import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

// 与 f05-u05、f05-u12 旅程相同的做法：主进程 fetch 改道到本机假 OpenAI 兼容服务，零真实模型调用。
export const FAKE_MODEL = Object.freeze({ id: 'redesign-drive-fixture', name: '驱动夹具模型', provider: 'openai', protocol: 'openai',
  modelName: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1', apiKey: 'redesign-drive-offline-key',
  maxTokens: 4096, temperature: 0.7, purposes: ['generation'] })

export const FIXTURE_PROSE = '林岚沿着旧港的石阶往下走，潮水刚退，青石上还留着一层薄薄的盐霜。她把父亲留下的地图摊在膝头，对照远处灯塔的位置，一格一格数过去。守塔人站在塔下朝她招手，说昨夜的钟声比往常早了一刻。'
const FIXTURE_REVISED = `${FIXTURE_PROSE}林岚把这句话记进日志，又核对了一遍潮位表。`
const REVIEW = JSON.stringify({ summary: '时间线需要核对。', items: [
  { category: '连续性', severity: 'warning', description: '核对钟声提前一刻与潮位的关系。', quote: '昨夜的钟声比往常早了一刻' },
], goalReviews: [] })

function responseFor(prompt) {
  if (prompt.includes('【已确认纳入本次修稿的审稿项】')) return { kind: 'revision', content: FIXTURE_REVISED }
  if (prompt.includes('goalReviews')) return { kind: 'review', content: REVIEW }
  if (prompt.includes('{"updates"')) return { kind: 'character-state', content: '{"updates":[]}' }
  return { kind: 'prose', content: FIXTURE_PROSE }
}

export async function startFakeModel(diagnostics) {
  const requests = []
  let held = null
  let holdEmbeddings = false
  let waiting = 0
  const gate = {
    /** 卡住之后的模型调用；embeddings 为 true 时连嵌入也卡住（参考文本入库这类只走嵌入的步骤）。 */
    hold: ({ embeddings = false } = {}) => { held ??= Promise.withResolvers(); holdEmbeddings = embeddings },
    release: () => { held?.resolve(); held = null; holdEmbeddings = false },
    /** 正卡在门上的请求数，场景据此确认运行已停在要截的那一步。 */
    get waiting() { return waiting },
  }
  const pass = async () => {
    if (!held) return
    waiting++
    try { await held.promise } finally { waiting-- }
  }
  const record = (kind, detail) => {
    requests.push(kind)
    diagnostics.push(`[fake-model] ${kind} <- ${detail}`)
  }
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${FAKE_MODEL.apiKey}`) {
      response.writeHead(403).end(); return
    }
    const body = JSON.parse(Buffer.concat(await Array.fromAsync(request)).toString('utf8'))
    if (request.url === '/v1/embeddings') {
      if (holdEmbeddings) await pass()
      const input = Array.isArray(body.input) ? body.input : [body.input]
      record('embedding', `${input.length} 条`)
      response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3] })) }))
      return
    }
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return }
    await pass()
    const prompt = (body.messages ?? []).map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')
    const { kind, content } = responseFor(prompt)
    record(kind, prompt.slice(0, 120).replace(/\s+/g, ' '))
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`)
    response.write('data: {"choices":[],"usage":{"prompt_tokens":400,"completion_tokens":200,"total_tokens":600}}\n\n')
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  server.unref()
  return { port: server.address().port, requests, gate,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}

/* global process */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inflateSync } from 'node:zlib'

const SIGNATURE = '89504e470d0a1a0a'
const CHANNELS = { 2: 3, 6: 4 }
/** 同一状态连续截图，渲染器在模糊与渐变上会有 ±1～2 级抖动，肉眼不可见；超过 2 级才算不同像素。 */
const CHANNEL_TOLERANCE = 2

/** 只解码截图实际产出的格式：8 位 RGB 或 RGBA、非隔行。返回 RGBA 像素。 */
function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), SIGNATURE, '不是 PNG')
  let width, height, channels
  const data = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const chunk = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); channels = CHANNELS[chunk[9]]
      assert(chunk[8] === 8 && channels && chunk[12] === 0, '只支持 8 位 RGB/RGBA 非隔行 PNG')
    } else if (type === 'IDAT') data.push(chunk)
    offset += length + 12
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      const paeth = () => {
        const p = left + up - upLeft
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      const predictor = [0, left, up, (left + up) >> 1, filter === 4 ? paeth() : 0][filter]
      line[x] = (line[x] + predictor) & 0xff
    }
    for (let x = 0; x < width; x++) {
      line.copy(pixels, (y * width + x) * 4, x * channels, x * channels + Math.min(channels, 4))
      if (channels === 3) pixels[(y * width + x) * 4 + 3] = 255
    }
    previous = line
  }
  return { width, height, pixels }
}

/** 不同像素占比，0 到 1。任一通道差值超过 threshold 即算不同；threshold 为 0 即逐字节比较。 */
function diffRatio(first, second, threshold = CHANNEL_TOLERANCE) {
  let different = 0
  for (let index = 0; index < first.pixels.length; index += 4) {
    for (let channel = 0; channel < 4; channel++) {
      if (Math.abs(first.pixels[index + channel] - second.pixels[index + channel]) > threshold) { different++; break }
    }
  }
  return different / (first.width * first.height)
}

const files = process.argv.slice(2).filter(arg => arg !== '--')
if (files.length < 2) {
  process.stderr.write('用法: node scripts/redesign/pixel-diff.mjs <基准.png> <对比.png>...\n')
  process.exit(2)
}
const [reference, ...others] = files.map(file => decodePng(fs.readFileSync(file)))
const ratios = others.map((image, index) => {
  const file = files[index + 1]
  if (image.width !== reference.width || image.height !== reference.height) {
    return { file, ratio: 1, strictRatio: 1, reason: `尺寸不同：${reference.width}×${reference.height} 对 ${image.width}×${image.height}` }
  }
  return { file, ratio: diffRatio(reference, image), strictRatio: diffRatio(reference, image, 0) }
})
const maxRatio = Math.max(...ratios.map(item => item.ratio))
process.stdout.write(`${JSON.stringify({ reference: files[0], channelTolerance: CHANNEL_TOLERANCE, ratios, maxRatio,
  pass: maxRatio < 0.005 })}\n`)
process.exitCode = maxRatio < 0.005 ? 0 : 1

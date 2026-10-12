import type { CommandExecuteParams, WorkflowGenerationRuntimeDependencies } from './base-command'
import type { ChapterInfo } from '../chapter-workflow'
import type { PreparedReviewRevisionContext } from '../../../shared/review-revision-generation'
import { ReviewRevisionCommand, type ReviewRevisionCommandSource } from './review-revision-command'
import { resolvePromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { promptLanguageText } from '../../prompt-language'
import { requireWorkflowProjectSession, workflowUiText } from '../workflow-project-session'

export interface HumanizeDraftParams extends ReviewRevisionCommandSource {
  chapterInfo: ChapterInfo
  userHumanizePrompt?: string
}

/** 去AI味 —— 复用修稿生命周期，但使用 humanize_draft 模板且不做材料准入（最小改动改写只需本章正文）。 */
export class HumanizeDraftCommand extends ReviewRevisionCommand {
  constructor(params: HumanizeDraftParams, dependencies?: WorkflowGenerationRuntimeDependencies) {
    super('humanize-draft', params, [
      { id: 'user-prompt', text: params.userHumanizePrompt ?? '' },
    ], {}, dependencies)
  }

  protected async generateAndCommit(prepared: PreparedReviewRevisionContext, params: CommandExecuteParams) {
    if (this.recovery?.composition && this.recovery.lastCompositionFinishReason === 'stop') {
      return this.generateRevision(prepared, params, '', '')
    }
    const frozen = prepared.context
    const language = frozen.writingLanguage
    params.callbacks.log(workflowUiText(params.context, '正在去除AI味...', 'Removing AI-generated flavor...'))
    const projectSession = requireWorkflowProjectSession(params.context)
    const template = await resolvePromptTemplate('humanize_draft', projectSession, language)
    if (!template) throw new Error(workflowUiText(params.context, '未找到去AI味模板', 'The de-AI prompt template was not found.'))
    const blueprint = frozen.blueprints.find(item => item.chapterNumber === frozen.source.chapterNumber)
    const userPrompt = frozen.authorInputs.find(input => input.id === 'user-prompt')?.text || ''
    const userPromptBlock = userPrompt.trim() ? promptLanguageText(language,
      `【用户额外去AI味指导（最高优先级）】\n${userPrompt}`,
      `[Additional de-AI guidance — highest priority]\n${userPrompt}`) : ''
    const builder = new ChapterPromptBuilder(template, language)
      .withDraftContent(frozen.source.content)
      .withChapterInfo({ projectPath: params.context.projectPath, chapterNumber: frozen.source.chapterNumber,
        title: blueprint?.title ?? '', role: blueprint?.role ?? '', purpose: blueprint?.purpose ?? '',
        characters: blueprint?.characters ?? [], keyEvents: blueprint?.keyEvents ?? '' })
      .withGlobalGuidance(frozen.config.globalGuidance || '')
      .withWritingStyle(frozen.config.writingStyle || '')
      .withUserRefinePrompt(userPromptBlock)
    try {
      return await this.generateRevision(prepared, params, builder.build(), builder.getSystemRole())
    } catch (error) {
      if (error instanceof Error && error.message.includes('GENERATION_REVIEW_REVISION_NOOP')) {
        throw new Error(workflowUiText(params.context,
          '模型未对正文做出实质修改，本次未生成修订稿；可补充附加要求后重试。',
          'The model made no substantive changes, so no revision was created. Add guidance and try again.'))
      }
      throw error
    }
  }
}

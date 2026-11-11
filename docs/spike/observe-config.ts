// 测试观察者插件（仅验证用，不进生产 overlay 的必选项）：
// 在 agent/created 与 agent/pre-step 输出 meta-controller 注入后的真实运行值，
// 供 scripts/verify-plugin.ts 断言 parallel / reasoning 两个维度。
// agent/pre-step 晚于全部 agent/created 监听器，读到的是首步实际生效值。
import type { Context } from 'cordis'

export const name = 'observe-config'
export const inject = ['agentLoop']

interface AgentLike {
  id: string
  model: { current(): { reasoningEffort?: string } | undefined }
}
type DshContext = Context & {
  agentLoop: { config: { maxParallelToolCalls: { get(): number } } }
  on: (event: string, listener: (payload: Record<string, unknown>) => void) => void
}

export function apply(ctx: Context): void {
  const dsh = ctx as DshContext
  const log = (tag: string, parallel: number, reasoning: string): void => {
    console.info(`OBSERVE tag=${tag} maxParallel=${parallel} reasoningEffort=${reasoning}`)
  }
  dsh.on('agent/created', (payload) => {
    const agent = payload.agent as AgentLike | undefined
    log('created', dsh.agentLoop.config.maxParallelToolCalls.get(), agent?.model?.current()?.reasoningEffort ?? 'unset')
  })
  // agent/pre-step 是 @mode waterfall（runtime-types.ts:348）：必须转发 next()，
  // 否则瀑布链断裂、driver 读到 undefined decision（'reading kind' 崩溃）。
  dsh.on('agent/pre-step', (payload, next: () => Promise<unknown>) => {
    const selection = payload.modelSelection as { reasoningEffort?: string } | undefined
    log('pre-step', dsh.agentLoop.config.maxParallelToolCalls.get(), selection?.reasoningEffort ?? 'unset')
    return next()
  })
}

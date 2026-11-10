// M0 验证插件：agent 创建时选中 meta-a preset（M2 元控制器的最小原型）。
// 依据：packages/core/agent/src/runtime-types.ts:290 的 agent/created 事件；
// select 必须在会话开始前调用（agent-preset-registry/src/index.ts:364-369）。
import type { Context } from '@deepseek-ai/cordis'

export const name = 'meta-verify-select'
export const inject = ['agentPresets']

export function apply(ctx: Context) {
  ctx.on('agent/created', async ({ agent }) => {
    await ctx.agentPresets.select(agent, 'meta-a')
  })
}
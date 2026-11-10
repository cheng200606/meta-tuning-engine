import type { Context } from 'cordis'

export const name = 'meta-controller'

// TODO(M2): 前置条件——docs/dsh-spike.md 第 1/2/3 项已确认：
//   1. PresetDefinition.plugins 数组项的确切格式（读 mountPreset 实现）
//   2. agentPresets.select 的调用时机与 agent-preset-locked 语义
//   3. 会话创建/模型切换事件名称
// 实现链路：读策略库 → 生成 PresetDefinition（systemPrompt.section +
//   agent-loop/default-model 配置）→ ctx.agentPresets.register → select。
// 校验失败一律回退默认配置；只在会话创建/模型切换时执行一次。
export function apply(_ctx: Context): void {}
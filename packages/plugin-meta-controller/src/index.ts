// M2 元控制器插件：策略库 → PresetDefinition → agent/created 时 select。
// 约束（docs/dsh-spike.md）：preset 内不放 agent-loop；select 必须在会话启动前；
// 函数插件 named export name/inject/Config/apply，无 default export；config 是 apply 第二参数。
import { z } from 'zod'
import type { Context } from 'cordis'
import { loadStore, lookupPolicy } from '@meta-tuning/policy-store'
import { parseConfig, DEFAULT_CONFIG } from '@meta-tuning/action-space'
import { promptTemplates } from '@meta-tuning/runner'

export const name = 'meta-controller'
export const inject = ['agentPresets']

export const Config = z.object({
  policyStore: z.string(),
  baseId: z.string(),
})
type Config = z.infer<typeof Config>

// DSH 服务/事件由 @deepseek-ai/dsh-agent-preset-registry 与 dsh-agent 做声明合并；
// 本仓库独立构建不引用 DSH workspace 包，用结构化局部类型（运行时由 DSH 提供）。
interface AgentHandle { id: string }
interface PresetsService {
  register(definition: unknown): () => void
  select(agent: AgentHandle, presetId: string): Promise<string>
}
type DshContext = Context & { agentPresets: PresetsService }

export function apply(ctx: Context, config: Config): void {
  const dsh = ctx as DshContext
  const store = loadStore(config.policyStore)
  const policy = lookupPolicy(store, config.baseId)
  // 无策略时回退默认配置（兜底纪律：元控制器故障不得阻塞 Agent）
  const agentConfig = parseConfig(policy ?? DEFAULT_CONFIG, { parallel_tool_calls: true, reasoning_effort: true })

  const definition = {
    id: `meta-${config.baseId}`,
    name: `Meta-controller (${config.baseId})`,
    description: `Auto-generated from policy store: ${agentConfig.prompt_style}`,
    order: 100,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: {
          prefix: promptTemplates[agentConfig.prompt_style],
          complete: true,
          includeRuntimeContext: false,
        },
      },
    ],
  }

  ctx.effect(() => dsh.agentPresets.register(definition))

  const onAgentCreated = (ctx as unknown as {
    on: (event: string, listener: (payload: { agent: AgentHandle }) => Promise<void>) => void
  }).on
  onAgentCreated('agent/created', async ({ agent }) => {
    await dsh.agentPresets.select(agent, definition.id)
  })
}
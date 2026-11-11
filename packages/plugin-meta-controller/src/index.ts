// M2/M2.1 元控制器插件：策略库 → PresetDefinition → agent/created 时 select。
// 约束（docs/dsh-spike.md）：preset 内不放 agent-loop；select 必须在会话启动前；
// 函数插件 named export name/inject/Config/apply，无 default export；config 是 apply 第二参数。
// M2.1：reasoning_effort 经 agent.model.select() 在步骤准备前覆盖（AgentModel 公开 API，
// 见 vendor packages/core/agent/src/model-selection.ts:117）；maxParallelToolCalls 经根部
// config 覆盖行注入（src/overlay.ts 生成，Volatile 外部只读、插件不可运行时改写）。
import { performance } from 'node:perf_hooks'
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
interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
interface AgentHandle {
  id: string
  model: { current(): ModelSelection | undefined; select(selection: Readonly<ModelSelection>): void }
}
interface PresetsService {
  register(definition: unknown): () => void
  select(agent: AgentHandle, presetId: string): Promise<string>
}
type DshContext = Context & {
  agentPresets: PresetsService
  on: (event: string, listener: (payload: { agent: AgentHandle }) => Promise<void> | void) => void
}

export function apply(ctx: Context, config: Config): void {
  const dsh = ctx as DshContext
  const t0 = performance.now()
  const store = loadStore(config.policyStore)
  const policy = lookupPolicy(store, config.baseId)
  const lookupMs = performance.now() - t0
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

  dsh.on('agent/created', async ({ agent }) => {
    // reasoning_effort 运行期注入：off = 不干预（adapter 默认）；low/high = 覆盖当前选路。
    // 必须在首个步骤准备前完成（之后 DSH 会拒绝 reasoning effort 变更）。
    if (agentConfig.reasoning_effort !== 'off') {
      const current = agent.model.current()
      if (current) {
        agent.model.select({ ...current, reasoningEffort: agentConfig.reasoning_effort })
      }
    }
    const t1 = performance.now()
    await dsh.agentPresets.select(agent, definition.id)
    const selectMs = performance.now() - t1
    // 注入延迟（M2 出口项：查表路径目标 <100ms）
    console.info(`[meta-controller] base=${config.baseId} lookupMs=${lookupMs.toFixed(2)} selectMs=${selectMs.toFixed(2)} persona=${agentConfig.prompt_style} parallel=${agentConfig.max_parallel_tool_calls} reasoning=${agentConfig.reasoning_effort}`)
  })
}

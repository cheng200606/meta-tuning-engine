// 启动期 overlay 生成器（M2.1）：策略库 + baseId → DSH --patch YAML。
// 依据（docs/dsh-spike.md + M2.1 源码核查）：
// - persona 走 preset（meta-controller 插件在 agent/created 时 select）；
// - maxParallelToolCalls 是 cordis Volatile（外部只读，值仅由所属 runtime 更新），
//   唯一受支持入口是根部 agent-loop 条目的 config 覆盖行（PatchOptions：同 id 按键合并，last-wins）；
// - reasoning_effort 是 agent 创建期选项，运行期可经 agent.model.select() 覆盖（插件内实现，非本文件）。
// 单一事实来源：maxParallelToolCalls 与插件读取同一份 policies.json。
import { lookupPolicy, loadStore, type PolicyStore } from '@meta-tuning/policy-store'
import { parseConfig, DEFAULT_CONFIG, type Availability } from '@meta-tuning/action-space'

export interface OverlaySpec {
  /** meta-controller 插件入口（src/index.ts 绝对路径，DSH loader 直接加载 TS）。 */
  pluginEntry: string
  /** policies.json 绝对路径。 */
  policyStore: string
  baseId: string
  /** headless profile 需显式插入 agent-preset-registry；web 组合已内置时省略。 */
  presetRegistry?: boolean
  /** 测试观察者插件入口（验证用：agent/created 与 agent/pre-step 时输出 OBSERVE 行）。 */
  observerEntry?: string
}

/** 读取策略并解析为有效配置（无策略回退默认，与插件兜底纪律一致）。 */
export function resolvePolicy(policyStore: string, baseId: string, availability: Availability) {
  const store: PolicyStore = loadStore(policyStore)
  return parseConfig(lookupPolicy(store, baseId) ?? DEFAULT_CONFIG, availability)
}

const yamlPath = (p: string): string => p.replaceAll('\\', '/')

/**
 * 生成 --patch overlay YAML。条目顺序即挂载顺序：
 * registry → meta-controller →（可选观察者）→ agent-loop config 覆盖行。
 */
export function buildOverlayYaml(spec: OverlaySpec, availability: Availability = { parallel_tool_calls: true, reasoning_effort: true }): string {
  const cfg = resolvePolicy(spec.policyStore, spec.baseId, availability)
  const lines: string[] = ['- insert:']
  if (spec.presetRegistry) {
    lines.push(
      '    - id: agent-preset-registry',
      "      name: '@deepseek-ai/dsh-agent-preset-registry'",
      '      config:',
      '        default: standard',
    )
  }
  lines.push(
    '    - id: meta-controller',
    `      name: ${yamlPath(spec.pluginEntry)}`,
    '      config:',
    `        policyStore: ${yamlPath(spec.policyStore)}`,
    `        baseId: ${spec.baseId}`,
  )
  if (spec.observerEntry) {
    lines.push(
      '    - id: observe-config',
      `      name: ${yamlPath(spec.observerEntry)}`,
    )
  }
  lines.push(
    '# M2.1：maxParallelToolCalls 为 cordis Volatile（只读），只能经根部条目 config 覆盖；',
    '# 与 meta-controller 同读一份 policies.json（单一事实来源）。',
    '- id: agent-loop',
    '  config:',
    `    maxParallelToolCalls: ${cfg.max_parallel_tool_calls}`,
  )
  return lines.join('\n') + '\n'
}

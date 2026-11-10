import { z } from 'zod'

export const PromptStyle = z.enum(['concise', 'step_by_step', 'constrained'])
export const ReasoningEffort = z.enum(['off', 'low', 'high'])

export const AgentConfigSchema = z.object({
  prompt_style: PromptStyle,
  max_parallel_tool_calls: z.number().int().min(1).max(3),
  reasoning_effort: ReasoningEffort,
})
export type AgentConfig = z.infer<typeof AgentConfigSchema>

export const DEFAULT_CONFIG: AgentConfig = {
  prompt_style: 'step_by_step',
  max_parallel_tool_calls: 1,
  reasoning_effort: 'off',
}

export interface Availability {
  parallel_tool_calls: boolean
  reasoning_effort: boolean
}

export function clipToAvailability(config: AgentConfig, av: Availability): AgentConfig {
  return {
    ...config,
    max_parallel_tool_calls: av.parallel_tool_calls ? config.max_parallel_tool_calls : 1,
    reasoning_effort: av.reasoning_effort ? config.reasoning_effort : 'off',
  }
}

export function parseConfig(raw: unknown, av: Availability): AgentConfig {
  const result = AgentConfigSchema.safeParse(raw)
  return clipToAvailability(result.success ? result.data : DEFAULT_CONFIG, av)
}

export function enumerateConfigs(av: Availability): AgentConfig[] {
  const configs: AgentConfig[] = []
  const parallels = av.parallel_tool_calls ? [1, 2, 3] : [1]
  const efforts = av.reasoning_effort ? ReasoningEffort.options : (['off'] as const)
  for (const prompt_style of PromptStyle.options)
    for (const p of parallels)
      for (const r of efforts)
        configs.push({ prompt_style, max_parallel_tool_calls: p, reasoning_effort: r })
  return configs
}

export function configId(config: AgentConfig): string {
  return `${config.prompt_style}-p${config.max_parallel_tool_calls}-r${config.reasoning_effort}`
}
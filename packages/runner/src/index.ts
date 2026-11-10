import type { AgentConfig } from '@meta-tuning/action-space'

export type TaskCategory = 'tool' | 'reasoning' | 'code'

export interface Task {
  id: string
  category: TaskCategory
  instruction: string
}

export interface RunContext {
  baseId: string
  baseUrl: string
  apiKey: string
  model: string
  config: AgentConfig
  seed: number
  maxSteps?: number
}

export interface EpisodeRecord {
  task_id: string
  base: string
  config_id: string
  seed: number
  success: boolean | 'infra_error'
  steps: number
  tool_calls: number
  tool_errors: number
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
  failure_reason: string | null
  trace_path: string | null
}

export const MAX_STEPS = 10

// TODO(M1): 最小 ReAct 循环 + OpenAI 兼容客户端 + mock 工具环境。
// 协议见 docs/g0-protocol.md；实现规格见 ../开发实验方案.md §4.1。
export async function runEpisode(_task: Task, _ctx: RunContext): Promise<EpisodeRecord> {
  throw new Error('M1 待实现')
}
import { configId, type AgentConfig } from '@meta-tuning/action-space'
import { MockTools, toolDefs } from './mock-tools.js'
import { promptTemplates } from './prompt-templates.js'

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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

interface ChatResponse {
  choices: Array<{ message: ChatMessage; finish_reason: string }>
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function chatCompletion(ctx: RunContext, messages: ChatMessage[], fetchImpl: FetchLike): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: ctx.model,
    messages,
    temperature: 0,
    seed: ctx.seed,
    tools: toolDefs.map((t) => ({ type: 'function', function: t })),
  }
  if (ctx.config.reasoning_effort !== 'off') body.reasoning_effort = ctx.config.reasoning_effort
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetchImpl(`${ctx.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.apiKey}` },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (attempt >= 3) throw new Error(`infra: network failure after 4 attempts: ${String(error)}`)
      await delay(1000 * 2 ** attempt)
      continue
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= 3) throw new Error(`infra: HTTP ${response.status} after 4 attempts`)
      await delay(1000 * 2 ** attempt)
      continue
    }
    if (!response.ok) throw new Error(`api error HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    return (await response.json()) as ChatResponse
  }
}

export async function runEpisode(
  task: Task,
  ctx: RunContext,
  check: (fs: MockTools['fs'], finalAnswer: string) => { pass: boolean; reason: string },
  tools: MockTools,
  fetchImpl: FetchLike = fetch,
): Promise<EpisodeRecord> {
  const started = Date.now()
  const maxSteps = ctx.maxSteps ?? MAX_STEPS
  const messages: ChatMessage[] = [
    { role: 'system', content: promptTemplates[ctx.config.prompt_style] },
    { role: 'user', content: task.instruction },
  ]
  const record: EpisodeRecord = {
    task_id: task.id,
    base: ctx.baseId,
    config_id: configId(ctx.config),
    seed: ctx.seed,
    success: false,
    steps: 0,
    tool_calls: 0,
    tool_errors: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    latency_ms: 0,
    failure_reason: null,
    trace_path: null,
  }
  let finalAnswer = ''
  try {
    for (let step = 0; step < maxSteps; step++) {
      const response = await chatCompletion(ctx, messages, fetchImpl)
      record.steps = step + 1
      record.prompt_tokens += response.usage?.prompt_tokens ?? 0
      record.completion_tokens += response.usage?.completion_tokens ?? 0
      const message = response.choices[0]?.message
      if (message === undefined) throw new Error('api error: empty choices')
      messages.push(message)
      finalAnswer = message.content ?? ''
      const calls = message.tool_calls ?? []
      if (calls.length === 0) break
      record.tool_calls += calls.length
      const limit = Math.max(1, ctx.config.max_parallel_tool_calls)
      for (let i = 0; i < calls.length; i += limit) {
        const batch = calls.slice(i, i + limit)
        const results = await Promise.all(
          batch.map(async (call) => {
            let args: Record<string, unknown>
            try {
              args = JSON.parse(call.function.arguments) as Record<string, unknown>
            } catch {
              record.tool_errors += 1
              return { id: call.id, content: 'invalid JSON arguments', isError: true }
            }
            const result = tools.call(call.function.name, args)
            if (result.isError) record.tool_errors += 1
            return { id: call.id, ...result }
          }),
        )
        for (const result of results) {
          messages.push({ role: 'tool', content: result.content, tool_call_id: result.id })
        }
      }
      if (step === maxSteps - 1) record.failure_reason = 'max_steps'
    }
    if (record.failure_reason === null) {
      const verdict = check(tools.fs, finalAnswer)
      record.success = verdict.pass
      if (!verdict.pass) record.failure_reason = verdict.reason
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    record.success = text.startsWith('infra:') ? 'infra_error' : false
    record.failure_reason = text
  }
  record.latency_ms = Date.now() - started
  return record
}
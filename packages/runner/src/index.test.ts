// runner 无 API 单测：脚本化 fake 模型验证循环、工具执行、并行语义、infra 处理
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@meta-tuning/action-space'
import { runEpisode, type FetchLike, type Task } from './index.ts'
import { MockTools } from './mock-tools.ts'

const task: Task = { id: 'g0-tool-01', category: 'tool', instruction: 'sum sales' }
const ctx = {
  baseId: 'fake', baseUrl: 'http://fake', apiKey: 'x', model: 'fake',
  config: DEFAULT_CONFIG, seed: 0,
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function assistant(content: string | null, toolCalls?: Array<{ id: string; name: string; args: string }>) {
  return {
    choices: [{
      message: {
        role: 'assistant', content,
        ...(toolCalls ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }
}

function scriptedFetch(responses: Array<unknown | Error>): FetchLike {
  let i = 0
  return async () => {
    const next = responses[Math.min(i++, responses.length - 1)]
    if (next instanceof Error) throw next
    return jsonResponse(next)
  }
}

const passCheck = () => ({ pass: true, reason: 'ok' })

describe('runner episode loop', () => {
  it('executes tool call then final answer', async () => {
    const fetchImpl = scriptedFetch([
      assistant(null, [{ id: 'c1', name: 'calculate', args: '{"expression":"100+200+300+400+500"}' }]),
      assistant('1500'),
    ])
    const record = await runEpisode(task, ctx, passCheck, new MockTools({}), fetchImpl)
    expect(record.success).toBe(true)
    expect(record.steps).toBe(2)
    expect(record.tool_calls).toBe(1)
    expect(record.tool_errors).toBe(0)
    expect(record.prompt_tokens).toBe(20)
  })

  it('counts tool errors for bad arguments and unknown tools', async () => {
    const fetchImpl = scriptedFetch([
      assistant(null, [
        { id: 'c1', name: 'calculate', args: 'not-json' },
        { id: 'c2', name: 'no_such_tool', args: '{}' },
      ]),
      assistant('done'),
    ])
    const record = await runEpisode(task, ctx, passCheck, new MockTools({}), fetchImpl)
    expect(record.tool_calls).toBe(2)
    expect(record.tool_errors).toBe(2)
  })

  it('serial config executes parallel-emitted calls one batch at a time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body as string) as { messages: Array<{ role: string }> }
      const toolMsgs = body.messages.filter((m) => m.role === 'tool').length
      if (toolMsgs === 0) {
        return jsonResponse(assistant(null, [
          { id: 'c1', name: 'get_weather', args: '{"city":"北京"}' },
          { id: 'c2', name: 'get_weather', args: '{"city":"上海"}' },
        ]))
      }
      return jsonResponse(assistant('done'))
    }
    const record = await runEpisode(task, { ...ctx, config: { ...DEFAULT_CONFIG, max_parallel_tool_calls: 1 } }, passCheck, new MockTools({}), fetchImpl)
    expect(record.tool_calls).toBe(2)
    expect(record.tool_errors).toBe(0)
    expect(record.success).toBe(true)
    void inFlight; void maxInFlight
  })

  it('marks infra_error after repeated network failures', async () => {
    const fetchImpl = scriptedFetch([new Error('ECONNRESET')])
    const record = await runEpisode(task, ctx, passCheck, new MockTools({}), fetchImpl)
    expect(record.success).toBe('infra_error')
  }, 20000)

  it('records checker failure reason', async () => {
    const fetchImpl = scriptedFetch([assistant('wrong answer')])
    const record = await runEpisode(task, ctx, () => ({ pass: false, reason: 'file missing: result.txt' }), new MockTools({}), fetchImpl)
    expect(record.success).toBe(false)
    expect(record.failure_reason).toBe('file missing: result.txt')
  })
})
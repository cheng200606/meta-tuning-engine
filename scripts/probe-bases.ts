// M0 spike 第 5 项：基座连通验证 + 可用性矩阵实测（开发实验方案 §3.4）
// 运行：node --env-file=.env --import tsx/esm scripts/probe-bases.ts
// 产出：docs/spike/availability-probe-report.json（人工审阅后填 configs/availability.yaml）
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases

const tools = [
  { type: 'function', function: { name: 'get_weather', description: 'Get weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
]

async function chat(base: BaseConfig, apiKey: string, body: Record<string, unknown>): Promise<{ ok: boolean; status?: number; json?: Record<string, unknown>; error?: string }> {
  try {
    const response = await fetch(`${base.base_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: base.model, temperature: 0, max_tokens: 256, ...body }),
      signal: AbortSignal.timeout(60000),
    })
    const text = await response.text()
    if (!response.ok) return { ok: false, status: response.status, error: text.slice(0, 300) }
    return { ok: true, status: response.status, json: JSON.parse(text) as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

interface ProbeResult {
  base: string
  model: string
  connectivity: { ok: boolean; detail: string }
  parallel_tool_calls: { supported: boolean | null; detail: string }
  reasoning_effort: { supported: boolean | null; detail: string }
}

const results: ProbeResult[] = []
for (const base of bases) {
  const apiKey = process.env[base.api_key_env]
  const result: ProbeResult = {
    base: base.id, model: base.model,
    connectivity: { ok: false, detail: apiKey ? '' : `missing env ${base.api_key_env}` },
    parallel_tool_calls: { supported: null, detail: 'skipped (no connectivity)' },
    reasoning_effort: { supported: null, detail: 'skipped (no connectivity)' },
  }
  if (apiKey) {
    const ping = await chat(base, apiKey, { messages: [{ role: 'user', content: 'Reply with the single word: ok' }] })
    result.connectivity = { ok: ping.ok, detail: ping.ok ? `HTTP ${ping.status}` : `HTTP ${ping.status ?? '-'} ${ping.error ?? ''}` }
    if (ping.ok) {
      // 并行探测：要求一次发出两个 tool call；API 接受请求且模型发出 >=2 个 call 记 true，
      // 只发 1 个记 null（模型行为问题，需人工复探），请求被拒记 false。
      const parallel = await chat(base, apiKey, {
        messages: [{ role: 'user', content: 'Call get_weather for Beijing AND Shanghai in a single response (two tool calls in one message).' }],
        tools, tool_choice: 'auto',
      })
      if (!parallel.ok) {
        result.parallel_tool_calls = { supported: false, detail: `request rejected: HTTP ${parallel.status} ${parallel.error ?? ''}` }
      } else {
        const message = (parallel.json?.choices as Array<{ message: { tool_calls?: unknown[] } }> | undefined)?.[0]?.message
        const count = message?.tool_calls?.length ?? 0
        result.parallel_tool_calls = { supported: count >= 2 ? true : null, detail: `tool_calls in one response: ${count}` }
      }
      // reasoning 探测：带 reasoning_effort=low 发最小请求；400/参数错误记 false，正常记 true。
      const reasoning = await chat(base, apiKey, {
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        reasoning_effort: 'low',
      })
      result.reasoning_effort = reasoning.ok
        ? { supported: true, detail: `HTTP ${reasoning.status} with reasoning_effort=low` }
        : { supported: false, detail: `HTTP ${reasoning.status ?? '-'} ${reasoning.error ?? ''}` }
    }
  }
  results.push(result)
  console.log(`${base.id}: connectivity=${result.connectivity.ok} parallel=${result.parallel_tool_calls.supported} reasoning=${result.reasoning_effort.supported}`)
}

const report = { date: new Date().toISOString(), note: 'null = 需人工复探；审阅后手工填 configs/availability.yaml', results }
writeFileSync(path.join(root, 'docs/spike/availability-probe-report.json'), JSON.stringify(report, null, 2))
console.log('report: docs/spike/availability-probe-report.json')
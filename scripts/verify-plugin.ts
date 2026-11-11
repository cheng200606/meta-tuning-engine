// M2.1 出口验证：元控制器插件三维度注入 —— persona（preset）+ maxParallelToolCalls（根部
// config 覆盖行）+ reasoning_effort（agent.model.select 运行期注入），并记录注入延迟。
// 全程无密钥：mock LLM + 观察者插件读取首步实际生效值。
// 运行：cd vendor/deepseek-harness && node --import tsx/esm ../../scripts/verify-plugin.ts
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '../vendor/deepseek-harness/packages/test-support/llm-mock-server/src/index.ts'
import { promptTemplates } from '../packages/runner/src/prompt-templates.ts'
import { buildOverlayYaml, resolvePolicy } from '../packages/plugin-meta-controller/src/overlay.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dsh = path.join(root, 'vendor/deepseek-harness')
const pluginEntry = path.join(root, 'packages/plugin-meta-controller/src/index.ts')
const observerEntry = path.join(root, 'docs/spike/observe-config.ts')
const policyStore = path.join(root, 'policies.json')
const availability = { parallel_tool_calls: true, reasoning_effort: true }

interface Case {
  baseId: string
  policyStore: string
  expectedPersona: string
  expectedParallel: number
  expectedReasoning: string // 'unset' 表示应为 adapter 默认（策略 off，未注入）
}

// 三个用例：两个真实基座策略（G0 最优）+ 一个合成策略（reasoning=low，验证运行期注入）。
const tmp = mkdtempSync(path.join(tmpdir(), 'meta-verify-'))
const reasoningStore = path.join(tmp, 'policies-reasoning.json')
writeFileSync(reasoningStore, JSON.stringify({
  version: 1,
  entries: [{
    base_id: 'test-base',
    config: { prompt_style: 'constrained', max_parallel_tool_calls: 2, reasoning_effort: 'low' },
    dev_score: 0.5,
    search_meta: { method: 'synthetic', episodes: 0, commit: 'n/a', date: new Date().toISOString().slice(0, 10) },
  }],
}, null, 2))

const cases: Case[] = [
  { baseId: 'deepseek-v3', policyStore, expectedPersona: promptTemplates.step_by_step, expectedParallel: resolvePolicy(policyStore, 'deepseek-v3', availability).max_parallel_tool_calls, expectedReasoning: 'unset' },
  { baseId: 'glm-4.5-air', policyStore, expectedPersona: promptTemplates.concise, expectedParallel: resolvePolicy(policyStore, 'glm-4.5-air', availability).max_parallel_tool_calls, expectedReasoning: 'unset' },
  { baseId: 'test-base', policyStore: reasoningStore, expectedPersona: promptTemplates.constrained, expectedParallel: 2, expectedReasoning: 'low' },
]

const results = []
try {
  for (const c of cases) {
    const server = await startMockLlmServer({ port: 0, sequence: ['success'], repeatLast: true, successText: 'MOCK_OK' })
    const overlay = path.join(tmp, `verify-plugin-${c.baseId}.yml`)
    writeFileSync(overlay, buildOverlayYaml({
      pluginEntry, policyStore: c.policyStore, baseId: c.baseId,
      presetRegistry: true, observerEntry,
    }, availability))
    const child = spawn(process.execPath, [
      '--import', 'tsx/esm', 'apps/cli/src/bin.ts',
      '--patch', overlay, '--profile', 'headless', 'Say hello',
    ], {
      cwd: dsh,
      env: { ...process.env, DEEPSEEK_API_KEY: 'mock-placeholder', DEEPSEEK_BASE_URL: server.baseURL, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (x) => { stdout += x })
    child.stderr.on('data', (x) => { stderr += x })
    const code = await new Promise((resolve) => child.on('exit', resolve))
    const bodies = server.requests.map((r) => JSON.stringify(r.body))
    const personaInjected = bodies.some((b) => b.includes(c.expectedPersona.slice(0, 60)))
    const metaLine = stdout.split('\n').find((l) => l.includes('[meta-controller]'))
    const meta = Object.fromEntries((metaLine?.split(' ').filter((t) => t.includes('=')).map((t) => t.split('=')) ?? []) as Array<[string, string]>)
    // pre-step 读到的是首步实际生效值；created 行仅作参考。
    const preStep = stdout.split('\n').find((l) => l.includes('OBSERVE tag=pre-step'))
    const observed = Object.fromEntries((preStep?.split(' ').filter((t) => t.includes('=')).map((t) => t.split('=')) ?? []) as Array<[string, string]>)
    results.push({
      baseId: c.baseId,
      headlessExit: code,
      requests: server.requests.length,
      personaInjected,
      observedMaxParallel: observed.maxParallel ?? null,
      observedReasoningEffort: observed.reasoningEffort ?? null,
      lookupMs: meta.lookupMs ? Number(meta.lookupMs) : null,
      selectMs: meta.selectMs ? Number(meta.selectMs) : null,
      stderr: stderr.slice(0, 400),
    })
    await server.close()
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
writeFileSync(path.join(root, 'docs/spike/verify-plugin-report.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2))
console.log(JSON.stringify(results, null, 2))
const pass = results.every((r) =>
  r.headlessExit === 0
  && r.requests > 0
  && r.personaInjected
  && Number(r.observedMaxParallel) === cases[results.indexOf(r)].expectedParallel
  && r.observedReasoningEffort === cases[results.indexOf(r)].expectedReasoning
  && r.lookupMs !== null && r.lookupMs < 100,
)
console.log(pass ? 'M2.1 VERIFY PASSED' : 'M2.1 VERIFY FAILED')
process.exit(pass ? 0 : 1)

// M2 出口验证：真实元控制器插件 + 策略库 → DSH 注入 → persona 进入模型请求。
// 对两个基座策略分别验证（deepseek-v3 → step_by_step；glm-4.5-air → concise）。
// 运行：cd vendor/deepseek-harness && node --import tsx/esm ../../scripts/verify-plugin.ts
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '../vendor/deepseek-harness/packages/test-support/llm-mock-server/src/index.ts'
import { promptTemplates } from '../packages/runner/src/prompt-templates.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dsh = path.join(root, 'vendor/deepseek-harness')
const pluginEntry = path.join(root, 'packages/plugin-meta-controller/src/index.ts').replaceAll('\\', '/')
const policyStore = path.join(root, 'policies.json').replaceAll('\\', '/')

const cases = [
  { baseId: 'deepseek-v3', expected: promptTemplates.step_by_step },
  { baseId: 'glm-4.5-air', expected: promptTemplates.concise },
]

const results = []
for (const c of cases) {
  const server = await startMockLlmServer({ port: 0, sequence: ['success'], repeatLast: true, successText: 'MOCK_OK' })
  const overlay = path.join(root, 'docs/spike', `verify-plugin-${c.baseId}.yml`)
  writeFileSync(overlay, [
    '- insert:',
    '    - id: agent-preset-registry',
    "      name: '@deepseek-ai/dsh-agent-preset-registry'",
    '      config:',
    '        default: standard',
    '    - id: meta-controller',
    `      name: ${pluginEntry}`,
    '      config:',
    `        policyStore: ${policyStore}`,
    `        baseId: ${c.baseId}`,
  ].join('\n'))
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
  const injected = bodies.some((b) => b.includes(c.expected.slice(0, 60)))
  results.push({ baseId: c.baseId, headlessExit: code, requests: server.requests.length, policyPersonaInjected: injected, stderr: stderr.slice(0, 400) })
  await server.close()
}
writeFileSync(path.join(root, 'docs/spike/verify-plugin-report.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2))
console.log(JSON.stringify(results, null, 2))
const pass = results.every((r) => r.headlessExit === 0 && r.requests > 0 && r.policyPersonaInjected)
console.log(pass ? 'M2 VERIFY PASSED' : 'M2 VERIFY FAILED')
process.exit(pass ? 0 : 1)
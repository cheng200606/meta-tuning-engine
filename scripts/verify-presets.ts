// M0 出口验证：静态 preset 经 --patch 加载后，persona 文本必须进入模型请求。
// 运行：node --import tsx/esm scripts/verify-presets.ts（在仓库根目录，需先构建 DSH）
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '../vendor/deepseek-harness/packages/test-support/llm-mock-server/src/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dsh = path.join(root, 'vendor/deepseek-harness')

const server = await startMockLlmServer({
  port: 0,
  sequence: ['success'],
  repeatLast: true,
  successText: 'MOCK_OK',
})

const patches = ['preset-registry.patch.yml', 'preset-a.patch.yml', 'preset-b.patch.yml', 'preset-select.patch.yml']
const args = [
  '--import', 'tsx/esm', 'apps/cli/src/bin.ts',
  ...patches.flatMap((p) => ['--patch', path.join(root, 'docs/spike', p)]),
  '--profile', 'headless', 'Say hello',
]

const child = spawn(process.execPath, args, {
  cwd: dsh,
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: 'mock-placeholder',
    DEEPSEEK_BASE_URL: server.baseURL,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (c) => { stdout += c })
child.stderr.on('data', (c) => { stderr += c })
const code = await new Promise<number | null>((resolve) => child.on('exit', resolve))

const bodies = server.requests.map((r) => JSON.stringify(r.body))
const personaA = bodies.some((b) => b.includes('efficient assistant'))
const personaB = bodies.some((b) => b.includes('step-by-step reasoning assistant'))
const report = {
  date: new Date().toISOString(),
  headlessExit: code,
  requests: server.requests.length,
  defaultPresetPersonaInjected: personaA,
  secondPresetPersonaObserved: personaB,
  pendingWarnings: stderr.includes('did not activate'),
  stdout: stdout.slice(0, 500),
  stderr: stderr.slice(0, 1000),
}
writeFileSync(path.join(root, 'docs/spike/verify-presets-report.json'), JSON.stringify(report, null, 2))
writeFileSync(path.join(root, 'docs/spike/verify-request-bodies.json'), JSON.stringify(server.requests.map((r) => r.body), null, 2))
await server.close()
console.log(JSON.stringify(report, null, 2))
if (code !== 0 || server.requests.length === 0 || !personaA || report.pendingWarnings) {
  console.error('VERIFY FAILED')
  process.exit(1)
}
console.log('VERIFY PASSED: default preset persona reached the model request')
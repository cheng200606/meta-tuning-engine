// 调试：中性 cwd 下 DSH headless 的请求形状与工具往返（跑完即删）
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '../../vendor/deepseek-harness/packages/test-support/llm-mock-server/src/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dsh = path.join(root, 'vendor/deepseek-harness')
const neutral = mkdtempSync(path.join(tmpdir(), 'neutral-cwd-'))
// 中性 cwd 下 --import tsx/esm 从 cwd 解析：junction 指回仓库的 tsx
mkdirSync(path.join(neutral, 'node_modules'), { recursive: true })
symlinkSync(path.join(root, 'node_modules/tsx'), path.join(neutral, 'node_modules/tsx'), 'junction')
const server = await startMockLlmServer({
  port: 0, sequence: ['tool_call_success', 'success'], repeatLast: true, successText: 'yes',
  toolName: 'get_weather', toolArguments: JSON.stringify({ city: '北京' }),
})
const overlay = path.join(root, 'docs/spike/_dbg.yml')
writeFileSync(overlay, [
  '- insert:',
  '    - id: g0-tools',
  `      name: ${path.join(root, 'packages/plugin-meta-controller/src/g0-tools.ts').replaceAll('\\', '/')}`,
  '      config:',
  '        taskId: g0-tool-02',
  `        dumpFsPath: ${path.join(neutral, 'fs.json').replaceAll('\\', '/')}`,
].join('\n'))
const child = spawn(process.execPath, [
  '--import', 'tsx/esm', path.join(dsh, 'apps/cli/src/bin.ts'),
  '--patch', overlay, '--profile', 'headless', '查询北京今天的天气。',
], {
  cwd: neutral,
  env: { ...process.env, DEEPSEEK_API_KEY: 'mock-placeholder', DEEPSEEK_BASE_URL: server.baseURL, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
let err = ''
child.stdout.on('data', (x) => { out += x })
child.stderr.on('data', (x) => { err += x })
const code = await new Promise((resolve) => child.on('exit', resolve))
const taskReq = server.requests.find((r) => JSON.stringify(r.body).includes('北京'))
console.log('exit', code, '| reqs', server.requests.length, '| stdout:', out.slice(0, 60))
server.requests.forEach((r, i) => {
  const b = r.body as { tools?: unknown[]; system?: string }
  console.log(`req${i}: tools=${(b.tools ?? []).length} system=${String(b.system ?? '').slice(0, 50)}`)
})
console.log('taskReq found:', taskReq !== undefined, '| reminder:', taskReq !== undefined ? String(JSON.stringify(taskReq.body)).includes('system-reminder') : 'n/a')
console.log('dump exists:', existsSync(path.join(neutral, 'fs.json')))
if (err) console.log('stderr:', err.slice(0, 200))
await server.close()

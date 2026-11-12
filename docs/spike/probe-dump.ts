// 调试：dump 管线验证——脚本化 get_weather→write_file，读回 dump 的 files 与 toolCalls（跑完即删）
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '../../vendor/deepseek-harness/packages/test-support/llm-mock-server/src/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dsh = path.join(root, 'vendor/deepseek-harness')
const tmp = mkdtempSync(path.join(tmpdir(), 'probe-dump-'))
const dumpFsPath = path.join(tmp, 'fs.json')
const server = await startMockLlmServer({
  port: 0, sequence: ['tool_call_success', 'tool_call_success', 'success'], repeatLast: true, successText: 'yes',
  toolName: 'get_weather', toolArguments: JSON.stringify({ city: '北京' }),
})
// 注意：mock 的 toolName 是服务器级参数——两次 tool_call_success 都会调 get_weather（写不了 coat.txt）。
// 本探针只验证：execute() 的记录与 exit 钩子是否落盘（非端到端任务判定）。
const overlay = path.join(tmp, 'overlay.yml')
writeFileSync(overlay, [
  '- insert:',
  '    - id: g0-tools',
  `      name: ${path.join(root, 'packages/plugin-meta-controller/src/g0-tools.ts').replaceAll('\\', '/')}`,
  '      config:',
  '        taskId: g0-tool-02',
  `        dumpFsPath: ${dumpFsPath.replaceAll('\\', '/')}`,
].join('\n'))
const child = spawn(process.execPath, [
  '--import', 'tsx/esm', path.join(dsh, 'apps/cli/src/bin.ts'),
  '--patch', overlay, '--profile', 'headless', '查询北京今天的天气。',
], { cwd: dsh, env: { ...process.env, DEEPSEEK_API_KEY: 'mock-placeholder', DEEPSEEK_BASE_URL: server.baseURL, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
const code = await new Promise((resolve) => child.on('exit', resolve))
console.log('exit', code, '| dump exists:', existsSync(dumpFsPath))
if (existsSync(dumpFsPath)) {
  const dump = JSON.parse(readFileSync(dumpFsPath, 'utf8')) as { files: Record<string, string>; toolCalls: Array<{ name: string; isError: boolean }> }
  console.log('files:', JSON.stringify(dump.files))
  console.log('toolCalls:', JSON.stringify(dump.toolCalls))
} else {
  console.log('DUMP MISSING — exit hook did not fire or path mismatch')
}
await server.close()

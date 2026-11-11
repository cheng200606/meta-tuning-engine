// 一致性校验通道的无密钥冒烟（M2 出口前置）：
// mock LLM 按脚本驱动 DSH 跑一个 G0 任务（g0-tool-04）：calculate 一次 → 最终答案 37.0，
// 验证 g0-tools 插件在 DSH 内注册与执行工具、FS 快照钩子生效、runner 判定器可验收 ——
// 即 DSH 侧评测通道全链路可用；真实模型下与 runner 通道的完成率对比（≤10pp）为下一步。
// 注：mock 服务器的 toolName/toolArguments 是服务器级参数（无法按请求编排不同调用），
// 故选单工具任务；多工具编排留给真实模型阶段。
// 运行：cd vendor/deepseek-harness && node --import tsx/esm ../../scripts/verify-consistency-smoke.ts
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer } from '../vendor/deepseek-harness/packages/test-support/llm-mock-server/src/index.ts'
import { checkers } from '../tasks/g0/checks/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dsh = path.join(root, 'vendor/deepseek-harness')
const TASK_ID = 'g0-tool-04'

const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<{ id: string; instruction: string }> }
const task = manifest.tasks.find((t) => t.id === TASK_ID)
if (task === undefined) throw new Error(`task ${TASK_ID} not in manifest`)

const tmp = mkdtempSync(path.join(tmpdir(), 'g0-consistency-'))
const dumpFsPath = path.join(tmp, 'fs.json')
const overlay = path.join(tmp, 'overlay.yml')
writeFileSync(overlay, [
  '- insert:',
  '    - id: agent-preset-registry',
  "      name: '@deepseek-ai/dsh-agent-preset-registry'",
  '      config:',
  '        default: standard',
  '    - id: meta-controller',
  `      name: ${path.join(root, 'packages/plugin-meta-controller/src/index.ts').replaceAll('\\', '/')}`,
  '      config:',
  `        policyStore: ${path.join(root, 'policies.json').replaceAll('\\', '/')}`,
  '        baseId: deepseek-v3',
  '    - id: g0-tools',
  `      name: ${path.join(root, 'packages/plugin-meta-controller/src/g0-tools.ts').replaceAll('\\', '/')}`,
  '      config:',
  `        taskId: ${TASK_ID}`,
  `        dumpFsPath: ${dumpFsPath.replaceAll('\\', '/')}`,
].join('\n'))

const server = await startMockLlmServer({
  port: 0,
  // 脚本化 episode：calculate 转换一次 → 最终回答 37.0
  sequence: ['tool_call_success', 'success'],
  repeatLast: true,
  successText: '37.0',
  toolName: 'calculate',
  toolArguments: '{"expression": "(98.6-32)*5/9"}',
})
const child = spawn(process.execPath, [
  '--import', 'tsx/esm', 'apps/cli/src/bin.ts',
  '--patch', overlay, '--profile', 'headless', task.instruction,
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
await server.close()

// 验证脚本化工具调用确实流经 DSH 工具执行器（进入第二次请求的 tools 结果）
const toolCalls = server.requests.flatMap((r) => {
  const choices = (r.body as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string } }> } }> }).choices ?? []
  return choices.flatMap((c) => c.message?.tool_calls ?? []).map((tc) => tc.function?.name ?? 'unknown')
})
const toolResults = server.requests.map((r) => JSON.stringify(r.body)).filter((b) => b.includes('"role":"tool"')).length

let checkPass = false
let checkReason = 'headless failed'
if (code === 0) {
  const checker = checkers[TASK_ID]
  const verdict = checker({ fs: undefined as never, finalAnswer: stdout.trim(), toolCalls: 0, toolErrors: 0 })
  checkPass = verdict.pass
  checkReason = verdict.reason
}

const fsDumped = existsSync(dumpFsPath)
const result = {
  date: new Date().toISOString(),
  taskId: TASK_ID,
  headlessExit: code,
  requests: server.requests.length,
  toolCalls,
  requestsWithToolResult: toolResults,
  // 请求体样本：核实 DSH 线格式（真实一致性驱动要从 trace 提取工具调用，需知道真实结构）
  secondRequestBody: server.requests[1] !== undefined ? JSON.stringify(server.requests[1].body).slice(0, 800) : null,
  finalAnswer: stdout.trim().slice(0, 120),
  fsDumped,
  checkPass,
  checkReason,
  stderr: stderr.slice(0, 400),
}
writeFileSync(path.join(root, 'docs/spike/verify-consistency-smoke-report.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
rmSync(tmp, { recursive: true, force: true })
// 工具调用往返的证据：工具结果消息出现（模型发起的 calculate 已在 DSH 内执行并回流）
const roundTripped = toolResults > 0 && JSON.stringify(server.requests.map((r) => r.body)).includes('calculate')
const pass = code === 0 && checkPass && roundTripped && fsDumped
console.log(pass ? 'CONSISTENCY SMOKE PASSED' : 'CONSISTENCY SMOKE FAILED')
process.exit(pass ? 0 : 1)

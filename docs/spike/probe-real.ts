// 调试：单集真实模型探针——g0-tool-02 × DSH 通道，全量 dump 诊断（跑完即删）
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dsh = path.join(root, 'vendor/deepseek-harness')

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const base = bases.find((b) => b.id === 'deepseek-v3')!
const apiKey = process.env[base.api_key_env]
if (!apiKey) throw new Error('missing key')

const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<{ id: string; instruction: string }> }
const task = manifest.tasks.find((t) => t.id === 'g0-tool-02')!

const tmp = mkdtempSync(path.join(tmpdir(), 'probe-real-'))
const store = path.join(tmp, 'policies.json')
writeFileSync(store, JSON.stringify({ version: 1, entries: [{ base_id: 'deepseek-v3', config: { prompt_style: 'step_by_step', max_parallel_tool_calls: 3, reasoning_effort: 'off' }, dev_score: 0, search_meta: { method: 'probe', episodes: 0, commit: 'n/a', date: '2026-11-13' } }] }))
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
  `        policyStore: ${store.replaceAll('\\', '/')}`,
  '        baseId: deepseek-v3',
  '    - id: g0-tools',
  `      name: ${path.join(root, 'packages/plugin-meta-controller/src/g0-tools.ts').replaceAll('\\', '/')}`,
  '      config:',
  '        taskId: g0-tool-02',
  `        dumpFsPath: ${dumpFsPath.replaceAll('\\', '/')}`,
].join('\n') + '\n- id: agent-loop\n  config:\n    maxParallelToolCalls: 3\n' + '- id: session-title\n  disabled: true\n')
const child = spawn(process.execPath, [
  '--import', 'tsx/esm', path.join(dsh, 'apps/cli/src/bin.ts'),
  '--patch', overlay, '--profile', 'headless', task.instruction,
], { cwd: dsh, env: { ...process.env, [base.api_key_env]: apiKey, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
child.stdout.on('data', (x) => { stdout += x })
child.stderr.on('data', (x) => { stderr += x })
const code = await new Promise((resolve) => child.on('exit', resolve))
console.log('exit', code)
console.log('stdout:', stdout.trim().slice(0, 200))
console.log('dump exists:', existsSync(dumpFsPath))
if (existsSync(dumpFsPath)) {
  const raw = readFileSync(dumpFsPath, 'utf8')
  console.log('dump raw head:', raw.slice(0, 300))
  const dump = JSON.parse(raw) as { files: Record<string, string>; toolCalls: Array<{ name: string; isError: boolean }> }
  console.log('files:', JSON.stringify(dump.files))
  console.log('toolCalls:', JSON.stringify(dump.toolCalls))
} else {
  console.log('stderr head:', stderr.slice(0, 800))
}
rmSync(tmp, { recursive: true, force: true })

// G0 mock 工具的 DSH 通道插件（M2 出口「一致性校验」的 DSH 侧工具环境）。
// 语义一致性策略：不复制任何工具逻辑，直接按相对路径复用 packages/runner 的
// MockTools / fixturesByTask（同一份代码 = 同一份语义）；每 episode 一个 DSH 进程
// （headless 一次性驱动），模块状态即天然重置。
// Config.dumpFsPath：进程退出时把虚拟 FS 快照落盘，驱动侧用同一判定器验收。
// 注意：本文件由 DSH 的 tsx 进程加载，@deepseek-ai/dsh-tools 无法从本仓库解析，
// 按相对路径直连 vendor 源文件（其内部依赖在 DSH workspace 内正常解析）。
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { Context } from 'cordis'
// 以下三个跨仓库相对导入是刻意的：语义一致性（一致性校验的前提）优先于模块边界整洁。
import { MockTools, toolDefs } from '../../runner/src/mock-tools.ts'
import { fixturesByTask } from '../../../tasks/g0/env/fixtures.ts'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- 同上
import { defineTool } from '../../../vendor/deepseek-harness/packages/core/tools/src/schema.ts'

export const name = 'g0-tools'
export const inject = ['tools']

export const Config = z.object({
  taskId: z.string(),
  dumpFsPath: z.string().optional(),
})
type Config = z.infer<typeof Config>

/** 标准 JSON Schema 属性 → DSH parameters 方言（per-field required 标志；键出现即必须为 true，可选参数整体省略）。 */
function toDshParameters(schema: { properties?: Record<string, { type?: string }>; required?: string[] }): Record<string, { type: string; required?: true }> {
  const out: Record<string, { type: string; required?: true }> = {}
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (schema.required?.includes(key) === true) out[key] = { type: prop.type ?? 'string', required: true }
    else out[key] = { type: prop.type ?? 'string' }
  }
  return out
}

export function apply(ctx: Context, config: Config): void {
  const mock = new MockTools(fixturesByTask[config.taskId] ?? {})
  // 工具使用档案：与 runner 通道对齐排查用（首轮一致性跑发现模型改用 DSH 内置 write，
  // 详见 experiments/*-m2-consistency 的首轮报告）
  const toolCalls: Array<{ name: string; isError: boolean }> = []
  for (const def of toolDefs) {
    ctx.tools.register(defineTool({
      name: def.name,
      description: def.description,
      parameters: toDshParameters(def.parameters as { properties?: Record<string, { type?: string }>; required?: string[] }),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { content: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: (value as { content: string }).content }],
      },
      async execute(args) {
        // 与 runner 通道对齐：错误以异常抛出（DSH 归一为错误工具结果，模型可见同一文案）。
        const result = mock.call(def.name, (args ?? {}) as Record<string, unknown>)
        toolCalls.push({ name: def.name, isError: result.isError })
        if (result.isError) throw new Error(result.content)
        return { content: result.content }
      },
    }))
  }
  // 工具面隔离：agent 作用域内只保留 G0 的 8 个 mock 工具，屏蔽 DSH 内置工具，
  // 否则模型会用内置 write/read（写真实沙箱而非虚拟 FS），破坏双通道可比性。
  const dsh = ctx as unknown as {
    on: (event: string, listener: (payload: { agent: { ctx: { tools: { restrict(filter: { allow: string[] }): () => void } } } }) => void) => void
  }
  dsh.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: toolDefs.map((d) => d.name) })
  })
  if (config.dumpFsPath !== undefined) {
    process.on('exit', () => {
      try {
        writeFileSync(config.dumpFsPath as string, JSON.stringify({ files: mock.fs.snapshot(), toolCalls }))
      } catch { /* exit path best-effort */ }
    })
  }
}

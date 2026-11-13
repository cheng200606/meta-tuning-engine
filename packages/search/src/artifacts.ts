// M3 实验产物三件套统一落盘器（experiments/README.md 规范 + G0 协议 §6 数据记录纪律）。
// 与 runner 解耦：EpisodeRecord 用结构化类型接收，search 包不新增对 runner 的依赖。
// 设计要点：产物在「一次运行」内闭环——快照先写、逐集 append、末了汇总 report，
// 任何时刻崩溃都保留已产生的 episode 行，便于按 infra_error 纪律补跑而非静默丢弃。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { RewardWeights } from './index.js'

/** 与 packages/runner 的 EpisodeRecord 同构（结构化兼容）。 */
export interface SearchEpisodeRecord {
  task_id: string
  base: string
  config_id: string
  seed: number
  success: boolean | 'infra_error'
  steps: number
  tool_calls: number
  tool_errors: number
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
  failure_reason: string | null
  trace_path: string | null
}

export interface SnapshotMeta {
  method: 'halving' | 'random'
  base_id: string
  model: string
  seed: number
  commit: string
  approval: string
  protocol_ref: string
  g0_manifest_hash: string
  dev_manifest_hash: string
  configs: string[]
  tasks: string[]
  temperature: number
  max_steps: number
  seeds: number[]
  margin: number
  weights: RewardWeights
  rounds: Array<{ keep: number; tasks: string[]; seeds: number[] }> | null
  estimated_episodes: number
}

export interface InfraErrorEntry {
  task_id: string
  config_id: string
  seed: number
  reason: string
}

export type ArtifactStatus = 'ok' | 'aborted_infra_error' | 'aborted_error'

export interface ReportEnvelope {
  status: ArtifactStatus
  method: string
  base_id: string
  seed: number
  commit: string
  approval: string
  protocol_ref: string
  tokens: { prompt: number; completion: number; total: number }
  episodes_written: number
  /** 发生过补跑的 episode（含补跑成功者）——协议 §2 要求全程留痕，不得静默替换。 */
  infra_reruns: InfraErrorEntry[]
  /** 补跑后仍失败、导致跑批中止的 episode。 */
  infra_errors: InfraErrorEntry[]
  result: unknown
  abort_reason: string | null
}

export const REQUIRED_SNAPSHOT_FIELDS = [
  'method', 'base_id', 'model', 'seed', 'commit', 'approval', 'protocol_ref',
  'g0_manifest_hash', 'dev_manifest_hash', 'configs', 'tasks', 'temperature',
  'max_steps', 'seeds', 'margin', 'weights', 'estimated_episodes',
] as const

export const REQUIRED_REPORT_FIELDS = [
  'status', 'method', 'base_id', 'seed', 'commit', 'tokens',
  'episodes_written', 'infra_reruns', 'infra_errors', 'result',
] as const

export interface ArtifactWriter {
  readonly dir: string
  readonly snapshotPath: string
  readonly episodesPath: string
  readonly reportPath: string
  appendEpisode(record: SearchEpisodeRecord): void
  recordInfra(entry: InfraErrorEntry): void
  recordInfraRerun(entry: InfraErrorEntry): void
  finalize(result: unknown, status?: ArtifactStatus, abortReason?: string): ReportEnvelope
}

export function createArtifactWriter(dir: string, meta: SnapshotMeta): ArtifactWriter {
  mkdirSync(dir, { recursive: true })
  const snapshotPath = path.join(dir, 'config.snapshot.json')
  const episodesPath = path.join(dir, 'episodes.jsonl')
  const reportPath = path.join(dir, 'report.json')
  writeFileSync(snapshotPath, JSON.stringify(meta, null, 2))
  writeFileSync(episodesPath, '') // 显式置空，杜绝同日重跑追加到旧文件

  const tokens = { prompt: 0, completion: 0, total: 0 }
  const infraErrors: InfraErrorEntry[] = []
  const infraReruns: InfraErrorEntry[] = []
  let episodesWritten = 0

  return {
    dir,
    snapshotPath,
    episodesPath,
    reportPath,
    appendEpisode(record) {
      appendFileSync(episodesPath, JSON.stringify(record) + '\n')
      episodesWritten += 1
      tokens.prompt += record.prompt_tokens
      tokens.completion += record.completion_tokens
      tokens.total += record.prompt_tokens + record.completion_tokens
    },
    recordInfra(entry) {
      infraErrors.push(entry)
    },
    recordInfraRerun(entry) {
      infraReruns.push(entry)
    },
    finalize(result, status = 'ok', abortReason) {
      const report: ReportEnvelope = {
        status,
        method: meta.method,
        base_id: meta.base_id,
        seed: meta.seed,
        commit: meta.commit,
        approval: meta.approval,
        protocol_ref: meta.protocol_ref,
        tokens: { ...tokens },
        episodes_written: episodesWritten,
        infra_reruns: [...infraReruns],
        infra_errors: [...infraErrors],
        result,
        abort_reason: abortReason ?? null,
      }
      writeFileSync(reportPath, JSON.stringify(report, null, 2))
      return report
    },
  }
}

export interface ArtifactValidation {
  ok: boolean
  problems: string[]
  episodes: number
  snapshot: Record<string, unknown> | null
  report: Record<string, unknown> | null
}

/** 离线校验三件套：文件齐全、必填字段、JSONL 可解析、行数与 report 一致、status 与 result 自洽。 */
export function validateArtifacts(dir: string): ArtifactValidation {
  const problems: string[] = []
  const snapshotPath = path.join(dir, 'config.snapshot.json')
  const episodesPath = path.join(dir, 'episodes.jsonl')
  const reportPath = path.join(dir, 'report.json')
  for (const p of [snapshotPath, episodesPath, reportPath]) {
    if (!existsSync(p)) problems.push(`missing ${path.basename(p)}`)
  }
  if (problems.length > 0) return { ok: false, problems, episodes: 0, snapshot: null, report: null }

  let snapshot: Record<string, unknown>
  let report: Record<string, unknown>
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    return { ok: false, problems: [`invalid JSON: ${String(error)}`], episodes: 0, snapshot: null, report: null }
  }

  for (const key of REQUIRED_SNAPSHOT_FIELDS) if (!(key in snapshot)) problems.push(`snapshot missing field: ${key}`)
  for (const key of REQUIRED_REPORT_FIELDS) if (!(key in report)) problems.push(`report missing field: ${key}`)

  const lines = readFileSync(episodesPath, 'utf8').split('\n').filter((l) => l.trim().length > 0)
  for (const [i, line] of lines.entries()) {
    try {
      const record = JSON.parse(line) as Record<string, unknown>
      for (const key of ['task_id', 'config_id', 'seed', 'success']) {
        if (!(key in record)) problems.push(`episode line ${i + 1} missing field: ${key}`)
      }
    } catch (error) {
      problems.push(`episode line ${i + 1} invalid JSON: ${String(error)}`)
    }
  }
  if (report.episodes_written !== lines.length) {
    problems.push(`episodes_written (${String(report.episodes_written)}) != jsonl lines (${lines.length})`)
  }
  if (report.status === 'ok' && (report.result === null || report.result === undefined)) {
    problems.push('status=ok but result is null')
  }
  if (report.status !== 'ok' && !String(report.abort_reason ?? '').trim()) {
    problems.push('aborted run missing abort_reason')
  }
  const result = report.result as { episodes?: unknown } | null
  if (report.status === 'ok' && typeof result?.episodes === 'number' && result.episodes !== lines.length) {
    problems.push(`result.episodes (${result.episodes}) != jsonl lines (${lines.length})`)
  }
  return { ok: problems.length === 0, problems, episodes: lines.length, snapshot, report }
}

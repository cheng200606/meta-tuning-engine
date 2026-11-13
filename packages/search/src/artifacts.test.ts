// 迭代 2 P0 验收：实验产物三件套落盘与离线校验（零 API、纯文件系统）。
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  createArtifactWriter, validateArtifacts,
  REQUIRED_REPORT_FIELDS, REQUIRED_SNAPSHOT_FIELDS,
  type SearchEpisodeRecord, type SnapshotMeta,
} from './artifacts.js'
import { DEFAULT_WEIGHTS } from './index.js'

const dir = path.resolve(process.cwd(), 'analysis/out/artifacts-test')

const meta = (): SnapshotMeta => ({
  method: 'halving',
  base_id: 'deepseek-v3',
  model: 'deepseek-chat',
  seed: 0,
  commit: 'test-commit',
  approval: 'unit-test',
  protocol_ref: 'experiments/README.md',
  g0_manifest_hash: 'a'.repeat(64),
  dev_manifest_hash: 'b'.repeat(64),
  configs: ['concise-p1-roff'],
  tasks: ['t1', 't2'],
  temperature: 0,
  max_steps: 10,
  seeds: [0],
  margin: 0.05,
  weights: DEFAULT_WEIGHTS,
  rounds: [{ keep: 1, tasks: ['t1', 't2'], seeds: [0] }],
  estimated_episodes: 2,
})

const episode = (taskId: string, success: boolean | 'infra_error' = true): SearchEpisodeRecord => ({
  task_id: taskId, base: 'deepseek-v3', config_id: 'concise-p1-roff', seed: 0,
  success, steps: 2, tool_calls: 1, tool_errors: 0,
  prompt_tokens: 100, completion_tokens: 50, latency_ms: 5,
  failure_reason: success === 'infra_error' ? 'infra: HTTP 429' : null, trace_path: null,
})

describe('experiment artifacts', () => {
  beforeEach(() => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) })
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

  it('三件套齐全、必填字段完整、token 汇总与 JSONL 行数一致', () => {
    const w = createArtifactWriter(dir, meta())
    w.appendEpisode(episode('t1'))
    w.appendEpisode(episode('t2'))
    const report = w.finalize({ episodes: 2, best_config_id: 'concise-p1-roff' }, 'ok')
    expect(report.status).toBe('ok')
    expect(report.tokens).toEqual({ prompt: 200, completion: 100, total: 300 })
    expect(report.episodes_written).toBe(2)
    expect(report.infra_reruns).toEqual([])
    expect(report.infra_errors).toEqual([])
    const v = validateArtifacts(dir)
    expect(v.problems).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.episodes).toBe(2)
    for (const key of REQUIRED_SNAPSHOT_FIELDS) expect(v.snapshot).toHaveProperty(key)
    for (const key of REQUIRED_REPORT_FIELDS) expect(v.report).toHaveProperty(key)
  })

  it('infra_error 补跑仍失败时留痕并中止：result=null、abort_reason 必填', () => {
    const w = createArtifactWriter(dir, meta())
    w.recordInfraRerun({ task_id: 't1', config_id: 'concise-p1-roff', seed: 0, reason: 'infra: HTTP 429' })
    w.recordInfra({ task_id: 't1', config_id: 'concise-p1-roff', seed: 0, reason: 'infra: HTTP 429' })
    w.appendEpisode(episode('t1', 'infra_error'))
    const report = w.finalize(null, 'aborted_infra_error', 'infra_error persisted after one rerun: t1')
    expect(report.status).toBe('aborted_infra_error')
    expect(report.result).toBeNull()
    expect(report.infra_errors).toHaveLength(1)
    expect(report.infra_reruns).toHaveLength(1)
    const v = validateArtifacts(dir)
    expect(v.ok).toBe(true)
    expect(v.episodes).toBe(1)
  })

  it('补跑成功的 infra_error 也留痕，不得静默替换数据点', () => {
    const w = createArtifactWriter(dir, meta())
    w.recordInfraRerun({ task_id: 't1', config_id: 'concise-p1-roff', seed: 0, reason: 'infra: HTTP 429' })
    w.appendEpisode(episode('t1'))
    const report = w.finalize({ episodes: 1 }, 'ok')
    expect(report.status).toBe('ok')
    expect(report.infra_reruns).toHaveLength(1)
    expect(report.infra_errors).toHaveLength(0)
    expect(validateArtifacts(dir).ok).toBe(true)
  })

  it('重跑同一目录会置空旧 episodes.jsonl，不把两次运行的数据混在一起', () => {
    const first = createArtifactWriter(dir, meta())
    first.appendEpisode(episode('t1'))
    first.finalize({ episodes: 1 }, 'ok')
    const second = createArtifactWriter(dir, meta())
    second.appendEpisode(episode('t2'))
    second.finalize({ episodes: 1 }, 'ok')
    expect(readFileSync(path.join(dir, 'episodes.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(validateArtifacts(dir).ok).toBe(true)
  })

  it('校验器能检出缺字段、行数不一致与非法 JSONL', () => {
    const w = createArtifactWriter(dir, meta())
    w.appendEpisode(episode('t1'))
    w.finalize({ episodes: 1 }, 'ok')
    writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ status: 'ok', result: { episodes: 1 } }))
    expect(validateArtifacts(dir).problems.some((p) => p.includes('report missing field'))).toBe(true)

    const w2 = createArtifactWriter(dir, meta())
    w2.appendEpisode(episode('t1'))
    w2.appendEpisode(episode('t2'))
    w2.finalize({ episodes: 2 }, 'ok')
    writeFileSync(path.join(dir, 'episodes.jsonl'), '{broken json\n')
    expect(validateArtifacts(dir).problems.some((p) => p.includes('invalid JSON'))).toBe(true)

    const w3 = createArtifactWriter(dir, meta())
    w3.appendEpisode(episode('t1'))
    const badReport = w3.finalize({ episodes: 1 }, 'ok')
    badReport.episodes_written = 99
    writeFileSync(path.join(dir, 'report.json'), JSON.stringify(badReport))
    expect(validateArtifacts(dir).problems.some((p) => p.includes('!= jsonl lines'))).toBe(true)
  })
})

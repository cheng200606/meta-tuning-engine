// M3 核心搜索算法（P1）：successive halving + 等预算随机对照。
// 规格：开发实验方案.md §6.2/§6.3 —— 轮次淘汰、得分差 < 裕量不淘汰（并列保留）、
// 奖励 = 0.6·success + 0.2·tool_accuracy − 0.1·norm_steps − 0.1·norm_cost（cohort 内 min-max）。
// 搜索器与执行环境解耦：注入 EpisodeRunner（真实 runner / mock / 回放均可）。
import { configId, type AgentConfig } from '@meta-tuning/action-space'
import { minMaxNormalizer, reward, type MetricMeans, type RewardWeights } from './index.js'

/** 单集指标（runner 的 EpisodeRecord 可直接映射到此）。 */
export interface EpisodeMetrics {
  success: boolean
  tool_accuracy: number
  steps: number
  /** 归一前成本（如 tokens 或元；同 cohort 内 min-max）。 */
  cost: number
}

/** 单集执行器：搜索器不关心底层实现。 */
export type EpisodeRunner = (config: AgentConfig, taskId: string, seed: number) => Promise<EpisodeMetrics>

export interface SearchTask {
  id: string
}

/** 一轮：在当前幸存者上用 tasks×seeds 评估，轮末按分保留 keep 个。 */
export interface HalvingRound {
  keep: number
  tasks: SearchTask[]
  seeds: number[]
}

export interface HalvingSpec {
  baseId: string
  configs: AgentConfig[]
  rounds: HalvingRound[]
  /** 淘汰裕量（方案 §6.2：5pp）。与第 keep 名的得分差 < margin 者并列保留。 */
  margin?: number
  weights?: RewardWeights
  runEpisode: EpisodeRunner
}

export interface RoundLogEntry {
  round: number
  evaluated: string[]
  scores: Record<string, number>
  kept: string[]
  episodes: number
}

export interface HalvingOutcome {
  base_id: string
  best: AgentConfig
  best_config_id: string
  scores: Record<string, number>
  survivors: string[]
  roundLog: RoundLogEntry[]
  episodes: number
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)

/** 对一组已评估 episode 聚合出 cohort 内归一化的奖励分。 */
function cohortScore(episodes: Map<string, EpisodeMetrics[]>, weights: RewardWeights): Record<string, number> {
  const all = [...episodes.values()].flat()
  const normSteps = minMaxNormalizer(all.map((e) => e.steps))
  const normCost = minMaxNormalizer(all.map((e) => e.cost))
  const scores: Record<string, number> = {}
  for (const [cid, eps] of episodes) {
    const m: MetricMeans = {
      success_rate: mean(eps.map((e) => (e.success ? 1 : 0))),
      tool_accuracy: mean(eps.map((e) => e.tool_accuracy)),
      norm_steps: mean(eps.map((e) => normSteps(e.steps))),
      norm_cost: mean(eps.map((e) => normCost(e.cost))),
    }
    scores[cid] = reward(m, weights)
  }
  return scores
}

/** 幸存者选择：按分取前 keep，分差 < margin 的并列一并保留。 */
function selectSurvivors(scores: Record<string, number>, keep: number, margin: number): string[] {
  const ranked = [...Object.entries(scores)].sort(([, a], [, b]) => b - a)
  const kept: string[] = []
  const cutoffIndex = Math.min(keep, ranked.length) - 1
  const cutoff = ranked[cutoffIndex]?.[1] ?? -Infinity
  for (const [cid, score] of ranked) {
    if (kept.length < keep || score >= cutoff - margin) kept.push(cid)
  }
  return kept
}

/** 末轮冠军：确定性平局打破（分数降序，同分取字典序较小者）。 */
function champion(scores: Record<string, number>): string {
  return [...Object.entries(scores)].sort(([cidA, scoreA], [cidB, scoreB]) => scoreB - scoreA || cidA.localeCompare(cidB))[0][0]
}

export async function successiveHalving(spec: HalvingSpec): Promise<HalvingOutcome> {
  const margin = spec.margin ?? 0.05
  const weights = spec.weights ?? { success: 0.6, toolAccuracy: 0.2, steps: 0.1, cost: 0.1 }
  if (spec.configs.length === 0) throw new Error('configs empty')
  if (spec.rounds.length === 0) throw new Error('rounds empty')
  const byId = new Map(spec.configs.map((c) => [configId(c), c] as const))
  let survivors = [...byId.keys()]
  const roundLog: RoundLogEntry[] = []
  let episodes = 0
  const totalScores: Record<string, number> = {}

  for (let r = 0; r < spec.rounds.length; r++) {
    const round = spec.rounds[r]
    if (round.keep <= 0) throw new Error(`round ${r}: keep must be positive`)
    const evaluated = new Map<string, EpisodeMetrics[]>()
    for (const cid of survivors) {
      const config = byId.get(cid)
      if (config === undefined) throw new Error(`survivor ${cid} not in configs`)
      const eps: EpisodeMetrics[] = []
      for (const task of round.tasks) {
        for (const seed of round.seeds) {
          eps.push(await spec.runEpisode(config, task.id, seed))
          episodes += 1
        }
      }
      evaluated.set(cid, eps)
    }
    const scores = cohortScore(evaluated, weights)
    for (const [cid, s] of Object.entries(scores)) totalScores[cid] = s
    // 末轮仅在多轮赛制下取唯一冠军（确定性平局打破）；单轮搜索按 keep+margin 正常保留。
    const isFinal = r === spec.rounds.length - 1
    const kept = isFinal && spec.rounds.length > 1
      ? [champion(scores)] // 末轮冠军：确定性平局打破（分数字典序）
      : selectSurvivors(scores, round.keep, margin)
    survivors = survivors.filter((cid) => kept.includes(cid))
    roundLog.push({ round: r, evaluated: [...evaluated.keys()], scores, kept: survivors, episodes: round.tasks.length * round.seeds.length * evaluated.size })
  }

  const bestCid = [...survivors].sort((a, b) => (totalScores[b] ?? 0) - (totalScores[a] ?? 0) || a.localeCompare(b))[0]
  return {
    base_id: spec.baseId,
    best: byId.get(bestCid) as AgentConfig,
    best_config_id: bestCid,
    scores: totalScores,
    survivors,
    roundLog,
    episodes,
  }
}

/** 可注入种子的确定性 PRNG（mulberry32），随机对照与测试共用。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RandomOutcome {
  base_id: string
  best: AgentConfig
  best_config_id: string
  scores: Record<string, number>
  episodes: number
  /** 每配置实际获得的 episode 数（等预算下的采样记账）。 */
  samples: Record<string, number>
}

/**
 * 等预算随机对照（方案 §6.4 基线 4）：用与 halving 相同的总 episode 预算，
 * 均匀随机采样配置跑完预算，按同一奖励函数择优。
 */
export async function equalBudgetRandom(spec: Omit<HalvingSpec, 'rounds' | 'margin'> & {
  budget: number
  tasks: SearchTask[]
  seeds: number[]
  rng?: () => number
}): Promise<RandomOutcome> {
  const weights = spec.weights ?? { success: 0.6, toolAccuracy: 0.2, steps: 0.1, cost: 0.1 }
  if (spec.configs.length === 0) throw new Error('configs empty')
  const rng = spec.rng ?? mulberry32(0)
  const byId = new Map(spec.configs.map((c) => [configId(c), c] as const))
  const cids = [...byId.keys()]
  const episodes = new Map<string, EpisodeMetrics[]>()
  const samples: Record<string, number> = {}
  for (const cid of cids) { episodes.set(cid, []); samples[cid] = 0 }
  for (let i = 0; i < spec.budget; i++) {
    const cid = cids[Math.floor(rng() * cids.length) % cids.length]
    const task = spec.tasks[Math.floor(rng() * spec.tasks.length) % spec.tasks.length]
    const seed = spec.seeds[Math.floor(rng() * spec.seeds.length) % spec.seeds.length]
    episodes.get(cid)!.push(await spec.runEpisode(byId.get(cid) as AgentConfig, task.id, seed))
    samples[cid] += 1
  }
  const scores = cohortScore(episodes, weights)
  const bestCid = [...cids].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))[0]
  return {
    base_id: spec.baseId,
    best: byId.get(bestCid) as AgentConfig,
    best_config_id: bestCid,
    scores,
    episodes: spec.budget,
    samples,
  }
}

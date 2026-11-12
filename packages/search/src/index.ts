import type { AgentConfig } from '@meta-tuning/action-space'

export interface RewardWeights {
  success: number
  toolAccuracy: number
  steps: number
  cost: number
}

export const DEFAULT_WEIGHTS: RewardWeights = {
  success: 0.6,
  toolAccuracy: 0.2,
  steps: 0.1,
  cost: 0.1,
}

export interface MetricMeans {
  success_rate: number
  tool_accuracy: number
  norm_steps: number
  norm_cost: number
}

export function reward(m: MetricMeans, w: RewardWeights = DEFAULT_WEIGHTS): number {
  return (
    w.success * m.success_rate +
    w.toolAccuracy * m.tool_accuracy -
    w.steps * m.norm_steps -
    w.cost * m.norm_cost
  )
}

export function minMaxNormalizer(values: number[]): (v: number) => number {
  if (values.length === 0) return () => 0
  const min = Math.min(...values)
  const max = Math.max(...values)
  return (v) => (max === min ? 0 : (v - min) / (max - min))
}

export interface SearchOutcome {
  base_id: string
  best: AgentConfig
  scores: Record<string, number>
  episodes: number
}

export {
  successiveHalving,
  equalBudgetRandom,
  mulberry32,
  type EpisodeMetrics,
  type EpisodeRunner,
  type SearchTask,
  type HalvingRound,
  type HalvingSpec,
  type HalvingOutcome,
  type RoundLogEntry,
  type RandomOutcome,
} from './halving.js'
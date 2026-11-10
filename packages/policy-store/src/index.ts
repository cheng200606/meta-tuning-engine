import { readFileSync, writeFileSync } from 'node:fs'
import type { AgentConfig } from '@meta-tuning/action-space'

export interface SearchMeta {
  method: string
  episodes: number
  commit: string
  date: string
}

export interface PolicyEntry {
  base_id: string
  profile?: Record<string, number | boolean>
  config: AgentConfig
  dev_score: number
  search_meta: SearchMeta
}

export interface PolicyStore {
  version: 1
  entries: PolicyEntry[]
}

export function loadStore(path: string): PolicyStore {
  return JSON.parse(readFileSync(path, 'utf8')) as PolicyStore
}

export function saveStore(path: string, store: PolicyStore): void {
  writeFileSync(path, JSON.stringify(store, null, 2))
}

export function lookupPolicy(store: PolicyStore, baseId: string): AgentConfig | undefined {
  return store.entries.find((e) => e.base_id === baseId)?.config
}
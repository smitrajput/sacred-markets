import type { Address, Hex } from 'viem'

/**
 * One unresolved transaction per chain + account, kept so a tab remount (or a second button) cannot submit again while the
 * outcome or the data refresh of the first is unresolved. Stores hashes and a block number only; never keys or signed bytes.
 *  - approval: an approval was sent and its outcome is unknown
 *  - action:   the main transaction was sent and its outcome is unknown
 *  - refresh:  the main transaction is CONFIRMED but the displayed data has not been refreshed yet
 */
export interface Intent {
  id: string // which action instance created it
  kind: 'approval' | 'action' | 'refresh'
  hash: Hex
  label: string
  at: number
  block?: string // receipt block, for kind 'refresh'
}
export interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const intentKey = (chainId: number, account: Address) => `sacred.intent.${chainId}.${account.toLowerCase()}`

export function readIntent(kv: KV, chainId: number, account: Address): Intent | null {
  try {
    const raw = kv.getItem(intentKey(chainId, account))
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<Intent>
    if (!o || typeof o.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(o.hash) || typeof o.id !== 'string') return null
    const kind = o.kind === 'approval' || o.kind === 'refresh' ? o.kind : 'action'
    return { id: o.id, kind, hash: o.hash, label: String(o.label ?? ''), at: Number(o.at ?? 0), block: typeof o.block === 'string' && /^\d+$/.test(o.block) ? o.block : undefined }
  } catch {
    return null
  }
}
export function writeIntent(kv: KV, chainId: number, account: Address, intent: Intent): void {
  kv.setItem(intentKey(chainId, account), JSON.stringify(intent))
}
export function clearIntent(kv: KV, chainId: number, account: Address): void {
  kv.removeItem(intentKey(chainId, account))
}

/**
 * Intent store that never throws. If sessionStorage is unavailable or full, records fall back to memory: duplicate-send
 * protection then lasts only until the page is reloaded (`degraded` says so), but it never silently disappears mid-session.
 */
export function createIntentStore(kv: KV | null) {
  const memory = new Map<string, Intent>()
  const store = {
    degraded: false,
    read(chainId: number, account: Address): Intent | null {
      const fromKv = kv ? readIntent(kv, chainId, account) : null
      return fromKv ?? memory.get(intentKey(chainId, account)) ?? null
    },
    write(chainId: number, account: Address, intent: Intent): void {
      memory.set(intentKey(chainId, account), intent)
      try {
        if (!kv) throw new Error('no storage')
        writeIntent(kv, chainId, account, intent)
      } catch {
        store.degraded = true
      }
    },
    clear(chainId: number, account: Address): void {
      memory.delete(intentKey(chainId, account))
      try {
        if (kv) clearIntent(kv, chainId, account)
      } catch {
        store.degraded = true
      }
    },
  }
  return store
}

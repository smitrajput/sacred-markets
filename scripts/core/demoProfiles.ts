// The only two episodes this tool will ever run. Fixed paths: no user-chosen journal, no env override, no reset.
import { join } from 'node:path'

import { ROOT } from '../smoke/common'

export type ProfileId = 'legacy' | 'final'
export interface Profile {
  id: ProfileId
  episodeId: string
  journalPath: string
  /** The command name shown in help and messages. */
  command: string
  /** The final recording may only start after the rehearsal episode finished cleanly (see checkFinalPrereqs). */
  requiresRehearsal: boolean
}

export const LEGACY_PATH = join(ROOT, 'deployments', 'demo-recording-20261107.json')
export const FINAL_PATH = join(ROOT, 'deployments', 'demo-final-recording-20261107.json')
/** ONE exclusive lock for every profile: both episodes sign with the same operator EOAs, so they must be serialized. */
export const LOCK_PATH = join(ROOT, '.tools', 'demo-recording-20261107.lock')

export const PROFILES: Record<ProfileId, Profile> = {
  legacy: { id: 'legacy', episodeId: 'recording-20261107', journalPath: LEGACY_PATH, command: 'bun run demo', requiresRehearsal: false },
  final: { id: 'final', episodeId: 'final-recording-20261107', journalPath: FINAL_PATH, command: 'bun run demo:record', requiresRehearsal: true },
}

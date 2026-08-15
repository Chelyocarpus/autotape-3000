import { readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { log } from './log'

/**
 * Max number of finalized MP3 recordings' lossless WAV sources retained at once.
 * WAV runs roughly 10 MB/min stereo, so this bounds worst-case temp-disk usage
 * to a few hundred MB while covering a realistic "just recorded, might still
 * retrim" window. Not user-configurable — see task scope.
 */
export const MAX_RETAINED_SOURCES = 12

/**
 * Maps a finalized MP3's output path to the still-lossless temp WAV it was
 * encoded from, so a retrim shortly afterward can re-encode from the WAV
 * instead of the already-lossy MP3 (avoiding a second lossy generation).
 * Keyed by output path (not recording id, which is Date.now()-based and can
 * collide across rapid finalizes) — this is also what retrimFile already
 * receives, so it's the natural lookup key.
 *
 * Robustness / pitfalls guarded against:
 * - Re-registering the same output path (e.g. a rare finalize collision)
 *   deletes the previous entry's now-orphaned file before overwriting it,
 *   instead of leaking it untracked on disk.
 * - Eviction and re-registration deletes are both best-effort: the underlying
 *   file may already be gone (deleted externally, or a double-eviction race)
 *   — unlinkSync failures are swallowed so one missing file never blocks a
 *   new recording from finalizing.
 * - Eviction runs in a loop bounded by strictly decreasing map size (not an
 *   unbounded scan), so a pathological cap value can't cause runaway cost.
 */
export class LosslessSourceCache {
  private static _map = new Map<string, string>()

  static register(outputFilePath: string, tmpWavPath: string): void {
    const existing = LosslessSourceCache._map.get(outputFilePath)
    if (existing !== undefined && existing !== tmpWavPath) {
      try { unlinkSync(existing) } catch { /* best-effort — may already be gone */ }
    }
    // Delete-then-set moves this key to the end (most recent) of Map iteration
    // order, which the eviction loop below relies on for "oldest first".
    LosslessSourceCache._map.delete(outputFilePath)
    LosslessSourceCache._map.set(outputFilePath, tmpWavPath)

    while (LosslessSourceCache._map.size > MAX_RETAINED_SOURCES) {
      const oldestKey = LosslessSourceCache._map.keys().next().value
      if (oldestKey === undefined) break
      const oldestPath = LosslessSourceCache._map.get(oldestKey)
      LosslessSourceCache._map.delete(oldestKey)
      if (oldestPath) {
        try { unlinkSync(oldestPath) } catch { /* best-effort — may already be gone */ }
        log(`[LosslessSourceCache] evicted retained source past cap: ${oldestPath}`)
      }
    }
  }

  static get(outputFilePath: string): string | null {
    return LosslessSourceCache._map.get(outputFilePath) ?? null
  }
}

/** Prefix/suffix identifying a capture temp WAV, matching AudioRecorder.start()'s naming. */
const ORPHAN_PREFIX = 'autotape_'
const ORPHAN_SUFFIX = '.wav'
/** Defensive cap on how many tmpdir entries a single sweep will process. */
const MAX_SWEEP_ENTRIES = 5000

/**
 * Delete leftover autotape_*.wav temp files in os.tmpdir() from a prior
 * crashed/killed session. LosslessSourceCache's in-memory map resets on every
 * restart, so without this, temp WAVs from ungraceful shutdowns (the process
 * dying before a later finalize's eviction could reclaim them) accumulate
 * indefinitely across restarts.
 *
 * Robustness / pitfalls guarded against:
 * - Must run once at startup before any recording can register a real entry
 *   (call it from app.whenReady() before registerIpcHandlers()) — otherwise
 *   this could race with and delete a WAV an in-flight recording still owns.
 * - Only matches the exact autotape_*.wav naming AudioRecorder.start() uses,
 *   so it never touches unrelated files that happen to share the temp dir.
 * - Per-file deletion is best-effort (a file may be in use or already gone);
 *   one failure doesn't abort the sweep of the rest.
 * - Directory listing is clamped to MAX_SWEEP_ENTRIES so an unexpectedly huge
 *   or adversarial tmpdir can't turn this into an unbounded scan.
 */
export function sweepOrphanedLosslessSources(): void {
  const dir = tmpdir()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (err) {
    log(`[LosslessSourceCache] orphan sweep failed to read tmpdir: ${(err as Error).message}`)
    return
  }

  for (const name of entries.slice(0, MAX_SWEEP_ENTRIES)) {
    if (!name.startsWith(ORPHAN_PREFIX) || !name.endsWith(ORPHAN_SUFFIX)) continue
    try {
      unlinkSync(join(dir, name))
    } catch {
      // best-effort — file may be in use or already gone
    }
  }
}

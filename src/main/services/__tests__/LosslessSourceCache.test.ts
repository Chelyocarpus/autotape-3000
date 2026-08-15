import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testTmpDir: string

// A plain require() (not a statically-analyzed import) resolves via Node's real
// module loader rather than Vitest's mocked graph, so this stays the genuine
// os.tmpdir() even though the 'os' module is mocked below for everything else.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realTmpdir: () => string = require('os').tmpdir

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, tmpdir: () => testTmpDir }
})

describe('LosslessSourceCache', () => {
  beforeEach(() => {
    testTmpDir = mkdtempSync(join(realTmpdir(), 'autotape-lossless-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testTmpDir, { recursive: true, force: true })
  })

  it('evicts the oldest-registered entry once the retention cap is exceeded, deleting its file', async () => {
    const { LosslessSourceCache, MAX_RETAINED_SOURCES } = await import('../LosslessSourceCache')

    const wavPaths: string[] = []
    for (let i = 0; i < MAX_RETAINED_SOURCES + 3; i++) {
      const wav = join(testTmpDir, `autotape_${i}.wav`)
      writeFileSync(wav, 'x')
      wavPaths.push(wav)
      LosslessSourceCache.register(`C:\\out\\song${i}.mp3`, wav)
    }

    // The 3 oldest registrations (0, 1, 2) were pushed out and their files deleted.
    expect(LosslessSourceCache.get('C:\\out\\song0.mp3')).toBeNull()
    expect(LosslessSourceCache.get('C:\\out\\song1.mp3')).toBeNull()
    expect(LosslessSourceCache.get('C:\\out\\song2.mp3')).toBeNull()
    expect(existsSync(wavPaths[0])).toBe(false)
    expect(existsSync(wavPaths[1])).toBe(false)
    expect(existsSync(wavPaths[2])).toBe(false)

    // The most recent MAX_RETAINED_SOURCES registrations remain retained and untouched.
    expect(LosslessSourceCache.get('C:\\out\\song3.mp3')).toBe(wavPaths[3])
    const lastIdx = MAX_RETAINED_SOURCES + 2
    expect(LosslessSourceCache.get(`C:\\out\\song${lastIdx}.mp3`)).toBe(wavPaths[lastIdx])
    expect(existsSync(wavPaths[lastIdx])).toBe(true)
  })

  it('deletes the previous file when the same output path is re-registered with a different source', async () => {
    const { LosslessSourceCache } = await import('../LosslessSourceCache')
    const first = join(testTmpDir, 'autotape_first.wav')
    const second = join(testTmpDir, 'autotape_second.wav')
    writeFileSync(first, 'x')
    writeFileSync(second, 'x')

    LosslessSourceCache.register('C:\\out\\song.mp3', first)
    LosslessSourceCache.register('C:\\out\\song.mp3', second)

    expect(existsSync(first)).toBe(false)
    expect(LosslessSourceCache.get('C:\\out\\song.mp3')).toBe(second)
  })

  it('does not delete the file when the same output path is re-registered with the SAME source', async () => {
    const { LosslessSourceCache } = await import('../LosslessSourceCache')
    const wav = join(testTmpDir, 'autotape_same.wav')
    writeFileSync(wav, 'x')

    LosslessSourceCache.register('C:\\out\\song.mp3', wav)
    LosslessSourceCache.register('C:\\out\\song.mp3', wav)

    expect(existsSync(wav)).toBe(true)
    expect(LosslessSourceCache.get('C:\\out\\song.mp3')).toBe(wav)
  })

  it('returns null for an output path that was never registered', async () => {
    const { LosslessSourceCache } = await import('../LosslessSourceCache')
    expect(LosslessSourceCache.get('C:\\out\\never-recorded.mp3')).toBeNull()
  })

  it('get() self-heals and returns null when the retained file was deleted externally', async () => {
    const { LosslessSourceCache } = await import('../LosslessSourceCache')
    const wav = join(testTmpDir, 'autotape_external.wav')
    writeFileSync(wav, 'x')
    LosslessSourceCache.register('C:\\out\\song.mp3', wav)

    // Simulate external deletion (e.g. antivirus, manual cleanup) that bypasses
    // this module's own register()/evict() bookkeeping entirely.
    rmSync(wav)

    expect(LosslessSourceCache.get('C:\\out\\song.mp3')).toBeNull()
    // The stale mapping must be dropped too, not just masked — re-registering
    // a fresh source for the same key should not attempt to delete the (already
    // gone) old path a second time or otherwise misbehave.
    const fresh = join(testTmpDir, 'autotape_fresh.wav')
    writeFileSync(fresh, 'x')
    LosslessSourceCache.register('C:\\out\\song.mp3', fresh)
    expect(LosslessSourceCache.get('C:\\out\\song.mp3')).toBe(fresh)
  })

  it('evict() removes the cache entry without deleting its file', async () => {
    const { LosslessSourceCache } = await import('../LosslessSourceCache')
    const wav = join(testTmpDir, 'autotape_evict.wav')
    writeFileSync(wav, 'x')
    LosslessSourceCache.register('C:\\out\\song.mp3', wav)

    LosslessSourceCache.evict('C:\\out\\song.mp3')

    expect(LosslessSourceCache.get('C:\\out\\song.mp3')).toBeNull()
    expect(existsSync(wav)).toBe(true)
  })

  // sweepOrphanedLosslessSources() always scans the real os.tmpdir() (matching where
  // AudioRecorder.start() actually writes captures) rather than an injectable directory,
  // so — unlike the register()/get() tests above — this exercises the genuine system
  // temp dir directly instead of the mocked-and-isolated `testTmpDir`. Unique random
  // filenames keep it from colliding with anything real, with cleanup in `finally`.
  it('sweeps orphaned autotape_*.wav files left in tmpdir, ignoring unrelated files', async () => {
    const marker = `sweep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const realDir = realTmpdir()
    const orphanA = join(realDir, `autotape_${marker}-a.wav`)
    const orphanB = join(realDir, `autotape_${marker}-b.wav`)
    const unrelated = join(realDir, `${marker}-notes.txt`)
    const wrongPrefix = join(realDir, `other_autotape_${marker}-looking.wav`)
    writeFileSync(orphanA, 'x')
    writeFileSync(orphanB, 'x')
    writeFileSync(unrelated, 'x')
    writeFileSync(wrongPrefix, 'x')

    try {
      const { sweepOrphanedLosslessSources } = await import('../LosslessSourceCache')
      sweepOrphanedLosslessSources()

      expect(existsSync(orphanA)).toBe(false)
      expect(existsSync(orphanB)).toBe(false)
      expect(existsSync(unrelated)).toBe(true)
      expect(existsSync(wrongPrefix)).toBe(true)
    } finally {
      for (const p of [orphanA, orphanB, unrelated, wrongPrefix]) {
        try { rmSync(p) } catch { /* already deleted by the sweep, or never existed */ }
      }
    }
  })
})

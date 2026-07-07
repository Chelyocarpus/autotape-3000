import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('TrimPresetsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'autotape-presets-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('is case- and whitespace-insensitive when matching a song-specific preset', async () => {
    const { saveTrimPreset, getTrimPreset } = await import('../TrimPresetsStore')
    saveTrimPreset('Daft Punk', 'One More Time', { startOffsetSec: 1.5, endOffsetSec: 0.5 })
    const preset = getTrimPreset('  daft punk ', 'ONE MORE TIME')
    expect(preset).toEqual({ startOffsetSec: 1.5, endOffsetSec: 0.5 })
  })

  it('falls back to the global preset when no song-specific preset exists', async () => {
    const { saveTrimPreset, getTrimPreset } = await import('../TrimPresetsStore')
    saveTrimPreset('Any Artist', null, { startOffsetSec: 2, endOffsetSec: 0 })
    expect(getTrimPreset('Someone Else', 'Some Song')).toEqual({ startOffsetSec: 2, endOffsetSec: 0 })
  })

  it('prefers a song-specific preset over the global default', async () => {
    const { saveTrimPreset, getTrimPreset } = await import('../TrimPresetsStore')
    saveTrimPreset('Any Artist', null, { startOffsetSec: 2, endOffsetSec: 0 })
    saveTrimPreset('Artist', 'Song', { startOffsetSec: 5, endOffsetSec: 1 })
    expect(getTrimPreset('Artist', 'Song')).toEqual({ startOffsetSec: 5, endOffsetSec: 1 })
  })

  it('returns null when nothing matches and there is no global default', async () => {
    const { getTrimPreset } = await import('../TrimPresetsStore')
    expect(getTrimPreset('Nobody', 'Nothing')).toBeNull()
  })

  it('deletes only the targeted song preset, leaving the global default intact', async () => {
    const { saveTrimPreset, deleteTrimPreset, getTrimPreset } = await import('../TrimPresetsStore')
    saveTrimPreset('Any Artist', null, { startOffsetSec: 2, endOffsetSec: 0 })
    saveTrimPreset('Artist', 'Song', { startOffsetSec: 5, endOffsetSec: 1 })
    deleteTrimPreset('Artist', 'Song')
    expect(getTrimPreset('Artist', 'Song')).toEqual({ startOffsetSec: 2, endOffsetSec: 0 })
  })
})

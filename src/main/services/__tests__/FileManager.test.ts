import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveOutputPath, swapExtension } from '../FileManager'

describe('FileManager', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autotape-filemanager-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('builds "Artist - Title.ext" and creates the output dir if missing', () => {
    const nested = join(dir, 'nested', 'output')
    const path = resolveOutputPath({
      outputDir: nested,
      artist: 'Daft Punk',
      title: 'One More Time',
      format: 'mp3',
      duplicateAction: 'increment'
    })
    expect(path).toBe(join(nested, 'Daft Punk - One More Time.mp3'))
    expect(existsSync(nested)).toBe(true)
  })

  it('sanitizes filesystem-invalid characters and falls back on empty fields', () => {
    const path = resolveOutputPath({
      outputDir: dir,
      artist: '',
      title: 'AC/DC: Back <in> Black?',
      format: 'wav',
      duplicateAction: 'increment'
    })
    expect(path).toBe(join(dir, 'Unknown Artist - AC_DC_ Back _in_ Black_.wav'))
  })

  it('returns null for "skip" when the file already exists', () => {
    const existing = join(dir, 'A - B.mp3')
    writeFileSync(existing, '')
    const path = resolveOutputPath({
      outputDir: dir, artist: 'A', title: 'B', format: 'mp3', duplicateAction: 'skip'
    })
    expect(path).toBeNull()
  })

  it('overwrites (deletes then returns the same path) for "overwrite"', () => {
    const existing = join(dir, 'A - B.mp3')
    writeFileSync(existing, 'stale data')
    const path = resolveOutputPath({
      outputDir: dir, artist: 'A', title: 'B', format: 'mp3', duplicateAction: 'overwrite'
    })
    expect(path).toBe(existing)
    expect(existsSync(existing)).toBe(false)
  })

  it('increments to the next free "(n)" suffix for "increment"', () => {
    writeFileSync(join(dir, 'A - B.mp3'), '')
    writeFileSync(join(dir, 'A - B (2).mp3'), '')
    const path = resolveOutputPath({
      outputDir: dir, artist: 'A', title: 'B', format: 'mp3', duplicateAction: 'increment'
    })
    expect(path).toBe(join(dir, 'A - B (3).mp3'))
  })

  it('swapExtension replaces only the extension, keeping dir and basename', () => {
    const wav = join(dir, 'sub', 'A - B.wav')
    expect(swapExtension(wav, 'mp3')).toBe(join(dir, 'sub', 'A - B.mp3'))
  })
})

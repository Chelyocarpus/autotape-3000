import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { join, extname, basename, dirname } from 'path'

export type DuplicateAction = 'skip' | 'overwrite' | 'increment'
export type MediaFormat = 'mp3' | 'wav'

export interface OutputFileOptions {
  outputDir: string
  artist: string
  title: string
  format: MediaFormat
  duplicateAction: DuplicateAction
}

const INVALID_CHARS = /[/\\:*?"<>|]/g

function sanitize(s: string): string {
  return (s ?? '').replace(INVALID_CHARS, '_').trim()
}

function buildBaseName(artist: string, title: string): string {
  const a = sanitize(artist) || 'Unknown Artist'
  const t = sanitize(title) || 'Unknown Title'
  return `${a} - ${t}`
}

/**
 * Resolves the final output path for a track, handling duplicates.
 * Returns null if the file should be skipped (duplicate action = skip and file exists).
 */
export function resolveOutputPath(opts: OutputFileOptions): string | null {
  const { outputDir, artist, title, format, duplicateAction } = opts

  mkdirSync(outputDir, { recursive: true })

  const baseName = buildBaseName(artist, title)
  const ext = `.${format}`
  const candidate = join(outputDir, `${baseName}${ext}`)

  if (!existsSync(candidate)) {
    return candidate
  }

  // File exists — apply duplicate action
  switch (duplicateAction) {
    case 'skip':
      return null // caller should skip recording

    case 'overwrite':
      try { unlinkSync(candidate) } catch { /* ignore */ }
      return candidate

    case 'increment': {
      let i = 2
      let incremented: string
      do {
        incremented = join(outputDir, `${baseName} (${i})${ext}`)
        i++
      } while (existsSync(incremented))
      return incremented
    }
  }
}

/**
 * Returns the ext without the dot, based on the existing file path.
 */
export function swapExtension(filePath: string, newExt: string): string {
  const dir = dirname(filePath)
  const base = basename(filePath, extname(filePath))
  return join(dir, `${base}.${newExt}`)
}

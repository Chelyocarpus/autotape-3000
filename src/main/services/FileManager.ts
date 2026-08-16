import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { join, extname, basename, dirname, resolve } from 'path'
import type { DuplicateAction, MediaFormat } from '../../shared/types'
import { log } from './log'

export type { DuplicateAction, MediaFormat } from '../../shared/types'

export interface OutputFileOptions {
  outputDir: string
  artist: string
  title: string
  format: MediaFormat
  duplicateAction: DuplicateAction
}

const INVALID_CHARS = /[/\\:*?"<>|]/g
const FALLBACK_BASE_NAME = 'Unknown Artist - Unknown Title'

function sanitize(s: string): string {
  const cleaned = (s ?? '').replace(INVALID_CHARS, '_').trim()
  // artist/title come from GSMTC media-session metadata, which any local app can
  // set — reject a value that's nothing but dots (e.g. "..") since that's the
  // exact sequence that means "parent directory" if it ever became a whole path
  // segment, even though it's inert as a fragment inside "Artist - Title".
  return /^\.+$/.test(cleaned) ? '' : cleaned
}

function buildBaseName(artist: string, title: string): string {
  const a = sanitize(artist) || 'Unknown Artist'
  const t = sanitize(title) || 'Unknown Title'
  return `${a} - ${t}`
}

/**
 * Joins `fileName` under `outputDir` and verifies the result still resolves
 * directly inside `outputDir` — a structural guard against path traversal
 * that's independent of sanitize()'s character stripping, so it still holds
 * if that regex is ever loosened, bypassed, or fed something it doesn't
 * anticipate (e.g. a raw separator smuggled in some other encoding). Falls
 * back to a fixed safe name rather than throwing, since callers don't expect
 * this to fail and an uncaught exception here would crash the recording loop.
 */
function buildCandidatePath(outputDir: string, fileName: string): string {
  const resolvedDir = resolve(outputDir)
  const safeName = basename(fileName)
  const candidate = resolve(resolvedDir, safeName)
  if (dirname(candidate) !== resolvedDir) {
    log(`[FileManager] Rejected output path that escaped outputDir: "${fileName}"`)
    return join(resolvedDir, FALLBACK_BASE_NAME + extname(fileName))
  }
  return join(outputDir, safeName)
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
  const candidate = buildCandidatePath(outputDir, `${baseName}${ext}`)

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
      // Bounded so a pathological run of collisions (or a repeatedly-escaping
      // candidate — see buildCandidatePath's fallback) can't spin forever.
      const MAX_INCREMENT_ATTEMPTS = 1000
      for (let i = 2; i <= MAX_INCREMENT_ATTEMPTS; i++) {
        const attempt = buildCandidatePath(outputDir, `${baseName} (${i})${ext}`)
        if (!existsSync(attempt)) return attempt
      }
      // Give up finding a free "(n)" slot — fall back to a timestamped name so
      // we still terminate and return a usable, near-certainly-unique path.
      return buildCandidatePath(outputDir, `${baseName} (${Date.now()})${ext}`)
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

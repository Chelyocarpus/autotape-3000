import { spawnSync } from 'child_process'
import { existsSync, realpathSync } from 'fs'
import { app } from 'electron'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { log } from './log'

// In a packaged Electron app the binary lives inside app.asar which cannot be
// executed. The binary is physically in app.asar.unpacked due to asarUnpack
// config, so we remap the path. In dev, no remapping needed.
// realpathSync resolves any symlinks/hardlinks in pnpm's store so the OS loader
// receives the real physical path.
function _resolveBundledPath(raw: string): string {
  const remapped = app.isPackaged ? raw.replace('app.asar', 'app.asar.unpacked') : raw
  try {
    return realpathSync(remapped)
  } catch {
    return remapped
  }
}

const _bundledFfmpegPath: string = _resolveBundledPath(ffmpegInstaller.path)

/** Explicitly configured path from user settings. null means auto-detect. */
let _overridePath: string | null = null

/** Cached result of the last auto-detection run. null means not yet detected. */
let _detectedPath: string | null = null

/**
 * Set or clear the user-supplied ffmpeg path from settings.
 * Passing null or empty string re-enables auto-detection.
 * Clears the auto-detect cache so the next call to getFfmpegPath()
 * will re-run detection when no override is provided.
 */
export function setFfmpegOverride(path: string | null): void {
  _overridePath = path?.trim() || null
  _detectedPath = null
}

/**
 * Return the ffmpeg binary path to use.
 * Priority: user override → cached auto-detect → fresh auto-detect.
 */
export function getFfmpegPath(): string {
  if (_overridePath) return _overridePath
  if (_detectedPath !== null) return _detectedPath
  return (_detectedPath = _runDetection())
}

/**
 * Force a fresh auto-detection run, bypassing the cache, and return the result.
 * Does NOT apply or clear the user override — call setFfmpegOverride(null) first
 * if you want to discard a previous override.
 */
export function detectFfmpegPath(): string {
  _detectedPath = null
  return (_detectedPath = _runDetection())
}

function _probeExecutable(exePath: string): boolean {
  if (!existsSync(exePath)) return false
  // On Windows, Node's libuv can fail with EFTYPE (ERROR_BAD_EXE_FORMAT) when
  // spawning directly from pnpm's hardlinked store. Routing through cmd.exe via
  // shell:true lets the OS loader resolve the binary correctly.
  const probe = spawnSync(exePath, ['-version'], {
    windowsHide: true,
    timeout: 5_000,
    shell: process.platform === 'win32'
  })
  if (probe.error || probe.status !== 0) {
    const reason = probe.error?.message ?? `exit ${probe.status}`
    log(`[FfmpegResolver] probe failed for "${exePath}": ${reason}`)
    return false
  }
  return true
}

function _runDetection(): string {
  if (_probeExecutable(_bundledFfmpegPath)) {
    log(`[FfmpegResolver] using bundled ffmpeg: ${_bundledFfmpegPath}`)
    return _bundledFfmpegPath
  }

  log(`[FfmpegResolver] bundled ffmpeg not usable, searching system PATH`)

  // On Windows, use where.exe. On other platforms, try 'which'.
  const whichCmd = process.platform === 'win32' ? 'where.exe' : 'which'
  const where = spawnSync(whichCmd, ['ffmpeg'], {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true
  })
  if (!where.error && typeof where.stdout === 'string') {
    const first = where.stdout.trim().split(/\r?\n/)[0]?.trim()
    if (first && _probeExecutable(first)) {
      log(`[FfmpegResolver] using system ffmpeg: ${first}`)
      return first
    }
  }

  log('[FfmpegResolver] WARNING: no working ffmpeg found. Audio recording will fail. Install ffmpeg and add it to PATH, or set a custom path in Settings.')
  return _bundledFfmpegPath
}

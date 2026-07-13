import { execFile } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { log } from './log'

interface RunningProcessInfo {
  ProcessName?: string
  Id?: number
  MainWindowHandle?: number
}

interface WindowAumidInfo {
  Pid?: number
  Aumid?: string
}

interface LoopbackTargetPayload {
  windows?: WindowAumidInfo[] | WindowAumidInfo
  processes?: RunningProcessInfo[] | RunningProcessInfo
}

export type AumidClassification =
  | { kind: 'packaged' }
  | { kind: 'win32'; exeName: string }

/**
 * Classify a GSMTC SourceAppUserModelId string as either a packaged (UWP/Store)
 * app AUMID — shaped `PackageFamilyName!AppId`, not supported in v1 — or a win32
 * desktop app, resolvable to an exe name.
 *
 * Exported for unit testing — pure parsing, no I/O.
 */
export function classifyAumid(aumid: string): AumidClassification {
  const trimmed = aumid.trim()
  if (!trimmed || trimmed.includes('!')) return { kind: 'packaged' }

  const base = trimmed.split(/[\\/]/).pop() ?? trimmed
  const exeName = /\.exe$/i.test(base) ? base : `${base}.exe`
  return { kind: 'win32', exeName }
}

function runPowerShellJson(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { timeout: 4_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(err)
          return
        }
        resolve(stdout.trim())
      }
    )
  })
}

/** Resolves the bundled resolve-loopback-target.ps1 script's path (mirrors GsmtcService's script resolution). */
function _resolveLoopbackTargetScriptPath(): string {
  const baseDir = app.isPackaged
    ? join(process.resourcesPath, 'scripts')
    : join(__dirname, '..', '..', 'scripts')
  return join(baseDir, 'resolve-loopback-target.ps1')
}

function toArray<T>(value: T[] | T | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Resolve a GSMTC sourceAppId (AUMID) to the PID of a currently-running process
 * suitable for isolated app-loopback capture. Returns null when the AUMID is a
 * packaged-app AUMID (unsupported in v1) or no matching process is running.
 *
 * Two resolution strategies, tried in order:
 *  1. Exact match against a visible top-level window's System.AppUserModel.ID
 *     property — the same identifier Windows surfaces to GSMTC. Chromium and
 *     Firefox assign each window its own generated AUMID (e.g. for taskbar/
 *     jump-list grouping) that bears no relation to the process image name, so
 *     this is the only strategy that resolves those correctly.
 *  2. Fall back to matching by exe name (derived from the AUMID by
 *     classifyAumid) against the full process list, for windowless/background
 *     players that don't carry an AppUserModel.ID on any window. Matches by
 *     name in TypeScript rather than interpolating the (externally-sourced)
 *     exe name into a PowerShell filter string. Apps like Spotify or a browser
 *     run several processes sharing the same exe name (GPU/renderer/helper
 *     processes) alongside the one actual UI window — process-loopback's
 *     INCLUDE_TARGET_PROCESS_TREE only captures the targeted process's own
 *     descendants, so targeting a same-named sibling instead of the main
 *     window's process silently captures nothing. Prefer whichever match owns
 *     a top-level window; fall back to the first match otherwise.
 *
 * Both strategies are served from a single PowerShell round-trip (rather than
 * Get-CimInstance Win32_Process, which goes through the WMI service — measured
 * ~3x slower on a real machine and, under concurrent load, contends with
 * GSMTC's own PowerShell polling process closely enough to push its calls past
 * their timeout).
 */
export async function resolveAumidToPid(aumid: string): Promise<number | null> {
  const classification = classifyAumid(aumid)
  if (classification.kind === 'packaged') return null

  let raw: string
  try {
    raw = await runPowerShellJson(['-File', _resolveLoopbackTargetScriptPath()])
  } catch (err) {
    log(`[ProcessResolver] loopback target query failed: ${(err as Error).message}`)
    return null
  }
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as LoopbackTargetPayload
    const trimmedAumid = aumid.trim().toLowerCase()
    const windowMatch = toArray(parsed.windows).find((w) => (w.Aumid ?? '').toLowerCase() === trimmedAumid)
    if (windowMatch && typeof windowMatch.Pid === 'number') return windowMatch.Pid

    // Get-Process reports names without the .exe suffix.
    const target = classification.exeName.replace(/\.exe$/i, '').toLowerCase()
    const matches = toArray(parsed.processes).filter((p) => (p.ProcessName ?? '').toLowerCase() === target)
    if (matches.length === 0) return null

    const withWindow = matches.find((p) => typeof p.MainWindowHandle === 'number' && p.MainWindowHandle !== 0)
    const match = withWindow ?? matches[0]
    return typeof match.Id === 'number' ? match.Id : null
  } catch (err) {
    log(`[ProcessResolver] failed to parse loopback target payload: ${(err as Error).message}`)
    return null
  }
}

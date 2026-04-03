import { EventEmitter } from 'events'
import { execFile, spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { join } from 'path'
import { app } from 'electron'
import { log } from './log'

export interface GsmtcTrack {
  artist: string
  title: string
  album: string
  albumArtFile: string
  albumArtMime?: string
  sourceAppId?: string
  positionMs?: number
  isPlaying: boolean
}

export interface GsmtcSessionOption {
  sourceAppId: string
  title: string
  artist: string
  isPlaying: boolean
  hasArtwork: boolean
}

const EMPTY_TRACK: GsmtcTrack = {
  artist: '',
  title: '',
  album: '',
  albumArtFile: '',
  albumArtMime: '',
  sourceAppId: '',
  positionMs: 0,
  isPlaying: false
}

function tracksEqual(a: GsmtcTrack, b: GsmtcTrack): boolean {
  return (
    a.artist === b.artist &&
    a.title === b.title &&
    a.album === b.album &&
    (a.sourceAppId ?? '') === (b.sourceAppId ?? '')
  )
}

function isLikelyNextTrack(prev: GsmtcTrack, next: GsmtcTrack): boolean {
  const prevPos = prev.positionMs ?? 0
  const nextPos = next.positionMs ?? 0
  const sameSource = (prev.sourceAppId ?? '') === (next.sourceAppId ?? '')

  if (!sameSource || !prev.isPlaying || !next.isPlaying) return false

  // Position reset to near-zero arrives in GSMTC before the metadata fields update.
  // Treat it as a strong early signal of a new track even when prevPos < 15 s
  // (e.g. song skipped shortly after it started).
  if (nextPos <= 500 && prevPos >= 3_000) return true

  // Large backward position jump also indicates a track skip when the new track
  // starts a few seconds in and the near-zero check does not apply.
  return prevPos >= 15_000 && nextPos + 2_500 < prevPos
}

export declare interface GsmtcService {
  on(event: 'trackChanged', listener: (oldTrack: GsmtcTrack, newTrack: GsmtcTrack) => void): this
  on(event: 'trackMetadataUpdated', listener: (track: GsmtcTrack) => void): this
  on(event: 'artworkUpdated', listener: (track: GsmtcTrack) => void): this
  on(event: 'playStateChanged', listener: (isPlaying: boolean) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  emit(event: 'trackChanged', oldTrack: GsmtcTrack, newTrack: GsmtcTrack): boolean
  emit(event: 'trackMetadataUpdated', track: GsmtcTrack): boolean
  emit(event: 'artworkUpdated', track: GsmtcTrack): boolean
  emit(event: 'playStateChanged', isPlaying: boolean): boolean
  emit(event: 'error', err: Error): boolean
}

export class GsmtcService extends EventEmitter {
  private static readonly MAX_PENDING_POLLS = 30

  private _currentTrack: GsmtcTrack = EMPTY_TRACK
  private _scriptPath: string
  private _loopScriptPath: string
  private _process: ChildProcess | null = null
  private _readline: ReturnType<typeof createInterface> | null = null
  private _restartTimer: ReturnType<typeof setTimeout> | null = null
  private _stopped = false
  private _intervalMs = 50
  private _sourceFilter = 'auto'
  private _metadataPending = false
  private _metadataPendingPollCount = 0
  private _prevTrackBeforeReset: GsmtcTrack = { ...EMPTY_TRACK }

  get currentTrack(): GsmtcTrack {
    return this._currentTrack
  }

  setSourceFilter(sourceFilter: string): void {
    const next = sourceFilter?.trim() || 'auto'
    if (next === this._sourceFilter) return
    this._sourceFilter = next
    // Restart the persistent process so it picks up the new source filter
    if (this._process) {
      this._process.kill()
      this._process = null
    }
    if (!this._stopped) {
      this._spawnLoop(this._intervalMs)
    }
  }

  /** Trigger an artwork fetch for the currently-reported track (e.g. on startup). */
  fetchArtworkForCurrentTrack(): void {
    const track = this._currentTrack
    if (track.title) void this._fetchArtworkForTrack(track)
  }

  async listSessions(): Promise<GsmtcSessionOption[]> {
    const listRaw = await this._runScript(['-List'])
    if (!listRaw) return []

    try {
      const parsed = JSON.parse(listRaw) as GsmtcTrack[] | GsmtcTrack
      const items = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])

      const byApp = new Map<string, GsmtcSessionOption>()
      for (const track of items) {
        const sourceAppId = (track.sourceAppId ?? '').trim()
        if (!sourceAppId) continue

        const candidate: GsmtcSessionOption = {
          sourceAppId,
          title: track.title ?? '',
          artist: track.artist ?? '',
          isPlaying: !!track.isPlaying,
          hasArtwork: !!track.albumArtFile
        }

        const existing = byApp.get(sourceAppId)
        if (!existing) {
          byApp.set(sourceAppId, candidate)
          continue
        }

        const existingScore = Number(existing.isPlaying) * 2 + Number(existing.hasArtwork)
        const candidateScore = Number(candidate.isPlaying) * 2 + Number(candidate.hasArtwork)
        if (candidateScore > existingScore) {
          byApp.set(sourceAppId, candidate)
        }
      }

      return Array.from(byApp.values()).sort((a, b) => {
        const scoreA = Number(a.isPlaying) * 2 + Number(a.hasArtwork)
        const scoreB = Number(b.isPlaying) * 2 + Number(b.hasArtwork)
        if (scoreA !== scoreB) return scoreB - scoreA
        return a.sourceAppId.localeCompare(b.sourceAppId)
      })
    } catch {
      return []
    }
  }

  constructor() {
    super()
    const baseDir = app.isPackaged
      ? join(process.resourcesPath, 'scripts')
      : join(__dirname, '..', '..', 'scripts')
    this._scriptPath = join(baseDir, 'gsmtc.ps1')
    this._loopScriptPath = join(baseDir, 'gsmtc_loop.ps1')
  }

  start(intervalMs = 50): void {
    if (this._process || this._stopped === false && this._restartTimer) return
    this._stopped = false
    this._intervalMs = intervalMs
    this._spawnLoop(intervalMs)
  }

  stop(): void {
    this._stopped = true
    this._clearRestartTimer()
    if (this._readline) {
      this._readline.close()
      this._readline = null
    }
    if (this._process) {
      this._process.kill()
      this._process = null
    }
  }

  private _spawnLoop(intervalMs: number): void {
    const proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this._loopScriptPath,
        '-SourceAppId',
        this._sourceFilter || 'auto',
        '-IntervalMs',
        String(intervalMs)
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    )

    this._process = proc

    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity })
    this._readline = rl
    rl.on('line', (raw) => {
      const line = raw.trim()
      if (!line) return
      try {
        const track = JSON.parse(line) as GsmtcTrack
        this._handleTrack(track)
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error'
        this.emit('error', new Error(`Failed to parse GSMTC loop output: ${msg}. Output: ${line.slice(0, 200)}`))
      }
    })

    proc.on('exit', () => {
      if (this._readline === rl) {
        this._readline.close()
        this._readline = null
      }
      if (this._process === proc) this._process = null
      if (!this._stopped) {
        this._restartTimer = setTimeout(() => {
          this._restartTimer = null
          this._spawnLoop(intervalMs)
        }, 1000)
      }
    })

    proc.on('error', (err) => this.emit('error', err))
  }

  private _clearRestartTimer(): void {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer)
      this._restartTimer = null
    }
  }

  private async _fetchArtworkForTrack(forTrack: GsmtcTrack): Promise<void> {
    try {
      const line = await this._runScript(['-SourceAppId', forTrack.sourceAppId || 'auto'])
      if (!line) return
      const full = JSON.parse(line) as GsmtcTrack
      if (!full.albumArtFile) return
      if (!tracksEqual(this._currentTrack, forTrack)) return
      this._currentTrack = { ...this._currentTrack, albumArtFile: full.albumArtFile, albumArtMime: full.albumArtMime }
      this.emit('artworkUpdated', this._currentTrack)
    } catch {
      // Artwork fetch failures are non-fatal
    }
  }

  private _runScript(extraScriptArgs: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-STA',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this._scriptPath,
          ...extraScriptArgs
        ],
        { timeout: 4000, windowsHide: true },
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

  private _handleTrack(track: GsmtcTrack): void {
    const prev = this._currentTrack
    const pos = (track.positionMs ?? 0)
    log(`[GSMTC] poll  pos=${pos}ms isPlaying=${track.isPlaying} title="${track.title}" artist="${track.artist}" pending=${this._metadataPending}`)

    // Waiting for real metadata after a position-reset early-stop sentinel.
    if (this._metadataPending) {
      this._metadataPendingPollCount++

      if (!track.isPlaying) {
        log('[GSMTC] pending-metadata: playback stopped — clearing pending state')
        this._metadataPending = false
        this._metadataPendingPollCount = 0
        this._prevTrackBeforeReset = { ...EMPTY_TRACK }
        this._currentTrack = { ...EMPTY_TRACK }
        this.emit('playStateChanged', false)
        return
      }

      const metadataArrived = !tracksEqual(track, this._prevTrackBeforeReset) && !!track.title
      const timedOut = this._metadataPendingPollCount >= GsmtcService.MAX_PENDING_POLLS
      log(`[GSMTC] pending-metadata: poll#${this._metadataPendingPollCount} metadataArrived=${metadataArrived} timedOut=${timedOut}`)

      if (metadataArrived || timedOut) {
        this._metadataPending = false
        this._metadataPendingPollCount = 0
        this._prevTrackBeforeReset = { ...EMPTY_TRACK }
        this._currentTrack = track

        if (timedOut && !track.title) {
          // Timed out but metadata still hasn't arrived — emit nothing.
          // The recorder keeps running; the real title will arrive via trackChanged
          // which TrackSplitter will apply in-place (pendingMetadataUpdate stays true).
          log(`[GSMTC] pending-metadata: timed out with no title — staying silent, recorder continues`)
        } else {
          log(`[GSMTC] trackMetadataUpdated → "${track.title}" by "${track.artist}" (timedOut=${timedOut})`)
          this.emit('trackMetadataUpdated', track)
          void this._fetchArtworkForTrack(track)
        }
      }
      return
    }

    if (!tracksEqual(prev, track) || isLikelyNextTrack(prev, track)) {
      if (tracksEqual(prev, track) && isLikelyNextTrack(prev, track)) {
        // Position has reset to near-zero but metadata hasn't updated yet.
        // Emit trackChanged with a sentinel so the recorder stops and immediately
        // starts capturing the new song's audio. The real metadata arrives via
        // trackMetadataUpdated on the next poll without restarting the recorder.
        log(`[GSMTC] position reset detected: prevPos=${prev.positionMs ?? 0}ms → ${pos}ms — emitting sentinel trackChanged`)
        const sentinel: GsmtcTrack = {
          ...EMPTY_TRACK,
          sourceAppId: track.sourceAppId,
          isPlaying: track.isPlaying
        }
        this._prevTrackBeforeReset = { ...prev }
        this._metadataPending = true
        this._metadataPendingPollCount = 0
        this._currentTrack = sentinel
        this.emit('trackChanged', prev, sentinel)
      } else {
        log(`[GSMTC] trackChanged: "${prev.title}" → "${track.title}" by "${track.artist}"`)
        this._currentTrack = track
        this.emit('trackChanged', prev, track)
        // Fetch artwork for real track changes (including initial empty→track detection on startup)
        if (track.title) void this._fetchArtworkForTrack(track)
      }
    } else if (prev.isPlaying !== track.isPlaying) {
      log(`[GSMTC] playStateChanged → ${track.isPlaying}`)
      this._currentTrack = track
      this.emit('playStateChanged', track.isPlaying)
    }
  }
}

import { EventEmitter } from 'events'
import { renameSync, unlinkSync } from 'fs'
import { powerSaveBlocker } from 'electron'
import type { GsmtcService, GsmtcTrack } from './GsmtcService'
import { AudioRecorder } from './AudioRecorder'
import { resolveOutputPath, swapExtension, type DuplicateAction, type MediaFormat } from './FileManager'
import { writeId3Tags } from './MetadataTagger'
import { getTrimPreset } from './TrimPresetsStore'
import { log } from './log'

export interface TrackSplitterSettings {
  outputDir: string
  format: MediaFormat
  bitrate: number
  deviceId: string
  duplicateAction: DuplicateAction
  sessionFilter: string
  minSaveSeconds: number
}

export interface RecordingEntry {
  id: string
  artist: string
  title: string
  filePath: string
  albumArtFile?: string
  albumArtMime?: string
  durationSec: number
  status: 'ok' | 'skipped' | 'error'
  error?: string
  startedAt: number
}

export declare interface TrackSplitter {
  on(event: 'recordingStarted', listener: (track: GsmtcTrack) => void): this
  on(event: 'recordingFinished', listener: (entry: RecordingEntry) => void): this
  on(event: 'recordingTrackUpdated', listener: (track: GsmtcTrack) => void): this
  on(event: 'error', listener: (err: Error) => void): this
}

export class TrackSplitter extends EventEmitter {
  private static readonly DEFAULT_MIN_SAVE_SECONDS = 0
  /** Extra seconds to keep at the start of a warm-promoted recording as a safety buffer. */
  private static readonly WARM_PAD_SEC = 0.1

  private _recorder = new AudioRecorder()
  private _settings: TrackSplitterSettings | null = null
  private _active = false
  private _currentTrack: GsmtcTrack | null = null
  private _recordingStartedAt = 0
  private _stopInFlight: Promise<void> | null = null
  private _pendingMetadataUpdate = false

  // Pre-warmed recorder: always-running ffmpeg that can be promoted instantly
  // on a track change, eliminating the process spawn delay.
  private _warmRecorder: AudioRecorder | null = null
  private _warmStartedAt = 0
  // Seconds of pre-roll captured before the track actually started (warm-promotion offset).
  private _trimSec = 0
  private _powerSaveBlockerId: number | null = null
  // Pending restart timer for the warm recorder — prevents tight restart loops on ffmpeg exit.
  private _warmRestartTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly _gsmtc: GsmtcService) {
    super()
    this._recorder.on('error', (err) => this.emit('error', err))
  }

  /**
   * Enable recording. Sets settings and subscribes to GSMTC events.
   */
  startListening(settings: TrackSplitterSettings): void {
    this._settings = settings
    this._active = true

    const currentTrack = this._gsmtc.currentTrack
    if (this._matchesSelectedSource(currentTrack) && currentTrack.isPlaying && currentTrack.title) {
      this._startRecording(currentTrack)
      // The loop-based currentTrack has no artwork — fetch it asynchronously.
      this._gsmtc.fetchArtworkForCurrentTrack()
    }

    this._gsmtc.on('trackChanged', this._onTrackChanged)
    this._gsmtc.on('trackMetadataUpdated', this._onTrackMetadataUpdated)
    this._gsmtc.on('playStateChanged', this._onPlayStateChanged)
    this._gsmtc.on('artworkUpdated', this._onArtworkUpdated)

    // Pre-warm a recorder so it's ready to promote on the next track change.
    this._startWarmRecorder()
  }

  /**
   * Stop recording and remove event listeners.
   */
  async stopListening(): Promise<void> {
    this._active = false
    this._gsmtc.off('trackChanged', this._onTrackChanged)
    this._gsmtc.off('trackMetadataUpdated', this._onTrackMetadataUpdated)
    this._gsmtc.off('playStateChanged', this._onPlayStateChanged)
    this._gsmtc.off('artworkUpdated', this._onArtworkUpdated)
    this._killWarmRecorder()
    await this._stopRecording()
  }

  updateSettings(settings: Partial<TrackSplitterSettings>): void {
    if (this._settings) {
      this._settings = { ...this._settings, ...settings }
    }
  }

  private _matchesSelectedSource(track: GsmtcTrack): boolean {
    const filter = this._settings?.sessionFilter?.trim().toLowerCase()
    if (!filter || filter === 'auto') return true
    const source = (track.sourceAppId ?? '').trim().toLowerCase()
    return source.length > 0 && source === filter
  }

  private _onTrackChanged = (
    _old: GsmtcTrack,
    newTrack: GsmtcTrack
  ): void => {
    if (!this._active) return
    // Capture exact event timestamp — this is when position 0:00 of the new track
    // was reported, which is the hard cut point for the outgoing recording.
    const trackChangedAt = Date.now()
    log(`[Splitter] trackChanged → title="${newTrack.title}" isPlaying=${newTrack.isPlaying} source="${newTrack.sourceAppId}" recorderRunning=${this._recorder.isRunning}`)

    // Sentinel recording is already capturing and the real title just arrived via
    // a second trackChanged (instead of trackMetadataUpdated). Apply in-place to
    // avoid stopping and restarting the recorder — preserving audio from position 0.
    if (this._pendingMetadataUpdate && this._recorder.isRunning && newTrack.title) {
      log(`[Splitter] trackChanged: sentinel in flight — applying metadata in-place for "${newTrack.title}"`)
      this._onTrackMetadataUpdated(newTrack)
      return
    }

    // The same song is still playing but metadata re-arrived with a minor update
    // (e.g. album field populated late by the source, or a redundant GSMTC event).
    // Treat as an in-place update so the in-progress recording is not restarted.
    if (
      this._currentTrack &&
      this._recorder.isRunning &&
      newTrack.title &&
      newTrack.title === this._currentTrack.title &&
      newTrack.artist === this._currentTrack.artist &&
      (newTrack.sourceAppId ?? '') === (this._currentTrack.sourceAppId ?? '')
    ) {
      log(`[Splitter] trackChanged: same song identity — updating metadata in-place for "${newTrack.title}"`)
      this._currentTrack = newTrack
      this.emit('recordingTrackUpdated', newTrack)
      return
    }

    // Snapshot outgoing state before resetting.
    const outgoingRecorder = this._swapRecorder()
    const outgoingTrack = this._currentTrack
    const outgoingStartedAt = this._recordingStartedAt
    const outgoingTrimSec = this._trimSec
    this._currentTrack = null
    this._recordingStartedAt = 0
    this._trimSec = 0
    this._pendingMetadataUpdate = false
    this._stopInFlight = null

    // Promote the warm recorder (already capturing audio) if available,
    // then start a fresh warm recorder for the next transition.
    const warm = this._warmRecorder
    const warmStartedAt = this._warmStartedAt
    this._warmRecorder = null

    // Start the new recording NOW — before the old ffmpeg process has exited.
    // Each instance writes to a unique temp file so they can overlap safely.
    if (!this._matchesSelectedSource(newTrack)) {
      log('[Splitter] trackChanged: source does not match filter — not starting new recording')
      warm && void warm.stop({ fast: true }).catch(() => {})
    } else if (!newTrack.title && newTrack.isPlaying) {
      log('[Splitter] sentinel — starting immediate capture (no title yet)')
      if (warm?.isRunning) {
        // Promote warm recorder as sentinel; trimSec computed using reported position
        // so we keep any new-song audio already buffered in the warm file.
        const positionSec = (newTrack.positionMs ?? 0) / 1000
        this._recorder = warm
        this._recorder.on('error', (err) => this.emit('error', err))
        this._recordingStartedAt = warmStartedAt
        this._trimSec = Math.max(0, (Date.now() - warmStartedAt) / 1000 - positionSec - TrackSplitter.WARM_PAD_SEC)
        this._pendingMetadataUpdate = true
        this._currentTrack = newTrack
        log(`[Splitter] warm recorder promoted as sentinel (pre-roll=${(this._trimSec * 1000).toFixed(0)}ms, position=${(positionSec * 1000).toFixed(0)}ms)`)
        this._acquirePowerSaveBlocker()
        this._startWarmRecorder()
      } else {
        this._startRecordingImmediate(newTrack)
      }
    } else if (newTrack.isPlaying && newTrack.title) {
      if (warm?.isRunning) {
        // Subtract the new track's current position so we keep new-song audio
        // that was already captured in the warm file before detection.
        const positionSec = (newTrack.positionMs ?? 0) / 1000
        const trimSec = Math.max(0, (Date.now() - warmStartedAt) / 1000 - positionSec - TrackSplitter.WARM_PAD_SEC)
        log(`[Splitter] warm recorder promoted for "${newTrack.title}" (pre-roll=${(trimSec * 1000).toFixed(0)}ms, position=${(positionSec * 1000).toFixed(0)}ms)`)
        this._recorder = warm
        this._recorder.on('error', (err) => this.emit('error', err))
        this._recordingStartedAt = warmStartedAt
        this._trimSec = trimSec
        this._currentTrack = newTrack
        this.emit('recordingStarted', newTrack)
        this._acquirePowerSaveBlocker()
        this._startWarmRecorder()
      } else {
        log(`[Splitter] starting recording for "${newTrack.title}" (no warm recorder)`)
        this._startRecording(newTrack)
      }
    } else {
      log(`[Splitter] not starting: isPlaying=${newTrack.isPlaying} title="${newTrack.title}"`)
      warm && void warm.stop({ fast: true }).catch(() => {})
    }

    // Stop and finalize the outgoing recorder in the background.
    // Use graceful stop (not fast) so ffmpeg has time to flush its WASAPI capture
    // buffer before closing the file — prevents the tail of the song being cut off.
    // Since the new recording is already running via the warm recorder, both
    // ffmpeg processes can safely overlap on WASAPI loopback simultaneously.
    // Back-calculate the true audio switch moment: if GSMTC fires with positionMs=200,
    // the new song's audio was already playing for 200ms before we received the event.
    // Subtract that offset so the outgoing recording is cut at the real crossover point,
    // preventing any of the next song's audio from bleeding into the previous song's file.
    const actualSwitchAt = trackChangedAt - (newTrack.positionMs ?? 0)
    void this._stopAndFinalizeDetached(outgoingRecorder, outgoingTrack, outgoingStartedAt, {
      dropIfShortOnTrackChange: true,
      fastStop: false,
      trimSec: outgoingTrimSec,
      stopAt: actualSwitchAt
    })
  }

  private _onArtworkUpdated = (track: GsmtcTrack): void => {
    if (!this._active || !this._currentTrack) return
    const cur = this._currentTrack
    if (
      cur.artist === track.artist &&
      cur.title === track.title &&
      (cur.sourceAppId ?? '') === (track.sourceAppId ?? '')
    ) {
      this._currentTrack = { ...cur, albumArtFile: track.albumArtFile, albumArtMime: track.albumArtMime }
      this.emit('recordingTrackUpdated', this._currentTrack)
    }
  }

  private _onPlayStateChanged = async (isPlaying: boolean): Promise<void> => {
    if (!this._active) return
    log(`[Splitter] playStateChanged → ${isPlaying} recorderRunning=${this._recorder.isRunning}`)

    const t = this._gsmtc.currentTrack
    if (!this._matchesSelectedSource(t)) {
      log('[Splitter] playStateChanged: source does not match filter — stopping')
      await this._stopRecording()
      return
    }

    if (!isPlaying) {
      await this._stopRecording()
    } else {
      if (t.title && !this._recorder.isRunning) {
        log(`[Splitter] playStateChanged: resuming recording for "${t.title}"`)
        this._startRecording(t)
      } else {
        log(`[Splitter] playStateChanged: not starting — title="${t.title}" recorderRunning=${this._recorder.isRunning}`)
      }
      // Ensure a warm recorder is primed after playback resumes.
      this._startWarmRecorder()
    }
  }

  private _startRecording(track: GsmtcTrack): void {
    if (!this._settings) return
    if (this._recorder.isRunning) {
      log(`[Splitter] _startRecording: SKIPPED — recorder already running (title="${track.title}")`)
      return
    }
    this._pendingMetadataUpdate = false

    // Check for duplicate BEFORE starting
    const outputPath = resolveOutputPath({
      outputDir: this._settings.outputDir,
      artist: track.artist,
      title: track.title,
      format: this._settings.format,
      duplicateAction: this._settings.duplicateAction
    })

    if (outputPath === null) {
      log(`[Splitter] _startRecording: SKIPPED duplicate — "${track.title}"`)
      this.emit('recordingFinished', {
        id: `${Date.now()}`,
        artist: track.artist,
        title: track.title,
        filePath: '',
        albumArtFile: track.albumArtFile,
        albumArtMime: track.albumArtMime,
        durationSec: 0,
        status: 'skipped',
        startedAt: Date.now()
      } satisfies RecordingEntry)
      return
    }

    log(`[Splitter] _startRecording: START "${track.title}" by "${track.artist}"`)
    this._currentTrack = track
    this._recordingStartedAt = Date.now()
    this._acquirePowerSaveBlocker()
    this._recorder.start(this._settings.deviceId)
    this.emit('recordingStarted', track)
  }

  private _startRecordingImmediate(placeholder: GsmtcTrack): void {
    if (!this._settings) return
    if (this._recorder.isRunning) {
      log(`[Splitter] _startRecordingImmediate: SKIPPED — recorder already running`)
      return
    }
    // Start capturing audio before metadata is available.
    // _onTrackMetadataUpdated will update _currentTrack and announce the recording.
    log('[Splitter] _startRecordingImmediate: START (awaiting metadata)')
    this._pendingMetadataUpdate = true
    this._currentTrack = placeholder
    this._recordingStartedAt = Date.now()
    this._acquirePowerSaveBlocker()
    this._recorder.start(this._settings.deviceId)
  }

  private _onTrackMetadataUpdated = (track: GsmtcTrack): void => {
    if (!this._active) return
    log(`[Splitter] trackMetadataUpdated → "${track.title}" by "${track.artist}" recorderRunning=${this._recorder.isRunning} pendingMetadata=${this._pendingMetadataUpdate}`)

    if (this._recorder.isRunning && this._pendingMetadataUpdate) {
      // Recorder is already capturing — update track info without restarting.
      // Check for duplicate now that we know the real title.
      const settings = this._settings!
      const outputPath = resolveOutputPath({
        outputDir: settings.outputDir,
        artist: track.artist,
        title: track.title,
        format: settings.format,
        duplicateAction: settings.duplicateAction
      })
      if (outputPath === null) {
        log(`[Splitter] trackMetadataUpdated: DUPLICATE — discarding in-progress recording for "${track.title}"`)
        // Duplicate — discard the in-progress recording.
        this._pendingMetadataUpdate = false
        void this._stopRecording({ fastStop: true }).then(() => {
          this.emit('recordingFinished', {
            id: `${Date.now()}`,
            artist: track.artist,
            title: track.title,
            filePath: '',
            albumArtFile: track.albumArtFile,
            albumArtMime: track.albumArtMime,
            durationSec: 0,
            status: 'skipped',
            startedAt: Date.now()
          } satisfies RecordingEntry)
        })
        return
      }
      log(`[Splitter] trackMetadataUpdated: metadata applied — "${track.title}" by "${track.artist}"`)
      this._pendingMetadataUpdate = false
      this._currentTrack = track
      this.emit('recordingStarted', track)
      this.emit('recordingTrackUpdated', track)
    } else if (!this._recorder.isRunning && !this._pendingMetadataUpdate) {
      log(`[Splitter] trackMetadataUpdated: recorder not running — starting fresh for "${track.title}"`)
      // Recorder stopped before metadata arrived (very rare race) — start fresh.
      if (track.isPlaying && track.title) {
        this._startRecording(track)
      }
    } else {
      log(`[Splitter] trackMetadataUpdated: IGNORED — recorderRunning=${this._recorder.isRunning} pendingMetadata=${this._pendingMetadataUpdate}`)
    }
  }

  /** Create a fresh AudioRecorder (with error listener), returning the old instance. */
  private _swapRecorder(): AudioRecorder {
    const old = this._recorder
    this._recorder = new AudioRecorder()
    this._recorder.on('error', (err) => this.emit('error', err))
    return old
  }

  /** Start a pre-warmed ffmpeg instance that captures audio right now, ready to promote. */
  private _startWarmRecorder(): void {
    if (!this._settings || this._warmRecorder) return
    const warm = new AudioRecorder()
    // On error or unexpected stop, clear and restart so the next track change promotes a warm recorder.
    warm.on('error', () => {
      if (this._warmRecorder === warm) {
        this._warmRecorder = null
        this._scheduleWarmRestart()
      }
    })
    warm.on('stopped', () => {
      if (this._warmRecorder === warm) {
        this._warmRecorder = null
        this._scheduleWarmRestart()
      }
    })
    try {
      warm.start(this._settings.deviceId)
      this._warmRecorder = warm
      this._warmStartedAt = Date.now()
      log('[Splitter] warm recorder started')
    } catch {
      // Warm recorder failed to start — next track change will fall back to cold start.
    }
  }

  private _acquirePowerSaveBlocker(): void {
    if (this._powerSaveBlockerId !== null) return
    this._powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    log(`[Splitter] powerSaveBlocker acquired (id=${this._powerSaveBlockerId})`)
  }

  private _releasePowerSaveBlocker(): void {
    if (this._powerSaveBlockerId === null) return
    powerSaveBlocker.stop(this._powerSaveBlockerId)
    log(`[Splitter] powerSaveBlocker released (id=${this._powerSaveBlockerId})`)
    this._powerSaveBlockerId = null
  }

  /** Cancel any pending warm-recorder restart timer and stop the current warm recorder. */
  private _killWarmRecorder(): void {
    if (this._warmRestartTimer !== null) {
      clearTimeout(this._warmRestartTimer)
      this._warmRestartTimer = null
    }
    const warm = this._warmRecorder
    if (!warm) return
    this._warmRecorder = null
    if (warm.isRunning) {
      warm.stop({ fast: true }).catch(() => {})
    }
  }

  /**
   * Schedule a warm-recorder restart with a 1 s backoff.
   * Deduplicated — calling this multiple times queues only one restart.
   */
  private _scheduleWarmRestart(): void {
    if (this._warmRestartTimer !== null || !this._active) return
    this._warmRestartTimer = setTimeout(() => {
      this._warmRestartTimer = null
      if (this._active) this._startWarmRecorder()
    }, 1_000)
  }

  /**
   * Stop a specific recorder instance and finalize its recording independently
   * of the currently active recorder. Safe to fire-and-forget with `void`.
   */
  private async _stopAndFinalizeDetached(
    recorder: AudioRecorder,
    track: GsmtcTrack | null,
    startedAt: number,
    options: { dropIfShortOnTrackChange?: boolean; fastStop?: boolean; trimSec?: number; stopAt?: number }
  ): Promise<void> {
    if (!recorder.isRunning) return
    if (!track) return
    const settings = this._settings!
    log(`[Splitter] _stopAndFinalizeDetached: stopping "${track.title}" fast=${options.fastStop} trimSec=${options.trimSec ?? 0}`)
    try {
      const stopRequestedAt = options.stopAt ?? Date.now()
      const tmpWav = await recorder.stop({ fast: options.fastStop === true })
      const trimSec = options.trimSec ?? 0
      const preciseDurationSec = Math.max(0, (stopRequestedAt - startedAt) / 1000 - trimSec)
      const durationSec = Math.round(preciseDurationSec)
      await this._finalizeStoppedRecording({
        settings,
        track,
        startedAt,
        tmpWav,
        durationSec,
        dropIfShortOnTrackChange: options.dropIfShortOnTrackChange === true,
        trimSec,
        maxDurationSec: preciseDurationSec
      })
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      this.emit('error', e)
      this.emit('recordingFinished', {
        id: `${Date.now()}`,
        artist: track.artist,
        title: track.title,
        filePath: '',
        albumArtFile: track.albumArtFile,
        albumArtMime: track.albumArtMime,
        durationSec: 0,
        status: 'error',
        error: e.message,
        startedAt
      } satisfies RecordingEntry)
    }
  }

  private async _stopRecording(options?: {
    dropIfShortOnTrackChange?: boolean
    finalizeInBackground?: boolean
    fastStop?: boolean
  }): Promise<void> {
    if (this._stopInFlight) {
      await this._stopInFlight
      return
    }
    if (!this._recorder.isRunning) {
      // Recorder died unexpectedly (e.g. ffmpeg crash). Clear stale state so
      // the next _startRecording doesn't operate against a ghost track.
      if (this._currentTrack) {
        log(`[Splitter] _stopRecording: recorder not running but currentTrack="${this._currentTrack.title}" — clearing stale state`)
        this._currentTrack = null
        this._recordingStartedAt = 0
        this._pendingMetadataUpdate = false
      }
      return
    }

    const stopTask = this._stopRecordingCore(options)
    this._stopInFlight = stopTask
    try {
      await stopTask
    } finally {
      this._stopInFlight = null
    }
  }

  private async _stopRecordingCore(options?: {
    dropIfShortOnTrackChange?: boolean
    finalizeInBackground?: boolean
    fastStop?: boolean
  }): Promise<void> {
    const settings = this._settings!
    const track = this._currentTrack
    if (!track) {
      log('[Splitter] _stopRecordingCore: no currentTrack, aborting')
      return
    }
    const startedAt = this._recordingStartedAt
    const trimSec = this._trimSec
    log(`[Splitter] _stopRecordingCore: stopping "${track.title}" fast=${options?.fastStop} finalizeBg=${options?.finalizeInBackground}`)

    // Clear current state immediately so a new track can start right after stop().
    this._currentTrack = null
    this._recordingStartedAt = 0
    this._trimSec = 0

    try {
      const stopRequestedAt = Date.now()
      const tmpWav = await this._recorder.stop({ fast: options?.fastStop === true })
      this._releasePowerSaveBlocker()
      const preciseDurationSec = Math.max(0, (stopRequestedAt - startedAt) / 1000 - trimSec)
      const durationSec = Math.round(preciseDurationSec)

      const finalizeTask = this._finalizeStoppedRecording({
        settings,
        track,
        startedAt,
        tmpWav,
        durationSec,
        dropIfShortOnTrackChange: options?.dropIfShortOnTrackChange === true,
        trimSec,
        maxDurationSec: preciseDurationSec
      })

      if (options?.finalizeInBackground) {
        void finalizeTask.catch((err) => {
          const e = err instanceof Error ? err : new Error(String(err))
          this.emit('error', e)
          this.emit('recordingFinished', {
            id: `${Date.now()}`,
            artist: track.artist,
            title: track.title,
            filePath: '',
            albumArtFile: track.albumArtFile,
            albumArtMime: track.albumArtMime,
            durationSec,
            status: 'error',
            error: e.message,
            startedAt
          } satisfies RecordingEntry)
        })
        return
      }

      await finalizeTask
    } catch (err) {
      this._releasePowerSaveBlocker()
      const e = err as Error
      this.emit('error', e)
      this.emit('recordingFinished', {
        id: `${Date.now()}`,
        artist: track?.artist ?? '',
        title: track?.title ?? '',
        filePath: '',
        albumArtFile: track?.albumArtFile,
        albumArtMime: track?.albumArtMime,
        durationSec: 0,
        status: 'error',
        error: e.message,
        startedAt
      } satisfies RecordingEntry)
    }
  }

  private async _finalizeStoppedRecording(args: {
    settings: TrackSplitterSettings
    track: GsmtcTrack
    startedAt: number
    tmpWav: string
    durationSec: number
    dropIfShortOnTrackChange: boolean
    trimSec?: number
    maxDurationSec?: number
  }): Promise<void> {
    const { settings, track, startedAt, tmpWav, durationSec, dropIfShortOnTrackChange } = args
    let { trimSec = 0, maxDurationSec } = args

    // Apply any saved trim preset for this song identity.
    const preset = getTrimPreset(track.artist, track.title)
    if (preset) {
      trimSec = trimSec + preset.startOffsetSec
      if (maxDurationSec !== undefined) {
        maxDurationSec = Math.max(
          0,
          maxDurationSec - preset.startOffsetSec - preset.endOffsetSec
        )
      }
      log(`[Splitter] _finalize: applying preset start+${preset.startOffsetSec.toFixed(3)}s end+${preset.endOffsetSec.toFixed(3)}s for "${track.title}"`)
    }

      log(`[Splitter] _finalize: "${track.title}" durationSec=${durationSec} minSave=${settings.minSaveSeconds} hasTitle=${!!track.title}`)

      // Placeholder recording whose metadata never updated — discard silently.
      if (!track.title || (track.sourceAppId && track.title === track.sourceAppId)) {
        log(`[Splitter] _finalize: DISCARD — no real title (title="${track.title}" sourceAppId="${track.sourceAppId}")`)
        try { unlinkSync(tmpWav) } catch { /* ignore */ }
        return
      }

      const minSaveSeconds = Number.isFinite(settings.minSaveSeconds)
        ? Math.max(0, Math.floor(settings.minSaveSeconds))
        : TrackSplitter.DEFAULT_MIN_SAVE_SECONDS

      const shouldDropPartial =
        durationSec < minSaveSeconds

      if (shouldDropPartial) {
        log(`[Splitter] _finalize: DISCARD — too short (${durationSec}s < ${minSaveSeconds}s) dropIfShortOnTrackChange=${dropIfShortOnTrackChange}`)
        try { unlinkSync(tmpWav) } catch { /* ignore */ }
        const reason = dropIfShortOnTrackChange
          ? `Dropped short partial on track change (< ${minSaveSeconds}s)`
          : `Dropped recording below minimum duration (< ${minSaveSeconds}s)`
        this.emit('recordingFinished', {
          id: `${Date.now()}`,
          artist: track.artist,
          title: track.title,
          filePath: '',
          albumArtFile: track.albumArtFile,
          albumArtMime: track.albumArtMime,
          durationSec,
          status: 'skipped',
          error: reason,
          startedAt
        } satisfies RecordingEntry)
        return
      }

      // Re-resolve the path (in case settings changed or the pending track updated it)
      const outputPath = resolveOutputPath({
        outputDir: settings.outputDir,
        artist: track.artist,
        title: track.title,
        format: settings.format,
        duplicateAction: settings.duplicateAction
      })

      if (!outputPath) {
        log(`[Splitter] _finalize: DISCARD — resolveOutputPath returned null (duplicate) for "${track.title}"`)
        try { unlinkSync(tmpWav) } catch { /* ignore */ }
        this.emit('recordingFinished', {
          id: `${Date.now()}`,
          artist: track.artist,
          title: track.title,
          filePath: '',
          albumArtFile: track.albumArtFile,
          albumArtMime: track.albumArtMime,
          durationSec,
          status: 'skipped',
          startedAt
        } satisfies RecordingEntry)
        return
      }

      if (settings.format === 'mp3') {
        log(`[Splitter] _finalize: SAVING mp3 "${track.title}" (${durationSec}s trimSec=${trimSec.toFixed(3)})`)
        const mp3Path = swapExtension(outputPath, 'mp3')
        try {
          await AudioRecorder.encodeToMp3(tmpWav, mp3Path, settings.bitrate, trimSec, maxDurationSec)
          try { unlinkSync(tmpWav) } catch { /* ignore */ }
          await writeId3Tags(mp3Path, track)
          this.emit('recordingFinished', {
            id: `${Date.now()}`,
            artist: track.artist,
            title: track.title,
            filePath: mp3Path,
            albumArtFile: track.albumArtFile,
            albumArtMime: track.albumArtMime,
            durationSec,
            status: 'ok',
            startedAt
          } satisfies RecordingEntry)
        } catch (encErr) {
          log(`[Splitter] _finalize: mp3 encode FAILED for "${track.title}" — ${encErr instanceof Error ? encErr.message : String(encErr)}`)
          try { unlinkSync(tmpWav) } catch { /* ignore */ }
          try { unlinkSync(mp3Path) } catch { /* ignore */ }
          this.emit('recordingFinished', {
            id: `${Date.now()}`,
            artist: track.artist,
            title: track.title,
            filePath: '',
            albumArtFile: track.albumArtFile,
            albumArtMime: track.albumArtMime,
            durationSec,
            status: 'error',
            error: encErr instanceof Error ? encErr.message : String(encErr),
            startedAt
          } satisfies RecordingEntry)
        }
      } else {
        log(`[Splitter] _finalize: SAVING wav "${track.title}" (${durationSec}s trimSec=${trimSec.toFixed(3)})`)
        if (trimSec > 0 || maxDurationSec !== undefined) {
          // Trim pre-roll / clamp duration via stream-copy (no re-encode).
          try {
            await AudioRecorder.trimWav(tmpWav, outputPath, trimSec, maxDurationSec)
          } catch {
            // Fallback: save untrimmed if trim failed.
            renameSync(tmpWav, outputPath)
          }
          try { unlinkSync(tmpWav) } catch { /* ignore */ }
        } else {
          renameSync(tmpWav, outputPath)
        }
        this.emit('recordingFinished', {
          id: `${Date.now()}`,
          artist: track.artist,
          title: track.title,
          filePath: outputPath,
          albumArtFile: track.albumArtFile,
          albumArtMime: track.albumArtMime,
          durationSec,
          status: 'ok',
          startedAt
        } satisfies RecordingEntry)
      }
  }
}

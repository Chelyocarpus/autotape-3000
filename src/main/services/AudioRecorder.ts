import { ChildProcess, execFile, spawn } from 'child_process'
import { renameSync, realpathSync } from 'fs'
import { EventEmitter } from 'events'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { getFfmpegPath } from './FfmpegResolver'
import { APP_LOOPBACK_DEVICE_ID } from './AudioDevices'
import { log } from './log'

/** Resolves the bundled WASAPI process-loopback capture helper's executable path. */
function _resolveLoopbackHelperPath(): string {
  const raw = app.isPackaged
    ? join(process.resourcesPath, 'native', 'loopback-capture.exe')
    : join(__dirname, '..', '..', 'native', 'loopback-capture', 'target', 'release', 'loopback-capture.exe')
  try {
    return realpathSync(raw)
  } catch {
    return raw
  }
}

function runFfmpegAsync(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(binary, args, { windowsHide: true, timeout: 8_000 }, (_err, stdout, stderr) => {
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`)
    })
  })
}

export declare interface AudioRecorder {
  on(event: 'started', listener: () => void): this
  on(event: 'stopped', listener: (filePath: string) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'silence-warning', listener: () => void): this
  on(event: 'audio-detected', listener: () => void): this
}

export class AudioRecorder extends EventEmitter {
  private static _firstDshowInput: string | null | undefined = undefined
  private static _probePromise: Promise<void> | null = null

  /**
   * Pre-warm the ffmpeg capability cache using async execFile so the first
   * recording start never blocks the main-process event loop.
   * Returns the same Promise on every call — safe to await concurrently.
   */
  static probe(): Promise<void> {
    if (!AudioRecorder._probePromise) {
      AudioRecorder._probePromise = AudioRecorder._doProbe()
    }
    return AudioRecorder._probePromise
  }

  /**
   * Clear the cached capability probe result so the next call to probe()
   * re-runs detection. Call this after changing the ffmpeg path.
   */
  static resetProbe(): void {
    AudioRecorder._probePromise = null
    AudioRecorder._firstDshowInput = undefined
  }

  private static async _doProbe(): Promise<void> {
    const binary = getFfmpegPath()
    try {
      const dshowOut = await runFfmpegAsync(binary, [
        '-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'
      ])
      // Extract only the audio section to avoid matching video device names
      const audioSectionIdx = dshowOut.indexOf('DirectShow audio devices')
      const audioSection = audioSectionIdx >= 0 ? dshowOut.slice(audioSectionIdx) : dshowOut
      // Match device lines: [dshow @ addr]  "Device Name"
      const m = /\[dshow[^\]]*\]\s+"([^"@][^"]*)"/i.exec(audioSection)
      AudioRecorder._firstDshowInput = m ? `audio=${m[1].trim()}` : null
      log(`[AudioRecorder] first dshow audio input: ${AudioRecorder._firstDshowInput ?? '(none)'}`)
    } catch (err) {
      log(`[AudioRecorder] probe failed: ${(err as Error).message}`)
      AudioRecorder._firstDshowInput = null
    }
  }

  private _proc: ChildProcess | null = null
  private _helper: ChildProcess | null = null
  private _tmpPath: string | null = null
  private _running = false
  private _startedAt = 0

  get isRunning(): boolean {
    return this._running
  }

  /**
   * Start recording. For a plain dshow deviceId this captures from that device.
   * For APP_LOOPBACK_DEVICE_ID, loopbackPid must be the already-resolved target
   * process ID — capture is then scoped to that process tree via the bundled
   * WASAPI process-loopback helper instead of a DirectShow device.
   * Returns the temp WAV file path where audio is being written.
   */
  start(deviceId: string, loopbackPid?: number | null): string {
    if (this._running) {
      throw new Error('Recorder already running')
    }

    const tmp = join(tmpdir(), `autotape_${randomUUID()}.wav`)
    const binary = getFfmpegPath()

    let args: string[]
    if (deviceId === APP_LOOPBACK_DEVICE_ID) {
      if (typeof loopbackPid !== 'number') {
        throw new Error('Isolated app capture requires a resolved process ID')
      }
      args = this._buildLoopbackFfmpegArgs(tmp)
      this._helper = this._spawnLoopbackHelper(loopbackPid)
    } else {
      args = this._buildCaptureArgs(deviceId, tmp)
    }

    this._tmpPath = tmp
    this._startedAt = Date.now()
    const spawnRequestedAt = this._startedAt
    this._proc = spawn(binary, args, { windowsHide: true })
    this._running = true
    log(`[AudioRecorder] start: deviceId=${deviceId}${typeof loopbackPid === 'number' ? ` loopbackPid=${loopbackPid}` : ''} wav=${tmp}`)
    this._proc.once('spawn', () => {
      log(`[AudioRecorder] ffmpeg spawned after ${Date.now() - spawnRequestedAt}ms`)
    })

    if (this._helper) {
      // child.stdin has no default error listener, so an EPIPE-class error here
      // (e.g. ffmpeg's stdin closing while the helper is still shutting down) would
      // otherwise be unhandled and crash the process. Teardown races like this are
      // expected — the proc 'error'/'close' handlers below already cover reporting.
      this._proc.stdin?.on('error', () => {})
      this._helper.stdout?.on('error', () => {})
      this._helper.stdout?.pipe(this._proc.stdin!)
      this._helper.on('error', (err) => this.emit('error', err))
      this._helper.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          log(`[AudioRecorder] loopback helper exited with code ${code} (signal=${signal})`)
        }
      })
    }

    let stderrBuf = ''
    this._proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
      // Process complete lines to detect silence events from the silencedetect filter
      let nl: number
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl)
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line.includes('silence_start')) {
          this.emit('silence-warning')
        } else if (line.includes('silence_end')) {
          this.emit('audio-detected')
        }
      }
    })

    this._proc.on('error', (err) => {
      this._running = false
      this.emit('error', err)
    })

    this._proc.on('close', (_code) => {
      this._running = false
      log(`[AudioRecorder] ffmpeg closed after ${Date.now() - this._startedAt}ms total (code=${_code})`)
      if (this._helper) {
        this._helper.kill()
        this._helper = null
      }
      if (this._tmpPath) {
        this.emit('stopped', this._tmpPath)
      }
      this._tmpPath = null
      this._proc = null
    })

    this.emit('started')
    return tmp
  }

  private _spawnLoopbackHelper(pid: number): ChildProcess {
    const helperPath = _resolveLoopbackHelperPath()
    return spawn(helperPath, ['--pid', String(pid)], { windowsHide: true })
  }

  private _buildLoopbackFfmpegArgs(outputPath: string): string[] {
    return [
      '-y',
      '-f', 'f32le',
      '-ar', '48000',
      '-ac', '2',
      '-thread_queue_size', '512',
      '-i', 'pipe:0',
      '-vn', '-ac', '2',
      '-af', 'silencedetect=noise=-60dB:d=5',
      '-fflags', '+nobuffer',
      '-flush_packets', '1',
      outputPath
    ]
  }

  private _buildCaptureArgs(deviceId: string, outputPath: string): string[] {
    // dshow device IDs are stored as: dshow:audio=Device Name
    // For 'default' or unknown IDs, fall back to the first probed dshow device.
    let input: string
    if (deviceId.startsWith('dshow:')) {
      input = deviceId.slice('dshow:'.length)
    } else {
      input = this._getFirstDshowAudioInput() ?? `audio=${deviceId}`
    }

    return [
      '-y',
      '-f', 'dshow',
      // Reduce DirectShow capture buffer from default ~500ms to 50ms for snappier endings
      '-audio_buffer_size', '50',
      '-thread_queue_size', '512',
      '-i', input,
      '-vn', '-ac', '2',
      '-af', 'silencedetect=noise=-60dB:d=5',
      '-fflags', '+nobuffer',
      '-flush_packets', '1',
      outputPath
    ]
  }

  private _getFirstDshowAudioInput(): string | null {
    // Falls back to null if probe hasn't completed — caller handles null gracefully
    if (AudioRecorder._firstDshowInput !== undefined) return AudioRecorder._firstDshowInput
    return null
  }

  /**
   * Stop the recording gracefully. Resolves with the WAV file path.
   */
  stop(options?: { fast?: boolean }): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this._running || !this._proc) {
        reject(new Error('Recorder not running'))
        return
      }

      const filePath = this._tmpPath!
      const fast = options?.fast === true
      const stopRequestedAt = Date.now()
      log(`[AudioRecorder] stop requested (fast=${fast}) after ${stopRequestedAt - this._startedAt}ms recording`)

      // Use named handlers so each can remove the other, preventing listener leaks
      // when the promise is settled via the SIGKILL timeout rather than the events.
      const onStopped = (path: string): void => {
        this.removeListener('error', onError)
        log(`[AudioRecorder] stop resolved after ${Date.now() - stopRequestedAt}ms`)
        resolve(path)
      }
      const onError = (err: Error): void => {
        this.removeListener('stopped', onStopped)
        reject(err)
      }
      this.once('stopped', onStopped)
      this.once('error', onError)

      const settle = (path: string): void => {
        this.removeListener('stopped', onStopped)
        this.removeListener('error', onError)
        resolve(path)
      }

      // Loopback mode: killing the helper closes its stdout, which EOFs ffmpeg's
      // stdin pipe and lets ffmpeg finalize the file on its own — same effect as
      // the 'q'/SIGINT paths below have for a dshow capture.
      const isLoopback = this._helper !== null
      if (this._helper) {
        this._helper.kill()
        this._helper = null
      }

      // On fast stop (track change), escalate quickly so capture stops almost instantly.
      if (fast) {
        // For split-on-change we prioritize cutting capture latency over graceful tail handling.
        // Capture the exact process instance — by the time the timer fires a new recording
        // may have already started on a different _proc, and we must NOT kill that one.
        const procToKill = this._proc
        this._proc.kill('SIGINT')

        setTimeout(() => {
          if (this._running && this._proc === procToKill) {
            log(`[AudioRecorder] fast stop: SIGINT did not close ffmpeg within 120ms — escalating to SIGKILL`)
            this._proc.kill('SIGKILL')
            // Mark as stopped immediately so isRunning is false before resolve() returns.
            // The close event will still fire and clean up _proc/_tmpPath.
            this._running = false
            settle(filePath)
          }
        }, 120)
        return
      }

      if (isLoopback) {
        // Nothing more to do — killing the helper above already EOFs ffmpeg's stdin
        // (piped from the helper's stdout), which finalizes the file on its own.
        // Writing 'q' into that stream here would corrupt the raw PCM data with a
        // stray byte and, worse, race the pipe's own auto-end() from the helper's
        // stdout closing, which can throw ERR_STREAM_WRITE_AFTER_END if any trailing
        // buffered audio from the killed helper arrives after our manual end() did.
      } else if (this._proc.stdin) {
        // Send 'q' to ffmpeg stdin to stop gracefully and finalize the file
        this._proc.stdin.write('q')
        this._proc.stdin.end()
      } else {
        this._proc.kill('SIGINT')
      }

      // Graceful path for normal stop/pause.
      const procToKillGraceful = this._proc
      setTimeout(() => {
        if (this._running && this._proc === procToKillGraceful) {
          log(`[AudioRecorder] graceful stop: ffmpeg did not close within 500ms — escalating to SIGKILL`)
          this._proc.kill('SIGKILL')
          this._running = false
          settle(filePath)
        }
      }, 500)
    })
  }

  /**
   * Encode a WAV file to MP3 using ffmpeg libmp3lame.
   * Returns the path to the resulting MP3 file.
   */
  static async encodeToMp3(wavPath: string, mp3Path: string, bitrate: number, trimSec = 0, maxDurationSec?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const binary = getFfmpegPath()
      const seekArgs = trimSec > 0 ? ['-ss', trimSec.toFixed(3)] : []
      const durationArgs = maxDurationSec !== undefined ? ['-t', maxDurationSec.toFixed(3)] : []
      execFile(
        binary,
        [
          '-y',
          ...seekArgs,
          ...durationArgs,
          '-i', wavPath,
          '-codec:a', 'libmp3lame',
          '-b:a', `${bitrate}k`,
          '-abr', '1',
          '-id3v2_version', '3',
          mp3Path
        ],
        { windowsHide: true, timeout: 120_000 },
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }

  /**
   * Best-effort read of an MP3's nominal bitrate (in kbps) from ffmpeg's own
   * stream-info output, so a re-trim can preserve it instead of guessing.
   */
  private static async _probeMp3BitrateKbps(binary: string, filePath: string): Promise<number | null> {
    const output = await runFfmpegAsync(binary, ['-i', filePath])
    const match = /\bbitrate:\s*(\d+)\s*kb\/s/.exec(output)
    return match ? Number(match[1]) : null
  }

  /**
   * Re-trim an already-saved MP3 or WAV file to the given [startSec, endSec] range.
   * The output replaces the original file in-place.
   */
  static async retrimFile(filePath: string, startSec: number, endSec: number): Promise<void> {
    const binary = getFfmpegPath()
    const duration = Math.max(0.1, endSec - startSec)
    const isWav = filePath.toLowerCase().endsWith('.wav')
    const tmpPath = `${filePath}.retrim${isWav ? '.wav' : '.mp3'}`

    let args: string[]
    if (isWav) {
      args = [
        '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
        '-i', filePath, '-c', 'copy', tmpPath
      ]
    } else {
      // Re-encode at the file's original bitrate rather than a fixed VBR
      // quality, so trimming a 128kbps recording doesn't balloon it to ~245kbps.
      const bitrate = (await AudioRecorder._probeMp3BitrateKbps(binary, filePath)) ?? 192
      args = [
        '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
        '-i', filePath,
        '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-abr', '1',
        '-map_metadata', '0', '-id3v2_version', '3',
        tmpPath
      ]
    }

    return new Promise((resolve, reject) => {
      execFile(binary, args, { windowsHide: true, timeout: 120_000 }, (err) => {
        if (err) { reject(err); return }
        try {
          renameSync(tmpPath, filePath)
          resolve()
        } catch (renameErr) {
          reject(renameErr)
        }
      })
    })
  }

  /**
   * Copy a WAV file, skipping the first `trimSec` seconds of audio.
   */
  static async trimWav(inputPath: string, outputPath: string, trimSec: number, maxDurationSec?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const binary = getFfmpegPath()
      const durationArgs = maxDurationSec !== undefined ? ['-t', maxDurationSec.toFixed(3)] : []
      execFile(
        binary,
        ['-y', '-ss', trimSec.toFixed(3), ...durationArgs, '-i', inputPath, '-c', 'copy', outputPath],
        { windowsHide: true, timeout: 60_000 },
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }
}

import { ChildProcess, execFile, spawn } from 'child_process'
import { renameSync } from 'fs'
import { EventEmitter } from 'events'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getFfmpegPath } from './FfmpegResolver'
import { log } from './log'

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
  private _tmpPath: string | null = null
  private _running = false

  get isRunning(): boolean {
    return this._running
  }

  /**
   * Start recording from the given DirectShow device.
   * Returns the temp WAV file path where audio is being written.
   */
  start(deviceId: string): string {
    if (this._running) {
      throw new Error('Recorder already running')
    }

    const tmp = join(tmpdir(), `autotape_${randomUUID()}.wav`)
    this._tmpPath = tmp

    const binary = getFfmpegPath()
    const args = this._buildCaptureArgs(deviceId, tmp)

    this._proc = spawn(binary, args, { windowsHide: true })
    this._running = true

    this._proc.stderr?.on('data', (_chunk: Buffer) => {
      // ffmpeg writes progress to stderr; we ignore it
    })

    this._proc.on('error', (err) => {
      this._running = false
      this.emit('error', err)
    })

    this._proc.on('close', (_code) => {
      this._running = false
      if (this._tmpPath) {
        this.emit('stopped', this._tmpPath)
      }
      this._tmpPath = null
      this._proc = null
    })

    this.emit('started')
    return tmp
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
      '-vn', '-ar', '44100', '-ac', '2',
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

      // Use named handlers so each can remove the other, preventing listener leaks
      // when the promise is settled via the SIGKILL timeout rather than the events.
      const onStopped = (path: string): void => {
        this.removeListener('error', onError)
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

      // On fast stop (track change), escalate quickly so capture stops almost instantly.
      if (fast) {
        // For split-on-change we prioritize cutting capture latency over graceful tail handling.
        // Capture the exact process instance — by the time the timer fires a new recording
        // may have already started on a different _proc, and we must NOT kill that one.
        const procToKill = this._proc
        this._proc.kill('SIGINT')

        setTimeout(() => {
          if (this._running && this._proc === procToKill) {
            this._proc.kill('SIGKILL')
            // Mark as stopped immediately so isRunning is false before resolve() returns.
            // The close event will still fire and clean up _proc/_tmpPath.
            this._running = false
            settle(filePath)
          }
        }, 120)
        return
      }

      // Send 'q' to ffmpeg stdin to stop gracefully and finalize the file
      if (this._proc.stdin) {
        this._proc.stdin.write('q')
        this._proc.stdin.end()
      } else {
        this._proc.kill('SIGINT')
      }

      // Graceful path for normal stop/pause.
      const procToKillGraceful = this._proc
      setTimeout(() => {
        if (this._running && this._proc === procToKillGraceful) {
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
   * Re-trim an already-saved MP3 or WAV file to the given [startSec, endSec] range.
   * The output replaces the original file in-place.
   */
  static async retrimFile(filePath: string, startSec: number, endSec: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const binary = getFfmpegPath()
      const duration = Math.max(0.1, endSec - startSec)
      const isWav = filePath.toLowerCase().endsWith('.wav')
      const tmpPath = `${filePath}.retrim${isWav ? '.wav' : '.mp3'}`
      const args = isWav
        ? [
            '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
            '-i', filePath, '-c', 'copy', tmpPath
          ]
        : [
            '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
            '-i', filePath,
            '-codec:a', 'libmp3lame', '-q:a', '0',
            '-map_metadata', '0', '-id3v2_version', '3',
            tmpPath
          ]
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

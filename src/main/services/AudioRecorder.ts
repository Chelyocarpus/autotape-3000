import { ChildProcess, execFile, spawn } from 'child_process'
import { renameSync } from 'fs'
import { EventEmitter } from 'events'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getFfmpegPath } from './FfmpegResolver'
import { log } from './log'
import NodeID3 from 'node-id3'

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
   * Run ffmpeg with the given args, then atomically replace filePath with the
   * tmpPath it wrote. Shared by every retrim variant below.
   */
  private static _runFfmpegAndRename(binary: string, args: string[], tmpPath: string, filePath: string): Promise<void> {
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

  private static _retrimWavFile(binary: string, filePath: string, startSec: number, endSec: number): Promise<void> {
    const duration = Math.max(0.1, endSec - startSec)
    const tmpPath = `${filePath}.retrim.wav`
    const args = [
      '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
      '-i', filePath, '-c', 'copy', tmpPath
    ]
    return AudioRecorder._runFfmpegAndRename(binary, args, tmpPath, filePath)
  }

  /** Re-encode filePath itself — the lossy fallback used when there's no lossless source, or it failed. */
  private static _retrimMp3Lossy(binary: string, filePath: string, startSec: number, endSec: number, bitrate: number): Promise<void> {
    const duration = Math.max(0.1, endSec - startSec)
    const tmpPath = `${filePath}.retrim.mp3`
    const args = [
      '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
      '-i', filePath,
      '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-abr', '1',
      '-map_metadata', '0', '-id3v2_version', '3',
      tmpPath
    ]
    return AudioRecorder._runFfmpegAndRename(binary, args, tmpPath, filePath)
  }

  /**
   * Re-encode from the still-lossless temp WAV instead of the already-lossy MP3 —
   * a single-generation WAV→MP3 encode instead of a second lossy re-encode.
   *
   * Robustness / pitfalls guarded against:
   * - The WAV can vanish between the caller's cache lookup and this method
   *   actually invoking ffmpeg (LosslessSourceCache eviction race, or the file
   *   being removed externally) — this throws on any ffmpeg/rename failure,
   *   and retrimFile()'s caller-side try/catch falls back to _retrimMp3Lossy
   *   so the user's trim action still succeeds rather than hard-failing.
   * - ID3 tags (title/artist/album/art) live only in the original MP3, not the
   *   bare WAV, so they're read before the encode and re-applied after the
   *   rename — otherwise every lossless-source retrim would silently strip
   *   them (the lossy path avoids this via ffmpeg's `-map_metadata 0` against
   *   the MP3 itself, which isn't available here since the MP3 isn't an input).
   */
  private static async _retrimMp3FromSource(
    binary: string,
    filePath: string,
    sourceWavPath: string,
    startSec: number,
    endSec: number,
    bitrate: number
  ): Promise<void> {
    const duration = Math.max(0.1, endSec - startSec)
    const tmpPath = `${filePath}.retrim.mp3`

    let existingTags: NodeID3.Tags = {}
    try {
      // NodeID3.Promise.* (not the sync NodeID3.read/write) so this doesn't
      // block the main process's event loop on file I/O.
      existingTags = (await NodeID3.Promise.read(filePath)) ?? {}
    } catch {
      // Original file's tags unreadable — proceed without them rather than failing the trim.
    }

    const args = [
      '-y', '-ss', startSec.toFixed(3), '-t', duration.toFixed(3),
      '-i', sourceWavPath,
      '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-abr', '1',
      '-id3v2_version', '3',
      tmpPath
    ]
    await AudioRecorder._runFfmpegAndRename(binary, args, tmpPath, filePath)

    try {
      await NodeID3.Promise.write(existingTags, filePath)
    } catch {
      // Best-effort — the audio trim already succeeded; losing tags here shouldn't fail the operation.
    }
  }

  /**
   * Re-trim an already-saved MP3 or WAV file to the given [startSec, endSec] range.
   * The output replaces the original file in-place.
   *
   * `losslessSourcePath`, when given (MP3 files only — WAV output is already
   * lossless), points at the still-uncompressed temp WAV captured before the
   * original MP3 encode, letting this do a single-generation re-encode instead
   * of decoding-then-re-encoding the already-lossy MP3 a second time.
   *
   * The returned `usedLosslessSource` tells the caller whether a provided
   * source was actually used — false means either none was given, or the
   * given one failed (e.g. evicted mid-race) and this fell back to the lossy
   * path, letting the caller (e.g. the IPC handler backing LosslessSourceCache)
   * evict a now-known-bad cache entry instead of retrying it forever.
   */
  static async retrimFile(
    filePath: string,
    startSec: number,
    endSec: number,
    losslessSourcePath?: string | null
  ): Promise<{ usedLosslessSource: boolean }> {
    const binary = getFfmpegPath()
    const isWav = filePath.toLowerCase().endsWith('.wav')

    if (isWav) {
      await AudioRecorder._retrimWavFile(binary, filePath, startSec, endSec)
      return { usedLosslessSource: false }
    }

    // Re-encode at the file's original bitrate rather than a fixed VBR quality,
    // so trimming a 128kbps recording doesn't balloon it to ~245kbps. Resolved
    // once up front so both the lossless attempt and its lossy fallback agree.
    const bitrate = (await AudioRecorder._probeMp3BitrateKbps(binary, filePath)) ?? 192

    if (losslessSourcePath) {
      try {
        await AudioRecorder._retrimMp3FromSource(binary, filePath, losslessSourcePath, startSec, endSec, bitrate)
        return { usedLosslessSource: true }
      } catch (err) {
        log(`[AudioRecorder] retrim from lossless source failed, falling back to lossy re-encode: ${(err as Error).message}`)
      }
    }

    await AudioRecorder._retrimMp3Lossy(binary, filePath, startSec, endSec, bitrate)
    return { usedLosslessSource: false }
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

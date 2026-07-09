import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../FfmpegResolver', () => ({
  getFfmpegPath: () => 'C:\\fake\\ffmpeg.exe'
}))

const execFileMock = vi.fn()
const spawnMock = vi.fn()

vi.mock('child_process', () => {
  const execFile = (...args: unknown[]) => execFileMock(...args)
  const spawn = (...args: unknown[]) => spawnMock(...args)
  return { execFile, spawn, ChildProcess: class {}, default: { execFile, spawn } }
})

vi.mock('fs', () => {
  const renameSync = vi.fn()
  return { renameSync, default: { renameSync } }
})

import { renameSync } from 'fs'
import { AudioRecorder } from '../AudioRecorder'

type ExecFileCallback = (err: Error | null, stdout?: string, stderr?: string) => void

/** Fake ChildProcess covering exactly what AudioRecorder.start()/stop() touch. */
class FakeChildProcess extends EventEmitter {
  stderr = new EventEmitter()
  stdin = { write: vi.fn(), end: vi.fn() }
  kill = vi.fn()
}

describe('AudioRecorder capture args', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => new FakeChildProcess())
  })

  it('does not force a 44.1kHz sample rate — the device native rate is preserved', () => {
    const recorder = new AudioRecorder()
    recorder.start('dshow:audio=Microphone')

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const captureArgs = spawnMock.mock.calls[0][1] as string[]
    expect(captureArgs).not.toContain('-ar')
    expect(captureArgs).not.toContain('44100')
  })
})

describe('AudioRecorder.retrimFile', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    vi.mocked(renameSync).mockReset()
  })

  function queueProbeThenEncode(probeStderr: string): void {
    // First execFile call: the ffmpeg `-i <file>` bitrate probe (runFfmpegAsync).
    // ffmpeg always exits non-zero with no output file specified, but the stream
    // info we need is on stderr regardless of the error.
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error('At least one output file must be specified'), '', probeStderr)
    })
    // Second execFile call: the actual re-encode.
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null)
    })
  }

  it('re-encodes at the probed bitrate in ABR mode', async () => {
    queueProbeThenEncode(
      'Duration: 00:03:00.00, start: 0.000000, bitrate: 256 kb/s\n' +
      '  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 256 kb/s'
    )

    await AudioRecorder.retrimFile('C:\\rec\\song.mp3', 1.5, 10)

    expect(execFileMock).toHaveBeenCalledTimes(2)
    const retrimArgs = execFileMock.mock.calls[1][1] as string[]
    expect(retrimArgs).toContain('-abr')
    expect(retrimArgs[retrimArgs.indexOf('-abr') + 1]).toBe('1')
    expect(retrimArgs[retrimArgs.indexOf('-b:a') + 1]).toBe('256k')
    expect(renameSync).toHaveBeenCalledWith('C:\\rec\\song.mp3.retrim.mp3', 'C:\\rec\\song.mp3')
  })

  it('falls back to 192kbps when the bitrate probe finds nothing usable', async () => {
    queueProbeThenEncode('ffmpeg version 6.0\nno stream info here')

    await AudioRecorder.retrimFile('C:\\rec\\song.mp3', 0, 5)

    const retrimArgs = execFileMock.mock.calls[1][1] as string[]
    expect(retrimArgs).toContain('-abr')
    expect(retrimArgs[retrimArgs.indexOf('-b:a') + 1]).toBe('192k')
  })

  it('skips bitrate probing entirely for WAV files (stream-copy trim, no re-encode)', async () => {
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null)
    })

    await AudioRecorder.retrimFile('C:\\rec\\song.wav', 0, 5)

    expect(execFileMock).toHaveBeenCalledTimes(1)
    const args = execFileMock.mock.calls[0][1] as string[]
    expect(args).toContain('-c')
    expect(args).not.toContain('-abr')
  })
})

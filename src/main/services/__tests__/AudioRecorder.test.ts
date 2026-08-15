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

// AudioRecorder uses NodeID3.Promise.read/write (not the sync read/write) so
// tag I/O doesn't block the main process — mock only the Promise namespace.
const nodeId3ReadMock = vi.fn((_filePath: string) => Promise.resolve({ title: 'Existing Title' }))
const nodeId3WriteMock = vi.fn((_tags: unknown, _filePath: string) => Promise.resolve(true))
vi.mock('node-id3', () => ({
  default: {
    Promise: {
      read: (filePath: string) => nodeId3ReadMock(filePath),
      write: (tags: unknown, filePath: string) => nodeId3WriteMock(tags, filePath)
    }
  }
}))

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
    nodeId3ReadMock.mockClear()
    nodeId3WriteMock.mockClear()
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

  it('retrims from the provided lossless WAV source with a single-generation encode (no -i on the MP3)', async () => {
    queueProbeThenEncode(
      'Duration: 00:03:00.00, start: 0.000000, bitrate: 192 kb/s\n' +
      '  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s'
    )

    const result = await AudioRecorder.retrimFile('C:\\rec\\song.mp3', 1, 5, 'C:\\Temp\\autotape_source.wav')

    expect(result).toEqual({ usedLosslessSource: true })
    expect(execFileMock).toHaveBeenCalledTimes(2)
    const encodeArgs = execFileMock.mock.calls[1][1] as string[]
    expect(encodeArgs[encodeArgs.indexOf('-i') + 1]).toBe('C:\\Temp\\autotape_source.wav')
    expect(encodeArgs).not.toContain('C:\\rec\\song.mp3')
    expect(encodeArgs[encodeArgs.indexOf('-b:a') + 1]).toBe('192k')
    expect(renameSync).toHaveBeenCalledWith('C:\\rec\\song.mp3.retrim.mp3', 'C:\\rec\\song.mp3')
    expect(nodeId3WriteMock).toHaveBeenCalledWith({ title: 'Existing Title' }, 'C:\\rec\\song.mp3')
  })

  it('still retrims successfully if ID3 tags cannot be read from the source file', async () => {
    queueProbeThenEncode(
      'Duration: 00:03:00.00, start: 0.000000, bitrate: 192 kb/s\n' +
      '  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s'
    )
    nodeId3ReadMock.mockRejectedValueOnce(new Error('failed to read ID3 tags'))

    const result = await AudioRecorder.retrimFile('C:\\rec\\song.mp3', 1, 5, 'C:\\Temp\\autotape_source.wav')

    expect(result).toEqual({ usedLosslessSource: true })
    expect(execFileMock).toHaveBeenCalledTimes(2)
    // Read failed, so existingTags stays {} — the write still happens (best-effort)
    // with whatever tags we had, rather than skipping it and silently doing nothing.
    expect(nodeId3WriteMock).toHaveBeenCalledWith({}, 'C:\\rec\\song.mp3')
  })

  it('still retrims successfully if writing ID3 tags to the retrimmed file fails', async () => {
    queueProbeThenEncode(
      'Duration: 00:03:00.00, start: 0.000000, bitrate: 192 kb/s\n' +
      '  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s'
    )
    nodeId3WriteMock.mockRejectedValueOnce(new Error('failed to write ID3 tags'))

    const result = await AudioRecorder.retrimFile('C:\\rec\\song.mp3', 1, 5, 'C:\\Temp\\autotape_source.wav')

    // The audio trim itself must not fail just because the best-effort tag write did.
    expect(result).toEqual({ usedLosslessSource: true })
    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(nodeId3WriteMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the lossy MP3 re-encode when the lossless source ffmpeg invocation fails (e.g. evicted mid-race)', async () => {
    // Call 1: bitrate probe (resolved once, shared by both the lossless attempt and its fallback).
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error('At least one output file must be specified'), '', 'Duration: 00:03:00.00, bitrate: 256 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 256 kb/s')
    })
    // Call 2: the lossless-source encode attempt fails — e.g. the WAV was evicted mid-race.
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error('ENOENT: no such file or directory'), '', '')
    })
    // Call 3: the fallback lossy re-encode against the still-present MP3 succeeds.
    execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(null)
    })

    const result = await AudioRecorder.retrimFile('C:\\rec\\song.mp3', 1, 5, 'C:\\Temp\\autotape_gone.wav')

    expect(result).toEqual({ usedLosslessSource: false })
    expect(execFileMock).toHaveBeenCalledTimes(3)
    const fallbackArgs = execFileMock.mock.calls[2][1] as string[]
    expect(fallbackArgs[fallbackArgs.indexOf('-i') + 1]).toBe('C:\\rec\\song.mp3')
    expect(fallbackArgs[fallbackArgs.indexOf('-b:a') + 1]).toBe('256k')
    expect(renameSync).toHaveBeenCalledWith('C:\\rec\\song.mp3.retrim.mp3', 'C:\\rec\\song.mp3')
  })
})

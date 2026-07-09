import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GsmtcService, GsmtcTrack } from '../GsmtcService'
import type { RecordingEntry, TrackSplitterSettings } from '../TrackSplitter'

// TrackSplitter drives everything through a real AudioRecorder (ffmpeg child process)
// and touches the filesystem via FileManager/MetadataTagger/TrimPresetsStore. None of
// that is needed to exercise the splitter's own state machine and trim math, so every
// collaborator is faked and the splitter is driven only through its public event-based
// API (gsmtc events in, recordingStarted/recordingFinished events out).

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn()
  }
}))

vi.mock('../AudioRecorder', async () => {
  const { EventEmitter: HoistSafeEventEmitter } = await import('events')
  class FakeAudioRecorder extends HoistSafeEventEmitter {
    static instances: FakeAudioRecorder[] = []
    static encodeToMp3 = vi.fn().mockResolvedValue(undefined)
    static trimWav = vi.fn().mockResolvedValue(undefined)

    isRunning = false
    startCalls: string[] = []
    stopCalls: Array<{ fast?: boolean } | undefined> = []
    private readonly _tmpPath: string

    constructor() {
      super()
      this._tmpPath = `C:\\tmp\\rec-${FakeAudioRecorder.instances.length}.wav`
      FakeAudioRecorder.instances.push(this)
    }

    start(deviceId: string): string {
      this.isRunning = true
      this.startCalls.push(deviceId)
      return this._tmpPath
    }

    stop(options?: { fast?: boolean }): Promise<string> {
      this.stopCalls.push(options)
      this.isRunning = false
      return Promise.resolve(this._tmpPath)
    }
  }
  return { AudioRecorder: FakeAudioRecorder }
})

vi.mock('../FileManager', () => ({
  resolveOutputPath: vi.fn(
    ({ outputDir, artist, title, format }: { outputDir: string; artist: string; title: string; format: string }) =>
      `${outputDir}\\${artist} - ${title}.${format}`
  ),
  swapExtension: (filePath: string, newExt: string) => filePath.replace(/\.[^.]+$/, `.${newExt}`)
}))

vi.mock('../MetadataTagger', () => ({
  writeId3Tags: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../TrimPresetsStore', () => ({
  getTrimPreset: vi.fn(() => null)
}))

vi.mock('fs', () => {
  const renameSync = vi.fn()
  const unlinkSync = vi.fn()
  return { renameSync, unlinkSync, default: { renameSync, unlinkSync } }
})

import { unlinkSync } from 'fs'
import { AudioRecorder } from '../AudioRecorder'
import { resolveOutputPath } from '../FileManager'
import { TrackSplitter } from '../TrackSplitter'

type FakeAudioRecorderCtor = typeof AudioRecorder & {
  instances: Array<{ isRunning: boolean; startCalls: string[]; stopCalls: Array<{ fast?: boolean } | undefined> }>
  encodeToMp3: ReturnType<typeof vi.fn>
  trimWav: ReturnType<typeof vi.fn>
}

const FakeRecorder = AudioRecorder as unknown as FakeAudioRecorderCtor

class FakeGsmtc extends EventEmitter {
  fetchArtworkForCurrentTrack = vi.fn()
  constructor(public currentTrack: GsmtcTrack) {
    super()
  }
}

function track(overrides: Partial<GsmtcTrack> = {}): GsmtcTrack {
  return {
    artist: 'Artist',
    title: 'Title',
    album: 'Album',
    albumArtFile: '',
    sourceAppId: 'Spotify.exe',
    positionMs: 0,
    isPlaying: true,
    ...overrides
  }
}

function makeSettings(overrides: Partial<TrackSplitterSettings> = {}): TrackSplitterSettings {
  return {
    outputDir: 'C:\\Music',
    format: 'mp3',
    bitrate: 320,
    deviceId: 'default',
    duplicateAction: 'increment',
    sessionFilter: 'auto',
    minSaveSeconds: 0,
    ...overrides
  }
}

/** Drain the microtask queue so fire-and-forget async finalize chains settle. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('TrackSplitter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    FakeRecorder.instances.length = 0
    FakeRecorder.encodeToMp3.mockClear()
    FakeRecorder.trimWav.mockClear()
    vi.mocked(resolveOutputPath).mockClear()
    vi.mocked(resolveOutputPath).mockImplementation(
      ({ outputDir, artist, title, format }) => `${outputDir}\\${artist} - ${title}.${format}`
    )
    vi.mocked(unlinkSync).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(console.log).mockRestore()
  })

  it('trims the warm-recorder pre-roll and computes the precise duration at the next track change, using a graceful stop', async () => {
    const T0 = 1_000_000
    vi.setSystemTime(T0)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const started: GsmtcTrack[] = []
    const finished: RecordingEntry[] = []
    splitter.on('recordingStarted', (t) => started.push(t))
    splitter.on('recordingFinished', (e) => finished.push(e))

    splitter.startListening(makeSettings())
    // Idle _recorder (index 0) + the warm recorder pre-started for the next song (index 1).
    expect(FakeRecorder.instances).toHaveLength(2)
    const warmForSongA = FakeRecorder.instances[1]
    expect(warmForSongA.isRunning).toBe(true)

    // Song A is detected 2s after the warm recorder started; GSMTC reports position=50ms
    // (a small detection lag between the audio actually starting and the event firing).
    vi.setSystemTime(T0 + 2_000)
    const songA = track({ artist: 'Artist A', title: 'Song A', positionMs: 50, isPlaying: true })
    gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
    await flush()

    expect(started).toEqual([songA])
    // The warm recorder was promoted in place to capture song A (no fresh recorder was
    // started to capture it) — the 4th instance is the next warm recorder, pre-started
    // for the following track change, plus the throwaway instance _swapRecorder() always
    // allocates as `this._recorder` before the warm-promotion branch overwrites it.
    expect(FakeRecorder.instances).toHaveLength(4)
    expect(warmForSongA.isRunning).toBe(true)

    // Song B arrives 5s later, with its own small detection lag (positionMs=80).
    vi.setSystemTime(T0 + 7_000)
    const songB = track({ artist: 'Artist B', title: 'Song B', positionMs: 80, isPlaying: true })
    gsmtc.emit('trackChanged', songA, songB)
    await flush()

    // Song A's recorder must be stopped gracefully (not fast) so ffmpeg can flush its
    // capture buffer — a fast stop here would risk truncating the tail of the song.
    expect(warmForSongA.stopCalls).toEqual([{ fast: false }])

    // trimSec = (2000ms warm-to-trackChanged gap)/1000 - positionSec(0.05) - WARM_PAD(0.1) = 1.85
    // actualSwitchAt = (T0+7000) - positionMs_B(80) = T0+6920
    // durationSec = (actualSwitchAt - warmStartedAt(T0))/1000 - trimSec = 6.92 - 1.85 = 5.07 -> rounds to 5
    expect(FakeRecorder.encodeToMp3).toHaveBeenCalledTimes(1)
    const [, , bitrate, trimSec, maxDurationSec] = FakeRecorder.encodeToMp3.mock.calls[0]
    expect(bitrate).toBe(320)
    expect(trimSec).toBeCloseTo(1.85, 2)
    expect(maxDurationSec).toBeCloseTo(5.07, 2)

    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ title: 'Song A', status: 'ok', durationSec: 5 })
  })

  it('drops a recording shorter than minSaveSeconds on track change and tags the reason accordingly', async () => {
    const T0 = 2_000_000
    vi.setSystemTime(T0)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const finished: RecordingEntry[] = []
    splitter.on('recordingFinished', (e) => finished.push(e))

    splitter.startListening(makeSettings({ minSaveSeconds: 3 }))

    const songA = track({ artist: 'A', title: 'Short Song', positionMs: 0, isPlaying: true })
    gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
    await flush()

    // Song B arrives after only 1s — below the 3s minimum.
    vi.setSystemTime(T0 + 1_000)
    const songB = track({ artist: 'B', title: 'Song B', positionMs: 0, isPlaying: true })
    gsmtc.emit('trackChanged', songA, songB)
    await flush()

    expect(FakeRecorder.encodeToMp3).not.toHaveBeenCalled()
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ title: 'Short Song', status: 'skipped' })
    expect(finished[0].error).toMatch(/track change/i)
    expect(unlinkSync).toHaveBeenCalled()
  })

  it('skips starting a recording when the resolved output path is already taken (duplicate, action=skip)', () => {
    vi.mocked(resolveOutputPath).mockReturnValueOnce(null)

    const gsmtc = new FakeGsmtc(track({ isPlaying: true, title: 'Existing Song' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const finished: RecordingEntry[] = []
    splitter.on('recordingFinished', (e) => finished.push(e))

    splitter.startListening(makeSettings({ duplicateAction: 'skip' }))

    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ title: 'Existing Song', status: 'skipped' })
    expect(finished[0].error).toMatch(/already exists/i)
    // The main recorder (instance 0) must never have been started for the duplicate.
    expect(FakeRecorder.instances[0].isRunning).toBe(false)
  })

  it('discards an in-progress sentinel recording via a fast stop once its metadata turns out to be a duplicate', async () => {
    vi.setSystemTime(3_000_000)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const finished: RecordingEntry[] = []
    splitter.on('recordingFinished', (e) => finished.push(e))

    splitter.startListening(makeSettings())
    const warm = FakeRecorder.instances[1]
    expect(warm.isRunning).toBe(true)

    // Playback starts before GSMTC has resolved a title (sentinel capture).
    const sentinel = track({ title: '', artist: '', isPlaying: true, positionMs: 0 })
    gsmtc.emit('trackChanged', track({ isPlaying: false }), sentinel)
    await flush()
    expect(warm.isRunning).toBe(true) // promoted, still capturing

    // The real metadata arrives and turns out to collide with an existing file.
    vi.mocked(resolveOutputPath).mockReturnValueOnce(null)
    const real = track({ title: 'Dup Song', artist: 'Dup Artist', isPlaying: true })
    gsmtc.emit('trackMetadataUpdated', real)
    await flush()

    expect(warm.stopCalls).toEqual([{ fast: true }])
    expect(FakeRecorder.encodeToMp3).not.toHaveBeenCalled()
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ title: 'Dup Song', status: 'skipped', durationSec: 0 })
    expect(finished[0].error).toMatch(/already exists/i)
  })

  it('updates in-place instead of restarting when the same song identity is reported again mid-recording', async () => {
    vi.setSystemTime(4_000_000)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const trackUpdated: GsmtcTrack[] = []
    const finished: RecordingEntry[] = []
    splitter.on('recordingTrackUpdated', (t) => trackUpdated.push(t))
    splitter.on('recordingFinished', (e) => finished.push(e))

    splitter.startListening(makeSettings())
    const songA = track({ artist: 'Artist A', title: 'Song A', positionMs: 0, isPlaying: true })
    gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
    await flush()

    const activeRecorder = FakeRecorder.instances[1]
    expect(activeRecorder.isRunning).toBe(true)

    // A redundant trackChanged for the identical song (e.g. album art populated late).
    const sameSongUpdate = track({ artist: 'Artist A', title: 'Song A', album: 'New Album', isPlaying: true, positionMs: 12_345 })
    gsmtc.emit('trackChanged', songA, sameSongUpdate)
    await flush()

    // No stop/restart happened — same recorder instance, no finalize, just a metadata update.
    expect(activeRecorder.stopCalls).toEqual([])
    expect(activeRecorder.isRunning).toBe(true)
    expect(finished).toHaveLength(0)
    expect(trackUpdated).toEqual([sameSongUpdate])
  })

  it('performs a graceful (non-fast) stop and finalizes the recording when stopListening is called', async () => {
    vi.setSystemTime(5_000_000)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const finished: RecordingEntry[] = []
    splitter.on('recordingFinished', (e) => finished.push(e))

    splitter.startListening(makeSettings())
    const songA = track({ artist: 'Artist A', title: 'Song A', positionMs: 0, isPlaying: true })
    gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
    await flush()

    const activeRecorder = FakeRecorder.instances[1]
    vi.setSystemTime(5_010_000)
    await splitter.stopListening()

    expect(activeRecorder.stopCalls).toEqual([{ fast: false }])
    expect(finished).toHaveLength(1)
    expect(finished[0]).toMatchObject({ title: 'Song A', status: 'ok' })
  })
})

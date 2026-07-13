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
  app: { isPackaged: false },
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
    /** When set, the next start() call throws this instead of starting — simulates an unresolved loopback PID. */
    static throwOnStart: Error | null = null

    isRunning = false
    startCalls: string[] = []
    startPidCalls: Array<number | null | undefined> = []
    stopCalls: Array<{ fast?: boolean } | undefined> = []
    private readonly _tmpPath: string

    constructor() {
      super()
      this._tmpPath = `C:\\tmp\\rec-${FakeAudioRecorder.instances.length}.wav`
      FakeAudioRecorder.instances.push(this)
    }

    start(deviceId: string, loopbackPid?: number | null): string {
      this.startCalls.push(deviceId)
      this.startPidCalls.push(loopbackPid)
      if (FakeAudioRecorder.throwOnStart) {
        throw FakeAudioRecorder.throwOnStart
      }
      this.isRunning = true
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

vi.mock('../ProcessResolver', () => ({
  resolveAumidToPid: vi.fn()
}))

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
import { APP_LOOPBACK_DEVICE_ID } from '../AudioDevices'
import { resolveAumidToPid } from '../ProcessResolver'
import { resolveOutputPath } from '../FileManager'
import { TrackSplitter } from '../TrackSplitter'

type FakeAudioRecorderCtor = typeof AudioRecorder & {
  instances: Array<EventEmitter & {
    isRunning: boolean
    startCalls: string[]
    startPidCalls: Array<number | null | undefined>
    stopCalls: Array<{ fast?: boolean } | undefined>
  }>
  encodeToMp3: ReturnType<typeof vi.fn>
  trimWav: ReturnType<typeof vi.fn>
  throwOnStart: Error | null
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
    pauseDiscardSeconds: 0,
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
    FakeRecorder.throwOnStart = null
    vi.mocked(resolveOutputPath).mockClear()
    vi.mocked(resolveOutputPath).mockImplementation(
      ({ outputDir, artist, title, format }) => `${outputDir}\\${artist} - ${title}.${format}`
    )
    vi.mocked(unlinkSync).mockClear()
    vi.mocked(resolveAumidToPid).mockReset()
    vi.mocked(resolveAumidToPid).mockResolvedValue(null)
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

  it('resolves the source app to a PID and passes it to the recorder for isolated app capture', async () => {
    vi.setSystemTime(6_000_000)
    vi.mocked(resolveAumidToPid).mockResolvedValue(4242)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '', sourceAppId: 'Spotify.exe' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)

    splitter.startListening(makeSettings({ deviceId: APP_LOOPBACK_DEVICE_ID }))
    await flush() // let the eagerly-kicked-off PID resolution settle and get cached

    expect(resolveAumidToPid).toHaveBeenCalledWith('Spotify.exe')
    // Cold-start path (playStateChanged resume) — the idle main recorder, not the warm one.
    gsmtc.currentTrack = track({ artist: 'Artist A', title: 'Song A', isPlaying: true, sourceAppId: 'Spotify.exe' })
    gsmtc.emit('playStateChanged', true)
    // Even a cached PID is awaited, so recorder.start() lands a microtask later.
    await flush()

    const mainRecorder = FakeRecorder.instances[0]
    expect(mainRecorder.startCalls).toEqual([APP_LOOPBACK_DEVICE_ID])
    expect(mainRecorder.startPidCalls).toEqual([4242])
  })

  it('emits an error instead of throwing when recorder.start() fails for isolated app capture', async () => {
    vi.setSystemTime(7_000_000)
    vi.mocked(resolveAumidToPid).mockResolvedValue(4242)

    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '', sourceAppId: 'Spotify.exe' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const errors: Error[] = []
    const started: GsmtcTrack[] = []
    splitter.on('error', (e) => errors.push(e))
    splitter.on('recordingStarted', (t) => started.push(t))

    splitter.startListening(makeSettings({ deviceId: APP_LOOPBACK_DEVICE_ID }))
    await flush()

    FakeRecorder.throwOnStart = new Error('Isolated app capture requires a resolved process ID')
    gsmtc.currentTrack = track({ artist: 'Artist A', title: 'Song A', isPlaying: true, sourceAppId: 'Spotify.exe' })
    expect(() => gsmtc.emit('playStateChanged', true)).not.toThrow()
    await flush()

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/process ID/)
    expect(started).toHaveLength(0)
  })

  it('does not fail the very first isolated-capture recording when startListening finds a track already playing', async () => {
    // Regression: previously _startRecording read the loopback PID cache
    // synchronously, so a track already playing at startListening() time raced
    // the async PID resolution kicked off in the same call and always lost —
    // recorder.start() threw "Isolated app capture requires a resolved process ID".
    vi.setSystemTime(9_000_000)
    vi.mocked(resolveAumidToPid).mockResolvedValue(4242)

    const gsmtc = new FakeGsmtc(
      track({ artist: 'Artist A', title: 'Song A', isPlaying: true, sourceAppId: 'Spotify.exe' })
    )
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    const errors: Error[] = []
    const started: GsmtcTrack[] = []
    splitter.on('error', (e) => errors.push(e))
    splitter.on('recordingStarted', (t) => started.push(t))

    splitter.startListening(makeSettings({ deviceId: APP_LOOPBACK_DEVICE_ID }))
    await flush()

    expect(errors).toHaveLength(0)
    expect(started).toMatchObject([{ title: 'Song A' }])
    const mainRecorder = FakeRecorder.instances[0]
    expect(mainRecorder.startCalls).toEqual([APP_LOOPBACK_DEVICE_ID])
    expect(mainRecorder.startPidCalls).toEqual([4242])
  })

  it('caches PID resolution per source app so GSMTC flapping between two apps does not re-query for every flip', async () => {
    vi.setSystemTime(8_000_000)
    vi.mocked(resolveAumidToPid).mockImplementation(async (appId: string) =>
      appId === 'AppA.exe' ? 111 : 222
    )

    // 'auto' source selection can bounce a few times between two real sessions in
    // quick succession (e.g. a paused app vs. a playing one) — this reproduces that
    // without a single-entry cache turning every flip into a fresh PowerShell spawn.
    const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '', sourceAppId: 'AppA.exe' }))
    const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
    splitter.startListening(makeSettings({ deviceId: APP_LOOPBACK_DEVICE_ID }))
    await flush()

    const trackA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true, sourceAppId: 'AppA.exe' })
    const trackB = track({ artist: 'Artist B', title: 'Song B', isPlaying: true, sourceAppId: 'AppB.exe' })

    gsmtc.emit('trackChanged', track({ isPlaying: false }), trackA)
    await flush()
    gsmtc.emit('trackChanged', trackA, trackB)
    await flush()
    gsmtc.emit('trackChanged', trackB, trackA)
    await flush()
    gsmtc.emit('trackChanged', trackA, trackB)
    await flush()

    const resolvedForApps = vi.mocked(resolveAumidToPid).mock.calls.map(([appId]) => appId)
    expect(resolvedForApps.filter((id) => id === 'AppA.exe')).toHaveLength(1)
    expect(resolvedForApps.filter((id) => id === 'AppB.exe')).toHaveLength(1)
  })

  describe('requestStop (two-click graceful stop)', () => {
    it('defers stopping while the track is still playing, then finalizes naturally when the track ends', async () => {
      vi.setSystemTime(10_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const finished: RecordingEntry[] = []
      const stopped = vi.fn()
      splitter.on('recordingFinished', (e) => finished.push(e))
      splitter.on('stopped', stopped)

      splitter.startListening(makeSettings())
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      await expect(splitter.requestStop()).resolves.toBe('pending')
      expect(stopped).not.toHaveBeenCalled()
      expect(finished).toHaveLength(0)
      // Recording keeps running while the stop is pending.
      expect(FakeRecorder.instances[1].isRunning).toBe(true)

      vi.setSystemTime(10_010_000)
      const songB = track({ artist: 'Artist B', title: 'Song B', isPlaying: true })
      gsmtc.currentTrack = songB
      gsmtc.emit('trackChanged', songA, songB)
      await flush()

      expect(stopped).toHaveBeenCalledTimes(1)
      expect(finished).toHaveLength(1)
      expect(finished[0]).toMatchObject({ title: 'Song A', status: 'ok' })
      // No recording should have started for songB — the stop won out.
      expect(FakeRecorder.instances.some((r) => r.isRunning)).toBe(false)
    })

    it('force-stops immediately on a second requestStop() call', async () => {
      vi.setSystemTime(11_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const stopped = vi.fn()
      splitter.on('stopped', stopped)

      splitter.startListening(makeSettings())
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      await expect(splitter.requestStop()).resolves.toBe('pending')
      await expect(splitter.requestStop()).resolves.toBe('stopped')
      expect(stopped).toHaveBeenCalledTimes(1)
      expect(FakeRecorder.instances[1].isRunning).toBe(false)
    })

    it('stops immediately (no deferral) when the track is already paused', async () => {
      vi.setSystemTime(12_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const stopped = vi.fn()
      splitter.on('stopped', stopped)

      splitter.startListening(makeSettings())
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      // Song is paused (live GSMTC state), but the recorder is still running per
      // the pause-tolerance behavior below.
      gsmtc.currentTrack = { ...songA, isPlaying: false }
      gsmtc.emit('playStateChanged', false)

      await expect(splitter.requestStop()).resolves.toBe('stopped')
      expect(stopped).toHaveBeenCalledTimes(1)
    })
  })

  describe('pause handling', () => {
    it('keeps the recorder running through a brief pause instead of splitting into two files', async () => {
      vi.setSystemTime(20_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const started = vi.fn()
      splitter.on('recordingStarted', started)

      splitter.startListening(makeSettings({ pauseDiscardSeconds: 60 }))
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      const activeRecorder = FakeRecorder.instances[1]
      expect(started).toHaveBeenCalledTimes(1)

      // Pause, then resume shortly after — well within the grace period.
      gsmtc.currentTrack = { ...songA, isPlaying: false }
      gsmtc.emit('playStateChanged', false)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(activeRecorder.isRunning).toBe(true)
      expect(activeRecorder.stopCalls).toHaveLength(0)

      gsmtc.currentTrack = songA
      gsmtc.emit('playStateChanged', true)
      await flush()

      // No restart — same recorder, no second recordingStarted.
      expect(started).toHaveBeenCalledTimes(1)
      expect(activeRecorder.isRunning).toBe(true)
    })

    it('suppresses silence warnings from ffmpeg while paused, since silence is expected', async () => {
      vi.setSystemTime(23_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const silenceWarning = vi.fn()
      splitter.on('silenceWarning', silenceWarning)

      splitter.startListening(makeSettings())
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      const activeRecorder = FakeRecorder.instances[1]

      // Paused — the recorder keeps running and ffmpeg naturally detects silence.
      gsmtc.currentTrack = { ...songA, isPlaying: false }
      gsmtc.emit('playStateChanged', false)
      activeRecorder.emit('silence-warning')
      expect(silenceWarning).not.toHaveBeenCalled()

      // Still playing — a genuine silence warning should come through.
      gsmtc.currentTrack = songA
      gsmtc.emit('playStateChanged', true)
      activeRecorder.emit('silence-warning')
      expect(silenceWarning).toHaveBeenCalledTimes(1)
    })

    it('clears an already-showing silence warning the moment playback pauses', async () => {
      vi.setSystemTime(24_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const audioDetected = vi.fn()
      splitter.on('audioDetected', audioDetected)

      splitter.startListening(makeSettings())
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      gsmtc.currentTrack = { ...songA, isPlaying: false }
      gsmtc.emit('playStateChanged', false)

      expect(audioDetected).toHaveBeenCalledTimes(1)
    })

    it('stops and discards the recording once paused longer than pauseDiscardSeconds, and tells listeners nothing is being captured', async () => {
      vi.setSystemTime(21_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const finished: RecordingEntry[] = []
      const idle = vi.fn()
      splitter.on('recordingFinished', (e) => finished.push(e))
      splitter.on('recordingIdle', idle)

      splitter.startListening(makeSettings({ pauseDiscardSeconds: 30 }))
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      const activeRecorder = FakeRecorder.instances[1]

      gsmtc.currentTrack = { ...songA, isPlaying: false }
      gsmtc.emit('playStateChanged', false)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(activeRecorder.isRunning).toBe(false)
      expect(finished).toHaveLength(1)
      expect(finished[0]).toMatchObject({ title: 'Song A', status: 'skipped' })
      expect(finished[0].error).toMatch(/paused too long/)
      expect(unlinkSync).toHaveBeenCalled()
      expect(idle).toHaveBeenCalledTimes(1)
    })

    it('never discards when pauseDiscardSeconds is 0', async () => {
      vi.setSystemTime(22_000_000)
      const gsmtc = new FakeGsmtc(track({ isPlaying: false, title: '' }))
      const splitter = new TrackSplitter(gsmtc as unknown as GsmtcService)
      const finished: RecordingEntry[] = []
      splitter.on('recordingFinished', (e) => finished.push(e))

      splitter.startListening(makeSettings({ pauseDiscardSeconds: 0 }))
      const songA = track({ artist: 'Artist A', title: 'Song A', isPlaying: true })
      gsmtc.currentTrack = songA
      gsmtc.emit('trackChanged', track({ isPlaying: false }), songA)
      await flush()

      const activeRecorder = FakeRecorder.instances[1]

      gsmtc.currentTrack = { ...songA, isPlaying: false }
      gsmtc.emit('playStateChanged', false)
      await vi.advanceTimersByTimeAsync(10 * 60_000)

      expect(activeRecorder.isRunning).toBe(true)
      expect(finished).toHaveLength(0)
    })
  })
})

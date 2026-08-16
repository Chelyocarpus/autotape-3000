import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

const spawnMock = vi.fn()

vi.mock('child_process', () => {
  const spawn = (...args: unknown[]) => spawnMock(...args)
  return { execFile: vi.fn(), spawn, ChildProcess: class {}, default: { execFile: vi.fn(), spawn } }
})

/** Captures the 'line' callback GsmtcService registers for the helper's stdout, so tests
 *  can feed it JSON lines the way the real GsmtcHelper.exe stdout would, without a live
 *  child process. Keyed off the fake stdout/stderr streams' `__stream` tag below so the
 *  two readline interfaces GsmtcService now creates (stdout for track data, stderr for
 *  diagnostic logging) don't clobber each other's captured handler. */
let latestLineHandler: ((line: string) => void) | null = null
let latestStderrLineHandler: ((line: string) => void) | null = null

vi.mock('readline', () => {
  const createInterface = ({ input }: { input?: { __stream?: string } } = {}) => {
    const iface = {
      on: (event: string, cb: (line: string) => void) => {
        if (event === 'line') {
          if (input?.__stream === 'stderr') latestStderrLineHandler = cb
          else latestLineHandler = cb
        }
        return iface
      },
      close: vi.fn()
    }
    return iface
  }
  return { createInterface, default: { createInterface } }
})

import { GsmtcService, isLikelyNextTrack, tracksEqual, type GsmtcTrack } from '../GsmtcService'

/** Fake ChildProcess covering exactly what GsmtcService._spawnLoop() touches. */
class FakeChildProcess extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { __stream: 'stdout' as const })
  stderr = Object.assign(new EventEmitter(), { __stream: 'stderr' as const })
  kill = vi.fn()
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

describe('tracksEqual', () => {
  it('is true when artist/title/album/source all match', () => {
    expect(tracksEqual(track(), track())).toBe(true)
  })

  it('ignores positionMs and isPlaying', () => {
    expect(tracksEqual(track({ positionMs: 50_000, isPlaying: false }), track())).toBe(true)
  })

  it('is false when title differs', () => {
    expect(tracksEqual(track(), track({ title: 'Other' }))).toBe(false)
  })

  it('treats missing sourceAppId as equal to empty string', () => {
    expect(tracksEqual(track({ sourceAppId: undefined }), track({ sourceAppId: '' }))).toBe(true)
  })
})

describe('isLikelyNextTrack', () => {
  it('is false across different sources even if position resets', () => {
    const prev = track({ sourceAppId: 'Spotify.exe', positionMs: 180_000 })
    const next = track({ sourceAppId: 'Chrome.exe', positionMs: 0 })
    expect(isLikelyNextTrack(prev, next)).toBe(false)
  })

  it('is false when playback is paused on either side', () => {
    const prev = track({ positionMs: 180_000, isPlaying: false })
    const next = track({ positionMs: 0, isPlaying: true })
    expect(isLikelyNextTrack(prev, next)).toBe(false)
  })

  it('detects a near-zero position reset after the track had been playing for a while', () => {
    // This is the "song skipped, metadata hasn't arrived yet" case the
    // sentinel/pending-metadata state machine in GsmtcService depends on.
    const prev = track({ positionMs: 4_000 })
    const next = track({ positionMs: 200 })
    expect(isLikelyNextTrack(prev, next)).toBe(true)
  })

  it('does not treat a near-zero position as a reset if the previous track had barely started', () => {
    const prev = track({ positionMs: 1_000 })
    const next = track({ positionMs: 200 })
    expect(isLikelyNextTrack(prev, next)).toBe(false)
  })

  it('detects a large backward jump for a mid-song skip', () => {
    const prev = track({ positionMs: 120_000 })
    const next = track({ positionMs: 30_000 })
    expect(isLikelyNextTrack(prev, next)).toBe(true)
  })

  it('does not flag normal forward playback progress as a new track', () => {
    const prev = track({ positionMs: 30_000 })
    const next = track({ positionMs: 31_000 })
    expect(isLikelyNextTrack(prev, next)).toBe(false)
  })

  it('does not flag a small backward seek (user scrubbing) as a new track', () => {
    const prev = track({ positionMs: 60_000 })
    const next = track({ positionMs: 58_000 })
    expect(isLikelyNextTrack(prev, next)).toBe(false)
  })
})

describe('GsmtcService sentinel position', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => new FakeChildProcess())
    latestLineHandler = null
  })

  /**
   * Reproduces a real bug: the position-reset sentinel emitted while a new
   * track's title is still pending previously hardcoded positionMs to 0
   * (from EMPTY_TRACK) instead of passing through the poll's actual reset
   * position. TrackSplitter uses that value to compute how much
   * warm-recorder pre-roll to trim, so discarding it made every such
   * recording trim a bit too much off the real start of the song.
   */
  it('carries the real reset position through the sentinel trackChanged event, not a hardcoded 0', () => {
    const service = new GsmtcService()
    const trackChanged = vi.fn()
    service.on('trackChanged', trackChanged)
    service.start()

    // First poll: an ordinary, already-playing track establishes _currentTrack.
    latestLineHandler!(JSON.stringify(track({ positionMs: 180_000, isPlaying: true })))

    // Second poll: same (stale) title/artist but position has reset near-zero —
    // the real-world case where GSMTC's position updates before its metadata does.
    latestLineHandler!(JSON.stringify(track({ positionMs: 220, isPlaying: true })))

    expect(trackChanged).toHaveBeenCalledTimes(2)
    const sentinel = trackChanged.mock.calls[1][1] as GsmtcTrack
    expect(sentinel.title).toBe('')
    expect(sentinel.positionMs).toBe(220)
  })
})

describe('GsmtcService helper process spawn', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => new FakeChildProcess())
  })

  /**
   * Locks in the process-spawn contract GsmtcService relies on after the migration from
   * spawning `powershell.exe gsmtc_loop.ps1` to spawning the compiled GsmtcHelper.exe
   * directly. A future change that silently reverts to the old shape (wrong exe, missing
   * the source-filter arg, or dropped process options) would otherwise only surface as a
   * runtime GSMTC failure, not a test failure.
   */
  it('spawns GsmtcHelper.exe with the default source filter and expected process options', () => {
    const service = new GsmtcService()
    service.start()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>]

    expect(command).toContain('GsmtcHelper.exe')
    expect(args).toEqual(['auto'])
    expect(options).toMatchObject({
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
  })

  /**
   * The compiled helper logs its own caught exceptions to stderr rather than swallowing
   * them silently, specifically so real-world "GSMTC stopped updating" reports are
   * diagnosable from the app's own log. That only has value if GsmtcService actually
   * captures and surfaces that stderr instead of discarding it.
   */
  it('forwards the helper stderr output into the app log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const service = new GsmtcService()
      service.start()

      expect(latestStderrLineHandler).not.toBeNull()
      latestStderrLineHandler!('[GsmtcHelper] ResyncAsync: COMException: The RPC server is unavailable.')

      const logged = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(logged).toContain('[GsmtcHelper] ResyncAsync: COMException')
    } finally {
      logSpy.mockRestore()
    }
  })

  it('passes the active source filter through to the helper on setSourceFilter()', () => {
    const service = new GsmtcService()
    service.start()
    spawnMock.mockClear()

    service.setSourceFilter('Spotify.exe')

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args] = spawnMock.mock.calls[0] as [string, string[]]
    expect(command).toContain('GsmtcHelper.exe')
    expect(args).toEqual(['Spotify.exe'])
  })
})

describe('GsmtcService restart backoff', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => new FakeChildProcess())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Mirrors GsmtcService's own backoff formula. Advancing by exactly this much (rather
   *  than some larger blanket amount) matters: fake timers move Date.now() forward by
   *  the full requested advance regardless of when the pending timer actually fires, so
   *  over-advancing would make the next spawn's run look "healthy" and reset the streak. */
  function backoffDelayForFailureCount(failureCount: number): number {
    return Math.min(1_000 * 2 ** (failureCount - 1), 30_000)
  }

  /** Immediately fails the most recently spawned process (0ms uptime) and advances the
   *  clock by exactly the expected backoff delay so the next spawn happens. */
  function failLatestProcessAndAdvance(failureCount: number): void {
    const latest = spawnMock.mock.results[spawnMock.mock.results.length - 1].value as FakeChildProcess
    latest.emit('exit')
    vi.advanceTimersByTime(backoffDelayForFailureCount(failureCount))
  }

  it('marks isFailed and stops retrying after MAX_CONSECUTIVE_FAILURES immediate-exit restarts', () => {
    const service = new GsmtcService()
    const errorHandler = vi.fn()
    service.on('error', errorHandler)

    service.start()
    expect(spawnMock).toHaveBeenCalledTimes(1)

    // 9 failures back off and respawn; the 10th gives up instead of scheduling another.
    for (let i = 1; i <= 9; i++) {
      failLatestProcessAndAdvance(i)
    }
    expect(spawnMock).toHaveBeenCalledTimes(10)
    expect(service.isFailed).toBe(false)

    const latest = spawnMock.mock.results[spawnMock.mock.results.length - 1].value as FakeChildProcess
    latest.emit('exit')

    expect(service.isFailed).toBe(true)
    expect(errorHandler).toHaveBeenCalledTimes(1)

    // No further spawn should be scheduled once given up.
    vi.advanceTimersByTime(60_000)
    expect(spawnMock).toHaveBeenCalledTimes(10)
  })

  it('clears isFailed when start() is called again after giving up', () => {
    const service = new GsmtcService()
    service.on('error', () => {})
    service.start()
    for (let i = 1; i <= 10; i++) {
      failLatestProcessAndAdvance(i)
    }
    expect(service.isFailed).toBe(true)

    service.start()
    expect(service.isFailed).toBe(false)
    expect(spawnMock).toHaveBeenCalledTimes(11)
  })
})

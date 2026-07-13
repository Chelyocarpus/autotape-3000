import { describe, expect, it } from 'vitest'
import { getLivePositionMs, isLikelyNextTrack, tracksEqual, type GsmtcTrack } from '../GsmtcService'

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

describe('getLivePositionMs', () => {
  it('extrapolates elapsed time since the source last pushed a position update', () => {
    const t = track({ positionMs: 1_000, positionUpdatedAtMs: 5_000, isPlaying: true })
    expect(getLivePositionMs(t, 5_300)).toBe(1_300)
  })

  it('falls back to the raw position when positionUpdatedAtMs is missing', () => {
    const t = track({ positionMs: 1_000, positionUpdatedAtMs: undefined, isPlaying: true })
    expect(getLivePositionMs(t, 5_300)).toBe(1_000)
  })

  it('does not extrapolate when paused', () => {
    const t = track({ positionMs: 1_000, positionUpdatedAtMs: 5_000, isPlaying: false })
    expect(getLivePositionMs(t, 5_300)).toBe(1_000)
  })

  it('does not go backwards when nowMs is before the last update (clock jitter)', () => {
    const t = track({ positionMs: 1_000, positionUpdatedAtMs: 5_000, isPlaying: true })
    expect(getLivePositionMs(t, 4_900)).toBe(1_000)
  })
})

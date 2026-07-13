import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecording, useSettings } from './useIpc'
import type { GsmtcTrack, UserSettings } from '../types'

const baseSettings: UserSettings = {
  outputDir: 'C:\\Music',
  format: 'mp3',
  bitrate: 320,
  deviceId: 'default',
  duplicateAction: 'increment',
  sessionFilter: 'auto',
  minSaveSeconds: 0,
  pauseDiscardSeconds: 60,
  ffmpegPath: ''
}

describe('useSettings', () => {
  it('loads settings on mount', async () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.settings).toBeNull()
    await waitFor(() => expect(result.current.settings).not.toBeNull())
  })

  it('save() persists immediately and updates local state', async () => {
    // NOTE: this hook currently saves on every call with no debouncing, so a
    // rapid burst of onChange events (e.g. dragging a slider) round-trips to
    // disk on every single one. If/when debouncing is added here, this test's
    // "called once per save() call" assertion is exactly what should change.
    const saveSettings = vi.fn(() => Promise.resolve())
    window.electronAPI.saveSettings = saveSettings

    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    await act(async () => {
      await result.current.save({ ...baseSettings, bitrate: 128 })
    })

    expect(result.current.settings?.bitrate).toBe(128)
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ bitrate: 128 }))
  })

  it('save() from one mounted instance updates every other mounted instance', async () => {
    // Regression: SettingsPanel and OnboardingWizard each call useSettings() independently.
    // Saving from one (e.g. picking a different device in a re-opened onboarding wizard)
    // used to leave the other holding a stale snapshot until the whole renderer reloaded.
    window.electronAPI.saveSettings = vi.fn(() => Promise.resolve())

    const a = renderHook(() => useSettings())
    const b = renderHook(() => useSettings())
    await waitFor(() => expect(a.result.current.settings).not.toBeNull())
    await waitFor(() => expect(b.result.current.settings).not.toBeNull())

    await act(async () => {
      await a.result.current.save({ ...baseSettings, deviceId: 'app-loopback' })
    })

    expect(a.result.current.settings?.deviceId).toBe('app-loopback')
    expect(b.result.current.settings?.deviceId).toBe('app-loopback')
  })

  it('stops notifying an instance after it unmounts', async () => {
    window.electronAPI.saveSettings = vi.fn(() => Promise.resolve())

    const a = renderHook(() => useSettings())
    const b = renderHook(() => useSettings())
    await waitFor(() => expect(a.result.current.settings).not.toBeNull())
    await waitFor(() => expect(b.result.current.settings).not.toBeNull())

    b.unmount()

    await act(async () => {
      await a.result.current.save({ ...baseSettings, deviceId: 'app-loopback' })
    })

    // b is unmounted, so its last snapshot is untouched — just verifying the save
    // above didn't throw from notifying a stale/removed listener.
    expect(a.result.current.settings?.deviceId).toBe('app-loopback')
  })
})

describe('useRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks elapsed time once per second while a track is being captured, and resets once the main process confirms the stop', async () => {
    // isRecording only flips off via the recorder:stopped event, mirroring how the
    // main process actually confirms a stop (immediately here) rather than optimistically
    // on the stopRecording() call itself — see the two-click pending-stop tests below.
    let stoppedCb: () => void = () => {}
    let startedCb: (track: GsmtcTrack) => void = () => {}
    window.electronAPI.onRecordingStopped = (cb) => { stoppedCb = cb; return () => {} }
    window.electronAPI.onRecordingStarted = (cb) => { startedCb = cb; return () => {} }
    window.electronAPI.stopRecording = () => {
      stoppedCb()
      return Promise.resolve('stopped')
    }

    const { result } = renderHook(() => useRecording(vi.fn()))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.isRecording).toBe(true)
    expect(result.current.elapsed).toBe(0)

    // The elapsed timer only ticks once a track is actually being captured
    // (see the "waiting for music" test below for the armed-but-idle case).
    act(() => {
      startedCb({ artist: 'Artist', title: 'Song', album: '', albumArtFile: '', isPlaying: true })
    })

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current.elapsed).toBe(3)

    await act(async () => {
      await result.current.stop()
    })
    expect(result.current.isRecording).toBe(false)
    expect(result.current.elapsed).toBe(0)
  })

  it('defers stopping until the current track ends (pending), and force-stops on a second click', async () => {
    let stoppedCb: () => void = () => {}
    window.electronAPI.onRecordingStopped = (cb) => { stoppedCb = cb; return () => {} }
    const stopRecording = vi.fn()
      .mockResolvedValueOnce('pending' as const)
      .mockImplementationOnce(() => {
        stoppedCb()
        return Promise.resolve('stopped' as const)
      })
    window.electronAPI.stopRecording = stopRecording

    const { result } = renderHook(() => useRecording(vi.fn()))
    await act(async () => {
      await result.current.start()
    })

    // First click: deferred — recording keeps running, UI shows pending.
    await act(async () => {
      await result.current.stop()
    })
    expect(result.current.stopPending).toBe(true)
    expect(result.current.isRecording).toBe(true)

    // Second click: forces the stop.
    await act(async () => {
      await result.current.stop()
    })
    expect(stopRecording).toHaveBeenCalledTimes(2)
    expect(result.current.isRecording).toBe(false)
    expect(result.current.stopPending).toBe(false)
  })

  it('clears the stale track and stops ticking elapsed when a recording is dropped mid-session (e.g. long pause), without ending the session', async () => {
    let startedCb: (track: GsmtcTrack) => void = () => {}
    let idleCb: () => void = () => {}
    window.electronAPI.onRecordingStarted = (cb) => { startedCb = cb; return () => {} }
    window.electronAPI.onRecordingIdle = (cb) => { idleCb = cb; return () => {} }

    const { result } = renderHook(() => useRecording(vi.fn()))
    await act(async () => {
      await result.current.start()
    })

    act(() => {
      startedCb({ artist: 'Artist', title: 'Song', album: '', albumArtFile: '', isPlaying: true })
    })
    expect(result.current.currentTrack).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(result.current.elapsed).toBe(5)

    // The recording gets dropped (e.g. paused too long) — session stays armed,
    // but the stale track/timer should clear instead of freezing in place.
    act(() => {
      idleCb()
    })
    expect(result.current.isRecording).toBe(true)
    expect(result.current.currentTrack).toBeNull()
    expect(result.current.elapsed).toBe(0)

    // Timer no longer ticks — nothing is being captured.
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(result.current.elapsed).toBe(0)
  })

  it('surfaces a silence warning and clears it when audio resumes', async () => {
    let silenceCb = () => {}
    let audioCb = () => {}
    window.electronAPI.onSilenceWarning = (cb) => { silenceCb = cb; return () => {} }
    window.electronAPI.onAudioDetected = (cb) => { audioCb = cb; return () => {} }

    const { result } = renderHook(() => useRecording(vi.fn()))
    act(() => silenceCb())
    expect(result.current.silenceWarning).toBe(true)

    act(() => audioCb())
    expect(result.current.silenceWarning).toBe(false)
  })
})

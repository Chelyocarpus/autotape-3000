import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecording, useSettings } from './useIpc'
import type { UserSettings } from '../types'

const baseSettings: UserSettings = {
  outputDir: 'C:\\Music',
  format: 'mp3',
  bitrate: 320,
  deviceId: 'default',
  duplicateAction: 'increment',
  sessionFilter: 'auto',
  minSaveSeconds: 0,
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
})

describe('useRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks elapsed time once per second while recording, and resets on stop', async () => {
    const { result } = renderHook(() => useRecording(vi.fn()))

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.isRecording).toBe(true)
    expect(result.current.elapsed).toBe(0)

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

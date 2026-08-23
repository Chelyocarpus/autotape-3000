import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SongTrimModal } from './SongTrimModal'
import type { RecordingEntry } from '../types'

// jsdom implements neither the Web Audio API nor <canvas> 2D contexts. This
// component's only non-UI work is "read the file over IPC, decode it, draw a
// waveform" — stub just enough of that pipeline for it to resolve without
// asserting on pixel output (the canvas.getContext('2d') call intentionally
// returns null in jsdom, and drawWaveform() already no-ops on that).
class FakeAudioBufferSourceNode {
  buffer: unknown = null
  private listeners: Record<string, () => void> = {}
  connect(): void {}
  start(): void {}
  stop(): void {}
  addEventListener(event: string, cb: () => void): void {
    this.listeners[event] = cb
  }
}

class FakeAudioContext {
  currentTime = 0
  destination = {}
  decodeAudioData(): Promise<{ duration: number; getChannelData: (ch: number) => Float32Array }> {
    return Promise.resolve({
      duration: 120,
      getChannelData: () => new Float32Array(1000)
    })
  }
  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

const entry: RecordingEntry = {
  id: '1',
  artist: 'Daft Punk',
  title: 'One More Time',
  filePath: 'C:\\Music\\Autotape 3000\\Daft Punk - One More Time.mp3',
  durationSec: 120,
  status: 'ok',
  startedAt: Date.now()
}

describe('SongTrimModal', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    window.electronAPI.readAudioFile = vi.fn(() => Promise.resolve(new Uint8Array(8)))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the audio and renders trim controls without crashing', async () => {
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByText(/decoding audio/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save trimmed file/i })).toBeEnabled()
    })
    expect(screen.getByText('Daft Punk')).toBeInTheDocument()
    expect(screen.getByText('One More Time')).toBeInTheDocument()
  })

  it('shows a load error instead of crashing when the file has no path', async () => {
    render(<SongTrimModal entry={{ ...entry, filePath: '' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(await screen.findByText(/no file path available/i)).toBeInTheDocument()
  })

  it('shows a load error instead of crashing when decoding fails', async () => {
    window.electronAPI.readAudioFile = vi.fn(() => Promise.reject(new Error('ENOENT: file not found')))
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(await screen.findByText(/file not found/i)).toBeInTheDocument()
  })

  it('moves initial focus into the dialog instead of leaving it on <body>', () => {
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
    // The Close button is the first focusable element in the dialog
    // regardless of load state, since the header renders before content
    // that's gated on isLoading/loadError.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^close$/i }))
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(<SongTrimModal entry={entry} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab focus between the Close button and the Save button once loaded', async () => {
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
    const closeButton = screen.getByRole('button', { name: /^close$/i })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save trimmed file/i })).toBeEnabled()
    })
    const saveButton = screen.getByRole('button', { name: /save trimmed file/i })

    // Save is the last focusable element once loaded (it's disabled, and so
    // excluded from the trap, while loading/erroring).
    saveButton.focus()
    fireEvent.keyDown(saveButton, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(saveButton)
  })

  it('does not recompute waveform peaks on every playhead tick, but does on zoom', async () => {
    // Counts reads of individual sample indices — the expensive part of peak
    // computation — so we can tell whether playback (which only moves the
    // playhead) triggers it, versus zooming (which changes the view window
    // and legitimately needs a recompute).
    const rawChannelData = new Float32Array(2000)
    let indexReads = 0
    const channelData = new Proxy(rawChannelData, {
      // No `receiver` argument: TypedArray's built-in accessors (e.g. the
      // `length` getter) reject being invoked with a `this` that isn't a
      // real TypedArray, which the Proxy itself isn't.
      get(target, prop) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) indexReads++
        return Reflect.get(target, prop)
      }
    })

    let ctxInstance: { currentTime: number } | undefined
    class TickingAudioContext {
      currentTime = 0
      destination = {}
      decodeAudioData(): Promise<{ duration: number; getChannelData: () => Float32Array }> {
        return Promise.resolve({ duration: 120, getChannelData: () => channelData })
      }
      createBufferSource(): FakeAudioBufferSourceNode {
        return new FakeAudioBufferSourceNode()
      }
      close(): Promise<void> {
        return Promise.resolve()
      }
      constructor() {
        ctxInstance = this
      }
    }
    vi.stubGlobal('AudioContext', TickingAudioContext)

    const rafQueue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    })
    const runFrame = (): void => {
      const cb = rafQueue.shift()
      cb?.(performance.now())
    }

    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /preview trim/i })).toBeEnabled()
    })

    const readsAfterLoad = indexReads
    expect(readsAfterLoad).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /preview trim/i }))
    for (let i = 0; i < 5; i++) {
      if (ctxInstance) ctxInstance.currentTime += 0.05
      act(() => runFrame())
    }
    expect(indexReads).toBe(readsAfterLoad)

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(indexReads).toBeGreaterThan(readsAfterLoad)
  })

  it('composites the moving playhead with a single blit instead of redrawing the static waveform layer', async () => {
    // Swaps jsdom's null-returning getContext (see test/setup.ts) for a
    // stand-in that records calls, so this can distinguish drawStaticLayer's
    // per-pixel fillRect loop from compositeFrame's one-call-per-tick blit.
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const fillRectSpy = vi.fn()
    const drawImageSpy = vi.fn()
    const fakeCtx = {
      fillRect: fillRectSpy,
      clearRect: vi.fn(),
      drawImage: drawImageSpy,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0
    }
    HTMLCanvasElement.prototype.getContext =
      (() => fakeCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext

    try {
      let ctxInstance: { currentTime: number } | undefined
      class TickingAudioContext {
        currentTime = 0
        destination = {}
        decodeAudioData(): Promise<{ duration: number; getChannelData: () => Float32Array }> {
          return Promise.resolve({ duration: 120, getChannelData: () => new Float32Array(2000) })
        }
        createBufferSource(): FakeAudioBufferSourceNode {
          return new FakeAudioBufferSourceNode()
        }
        close(): Promise<void> {
          return Promise.resolve()
        }
        constructor() {
          ctxInstance = this
        }
      }
      vi.stubGlobal('AudioContext', TickingAudioContext)

      const rafQueue: FrameRequestCallback[] = []
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafQueue.push(cb)
        return rafQueue.length
      })
      const runFrame = (): void => {
        const cb = rafQueue.shift()
        cb?.(performance.now())
      }

      render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /preview trim/i })).toBeEnabled()
      })

      const fillRectAfterLoad = fillRectSpy.mock.calls.length
      expect(fillRectAfterLoad).toBeGreaterThan(0) // the static layer drew its peak bars

      fireEvent.click(screen.getByRole('button', { name: /preview trim/i }))
      const drawImageBeforeTicks = drawImageSpy.mock.calls.length
      for (let i = 0; i < 5; i++) {
        if (ctxInstance) ctxInstance.currentTime += 0.05
        act(() => runFrame())
      }

      // Five playback ticks: the blit fires each time, but not one further
      // fillRect — the expensive peak-bar redraw never reruns for a moving
      // playhead.
      expect(fillRectSpy.mock.calls.length).toBe(fillRectAfterLoad)
      expect(drawImageSpy.mock.calls.length).toBeGreaterThan(drawImageBeforeTicks)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('shows a persistent warning banner when the MP3 lossless source is unavailable', async () => {
    window.electronAPI.trimHasLosslessSource = vi.fn(() => Promise.resolve(false))
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(await screen.findByText(/original recording no longer available/i)).toBeInTheDocument()
  })

  it('does not check or show the warning banner for a WAV entry (already lossless)', async () => {
    const checkMock = vi.fn(() => Promise.resolve(false))
    window.electronAPI.trimHasLosslessSource = checkMock
    const wavEntry = { ...entry, filePath: entry.filePath.replace(/\.mp3$/, '.wav') }
    render(<SongTrimModal entry={wavEntry} onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /save trimmed file/i })).toBeEnabled())
    expect(checkMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/original recording no longer available/i)).not.toBeInTheDocument()
  })

  it('shows a visible error and re-enables Save when saving fails, instead of failing silently', async () => {
    window.electronAPI.trimApply = vi.fn(() => Promise.reject(new Error('disk full')))
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)

    const saveButton = await screen.findByRole('button', { name: /save trimmed file/i })
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    expect(await screen.findByText('disk full')).toBeInTheDocument()
    await waitFor(() => expect(saveButton).toBeEnabled())
  })
})

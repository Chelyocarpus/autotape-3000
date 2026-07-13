import { render, screen, waitFor } from '@testing-library/react'
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
    vi.spyOn(window.electronAPI, 'readAudioFile').mockResolvedValue(new Uint8Array(8))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

  it('shows a load error instead of crashing when the file cannot be read', async () => {
    vi.spyOn(window.electronAPI, 'readAudioFile').mockRejectedValue(new Error('ENOENT: no such file or directory'))
    render(<SongTrimModal entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(await screen.findByText(/enoent/i)).toBeInTheDocument()
  })
})

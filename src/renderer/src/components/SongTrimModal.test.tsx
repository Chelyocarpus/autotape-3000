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
})

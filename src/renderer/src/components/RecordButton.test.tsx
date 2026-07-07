import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecordButton } from './RecordButton'
import type { GsmtcTrack } from '../types'

const track: GsmtcTrack = {
  artist: 'Daft Punk', title: 'One More Time', album: '', albumArtFile: '', isPlaying: true
}

describe('RecordButton', () => {
  it('renders the idle state with a track count', () => {
    render(
      <RecordButton
        isRecording={false}
        currentTrack={null}
        elapsed={0}
        trackCount={12}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByText(/12 tracks saved/i)).toBeInTheDocument()
  })

  it('renders the active-recording state with formatted elapsed time and the current track', () => {
    render(
      <RecordButton
        isRecording
        currentTrack={track}
        elapsed={125}
        trackCount={3}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
    expect(screen.getByText('02:05')).toBeInTheDocument() // formatElapsed(125)
    expect(screen.getByText('Daft Punk — One More Time')).toBeInTheDocument()
  })

  it('formats elapsed time past an hour as h:mm:ss', () => {
    render(
      <RecordButton
        isRecording
        currentTrack={null}
        elapsed={3725} // 1:02:05
        trackCount={0}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
  })
})

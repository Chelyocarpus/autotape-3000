import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RecordButton } from './RecordButton'
import { TooltipProvider } from './ui/tooltip'
import type { GsmtcTrack } from '../types'

// The pending-stop badge uses Radix Tooltip, which throws if rendered outside
// a TooltipProvider. The real app provides one at the App root (see App.tsx);
// component-level tests need to supply their own.
function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

const track: GsmtcTrack = {
  artist: 'Daft Punk', title: 'One More Time', album: '', albumArtFile: '', isPlaying: true
}

describe('RecordButton', () => {
  it('renders the idle state with a track count', () => {
    renderWithTooltip(
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
    renderWithTooltip(
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
    renderWithTooltip(
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

  it('shows a waiting state when the session is armed but nothing is currently being captured', () => {
    renderWithTooltip(
      <RecordButton
        isRecording
        currentTrack={null}
        elapsed={0}
        trackCount={3}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByText(/waiting for music/i)).toBeInTheDocument()
  })

  it('shows the pending-stop state and still stops on click', () => {
    const onStop = vi.fn()
    renderWithTooltip(
      <RecordButton
        isRecording
        stopPending
        currentTrack={track}
        elapsed={30}
        trackCount={3}
        onStart={vi.fn()}
        onStop={onStop}
      />
    )
    expect(screen.getByText(/stopping soon/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /stop recording now/i })
    button.click()
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecordButton } from './RecordButton'

describe('RecordButton', () => {
  it('renders the idle state with a track count', () => {
    render(
      <RecordButton
        isRecording={false}
        elapsed={0}
        trackCount={12}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
    expect(screen.getByText(/12 tracks saved/i)).toBeInTheDocument()
  })

  it('renders the active-recording state with formatted elapsed time', () => {
    render(
      <RecordButton
        isRecording
        elapsed={125}
        trackCount={3}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument()
    expect(screen.getByText('02:05')).toBeInTheDocument() // formatElapsed(125)
  })

  it('formats elapsed time past an hour as h:mm:ss', () => {
    render(
      <RecordButton
        isRecording
        elapsed={3725} // 1:02:05
        trackCount={0}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.getByText('1:02:05')).toBeInTheDocument()
  })

  it('gives the vinyl spin and record-ring a motion-reduce alternative in both states', () => {
    const { container: idle } = render(
      <RecordButton isRecording={false} elapsed={0} trackCount={0} onStart={vi.fn()} onStop={vi.fn()} />
    )
    // The spin communicates state, but Play/Stop icon + label color already
    // do too — so it's safe to freeze under reduced motion.
    expect(idle.querySelector('svg')?.className.baseVal).toMatch(/motion-reduce:animate-none/)
    expect(idle.querySelector('svg')?.className.baseVal).toMatch(/motion-safe:animate-\[vinyl-spin/)

    const { container: recording } = render(
      <RecordButton isRecording elapsed={0} trackCount={0} onStart={vi.fn()} onStop={vi.fn()} />
    )
    expect(recording.querySelector('svg')?.className.baseVal).toMatch(/motion-reduce:animate-none/)
    const button = screen.getAllByRole('button', { name: /stop recording/i })[0]
    expect(button.className).toMatch(/motion-safe:animate-\[record-ring/)
    expect(button.className).toMatch(/motion-reduce:shadow-\[/)
  })
})

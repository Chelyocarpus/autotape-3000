import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RecordingLog } from './RecordingLog'
import { TooltipProvider } from './ui/tooltip'
import type { RecordingEntry } from '../types'

// RecordingLog's row actions use Radix Tooltip, which throws if rendered
// outside a TooltipProvider. The real app provides one at the App root
// (see App.tsx); component-level tests need to supply their own.
function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function entry(overrides: Partial<RecordingEntry>): RecordingEntry {
  return {
    id: 'x',
    artist: 'Artist',
    title: 'Title',
    filePath: '',
    durationSec: 0,
    status: 'ok',
    startedAt: Date.now(),
    ...overrides
  }
}

describe('RecordingLog', () => {
  it('shows an empty state when there are no entries', () => {
    renderWithTooltip(<RecordingLog entries={[]} onTrimEntry={vi.fn()} />)
    expect(screen.getByText(/no tracks yet/i)).toBeInTheDocument()
  })

  it('renders one row per status without crashing', () => {
    const entries: RecordingEntry[] = [
      entry({ id: '1', title: 'Saved Song', status: 'ok', durationSec: 185, filePath: 'C:\\a.mp3' }),
      entry({ id: '2', title: 'Skipped Song', status: 'skipped' }),
      entry({ id: '3', title: 'Broken Song', status: 'error', error: 'ffmpeg exited with code 1' })
    ]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    expect(screen.getByText('Saved Song')).toBeInTheDocument()
    expect(screen.getByText('3:05')).toBeInTheDocument() // formatDuration(185)

    expect(screen.getByText('Skipped Song')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()

    expect(screen.getByText('Broken Song')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('only shows trim/open-folder actions for entries with a filePath', () => {
    const entries: RecordingEntry[] = [
      entry({ id: '1', title: 'Has file', filePath: 'C:\\a.mp3' }),
      entry({ id: '2', title: 'No file (discarded)', filePath: '', status: 'skipped' })
    ]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    expect(screen.getAllByLabelText('Trim recording')).toHaveLength(1)
    expect(screen.getAllByLabelText('Open file location')).toHaveLength(1)
  })

  it('renders newest entries first', () => {
    const entries: RecordingEntry[] = [
      entry({ id: '1', title: 'First recorded' }),
      entry({ id: '2', title: 'Second recorded' })
    ]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)
    const titles = screen.getAllByText(/recorded$/).map((el) => el.textContent)
    expect(titles).toEqual(['Second recorded', 'First recorded'])
  })

  it('filters rows by title or artist as the user types', () => {
    const entries: RecordingEntry[] = [
      entry({ id: '1', title: 'Midnight City', artist: 'M83' }),
      entry({ id: '2', title: 'Instant Crush', artist: 'Daft Punk' })
    ]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(/search recordings/i), {
      target: { value: 'daft' }
    })

    expect(screen.getByText('Instant Crush')).toBeInTheDocument()
    expect(screen.queryByText('Midnight City')).not.toBeInTheDocument()
  })

  it('shows a no-matches state with a way to clear the search', () => {
    const entries: RecordingEntry[] = [entry({ id: '1', title: 'Midnight City', artist: 'M83' })]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(/search recordings/i), {
      target: { value: 'nonexistent track' }
    })

    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Clear search'))
    expect(screen.getByText('Midnight City')).toBeInTheDocument()
  })

  it('shows the no-matches state even while a track is finalizing', () => {
    const entries: RecordingEntry[] = [entry({ id: '1', title: 'Midnight City', artist: 'M83' })]
    renderWithTooltip(
      <RecordingLog
        entries={entries}
        onTrimEntry={vi.fn()}
        finalizingTrack={{ artist: 'Other', title: 'Currently Recording', album: '', albumArtFile: '', isPlaying: true }}
      />
    )

    fireEvent.change(screen.getByPlaceholderText(/search recordings/i), {
      target: { value: 'nonexistent track' }
    })

    expect(screen.getByText('Currently Recording')).toBeInTheDocument()
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it('does not show the no-matches state for the first recording finalizing with no completed entries and no search', () => {
    renderWithTooltip(
      <RecordingLog
        entries={[]}
        onTrimEntry={vi.fn()}
        finalizingTrack={{ artist: 'Someone', title: 'First Track', album: '', albumArtFile: '', isPlaying: true }}
      />
    )

    expect(screen.getByText('First Track')).toBeInTheDocument()
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing found/i)).not.toBeInTheDocument()
  })

  it('does not render a status icon for successful recordings', () => {
    const entries: RecordingEntry[] = [entry({ id: '1', title: 'Clean Take', status: 'ok', durationSec: 90 })]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    expect(screen.getByText('Clean Take')).toBeInTheDocument()
    expect(screen.queryByText('ok')).not.toBeInTheDocument()
  })

  it('formats a duration over an hour with an hour component', () => {
    const entries: RecordingEntry[] = [entry({ id: '1', title: 'Long Mix', status: 'ok', durationSec: 7530 })]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    expect(screen.getByText('2:05:30')).toBeInTheDocument()
  })

  it('animates only the newly-arrived row, never rows that were already there', () => {
    const initial: RecordingEntry[] = [entry({ id: '1', title: 'Old Song' })]
    const { rerender } = renderWithTooltip(<RecordingLog entries={initial} onTrimEntry={vi.fn()} />)

    rerender(
      <TooltipProvider>
        <RecordingLog entries={[...initial, entry({ id: '2', title: 'New Song' })]} onTrimEntry={vi.fn()} />
      </TooltipProvider>
    )

    const newRow = screen.getByText('New Song').closest('div[class*="rounded-lg"]')
    const oldRow = screen.getByText('Old Song').closest('div[class*="rounded-lg"]')
    expect(newRow?.className).toMatch(/entry-in/)
    expect(oldRow?.className).not.toMatch(/entry-in/)
  })

  it('fades in a row that only just started matching a broadened search, not one that was already visible', () => {
    const entries: RecordingEntry[] = [
      entry({ id: '1', title: 'Midnight City', artist: 'M83' }),
      entry({ id: '2', title: 'Instant Crush', artist: 'Daft Punk' })
    ]
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    const search = screen.getByPlaceholderText(/search recordings/i)
    fireEvent.change(search, { target: { value: 'daft' } })
    expect(screen.queryByText('Midnight City')).not.toBeInTheDocument()

    // Broadening back to everything reveals "Midnight City" for the first
    // time since it was excluded — "Instant Crush" was visible throughout.
    fireEvent.change(search, { target: { value: '' } })

    const revealedRow = screen.getByText('Midnight City').closest('div[class*="rounded-lg"]')
    const alreadyVisibleRow = screen.getByText('Instant Crush').closest('div[class*="rounded-lg"]')
    expect(revealedRow?.className).toMatch(/filter-match-in/)
    expect(alreadyVisibleRow?.className).not.toMatch(/filter-match-in/)
  })

  it('clears the filter-match state on a real scroll during the reposition window, so a row does not replay the fade later', () => {
    const entries: RecordingEntry[] = [
      entry({ id: '1', title: 'Midnight City', artist: 'M83' }),
      entry({ id: '2', title: 'Instant Crush', artist: 'Daft Punk' })
    ]
    const { container } = renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    const search = screen.getByPlaceholderText(/search recordings/i)
    fireEvent.change(search, { target: { value: 'daft' } })
    fireEvent.change(search, { target: { value: '' } })

    // "Midnight City" is mid-fade-in at this point (see the test above) —
    // a real scroll gesture should cancel that state immediately rather
    // than just cancelling the visual transition, or the row would still
    // carry filterMatchDelayMs and could replay the fade if virtualization
    // later unmounts and remounts it.
    const viewport = container.querySelector('[data-radix-scroll-area-viewport]')
    expect(viewport).not.toBeNull()
    fireEvent.wheel(viewport as Element)

    const revealedRow = screen.getByText('Midnight City').closest('div[class*="rounded-lg"]')
    expect(revealedRow?.className).not.toMatch(/filter-match-in/)
  })

  it('virtualizes a large list instead of mounting every row', () => {
    const entries: RecordingEntry[] = Array.from({ length: 500 }, (_, i) =>
      entry({ id: String(i), title: `Track ${i}` })
    )
    renderWithTooltip(<RecordingLog entries={entries} onTrimEntry={vi.fn()} />)

    // The newest entries render first (list order); a row from the far end
    // of the reversed list should not be mounted at all off-screen.
    expect(screen.getByText('Track 499')).toBeInTheDocument()
    expect(screen.queryByText('Track 0')).not.toBeInTheDocument()
  })
})

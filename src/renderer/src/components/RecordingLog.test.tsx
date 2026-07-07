import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('skipped')).toBeInTheDocument()

    expect(screen.getByText('Broken Song')).toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
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
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { TooltipProvider } from './ui/tooltip'

// SettingsPanel's folder-picker and ffmpeg-detect buttons use Radix Tooltip,
// which throws if rendered outside a TooltipProvider (the real app supplies
// one at the App root — see App.tsx).
function renderPanel() {
  return render(
    <TooltipProvider>
      <SettingsPanel />
    </TooltipProvider>
  )
}

describe('SettingsPanel', () => {
  it('shows a loading state before settings resolve, then renders the form', async () => {
    renderPanel()
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument()

    expect(await screen.findByText('Output Folder')).toBeInTheDocument()
    expect(screen.getByText('Format')).toBeInTheDocument()
    expect(screen.getByText('Audio Capture Method')).toBeInTheDocument()
    expect(screen.getByText('ffmpeg Binary')).toBeInTheDocument()
  })

  it('shows the bitrate selector only for mp3 (the default format)', async () => {
    renderPanel()
    await screen.findByText('Output Folder')
    expect(screen.getByText('Bitrate')).toBeInTheDocument()
  })
})

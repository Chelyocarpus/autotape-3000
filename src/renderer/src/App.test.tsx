import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, SilenceDialog } from './App'

describe('App', () => {
  it('renders without throwing on initial mount', () => {
    // Regression test for the 2.4.1 blank-screen crash: `showSilenceDialog` was
    // referenced by a useEffect declared above its own `const` declaration,
    // which threw a TemporalDeadZone ReferenceError on first render and
    // crashed the whole app before anything painted. A render smoke test
    // catches that class of bug immediately.
    render(<App />)
    expect(screen.getByText('Autotape 3000')).toBeInTheDocument()
  })

  it('shows the idle record button when no recording is active', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /start recording/i })).toBeInTheDocument()
  })
})

describe('SilenceDialog', () => {
  it('focuses the dismiss button on mount and traps Tab on it', async () => {
    render(<SilenceDialog onDismiss={vi.fn()} />)
    const dismiss = screen.getByRole('button', { name: /dismiss warning/i })

    await waitFor(() => expect(document.activeElement).toBe(dismiss))

    // Only one focusable element exists, so Tab must wrap back to it rather
    // than letting focus fall through to whatever's behind the dialog.
    fireEvent.keyDown(dismiss, { key: 'Tab' })
    expect(document.activeElement).toBe(dismiss)
  })

  it('calls onDismiss on Escape', () => {
    const onDismiss = vi.fn()
    render(<SilenceDialog onDismiss={onDismiss} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on backdrop click', () => {
    const onDismiss = vi.fn()
    const { container } = render(<SilenceDialog onDismiss={onDismiss} />)

    const backdrop = container.querySelector('[role="alertdialog"] > div')
    fireEvent.click(backdrop as Element)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the previously-focused element on unmount', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open'
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = render(<SilenceDialog onDismiss={vi.fn()} />)
    await waitFor(() => expect(document.activeElement).not.toBe(opener))

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

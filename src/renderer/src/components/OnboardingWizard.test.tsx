import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingWizard } from './OnboardingWizard'

describe('OnboardingWizard', () => {
  it('moves initial focus into the dialog instead of leaving it on <body>', async () => {
    render(<OnboardingWizard onComplete={vi.fn()} />)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /get started/i }))
    })
  })

  it('restores focus to the previously-focused element on unmount', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open wizard'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(<OnboardingWizard onComplete={vi.fn()} />)
    await waitFor(() => {
      expect(document.activeElement).not.toBe(opener)
    })

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('wraps Tab from the last focusable element back to the first, trapping focus inside the dialog', async () => {
    render(<OnboardingWizard onComplete={vi.fn()} onCancel={vi.fn()} />)
    // DOM order within the dialog is header (Close) then step body (Get
    // started), so Close is the first stop and Get started the last.
    const closeButton = screen.getByRole('button', { name: /close/i })
    const getStarted = screen.getByRole('button', { name: /get started/i })

    getStarted.focus()
    expect(document.activeElement).toBe(getStarted)

    fireEvent.keyDown(getStarted, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)
  })

  it('wraps Shift+Tab from the first focusable element back to the last', async () => {
    render(<OnboardingWizard onComplete={vi.fn()} onCancel={vi.fn()} />)
    const closeButton = screen.getByRole('button', { name: /close/i })
    const getStarted = screen.getByRole('button', { name: /get started/i })

    await waitFor(() => expect(document.activeElement).toBe(closeButton))

    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getStarted)
  })
})

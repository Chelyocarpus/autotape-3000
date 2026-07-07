import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

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

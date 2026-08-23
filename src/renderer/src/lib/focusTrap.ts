import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * Robustness / pitfalls guarded against:
 * - Container not yet mounted, or its content has zero focusable children
 *   (e.g. a step still loading data) — falls back to the container itself
 *   (which must carry tabIndex={-1}) so focus never lands on `<body>`/behind
 *   the overlay, which is what would let a keyboard user reach whatever a
 *   modal dialog exists to block interaction with.
 */
function focusFirst(container: HTMLElement | null): void {
  if (!container) return
  const target = getFocusable(container)[0] ?? container
  target.focus()
}

/**
 * Robustness / pitfalls guarded against:
 * - Focus reaching an element outside the dialog (native title bar buttons,
 *   or anything behind the overlay) via Tab/Shift+Tab — the exact bypass
 *   this trap exists to close.
 * - The focusable set changing between renders (e.g. a wizard step swap) —
 *   recomputed on every Tab press rather than cached.
 * - Radix's own portaled overlays (Select dropdowns, etc.), which run their
 *   own internal focus trap while open and live outside this container in
 *   the DOM — left alone by only acting when the keydown originated inside
 *   this container, so this trap never fights Radix's.
 * - Zero focusable elements in the dialog — falls back to keeping focus on
 *   the container rather than throwing.
 */
function trapTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (!container || !(event.target instanceof Node) || !container.contains(event.target)) return
  const focusable = getFocusable(container)
  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last || !container.contains(active)) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Traps Tab/Shift+Tab focus inside a modal dialog container, moves initial
 * focus into it, restores focus to whatever had it beforehand on unmount,
 * and wires Escape to `onEscape`. The container ref's element must carry
 * `role="dialog"`/`"alertdialog"`, `aria-modal="true"`, and `tabIndex={-1}`
 * (the last so `focusFirst`'s container fallback is actually focusable).
 *
 * Pass `refocusKey` for dialogs whose content is swapped in place (e.g. a
 * multi-step wizard) — changing it re-runs the initial-focus step, since the
 * previous focus target no longer exists once the content swaps.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: { onEscape?: () => void; refocusKey?: unknown } = {}
): void {
  const { onEscape, refocusKey } = options
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Remember whatever had focus before the dialog opened so it can be
  // restored on close, rather than leaving focus stranded on <body>.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    return () => {
      const el = previouslyFocused.current
      if (el && document.contains(el)) el.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    focusFirst(containerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refocusKey])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (onEscape) onEscape()
        return
      }
      if (e.key === 'Tab') trapTab(e, containerRef.current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEscape])
}

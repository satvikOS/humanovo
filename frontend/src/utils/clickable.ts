/**
 * Keyboard-accessibility helpers for clickable non-button elements.
 *
 * The codebase has ~10+ `<div onClick={...}>` interactive elements
 * (selection lists, list rows, modal triggers) that look clickable
 * to mouse users but are completely invisible to keyboard users —
 * Tab can't reach them, Enter/Space don't fire them. Calling these
 * helpers gets you the right four ARIA attributes in one spread:
 *
 *     <div {...keyboardClickProps(() => selectItem(x))}>
 *
 * Two variants:
 *
 *  - `keyboardClickProps(handler)` — the standard pattern. Adds
 *    role="button", tabIndex=0, onClick, and an onKeyDown that fires
 *    on Enter or Space.
 *
 *  - `modalBackdropProps(onClose)` — for full-screen modal backdrops.
 *    Keeps the click-outside-to-close behavior + adds an Escape-to-close
 *    keyboard listener. Pair with a `role="dialog" aria-modal="true"`
 *    on the backdrop for screen readers.
 *
 * If a div has more semantics than "trigger this action" (e.g. a list
 * item with a checkbox + delete button + content area), prefer breaking
 * it into a real <button> instead — that's always cleaner.
 */

import { useEffect } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

export function keyboardClickProps<E extends Element = HTMLDivElement>(
  onActivate: () => void,
): {
  role: 'button'
  tabIndex: 0
  onClick: (event: MouseEvent<E>) => void
  onKeyDown: (event: KeyboardEvent<E>) => void
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: () => onActivate(),
    onKeyDown: (event: KeyboardEvent<E>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate()
      }
    },
  }
}

export function modalBackdropProps<E extends Element = HTMLDivElement>(
  onClose: () => void,
): {
  role: 'presentation'
  onClick: (event: MouseEvent<E>) => void
  onKeyDown: (event: KeyboardEvent<E>) => void
  tabIndex: -1
} {
  return {
    role: 'presentation',
    onClick: (event) => {
      // Only close when the backdrop itself was the click target —
      // clicks on the dialog's children should not bubble through here
      // because consumers stopPropagation, but be defensive.
      if (event.target === event.currentTarget) onClose()
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    tabIndex: -1,
  }
}

/**
 * Register a window-level Escape-key handler for the lifetime the
 * `enabled` prop is true. Use this for modals where the backdrop is a
 * sibling of the dialog content (rather than wrapping it) — in that
 * shape, focus typically lives in a form field and `modalBackdropProps`
 * onKeyDown never fires because keystrokes don't bubble to the
 * backdrop.
 *
 *   useEscapeKey(closeModal, isModalOpen)
 *
 * The listener is added on mount / `enabled === true` and removed on
 * unmount / `enabled === false`, so it never leaks between modals.
 */
export function useEscapeKey(handler: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handler, enabled])
}

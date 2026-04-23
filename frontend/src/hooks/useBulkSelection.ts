/**
 * useBulkSelection — shared select-mode hook for list surfaces.
 *
 * Keeps the select-mode toggle, the selected-id set, and the
 * toggle/clear/select-all helpers in one place so every list
 * (Projects / Clinical Trials / Manuscripts / Biobank / Regulatory)
 * behaves identically.
 */
import { useCallback, useMemo, useState } from 'react'

export interface BulkSelection<T> {
  selectMode: boolean
  setSelectMode: (v: boolean) => void
  selectedIds: Set<string>
  toggle: (id: string) => void
  allSelected: boolean
  toggleAll: (visible: T[]) => void
  clear: () => void
  exit: () => void
  selectedCount: number
}

export function useBulkSelection<T extends { id: string }>(): BulkSelection<T> {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  const toggleAll = useCallback((visible: T[]) => {
    setSelectedIds(prev => {
      const allSel = visible.length > 0 && visible.every(v => prev.has(v.id))
      if (allSel) return new Set()
      return new Set(visible.map(v => v.id))
    })
  }, [])

  const exit = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const allSelectedFor = useMemo(() => (visible: T[]) =>
    selectMode && visible.length > 0 && visible.every(v => selectedIds.has(v.id)),
    [selectMode, selectedIds],
  )

  return {
    selectMode,
    setSelectMode,
    selectedIds,
    toggle,
    allSelected: false, // computed per-call via allSelectedFor in components
    toggleAll,
    clear,
    exit,
    selectedCount: selectedIds.size,
    // Internal helper exposed via type-cast in components
    // @ts-expect-error helper not in the public interface
    _allSelectedFor: allSelectedFor,
  }
}

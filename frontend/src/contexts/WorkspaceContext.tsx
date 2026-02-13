import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react'
import { persistGet, persistSet } from '../utils/persistence'

export interface WorkspaceTab {
  id: string
  type: 'project' | 'hypothesis' | 'simulation' | 'workbench' | 'evidence' | 'notebook' | 'agents'
  title: string
  projectId?: string
  data?: Record<string, unknown>
}

interface WorkspaceContextType {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  addTab: (tab: Omit<WorkspaceTab, 'id'>) => string
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<WorkspaceTab>) => void
  getTab: (id: string) => WorkspaceTab | undefined
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

let tabCounter = persistGet<number>('tab-counter', 0)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => persistGet<WorkspaceTab[]>('workspace-tabs', []))
  const [activeTabId, setActiveTabId] = useState<string | null>(() => persistGet<string | null>('workspace-active-tab', null))

  // Persist tabs and active tab whenever they change
  useEffect(() => {
    persistSet('workspace-tabs', tabs)
  }, [tabs])

  useEffect(() => {
    persistSet('workspace-active-tab', activeTabId)
  }, [activeTabId])

  const addTab = useCallback((tab: Omit<WorkspaceTab, 'id'>) => {
    tabCounter++
    persistSet('tab-counter', tabCounter)
    const id = `tab-${tabCounter}-${Date.now()}`
    const newTab: WorkspaceTab = { ...tab, id }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(id)
    return id
  }, [])

  const removeTab = useCallback((id: string) => {
    setTabs(prev => {
      const index = prev.findIndex(t => t.id === id)
      const newTabs = prev.filter(t => t.id !== id)

      // If closing active tab, switch to adjacent tab
      if (activeTabId === id && newTabs.length > 0) {
        const newIndex = Math.min(index, newTabs.length - 1)
        setActiveTabId(newTabs[newIndex].id)
      } else if (newTabs.length === 0) {
        setActiveTabId(null)
      }

      return newTabs
    })
  }, [activeTabId])

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const updateTab = useCallback((id: string, updates: Partial<WorkspaceTab>) => {
    setTabs(prev => prev.map(tab =>
      tab.id === id ? { ...tab, ...updates } : tab
    ))
  }, [])

  const getTab = useCallback((id: string) => {
    return tabs.find(t => t.id === id)
  }, [tabs])

  return (
    <WorkspaceContext.Provider value={{
      tabs,
      activeTabId,
      addTab,
      removeTab,
      setActiveTab,
      updateTab,
      getTab,
    }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}

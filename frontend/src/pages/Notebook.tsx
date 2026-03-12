import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  FiPlus, FiTrash2, FiSave, FiDownload, FiClock, FiTag,
  FiEdit3, FiEye, FiColumns, FiFileText,
  FiCode, FiHash, FiRotateCcw, FiX, FiSearch,
  FiCopy, FiBookOpen, FiGrid, FiList
} from 'react-icons/fi'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import api, { NotebookPage, NotebookVersion } from '../services/api'

type ViewMode = 'edit' | 'preview' | 'split'

const PAGE_TEMPLATES: { name: string; icon: React.ReactNode; content: string }[] = [
  {
    name: 'Blank',
    icon: <FiFileText className="w-4 h-4" />,
    content: '',
  },
  {
    name: 'Research Notes',
    icon: <FiBookOpen className="w-4 h-4" />,
    content: `# Research Notes

## Objective


## Background


## Key Findings

1.
2.
3.

## Methods


## Results


## Discussion


## References

-
`,
  },
  {
    name: 'Experiment Log',
    icon: <FiCode className="w-4 h-4" />,
    content: `# Experiment Log

**Date:** ${new Date().toISOString().split('T')[0]}
**Researcher:**

## Hypothesis


## Materials & Methods

| Parameter | Value |
|-----------|-------|
|           |       |

## Protocol

1.
2.
3.

## Observations


## Data

\`\`\`
# Raw data or code here
\`\`\`

## Analysis

$$
\\text{Result} = \\frac{\\text{observed}}{\\text{expected}}
$$

## Conclusions

`,
  },
  {
    name: 'Literature Review',
    icon: <FiBookOpen className="w-4 h-4" />,
    content: `# Literature Review

## Topic


## Search Strategy

- Databases: PubMed, Google Scholar
- Keywords:
- Date range:

## Summary of Findings

### Paper 1
- **Title:**
- **Authors:**
- **Year:**
- **Key findings:**
- **Relevance:**

### Paper 2
- **Title:**
- **Authors:**
- **Year:**
- **Key findings:**
- **Relevance:**

## Synthesis


## Knowledge Gaps


## References

`,
  },
  {
    name: 'Data Analysis',
    icon: <FiGrid className="w-4 h-4" />,
    content: `# Data Analysis

## Dataset Description

| Feature | Type | Description |
|---------|------|-------------|
|         |      |             |

## Statistical Summary

$$
\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i
$$

## Methodology


## Results

### Visualization Notes


### Key Metrics

| Metric | Value | 95% CI |
|--------|-------|--------|
|        |       |        |

## Interpretation


`,
  },
]

const SNIPPET_INSERT = {
  latex: '$$\n\\alpha + \\beta = \\gamma\n$$',
  table: '| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |',
  code: '```python\n# Code here\n```',
  heading: '## Heading',
  list: '- Item 1\n- Item 2\n- Item 3',
  link: '[Link text](url)',
}

export default function Notebook() {
  const [pages, setPages] = useState<NotebookPage[]>([])
  const [activePage, setActivePage] = useState<NotebookPage | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<NotebookVersion[]>([])
  const [tagInput, setTagInput] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarView, setSidebarView] = useState<'list' | 'grid'>('list')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  // Load pages
  useEffect(() => {
    loadPages()
  }, [])

  const loadPages = async () => {
    try {
      setLoading(true)
      const res = await api.getNotebookPages({ page_size: 100 }) || {}
      const items = Array.isArray(res.items) ? res.items : []
      if (items.length > 0) {
        setPages(items)
        if (!activePage) selectPage(items[0])
      } else {
        // No pages returned — create a default local page
        const defaultPage: NotebookPage = {
          id: 'local-default',
          title: 'Getting Started',
          content: '# Welcome to HumaNovo Notebook\n\nThis is your research notebook. Use **Markdown** to write notes, embed evidence, and track your research.\n\n## Features\n- Rich Markdown editing with live preview\n- LaTeX math: $E = mc^2$\n- Link evidence and hypotheses\n- Version history\n- Export to PDF/Markdown\n\nStart writing below...',
          content_type: 'markdown',
          tags: ['getting-started'],
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setPages([defaultPage])
        selectPage(defaultPage)
      }
    } catch (err) {
      console.error('Failed to load notebook pages:', err)
      // Fallback: create a local-only page so the UI isn't blank
      const fallbackPage: NotebookPage = {
        id: 'local-fallback',
        title: 'Research Notes',
        content: '# Research Notes\n\nStart writing your research notes here.\n\n> **Note:** The notebook backend is currently unavailable. Your notes will be available once the server is back online.\n',
        content_type: 'markdown',
        tags: [],
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setPages([fallbackPage])
      selectPage(fallbackPage)
    } finally {
      setLoading(false)
    }
  }

  const selectPage = useCallback((page: NotebookPage) => {
    setActivePage(page)
    setEditContent(page.content || '')
    setEditTitle(page.title || '')
    setEditTags(Array.isArray(page.tags) ? page.tags : [])
    setHasUnsavedChanges(false)
    setShowVersions(false)
  }, [])

  // Auto-save with debounce
  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setHasUnsavedChanges(true)
    saveTimerRef.current = window.setTimeout(() => {
      savePage()
    }, 2000)
  }, [activePage?.id])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const handleContentChange = (value: string) => {
    setEditContent(value)
    scheduleAutoSave()
  }

  const handleTitleChange = (value: string) => {
    setEditTitle(value)
    scheduleAutoSave()
  }

  const savePage = async () => {
    if (!activePage) return
    try {
      setSaving(true)
      // For local/fallback pages, save in-memory only
      if (activePage.id.startsWith('local-')) {
        const updated = { ...activePage, title: editTitle, content: editContent, tags: editTags, updated_at: new Date().toISOString() }
        setActivePage(updated)
        setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
        setHasUnsavedChanges(false)
        return
      }
      const updated = await api.updateNotebookPage(activePage.id, {
        title: editTitle,
        content: editContent,
        tags: editTags,
      })
      setActivePage(updated)
      setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
      setHasUnsavedChanges(false)
    } catch (err) {
      console.error('Failed to save page:', err)
      // Save locally on failure
      const updated = { ...activePage, title: editTitle, content: editContent, tags: editTags, updated_at: new Date().toISOString() }
      setActivePage(updated)
      setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
      setHasUnsavedChanges(false)
    } finally {
      setSaving(false)
    }
  }

  const createPage = async (template?: typeof PAGE_TEMPLATES[0]) => {
    const title = template ? template.name : 'Untitled'
    const content = template?.content || ''
    try {
      const page = await api.createNotebookPage({
        title,
        content,
        content_type: 'markdown',
        tags: [],
      })
      setPages(prev => [page, ...prev])
      selectPage(page)
    } catch (err) {
      console.error('Failed to create page via API, creating locally:', err)
      // Fallback: create a local page so the UI isn't blank
      const localPage: NotebookPage = {
        id: `local-${Date.now()}`,
        title,
        content,
        content_type: 'markdown',
        tags: [],
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setPages(prev => [localPage, ...prev])
      selectPage(localPage)
    }
    setShowTemplates(false)
  }

  const deletePage = async (id: string) => {
    try {
      await api.deleteNotebookPage(id)
      setPages(prev => prev.filter(p => p.id !== id))
      if (activePage?.id === id) {
        const remaining = pages.filter(p => p.id !== id)
        if (remaining.length > 0) {
          selectPage(remaining[0])
        } else {
          setActivePage(null)
          setEditContent('')
          setEditTitle('')
        }
      }
    } catch (err) {
      console.error('Failed to delete page:', err)
    }
  }

  const loadVersions = async () => {
    if (!activePage) return
    try {
      const vers = await api.getNotebookPageVersions(activePage.id)
      setVersions(vers)
      setShowVersions(true)
    } catch (err) {
      console.error('Failed to load versions:', err)
    }
  }

  const restoreVersion = async (version: number) => {
    if (!activePage) return
    try {
      const restored = await api.restoreNotebookVersion(activePage.id, version)
      selectPage(restored)
      setPages(prev => prev.map(p => p.id === restored.id ? restored : p))
      setShowVersions(false)
    } catch (err) {
      console.error('Failed to restore version:', err)
    }
  }

  const exportPage = async (format: 'markdown' | 'html') => {
    if (!activePage) return
    try {
      const blob = await api.exportNotebookPage(activePage.id, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${editTitle || 'notebook'}.${format === 'markdown' ? 'md' : 'html'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export:', err)
    }
  }

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !editTags.includes(tag)) {
      const newTags = [...editTags, tag]
      setEditTags(newTags)
      setTagInput('')
      scheduleAutoSave()
    }
  }

  const removeTag = (tag: string) => {
    setEditTags(prev => prev.filter(t => t !== tag))
    scheduleAutoSave()
  }

  const insertSnippet = (key: keyof typeof SNIPPET_INSERT) => {
    const textarea = editorRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = SNIPPET_INSERT[key]
    const currentContent = editContent || ''
    const newContent = currentContent.slice(0, start) + text + currentContent.slice(end)
    setEditContent(newContent)
    scheduleAutoSave()
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + text.length, start + text.length)
    }, 0)
  }

  const copyContent = () => {
    navigator.clipboard.writeText(editContent)
  }

  const filteredPages = useMemo(() => {
    if (!searchQuery) return pages
    const q = searchQuery.toLowerCase()
    return pages.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.content || '').toLowerCase().includes(q) ||
      (Array.isArray(p.tags) && p.tags.some(t => t.toLowerCase().includes(q)))
    )
  }, [pages, searchQuery])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading notebook...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Pages</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSidebarView(sidebarView === 'list' ? 'grid' : 'list')}
                className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]"
              >
                {sidebarView === 'list' ? <FiGrid className="w-3.5 h-3.5" /> : <FiList className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setShowTemplates(true)}
                className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]"
                title="New page"
              >
                <FiPlus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="relative">
            <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search pages..."
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded focus:outline-none focus:border-white/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredPages.map(page => (
            <button
              key={page.id}
              onClick={() => selectPage(page)}
              className={clsx(
                'w-full text-left p-2 rounded transition-colors group',
                activePage?.id === page.id
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-white/5'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate flex-1">{page.title}</span>
                <button
                  onClick={e => { e.stopPropagation(); deletePage(page.id) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-red-400"
                >
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xxs text-[var(--color-text-muted)]">
                  v{page.version}
                </span>
                <span className="text-xxs text-[var(--color-text-muted)]">
                  {new Date(page.updated_at).toLocaleDateString()}
                </span>
              </div>
              {Array.isArray(page.tags) && page.tags.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(page.tags ?? []).slice(0, 3).map(tag => (
                    <span key={tag} className="text-xxs px-1 py-0.5 rounded bg-white/5 text-[var(--color-text-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}

          {filteredPages.length === 0 && (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              <FiFileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">
                {searchQuery ? 'No pages found' : 'No pages yet'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setShowTemplates(true)}
                  className="text-xs text-accent-blue hover:underline mt-1"
                >
                  Create one
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      {activePage ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
            {/* Title */}
            <input
              type="text"
              value={editTitle}
              onChange={e => handleTitleChange(e.target.value)}
              className="text-base font-semibold bg-transparent border-none outline-none flex-1 min-w-0"
              placeholder="Page title..."
            />

            {/* View mode toggle */}
            <div className="flex items-center bg-[var(--color-surface)] rounded border border-[var(--color-border)]">
              {[
                { mode: 'edit' as ViewMode, icon: <FiEdit3 className="w-3 h-3" />, label: 'Edit' },
                { mode: 'split' as ViewMode, icon: <FiColumns className="w-3 h-3" />, label: 'Split' },
                { mode: 'preview' as ViewMode, icon: <FiEye className="w-3 h-3" />, label: 'Preview' },
              ].map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={clsx(
                    'px-2 py-1 text-xs flex items-center gap-1 transition-colors',
                    viewMode === mode
                      ? 'bg-white/10 text-white'
                      : 'text-[var(--color-text-muted)] hover:text-white'
                  )}
                  title={label}
                >
                  {icon}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => insertSnippet('latex')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Insert LaTeX"
              >
                <FiHash className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => insertSnippet('table')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Insert Table"
              >
                <FiGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => insertSnippet('code')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Insert Code Block"
              >
                <FiCode className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={copyContent}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Copy content"
              >
                <FiCopy className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

              <button
                onClick={loadVersions}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Version history"
              >
                <FiClock className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => exportPage('markdown')}
                className="p-1.5 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-white"
                title="Export Markdown"
              >
                <FiDownload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={savePage}
                disabled={saving}
                className={clsx(
                  'px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors',
                  hasUnsavedChanges
                    ? 'bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30'
                    : 'text-[var(--color-text-muted)] hover:bg-white/5'
                )}
              >
                <FiSave className="w-3 h-3" />
                {saving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
              </button>
            </div>
          </div>

          {/* Tags bar */}
          <div className="px-4 py-1.5 border-b border-[var(--color-border)] flex items-center gap-2 shrink-0">
            <FiTag className="w-3 h-3 text-[var(--color-text-muted)]" />
            <div className="flex items-center gap-1 flex-wrap flex-1">
              {editTags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xxs bg-white/5 rounded text-[var(--color-text-secondary)]"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400">
                    <FiX className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Add tag..."
                className="text-xxs bg-transparent border-none outline-none w-16"
              />
            </div>
          </div>

          {/* Editor / Preview area */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Editor pane */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div className={clsx('flex-1 flex flex-col min-w-0', viewMode === 'split' && 'border-r border-[var(--color-border)]')}>
                <textarea
                  ref={editorRef}
                  value={editContent}
                  onChange={e => handleContentChange(e.target.value)}
                  className="flex-1 w-full p-4 bg-transparent text-sm font-mono resize-none outline-none leading-relaxed"
                  placeholder="Start writing in Markdown...

Supports:
- **Bold**, *italic*, ~~strikethrough~~
- LaTeX: $E = mc^2$ or $$\int_0^\infty$$
- Tables, code blocks, lists
- Links, images, and more"
                  spellCheck={false}
                />
              </div>
            )}

            {/* Preview pane */}
            {(viewMode === 'preview' || viewMode === 'split') && (
              <div className="flex-1 overflow-y-auto min-w-0">
                <div className="p-6 max-w-3xl mx-auto prose prose-invert prose-sm
                  prose-headings:text-white prose-headings:font-semibold
                  prose-p:text-[var(--color-text-secondary)]
                  prose-a:text-accent-blue prose-a:no-underline hover:prose-a:underline
                  prose-code:text-accent-green prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                  prose-pre:bg-[#0a0a0a] prose-pre:border prose-pre:border-[var(--color-border)] prose-pre:rounded-lg
                  prose-th:text-white prose-th:border-[var(--color-border)] prose-th:px-3 prose-th:py-1.5
                  prose-td:border-[var(--color-border)] prose-td:px-3 prose-td:py-1.5
                  prose-table:border-collapse
                  prose-blockquote:border-l-accent-blue prose-blockquote:text-[var(--color-text-muted)]
                  prose-strong:text-white prose-em:text-[var(--color-text-secondary)]
                  prose-hr:border-[var(--color-border)]
                  prose-li:text-[var(--color-text-secondary)]
                  prose-img:rounded-lg
                ">
                  {editContent ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {editContent}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-[var(--color-text-muted)] italic">Nothing to preview</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="px-4 py-1 border-t border-[var(--color-border)] flex items-center justify-between text-xxs text-[var(--color-text-muted)] shrink-0">
            <div className="flex items-center gap-3">
              <span>Markdown</span>
              <span>{(editContent || '').length} chars</span>
              <span>{(editContent || '').split('\n').length} lines</span>
              <span>{(editContent || '').split(/\s+/).filter(Boolean).length} words</span>
            </div>
            <div className="flex items-center gap-3">
              <span>v{activePage.version ?? 1}</span>
              <span>Last saved {activePage.updated_at ? new Date(activePage.updated_at).toLocaleTimeString() : '—'}</span>
            </div>
          </div>
        </div>
      ) : (
        /* No page selected */
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <FiFileText className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium mb-2">No page selected</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              Select a page from the sidebar or create a new one
            </p>
            <button
              onClick={() => setShowTemplates(true)}
              className="btn text-accent-blue hover:bg-accent-blue/10"
            >
              <FiPlus className="w-4 h-4 mr-1" />
              New Page
            </button>
          </div>
        </div>
      )}

      {/* Template picker modal */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowTemplates(false)}>
          <div className="glass-card w-full max-w-md mx-4 p-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
              <h2 className="text-sm font-semibold">New Page</h2>
              <button onClick={() => setShowTemplates(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2">
              {PAGE_TEMPLATES.map(template => (
                <button
                  key={template.name}
                  onClick={() => createPage(template)}
                  className="w-full text-left p-3 rounded hover:bg-white/5 transition-colors flex items-center gap-3"
                >
                  <div className="p-2 rounded bg-white/5 text-[var(--color-text-muted)]">
                    {template.icon}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{template.name}</div>
                    <div className="text-xxs text-[var(--color-text-muted)]">
                      {template.content ? 'Pre-filled template' : 'Start from scratch'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Version history panel */}
      {showVersions && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowVersions(false)}>
          <div className="glass-card w-full max-w-lg mx-4 p-0 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] shrink-0">
              <h2 className="text-sm font-semibold">Version History</h2>
              <button onClick={() => setShowVersions(false)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]">
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {versions.length > 0 ? (
                versions.map(ver => (
                  <div
                    key={ver.version}
                    className="p-3 rounded hover:bg-white/5 flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        v{ver.version} — {ver.title}
                      </div>
                      <div className="text-xxs text-[var(--color-text-muted)]">
                        {new Date(ver.created_at).toLocaleString()}
                      </div>
                      <div className="text-xxs text-[var(--color-text-muted)] mt-0.5 line-clamp-1">
                        {(ver.content || '').slice(0, 100)}...
                      </div>
                    </div>
                    <button
                      onClick={() => restoreVersion(ver.version)}
                      className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-accent-blue hover:bg-accent-blue/10 rounded transition-all"
                    >
                      <FiRotateCcw className="w-3 h-3 inline mr-1" />
                      Restore
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-[var(--color-text-muted)]">
                  <FiClock className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No version history yet</p>
                  <p className="text-xxs mt-1">Versions are created on each save</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

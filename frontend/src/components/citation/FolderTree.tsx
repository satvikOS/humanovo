// FolderTree — hierarchical sidebar of citation collections.
//
// Nested tree render with expand/collapse, click-to-filter, hover
// actions for rename / color / delete / nest-a-child. Supports
// drag-and-drop to reparent a folder (HTML5 dnd — no external lib).
//
// Staying consistent with the platform's muted aesthetic: no colored
// fills by default, just a thin accent bar when a custom color is set.
import { useMemo, useState } from 'react'
import { FiFolder, FiFolderPlus, FiChevronRight, FiChevronDown, FiEdit2, FiTrash2 } from 'react-icons/fi'
import type { LibraryFolder } from '../../services/api'

interface FolderTreeProps {
  folders: LibraryFolder[]
  selected: string | null
  onSelect: (folderId: string | null) => void
  onCreate: (parentId: string | null, name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onReparent: (id: string, newParentId: string | null) => void
  // Count badges per folder (citation count) — precomputed from the
  // library list by the parent.
  counts: Record<string, number>
}

interface TreeNode extends LibraryFolder {
  children: TreeNode[]
}

function buildTree(folders: LibraryFolder[]): TreeNode[] {
  const byId: Record<string, TreeNode> = {}
  folders.forEach(f => { byId[f.id] = { ...f, children: [] } })
  const roots: TreeNode[] = []
  folders.forEach(f => {
    if (f.parent_id && byId[f.parent_id]) byId[f.parent_id].children.push(byId[f.id])
    else roots.push(byId[f.id])
  })
  // Stable sort children by order_index then name at every level.
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name))
    n.children.forEach(sortRec)
  }
  roots.sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name))
  roots.forEach(sortRec)
  return roots
}

export default function FolderTree({ folders, selected, onSelect, onCreate, onRename, onDelete, onReparent, counts }: FolderTreeProps) {
  const tree = useMemo(() => buildTree(folders), [folders])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [creatingParent, setCreatingParent] = useState<string | null | undefined>(undefined)   // undefined = no-op, null = root
  const [createDraft, setCreateDraft] = useState('')

  const toggle = (id: string) => setExpanded(x => ({ ...x, [id]: !x[id] }))

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded[node.id] !== false
    const isSelected = selected === node.id
    const isRenaming = renamingId === node.id

    const onDragStart = (e: React.DragEvent) => { e.dataTransfer.setData('folder-id', node.id); e.stopPropagation() }
    const onDragOver  = (e: React.DragEvent) => { if (e.dataTransfer.types.includes('folder-id')) e.preventDefault() }
    const onDrop = (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      const draggedId = e.dataTransfer.getData('folder-id')
      if (draggedId && draggedId !== node.id) onReparent(draggedId, node.id)
    }

    return (
      <div key={node.id}>
        <div
          draggable
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => !isRenaming && onSelect(node.id)}
          className={`group flex items-center gap-1 py-1 rounded cursor-pointer transition-colors ${
            isSelected ? 'bg-[var(--glass-bg)]' : 'hover:bg-[var(--glass-bg)]'
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          {hasChildren ? (
            <button
              onClick={e => { e.stopPropagation(); toggle(node.id) }}
              className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
            >
              {isOpen ? <FiChevronDown className="w-3 h-3" /> : <FiChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          {node.color && <div className="w-0.5 h-4 rounded" style={{ background: node.color }} aria-hidden="true" />}
          <FiFolder className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          {isRenaming ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={e => setRenameDraft(e.target.value)}
              onBlur={() => { if (renameDraft.trim() && renameDraft.trim() !== node.name) onRename(node.id, renameDraft.trim()); setRenamingId(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameDraft.trim()) { onRename(node.id, renameDraft.trim()); setRenamingId(null) }
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onClick={e => e.stopPropagation()}
              className="flex-1 min-w-0 px-1 py-0.5 text-xs rounded bg-[var(--color-surface-raised)] border border-[var(--color-border-strong)] text-[var(--color-text)]"
              aria-label="Rename folder"
            />
          ) : (
            <>
              <span className="flex-1 min-w-0 text-xs truncate" style={{ color: 'var(--color-text)' }}>{node.name}</span>
              <span className="text-xxs text-[var(--color-text-muted)] tabular-nums">{counts[node.id] || 0}</span>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); setCreatingParent(node.id); setCreateDraft('') }}
                  className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Add sub-folder" aria-label="Add sub-folder">
                  <FiFolderPlus className="w-3 h-3" />
                </button>
                <button onClick={e => { e.stopPropagation(); setRenamingId(node.id); setRenameDraft(node.name) }}
                  className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Rename" aria-label="Rename folder">
                  <FiEdit2 className="w-3 h-3" />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete(node.id) }}
                  className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Delete" aria-label="Delete folder">
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
        </div>
        {hasChildren && isOpen && node.children.map(child => renderNode(child, depth + 1))}
        {creatingParent === node.id && (
          <div style={{ paddingLeft: `${(depth + 1) * 14 + 18}px` }} className="py-1">
            <input
              autoFocus
              value={createDraft}
              onChange={e => setCreateDraft(e.target.value)}
              onBlur={() => { if (createDraft.trim()) onCreate(node.id, createDraft.trim()); setCreatingParent(undefined) }}
              onKeyDown={e => {
                if (e.key === 'Enter' && createDraft.trim()) { onCreate(node.id, createDraft.trim()); setCreatingParent(undefined) }
                if (e.key === 'Escape') setCreatingParent(undefined)
              }}
              placeholder="Sub-folder name…"
              className="w-full px-1 py-0.5 text-xs rounded bg-[var(--color-surface-raised)] border border-[var(--color-border-strong)] text-[var(--color-text)]"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {tree.map(n => renderNode(n, 0))}
      {creatingParent === null && (
        <div className="py-1 px-1">
          <input
            autoFocus
            value={createDraft}
            onChange={e => setCreateDraft(e.target.value)}
            onBlur={() => { if (createDraft.trim()) onCreate(null, createDraft.trim()); setCreatingParent(undefined) }}
            onKeyDown={e => {
              if (e.key === 'Enter' && createDraft.trim()) { onCreate(null, createDraft.trim()); setCreatingParent(undefined) }
              if (e.key === 'Escape') setCreatingParent(undefined)
            }}
            placeholder="New folder name…"
            className="w-full px-1.5 py-1 text-xs rounded bg-[var(--color-surface-raised)] border border-[var(--color-border-strong)] text-[var(--color-text)]"
          />
        </div>
      )}
      <button
        onClick={() => { setCreatingParent(null); setCreateDraft('') }}
        className="flex items-center gap-1 text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)] pl-1 py-1 mt-1"
      >
        <FiFolderPlus className="w-3 h-3" /> New folder
      </button>
    </div>
  )
}

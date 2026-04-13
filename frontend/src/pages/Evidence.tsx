import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiDatabase,
  FiSearch,
  FiPlus,
  FiRefreshCw,
  FiExternalLink,
  FiFileText,
  FiCheckCircle,
  FiClock,
  FiAlertCircle,
  FiCalendar,
  FiUser,
  FiX,
  FiEdit3,
  FiEye,
  FiSave,
  FiTrash2,
  FiLink,
  FiMessageSquare,
  FiLoader,
  FiChevronLeft,
  FiChevronRight,
  FiTag,
  FiGlobe,
  FiShare2,
  FiDownload,
  FiPrinter,
} from 'react-icons/fi'
import api from '../services/api'
import type { Evidence as EvidenceType, Hypothesis, Entity } from '../services/api'
import { logActivity, persistGet, persistSet } from '../utils/persistence'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

// Monochrome: source type is indicated by the label text itself; no colored badges.
const sourceTypeColors: Record<string, string> = {
  pubmed: 'var(--color-text)',
  clinical_trial: 'var(--color-text)',
  preprint: 'var(--color-text-secondary)',
  omics: 'var(--color-text-secondary)',
  drug_database: 'var(--color-text-secondary)',
  pathway_database: 'var(--color-text-secondary)',
  web_search: 'var(--color-text-muted)',
  user_upload: 'var(--color-text-muted)',
  patent: 'var(--color-text-secondary)',
  paper: 'var(--color-text)',
  trial: 'var(--color-text)',
  dataset: 'var(--color-text-secondary)',
}

const statusConfig: Record<string, { icon: typeof FiCheckCircle; color: string; label: string }> = {
  verified: { icon: FiCheckCircle, color: 'var(--color-success)', label: 'Verified' },
  pending: { icon: FiClock, color: 'var(--color-warning)', label: 'Pending' },
  disputed: { icon: FiAlertCircle, color: 'var(--color-error)', label: 'Disputed' },
}

// Knowledge Base status panel — shows dataset counts from the graph
function KnowledgeBaseStatus({ stats }: { stats: { total_entities: number; total_relations: number; entity_counts: Record<string, number>; relation_counts: Record<string, number> } | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!stats || typeof stats.total_entities !== 'number' || typeof stats.total_relations !== 'number') return null

  const entityTypes = Object.entries(stats.entity_counts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0))
  const relationTypes = Object.entries(stats.relation_counts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0))

  const entityColors: Record<string, string> = {
    gene: '#3B82F6', protein: '#8B5CF6', disease: '#EF4444', drug: '#10B981',
    pathway: '#F59E0B', biomarker: '#EC4899', cell_type: '#6366F1', mutation: '#F97316',
  }

  return (
    <div className="mx-6 mt-4 glass-card p-4">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2">
          <FiGlobe className="w-4 h-4 text-[var(--color-text)]" />
          <span className="text-sm font-medium">Knowledge Base</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {(stats.total_entities ?? 0).toLocaleString()} entities &middot; {(stats.total_relations ?? 0).toLocaleString()} relations
          </span>
        </div>
        <FiChevronRight className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] animate-fade-in">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Entity Types</div>
              <div className="space-y-1.5">
                {entityTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: entityColors[type] || 'var(--color-text-muted)' }} />
                      <span className="text-[var(--color-text-secondary)] capitalize">{type.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-[var(--color-text-muted)] font-mono">{(count ?? 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xxs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Relation Types</div>
              <div className="space-y-1.5">
                {relationTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-text-secondary)] capitalize">{type.replace(/_/g, ' ')}</span>
                    <span className="text-[var(--color-text-muted)] font-mono">{(count ?? 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xxs text-[var(--color-text-muted)] mt-3 pt-2 border-t border-[var(--color-border)]">
            Evidence and discoveries are grounded against this knowledge base. Data sourced from Gene Ontology, HPO, MeSH, Disease Ontology, ChEBI, DisGeNET, HGNC, Reactome, DrugBank, and ClinVar.
          </p>
        </div>
      )}
    </div>
  )
}

// Linked entities panel for evidence detail sidebar
function LinkedEntities({ entities, onEntityClick }: { entities: Entity[]; onEntityClick?: (e: Entity) => void }) {
  if (!entities || entities.length === 0) return null

  const entityColors: Record<string, string> = {
    gene: '#3B82F6', protein: '#8B5CF6', disease: '#EF4444', drug: '#10B981',
    pathway: '#F59E0B', biomarker: '#EC4899', cell_type: '#6366F1', mutation: '#F97316',
  }

  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5">
        <FiShare2 className="w-3 h-3" /> Linked Entities
      </div>
      <div className="space-y-1.5">
        {entities.map(entity => {
          const color = entityColors[entity.entity_type] || 'var(--color-text-muted)'
          return (
            <button
              key={entity.id}
              onClick={() => onEntityClick?.(entity)}
              className="w-full text-left p-2 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-all group"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs font-medium truncate">{entity.name}</span>
                <span className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)] capitalize ml-auto flex-shrink-0">{entity.entity_type}</span>
              </div>
              {entity.description && (
                <p className="text-xxs text-[var(--color-text-muted)] mt-1 line-clamp-2 ml-4">{entity.description}</p>
              )}
              {entity.external_ids && Object.keys(entity.external_ids).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1 ml-4">
                  {Object.entries(entity.external_ids).slice(0, 3).map(([db, id]) => (
                    <span key={db} className="text-xxs text-[var(--color-text-muted)]">{db}: {String(id)}</span>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
function getEvidenceSearchUrl(item: EvidenceType): string {
  const title = encodeURIComponent(item.title)
  if (item.source_type === 'pubmed') return `https://pubmed.ncbi.nlm.nih.gov/?term=${title}`
  if (item.source_type === 'clinical_trial') return `https://clinicaltrials.gov/search?term=${title}`
  if (item.source_type === 'preprint') return `https://www.biorxiv.org/search/${title}`
  return `https://scholar.google.com/scholar?q=${title}`
}

export default function Evidence() {
  const [evidence, setEvidence] = useState<EvidenceType[]>([])
  // `?id=…` deep-link: pre-select a specific evidence row on mount so
  // Search result navigation can land users on the correct item. The
  // id is held even if the evidence list hasn't loaded yet; the list's
  // `.find(e => e.id === selectedId)` will resolve once the fetch
  // completes.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const qId = new URLSearchParams(window.location.search).get('id')
    return qId || null
  })
  // Deep-link support: `?add=1` (or `?new=1`) auto-opens the Add Evidence
  // dialog so dashboard/quick-action links can drop users straight into the
  // upload flow. `?q=` seeds the search input and `?type=` seeds the
  // source-type filter so cross-page links preserve user intent. All
  // params are consume-and-cleaned on mount so a soft re-render doesn't
  // keep re-opening the modal after the user cancels.
  const [searchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [filterType, setFilterType] = useState(() => {
    const raw = (searchParams.get('type') || '').toLowerCase()
    const VALID = new Set(['all', 'pubmed', 'clinical_trial', 'preprint', 'patent', 'user_upload'])
    return VALID.has(raw) ? raw : 'all'
  })
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(() => {
    const q = searchParams.get('add') || searchParams.get('new')
    return q === '1'
  })
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [noteText, setNoteText] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [linkingHypothesis, setLinkingHypothesis] = useState(false)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [saving, setSaving] = useState(false)
  const [graphStats, setGraphStats] = useState<{ total_entities: number; total_relations: number; entity_counts: Record<string, number>; relation_counts: Record<string, number> } | null>(null)
  const [linkedEntities, setLinkedEntities] = useState<Entity[]>([])
  const [viewingDocOverlay, setViewingDocOverlay] = useState<{ id: string; title: string; mime_type: string; filename: string; description?: string; authors?: string; date?: string; doc_type?: string } | null>(null)
  const [viewingDocBlobUrl, setViewingDocBlobUrl] = useState<string | null>(null)
  const [viewingDocLoading, setViewingDocLoading] = useState(false)
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [editDocForm, setEditDocForm] = useState({ title: '', doc_type: '', authors: '', description: '', tags: '' })
  const [deleteDocConfirmId, setDeleteDocConfirmId] = useState<string | null>(null)
  const pageSize = 30

  const fetchEvidence = useCallback(async () => {
    setLoading(true)
    try {
      if (searchQuery.trim()) {
        const res = await api.searchEvidence(searchQuery, {
          source_types: filterType !== 'all' ? [filterType] : undefined,
          limit: pageSize,
        })
        setEvidence(res.items || [])
        setTotalItems(res.total || 0)
      } else {
        const res = await api.getEvidenceList({
          page,
          page_size: pageSize,
          source_type: filterType !== 'all' ? filterType : undefined,
        })
        setEvidence(res.items || [])
        setTotalItems(res.total || 0)
      }
    } catch (err) {
      console.error('Failed to fetch evidence:', err)
      setEvidence([])
      setTotalItems(0)
    }
    setLoading(false)
  }, [searchQuery, filterType, page])

  useEffect(() => { fetchEvidence() }, [fetchEvidence])

  // Clean deep-link query params (`add`/`new`/`id`/`q`/`type`) off the
  // URL after the initial mount so a soft reload doesn't re-open the
  // dialog or stomp user-driven selection changes.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    let changed = false
    for (const k of ['add', 'new', 'id', 'q', 'type']) {
      if (sp.has(k)) { sp.delete(k); changed = true }
    }
    if (changed) {
      const qs = sp.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Merge project documents into evidence list. Both intermediate lists
  // are memoized so long lists don't re-map + re-filter on every
  // unrelated render (selection, form edits, etc.).
  type ProjectDoc = {
    id: string; project_id: string; title: string; doc_type: string; authors: string;
    date: string; description: string; tags: string[]; filename: string;
    file_size: number; mime_type: string; uploaded_at: string
  }
  const allProjectDocs = useMemo<ProjectDoc[]>(
    () => persistGet<ProjectDoc[]>('project-documents', []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evidence], // refresh when evidence set changes (post-upload/edit)
  )
  const mergedEvidence = useMemo<EvidenceType[]>(() => {
    const docEvidence: EvidenceType[] = allProjectDocs.map(d => ({
      id: `doc-ev-${d.id}`,
      title: d.title,
      abstract: d.description,
      source_type: 'user_upload',
      source_url: '',
      authors: d.authors ? [d.authors] : [],
      publication_date: d.date,
      status: 'verified',
      relevance_score: 1.0,
      tags: [...d.tags, d.doc_type],
      entities: [],
      notes: '',
      created_at: d.uploaded_at,
      updated_at: d.uploaded_at,
      citation_count: 0,
      metadata: { filename: d.filename, file_size: d.file_size, mime_type: d.mime_type, project_id: d.project_id },
    }))
    if (filterType === 'user_upload' || filterType === 'all') {
      const q = searchQuery.toLowerCase()
      const matchedDocs = q ? docEvidence.filter(d => d.title.toLowerCase().includes(q)) : docEvidence
      return [...matchedDocs, ...evidence]
    }
    return evidence
  }, [filterType, searchQuery, evidence, allProjectDocs])

  // Fetch knowledge base stats on mount
  useEffect(() => {
    api.getGraphStats().then(stats => {
      setGraphStats(stats || null)
    }).catch(() => {
      setGraphStats(null)
    })
  }, [])

  // Fetch linked entities when an evidence item is selected
  useEffect(() => {
    if (!selectedId) { setLinkedEntities([]); return }
    const item = evidence.find(e => e.id === selectedId)
    if (!item) return
    // Search for entities mentioned in the evidence title/entities field
    const searchTerms = [...(item.entities || []), ...(item.tags || [])].filter(Boolean)
    if (searchTerms.length === 0 && item.title) {
      // Fallback: search by title keywords
      api.searchEntities(item.title, { limit: 5 }).then(setLinkedEntities).catch(() => setLinkedEntities([]))
    } else if (searchTerms.length > 0) {
      Promise.allSettled(
        searchTerms.slice(0, 5).map(term => api.searchEntities(term, { limit: 2 }))
      ).then(results => {
        const entities: Entity[] = []
        const seen = new Set<string>()
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            r.value.forEach((e: Entity) => {
              if (!seen.has(e.id)) { seen.add(e.id); entities.push(e) }
            })
          }
        })
        setLinkedEntities(entities.slice(0, 10))
      })
    }
  }, [selectedId, evidence])

  const selectedItem = evidence.find(e => e.id === selectedId) || null

  const handleUpdateField = async (field: string, value: any) => {
    if (!selectedId) return
    setSaving(true)
    try {
      const updated = await api.updateEvidence(selectedId, { [field]: value })
      setEvidence(prev => prev.map(e => e.id === selectedId ? { ...e, ...updated } : e))
      setEditField(null)
      logActivity({ type: 'evidence', action: 'updated', title: `Updated evidence field ${field}: ${selectedItem?.title || selectedId}` })
    } catch (err) {
      console.error('Failed to update:', err)
    }
    setSaving(false)
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedId) return
    setSaving(true)
    try {
      const updated = await api.updateEvidence(selectedId, { status: newStatus })
      setEvidence(prev => prev.map(e => e.id === selectedId ? { ...e, ...updated } : e))
      logActivity({ type: 'evidence', action: 'updated', title: `Updated evidence status to ${newStatus}: ${selectedItem?.title || selectedId}` })
    } catch (err) {
      console.error('Failed to update status:', err)
    }
    setSaving(false)
  }

  const handleAddTag = async () => {
    if (!selectedId || !newTag.trim()) return
    const item = evidence.find(e => e.id === selectedId)
    if (!item) return
    const tags = [...(item.tags || []), newTag.trim()]
    await handleUpdateField('tags', tags)
    setNewTag('')
  }

  const handleRemoveTag = async (tag: string) => {
    if (!selectedId) return
    const item = evidence.find(e => e.id === selectedId)
    if (!item) return
    const tags = (item.tags || []).filter(t => t !== tag)
    await handleUpdateField('tags', tags)
  }

  const handleSaveNote = async () => {
    if (!selectedId) return
    await handleUpdateField('notes', noteText)
    setShowNoteInput(false)
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    try {
      const deletedItem = evidence.find(e => e.id === id)
      await api.deleteEvidence(id)
      setEvidence(prev => prev.filter(e => e.id !== id))
      if (selectedId === id) setSelectedId(null)
      logActivity({ type: 'evidence', action: 'deleted', title: `Deleted evidence: ${deletedItem?.title || id}` })
    } catch (err) {
      console.error('Failed to delete evidence:', err)
    }
  }

  const handleLinkToHypothesis = async (hypothesisId: string, linkType: 'supporting' | 'contradicting' | 'neutral') => {
    if (!selectedId) return
    try {
      await api.addEvidenceToHypothesis(hypothesisId, {
        evidence_id: selectedId,
        evidence_type: linkType,
        relevance_score: 0.8,
      })
      setLinkingHypothesis(false)
    } catch (err) {
      console.error('Failed to link evidence:', err)
    }
  }

  const openLinkDialog = async () => {
    try {
      const res = await api.getHypotheses({ page_size: 50 })
      setHypotheses(res.items || [])
      setLinkingHypothesis(true)
    } catch (err) {
      console.error('Failed to fetch hypotheses:', err)
    }
  }

  const openDocViewer = async (docId: string) => {
    const realId = docId.replace('doc-ev-', '')
    const doc = allProjectDocs.find(d => d.id === realId)
    if (!doc) return
    setViewingDocOverlay({ id: realId, title: doc.title, mime_type: doc.mime_type, filename: doc.filename, description: doc.description, authors: doc.authors, date: doc.date, doc_type: doc.doc_type })
    setViewingDocLoading(true)
    try {
      const { blobGet } = await import('../utils/persistence')
      const base64 = await blobGet(realId)
      if (base64) {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: doc.mime_type })
        setViewingDocBlobUrl(URL.createObjectURL(blob))
      }
    } catch { /* blob not available */ }
    setViewingDocLoading(false)
  }

  const closeDocViewer = () => {
    if (viewingDocBlobUrl) URL.revokeObjectURL(viewingDocBlobUrl)
    setViewingDocOverlay(null)
    setViewingDocBlobUrl(null)
  }

  const startEditDoc = (docId: string) => {
    const realId = docId.replace('doc-ev-', '')
    const doc = allProjectDocs.find(d => d.id === realId)
    if (!doc) return
    setEditingDocId(realId)
    setEditDocForm({ title: doc.title, doc_type: doc.doc_type, authors: doc.authors, description: doc.description, tags: doc.tags.join(', ') })
  }

  const saveEditDoc = () => {
    if (!editingDocId) return
    const docs = persistGet<any[]>('project-documents', [])
    const updated = docs.map(d => d.id === editingDocId ? { ...d, title: editDocForm.title, doc_type: editDocForm.doc_type, authors: editDocForm.authors, description: editDocForm.description, tags: editDocForm.tags.split(',').map((t: string) => t.trim()).filter(Boolean) } : d)
    persistSet('project-documents', updated)
    setEditingDocId(null)
    fetchEvidence()
  }

  const confirmDeleteDoc = async () => {
    if (!deleteDocConfirmId) return
    const realId = deleteDocConfirmId.replace('doc-ev-', '')
    try {
      const { blobDelete } = await import('../utils/persistence')
      await blobDelete(realId)
    } catch { /* blob not found */ }
    const docs = persistGet<any[]>('project-documents', [])
    persistSet('project-documents', docs.filter(d => d.id !== realId))
    setDeleteDocConfirmId(null)
    fetchEvidence()
  }

  const handleAddEvidence = async (form: any) => {
    try {
      const created = await api.createEvidence({
        title: form.title,
        source_type: form.type,
        source_url: form.sourceUrl,
        abstract: form.abstract,
        authors: form.authors ? form.authors.split(',').map((a: string) => a.trim()) : [],
        tags: form.tags ? form.tags.split(',').map((t: string) => t.trim()) : [],
        publication_date: form.date,
      })
      setEvidence(prev => [created, ...prev])
      setShowAddModal(false)
      logActivity({ type: 'evidence', action: 'created', title: `Added evidence: ${form.title}` })
    } catch (err) {
      console.error('Failed to create evidence:', err)
    }
  }

  const totalPages = Math.ceil(totalItems / pageSize)

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-6 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-semibold tracking-tight">Evidence</h1>
            <button onClick={() => setShowAddModal(true)} className="btn text-sm border border-[var(--color-border)]" style={{ color: 'var(--color-text)' }}>
              <FiPlus className="w-4 h-4" /> Add Evidence
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Search evidence..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
                onKeyDown={e => e.key === 'Enter' && fetchEvidence()}
                className="input w-full pl-10"
              />
            </div>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1) }} className="input">
              <option value="all">All Types</option>
              <option value="pubmed">PubMed</option>
              <option value="clinical_trial">Clinical Trial</option>
              <option value="preprint">Preprint</option>
              <option value="patent">Patent</option>
              <option value="user_upload">User Upload</option>
            </select>
            <button onClick={fetchEvidence} className="btn p-2" title="Refresh">
              <FiRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Knowledge Base Status */}
        <KnowledgeBaseStatus stats={graphStats} />

        {/* Stats */}
        <div className="px-6 py-2 border-b border-[var(--color-border)] flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span><span className="text-[var(--color-text)] font-medium">{totalItems}</span> items total</span>
          <span>Page {page} of {Math.max(1, totalPages)}</span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && mergedEvidence.length === 0 ? (
            <div className="text-center py-16">
              <FiLoader className="w-8 h-8 animate-spin mx-auto mb-3 text-[var(--color-text-muted)]" />
            </div>
          ) : mergedEvidence.length === 0 ? (
            <div className="text-center py-16">
              <FiDatabase className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-30" />
              <p className="text-sm text-[var(--color-text-muted)]">No evidence found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mergedEvidence.map(item => {
                const color = sourceTypeColors[item.source_type] || 'var(--color-text-muted)'
                const status = statusConfig[item.status || 'pending'] || statusConfig.pending
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left glass-card p-4 transition-all ${selectedId === item.id ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg-hover)]' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg flex-shrink-0" style={{ background: `${color}12` }}>
                        <FiFileText className="w-4 h-4" style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium line-clamp-1">{item.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mt-1">
                          <span style={{ color }}>{item.source_type}</span>
                          {item.publication_date && <span>{item.publication_date}</span>}
                          {item.citation_count !== undefined && <span>{item.citation_count} citations</span>}
                          {item.id.startsWith('doc-ev-') ? (
                            <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                              <button onClick={e => { e.stopPropagation(); openDocViewer(item.id) }} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="View"><FiEye className="w-3 h-3" /></button>
                              <button onClick={e => { e.stopPropagation(); startEditDoc(item.id) }} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Edit"><FiEdit3 className="w-3 h-3" /></button>
                              <button onClick={e => { e.stopPropagation(); setDeleteDocConfirmId(item.id) }} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Delete"><FiTrash2 className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <a href={item.source_url || getEvidenceSearchUrl(item)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              className="ml-auto flex items-center gap-0.5 text-[var(--color-text-secondary)] hover:underline flex-shrink-0">
                              <FiExternalLink className="w-3 h-3" /> View
                            </a>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1.5">
                            <status.icon className="w-3 h-3" style={{ color: status.color }} />
                            <span className="text-xs" style={{ color: status.color }}>{status.label}</span>
                          </div>
                          {item.relevance_score != null && Number.isFinite(Number(item.relevance_score)) && (
                            <div className="flex items-center gap-1">
                              <div className="h-1 w-12 rounded-full overflow-hidden bg-[var(--color-border)]">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, Number(item.relevance_score) * 100))}%`, background: color }} />
                              </div>
                              <span className="text-xxs text-[var(--color-text-muted)]">{Math.round(Number(item.relevance_score) * 100)}%</span>
                            </div>
                          )}
                        </div>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {item.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{tag}</span>
                            ))}
                            {item.tags.length > 3 && <span className="text-xxs text-[var(--color-text-muted)]">+{item.tags.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-[var(--color-border)]">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-sm disabled:opacity-30">
                <FiChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-xs text-[var(--color-text-muted)]">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn btn-sm disabled:opacity-30">
                Next <FiChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail sidebar */}
      <div className="w-96 border-l border-[var(--color-border)] flex flex-col overflow-hidden">
        {selectedItem ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-5 border-b border-[var(--color-border)]">
              <div className="flex items-start justify-between mb-3">
                {editField === 'title' ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input value={editValue} onChange={e => setEditValue(e.target.value)} className="input flex-1 text-sm" autoFocus />
                    <button onClick={() => handleUpdateField('title', editValue)} className="btn btn-sm" style={{ color: 'var(--color-success)' }}><FiSave className="w-3 h-3" /></button>
                    <button onClick={() => setEditField(null)} className="btn btn-sm"><FiX className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <h2 className="text-lg font-medium leading-tight group cursor-pointer" onClick={() => { setEditField('title'); setEditValue(selectedItem.title) }}>
                    {selectedItem.title}
                    <FiEdit3 className="inline w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)]" />
                  </h2>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                {selectedItem.publication_date && <span className="flex items-center gap-1"><FiCalendar className="w-3 h-3" />{selectedItem.publication_date}</span>}
                <span className="flex items-center gap-1"><FiDatabase className="w-3 h-3" />{selectedItem.source_type}</span>
                {selectedItem.citation_count !== undefined && <span>{selectedItem.citation_count} citations</span>}
              </div>

              <div className="flex items-center gap-2 mt-3">
                <a href={selectedItem.source_url || getEvidenceSearchUrl(selectedItem)} target="_blank" rel="noopener noreferrer" className="btn btn-sm border border-[var(--color-border)]">
                  <FiExternalLink className="w-3 h-3" /> {selectedItem.source_url ? 'Source' : 'Search'}
                </a>
                <button onClick={openLinkDialog} className="btn btn-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <FiLink className="w-3 h-3" /> Link to Hypothesis
                </button>
                <button onClick={() => handleDelete(selectedItem.id)} className="btn btn-sm ml-auto" style={{ color: 'var(--color-error)' }}>
                  <FiTrash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Authors (editable) */}
              {selectedItem.authors && selectedItem.authors.length > 0 && (
                <div>
                  <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Authors</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedItem.authors.map(author => (
                      <span key={author} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                        <FiUser className="w-3 h-3 text-[var(--color-text-muted)]" /> {author}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Abstract (editable) */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium flex items-center justify-between">
                  Abstract
                  <button onClick={() => { setEditField('abstract'); setEditValue(selectedItem.abstract || '') }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <FiEdit3 className="w-3 h-3" />
                  </button>
                </div>
                {editField === 'abstract' ? (
                  <div>
                    <textarea value={editValue} onChange={e => setEditValue(e.target.value)} className="input w-full h-32 resize-none text-xs" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => handleUpdateField('abstract', editValue)} className="btn btn-sm" style={{ color: 'var(--color-success)' }}>Save</button>
                      <button onClick={() => setEditField(null)} className="btn btn-sm text-[var(--color-text-muted)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{selectedItem.abstract || 'No abstract available'}</p>
                )}
              </div>

              {/* Tags (editable) */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {(selectedItem.tags || []).map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-[var(--glass-bg)] text-[var(--color-text-secondary)] group">
                      {tag}
                      <button onClick={() => handleRemoveTag(tag)} className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
                        <FiX className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                      placeholder="Add tag..."
                      className="text-xs bg-transparent outline-none w-16 text-[var(--color-text-muted)]"
                    />
                    {newTag && <button onClick={handleAddTag} className="text-[var(--color-text-muted)]"><FiTag className="w-3 h-3" /></button>}
                  </div>
                </div>
              </div>

              {/* Linked Entities from Knowledge Graph */}
              <LinkedEntities entities={linkedEntities} />

              {/* Status (changeable) */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium">Status</div>
                <div className="flex items-center gap-2">
                  {Object.entries(statusConfig).map(([key, config]) => {
                    const active = selectedItem.status === key
                    return (
                      <button
                        key={key}
                        onClick={() => handleStatusChange(key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all border ${active ? 'border-[var(--color-border-strong)]' : 'border-transparent hover:bg-[var(--glass-bg)]'}`}
                        style={{ color: config.color, background: active ? `${config.color}12` : undefined }}
                      >
                        <config.icon className="w-3 h-3" />
                        {config.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2 font-medium flex items-center justify-between">
                  Notes
                  <button onClick={() => { setShowNoteInput(true); setNoteText(selectedItem.notes || '') }} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <FiMessageSquare className="w-3 h-3" />
                  </button>
                </div>
                {showNoteInput ? (
                  <div>
                    <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add notes..." className="input w-full h-20 resize-none text-xs" autoFocus />
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleSaveNote} className="btn btn-sm" style={{ color: 'var(--color-success)' }}>Save</button>
                      <button onClick={() => setShowNoteInput(false)} className="btn btn-sm text-[var(--color-text-muted)]">Cancel</button>
                    </div>
                  </div>
                ) : selectedItem.notes ? (
                  <p className="text-xs text-[var(--color-text-secondary)] p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">{selectedItem.notes}</p>
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)]">No notes yet</p>
                )}
              </div>

              {saving && <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><FiLoader className="w-3 h-3 animate-spin" /> Saving...</div>}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
            <FiDatabase className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">Select evidence to view details</p>
          </div>
        )}
      </div>

      {/* Add Evidence Modal */}
      {showAddModal && <AddEvidenceModal onClose={() => setShowAddModal(false)} onAdd={handleAddEvidence} />}

      {/* Link to Hypothesis Modal */}
      {linkingHypothesis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
          <div className="glass-card-static p-6 w-full max-w-md mx-4 animate-scale-in" style={{ background: 'var(--color-surface-solid)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Link Evidence to Hypothesis</h3>
              <button onClick={() => setLinkingHypothesis(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><FiX className="w-4 h-4" /></button>
            </div>
            {hypotheses.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">No hypotheses found</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {hypotheses.map(h => (
                  <div key={h.id} className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                    <p className="text-xs font-medium mb-2 line-clamp-2">{h.statement}</p>
                    <div className="flex gap-1">
                      <button onClick={() => handleLinkToHypothesis(h.id, 'supporting')} className="btn btn-sm" style={{ color: 'var(--color-success)' }}>Supporting</button>
                      <button onClick={() => handleLinkToHypothesis(h.id, 'contradicting')} className="btn btn-sm" style={{ color: 'var(--color-error)' }}>Contradicting</button>
                      <button onClick={() => handleLinkToHypothesis(h.id, 'neutral')} className="btn btn-sm text-[var(--color-text-muted)]">Neutral</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 max-w-sm mx-4 text-center" style={{ background: 'var(--color-surface-solid)' }}>
            <h3 className="text-lg font-semibold mb-2">Delete Evidence?</h3>
            <p className="text-sm text-[var(--color-text-muted)] mb-4">
              This will permanently delete this evidence item. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setDeleteConfirmId(null)} className="btn px-4 py-2 text-sm text-[var(--color-text-muted)]">
                Cancel
              </button>
              <button onClick={confirmDelete} className="btn px-4 py-2 text-sm bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20">
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Overlay */}
      {viewingDocOverlay && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={closeDocViewer} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
            <div className="w-full max-w-4xl h-[80vh] flex flex-col rounded-2xl border border-[var(--color-border)] overflow-hidden" style={{ background: 'var(--color-surface-solid)' }}>
              <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
                <div className="min-w-0 flex-1 mr-3">
                  <h3 className="text-sm font-medium text-white truncate">{viewingDocOverlay.title}</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{viewingDocOverlay.doc_type} {viewingDocOverlay.authors && `· ${viewingDocOverlay.authors}`} {viewingDocOverlay.date && `· ${viewingDocOverlay.date}`}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {viewingDocBlobUrl && (
                    <>
                      <button
                        onClick={() => {
                          const w = window.open('')
                          if (w) { w.document.write(`<iframe src="${viewingDocBlobUrl}" style="width:100%;height:100%;border:none"></iframe>`); w.document.title = viewingDocOverlay.title; w.print() }
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        title="Print"
                      >
                        <FiPrinter className="w-4 h-4" />
                      </button>
                      <a
                        href={viewingDocBlobUrl}
                        download={viewingDocOverlay.filename || viewingDocOverlay.title}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        title="Download"
                      >
                        <FiDownload className="w-4 h-4" />
                      </a>
                    </>
                  )}
                  <button onClick={closeDocViewer} className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <FiX className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 relative">
                {viewingDocLoading && <div className="absolute inset-0 flex items-center justify-center"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}
                {!viewingDocLoading && viewingDocBlobUrl && viewingDocOverlay.mime_type === 'application/pdf' && (
                  <iframe src={`${viewingDocBlobUrl}#toolbar=0&navpanes=0`} className="w-full h-full border-0" title={viewingDocOverlay.title} />
                )}
                {!viewingDocLoading && viewingDocBlobUrl && viewingDocOverlay.mime_type.startsWith('image/') && (
                  <div className="flex items-center justify-center h-full p-8"><img src={viewingDocBlobUrl} alt={viewingDocOverlay.title} className="max-w-full max-h-full object-contain rounded" /></div>
                )}
                {!viewingDocLoading && !viewingDocBlobUrl && (
                  <div className="flex flex-col items-center justify-center h-full"><p className="text-[var(--color-text-muted)]">File content not available</p></div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit Doc Modal */}
      {editingDocId && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setEditingDocId(null)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-md glass-card p-0" style={{ background: 'var(--color-surface-solid)' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
                <h3 className="text-sm font-semibold text-white">Edit Document</h3>
                <button onClick={() => setEditingDocId(null)} className="p-1 rounded hover:bg-white/5 text-[var(--color-text-muted)]"><FiX className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-3">
                <input value={editDocForm.title} onChange={e => setEditDocForm(prev => ({ ...prev, title: e.target.value }))} className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white" placeholder="Title" />
                <input value={editDocForm.authors} onChange={e => setEditDocForm(prev => ({ ...prev, authors: e.target.value }))} className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white" placeholder="Authors" />
                <textarea value={editDocForm.description} onChange={e => setEditDocForm(prev => ({ ...prev, description: e.target.value }))} rows={2} className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white resize-none" placeholder="Description" />
                <input value={editDocForm.tags} onChange={e => setEditDocForm(prev => ({ ...prev, tags: e.target.value }))} className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-[var(--color-border)] text-white" placeholder="Tags (comma-separated)" />
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)]">
                <button onClick={() => setEditingDocId(null)} className="px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded-lg hover:bg-white/5">Cancel</button>
                <button onClick={saveEditDoc} className="px-3 py-1.5 text-sm text-white bg-white/10 hover:bg-white/15 rounded-lg border border-[var(--color-border)]">Save</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Doc Confirm */}
      {deleteDocConfirmId && (
        <ConfirmDeleteDialog
          title="Delete Document?"
          message="This will permanently delete this document from all locations. This action cannot be undone."
          onConfirm={confirmDeleteDoc}
          onCancel={() => setDeleteDocConfirmId(null)}
        />
      )}
    </div>
  )
}

function AddEvidenceModal({ onClose, onAdd }: { onClose: () => void; onAdd: (form: any) => void }) {
  const [form, setForm] = useState({
    title: '', source: '', sourceUrl: '', type: 'pubmed',
    abstract: '', authors: '', tags: '', date: new Date().toISOString().split('T')[0],
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div className="glass-card-static w-full max-w-lg mx-4 animate-scale-in" style={{ background: 'var(--color-surface-solid)' }}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold">Add Evidence</h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><FiX className="w-5 h-5" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onAdd(form) }} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Title *</label>
            <input type="text" className="input w-full" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Source</label>
              <input type="text" className="input w-full" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Type</label>
              <select className="input w-full" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="pubmed">PubMed</option>
                <option value="clinical_trial">Clinical Trial</option>
                <option value="preprint">Preprint</option>
                <option value="patent">Patent</option>
                <option value="user_upload">User Upload</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">URL</label>
            <input type="url" className="input w-full" value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Authors (comma separated)</label>
            <input type="text" className="input w-full" value={form.authors} onChange={e => setForm({ ...form, authors: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Abstract</label>
            <textarea className="input w-full h-20 resize-none" value={form.abstract} onChange={e => setForm({ ...form, abstract: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1 font-medium">Tags (comma separated)</label>
            <input type="text" className="input w-full" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn text-[var(--color-text-muted)]">Cancel</button>
            <button type="submit" className="btn border border-[var(--color-border)]" style={{ color: 'var(--color-text)' }}>Add Evidence</button>
          </div>
        </form>
      </div>
    </div>
  )
}

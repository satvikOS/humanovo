// ═══════════════════════════════════════════════════════════════════════
// Data Manager — Enhanced Data Hub + ETL Pipeline + Variable Browser
// Client-side dataset management for biomedical research:
//   • CSV/TSV/JSON upload with auto-typing
//   • Variable browser with type detection & summary stats
//   • ETL operations: filter, sort, derive columns, merge, group-by
//   • Profile view with histograms & missing-value report
//   • Export to CSV/JSON
//   • Persistence via localStorage
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FiDatabase, FiUpload, FiDownload, FiSearch, FiTrash2, FiPlus,
  FiBarChart2, FiList, FiGrid, FiX, FiPlay,
  FiTag, FiSliders, FiCopy,
} from 'react-icons/fi'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import clsx from 'clsx'
import * as XLSX from 'xlsx'
import { useAlertDialog } from '../components/AlertDialog'

type ColumnType = 'number' | 'string' | 'date' | 'boolean'

interface Column {
  name: string
  type: ColumnType
  description?: string
  unit?: string
}

interface Dataset {
  id: string
  name: string
  description: string
  source: 'upload' | 'manual' | 'derived'
  columns: Column[]
  rows: Record<string, any>[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

type ViewMode = 'overview' | 'table' | 'variables' | 'profile' | 'etl'
const VALID_VIEW_MODES = new Set<ViewMode>(['overview', 'table', 'variables', 'profile', 'etl'])

const STORAGE_KEY = 'data-manager-datasets'

function loadDatasets(): Dataset[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveDatasets(d: Dataset[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch { /* quota exceeded */ }
}

/* ── CSV / TSV Parser ───────────────────────────────────────────────── */
function parseDelimited(text: string, delimiter: string): { columns: Column[]; rows: Record<string, any>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return { columns: [], rows: [] }
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''))
  const dataRows = lines.slice(1).map(line => {
    const cells = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''))
    const row: Record<string, any> = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
  // Type inference
  const columns: Column[] = headers.map(name => {
    const samples = dataRows.slice(0, 100).map(r => r[name]).filter(v => v !== '' && v != null)
    if (samples.every(v => !isNaN(Number(v)))) return { name, type: 'number' }
    if (samples.every(v => /^(true|false|0|1|yes|no)$/i.test(String(v)))) return { name, type: 'boolean' }
    if (samples.every(v => !isNaN(Date.parse(String(v))))) return { name, type: 'date' }
    return { name, type: 'string' }
  })
  // Coerce values
  const typed = dataRows.map(row => {
    const r: Record<string, any> = {}
    columns.forEach(c => {
      const v = row[c.name]
      if (v === '' || v == null) { r[c.name] = null; return }
      if (c.type === 'number') r[c.name] = Number(v)
      else if (c.type === 'boolean') r[c.name] = /^(true|1|yes)$/i.test(String(v))
      else r[c.name] = v
    })
    return r
  })
  return { columns, rows: typed }
}

function parseJSON(text: string): { columns: Column[]; rows: Record<string, any>[] } {
  const parsed = JSON.parse(text)
  const arr: Record<string, any>[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : [parsed])
  if (!arr.length) return { columns: [], rows: [] }
  const headers = Array.from(new Set(arr.flatMap(r => Object.keys(r))))
  const columns: Column[] = headers.map(name => {
    const samples = arr.slice(0, 100).map(r => r[name]).filter(v => v != null)
    if (samples.every(v => typeof v === 'number')) return { name, type: 'number' }
    if (samples.every(v => typeof v === 'boolean')) return { name, type: 'boolean' }
    return { name, type: 'string' }
  })
  return { columns, rows: arr }
}

/* ── Profile / Stats Helpers ────────────────────────────────────────── */
interface ColumnProfile {
  name: string
  type: ColumnType
  count: number
  nullCount: number
  uniqueCount: number
  completeness: number
  min?: number; max?: number; mean?: number; std?: number; median?: number
  histogram?: { bin: string; count: number }[]
  topValues?: { value: string; count: number }[]
}

function profileColumn(col: Column, rows: Record<string, any>[]): ColumnProfile {
  const values = rows.map(r => r[col.name])
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== '')
  const unique = new Set(nonNull.map(String)).size
  const profile: ColumnProfile = {
    name: col.name,
    type: col.type,
    count: values.length,
    nullCount: values.length - nonNull.length,
    uniqueCount: unique,
    completeness: values.length === 0 ? 0 : nonNull.length / values.length,
  }
  if (col.type === 'number') {
    const nums = nonNull.map(Number).filter(n => !isNaN(n))
    if (nums.length) {
      const sum = nums.reduce((s, v) => s + v, 0)
      const mean = sum / nums.length
      const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length
      const sorted = [...nums].sort((a, b) => a - b)
      profile.min = sorted[0]
      profile.max = sorted[sorted.length - 1]
      profile.mean = mean
      profile.std = Math.sqrt(variance)
      profile.median = sorted[Math.floor(sorted.length / 2)]
      // Histogram
      const bins = 20
      const range = profile.max - profile.min || 1
      const binWidth = range / bins
      const histogram = new Array(bins).fill(0)
      nums.forEach(n => {
        const idx = Math.min(bins - 1, Math.floor((n - profile.min!) / binWidth))
        histogram[idx]++
      })
      profile.histogram = histogram.map((c, i) => ({
        bin: (profile.min! + i * binWidth).toFixed(2),
        count: c,
      }))
    }
  } else {
    const counts: Record<string, number> = {}
    nonNull.forEach(v => { const s = String(v); counts[s] = (counts[s] || 0) + 1 })
    profile.topValues = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }))
  }
  return profile
}

/* ── ETL Operations ─────────────────────────────────────────────────── */
type Op = {
  id: string
  type: 'filter' | 'sort' | 'select' | 'derive' | 'rename' | 'drop_nulls'
  config: any
}

function applyOps(ds: Dataset, ops: Op[]): Dataset {
  let cols = [...ds.columns]
  let rows = [...ds.rows]
  for (const op of ops) {
    if (op.type === 'filter') {
      const { column, operator, value } = op.config
      rows = rows.filter(r => {
        const v = r[column]
        if (v == null) return false
        switch (operator) {
          case '=': return String(v) === String(value)
          case '!=': return String(v) !== String(value)
          case '>': return Number(v) > Number(value)
          case '<': return Number(v) < Number(value)
          case '>=': return Number(v) >= Number(value)
          case '<=': return Number(v) <= Number(value)
          case 'contains': return String(v).toLowerCase().includes(String(value).toLowerCase())
          default: return true
        }
      })
    } else if (op.type === 'sort') {
      const { column, direction } = op.config
      rows = [...rows].sort((a, b) => {
        const va = a[column], vb = b[column]
        if (va == null) return 1
        if (vb == null) return -1
        if (typeof va === 'number' && typeof vb === 'number') return direction === 'asc' ? va - vb : vb - va
        return direction === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      })
    } else if (op.type === 'select') {
      const keep: string[] = op.config.columns
      cols = cols.filter(c => keep.includes(c.name))
      rows = rows.map(r => {
        const o: Record<string, any> = {}
        keep.forEach(k => { o[k] = r[k] })
        return o
      })
    } else if (op.type === 'drop_nulls') {
      const col: string = op.config.column
      rows = rows.filter(r => r[col] != null && r[col] !== '')
    } else if (op.type === 'derive') {
      const { name, expression } = op.config
      cols.push({ name, type: 'number' })
      rows = rows.map(r => {
        try {
           
          const fn = new Function(...Object.keys(r), `return ${expression}`)
          return { ...r, [name]: fn(...Object.values(r)) }
        } catch {
          return { ...r, [name]: null }
        }
      })
    } else if (op.type === 'rename') {
      const { from, to } = op.config
      cols = cols.map(c => c.name === from ? { ...c, name: to } : c)
      rows = rows.map(r => {
        const o: Record<string, any> = {}
        Object.entries(r).forEach(([k, v]) => { o[k === from ? to : k] = v })
        return o
      })
    }
  }
  return { ...ds, columns: cols, rows }
}

/* ── Sample datasets ────────────────────────────────────────────────── */
const SAMPLE_DATASETS: Omit<Dataset, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Clinical Trial — Drug X',
    description: 'Phase II RCT outcomes for hypothetical drug X vs placebo',
    source: 'manual',
    tags: ['clinical', 'rct'],
    columns: [
      { name: 'patient_id', type: 'string' },
      { name: 'arm', type: 'string', description: 'Treatment arm' },
      { name: 'age', type: 'number', unit: 'years' },
      { name: 'baseline_score', type: 'number' },
      { name: 'week_12_score', type: 'number' },
      { name: 'response', type: 'boolean' },
    ],
    rows: Array.from({ length: 30 }, (_, i) => {
      const arm = i % 2 === 0 ? 'placebo' : 'drug_x'
      const baseline = 60 + Math.random() * 20
      const reduction = arm === 'drug_x' ? 15 + Math.random() * 10 : 3 + Math.random() * 5
      return {
        patient_id: `P${(i + 1).toString().padStart(3, '0')}`,
        arm,
        age: Math.round(45 + Math.random() * 25),
        baseline_score: Math.round(baseline * 10) / 10,
        week_12_score: Math.round((baseline - reduction) * 10) / 10,
        response: arm === 'drug_x' ? Math.random() > 0.3 : Math.random() > 0.7,
      }
    }),
  },
  {
    name: 'Gene Expression — Tumor vs Normal',
    description: '50 genes across 20 samples (counts)',
    source: 'manual',
    tags: ['rnaseq', 'cancer'],
    columns: [
      { name: 'gene', type: 'string' },
      { name: 'tumor_mean', type: 'number' },
      { name: 'normal_mean', type: 'number' },
      { name: 'log2fc', type: 'number' },
      { name: 'pvalue', type: 'number' },
    ],
    rows: Array.from({ length: 50 }, (_, i) => {
      const tumor = 50 + Math.random() * 500
      const normal = 50 + Math.random() * 500
      const lfc = Math.log2((tumor + 1) / (normal + 1))
      return {
        gene: `GENE_${(i + 1).toString().padStart(4, '0')}`,
        tumor_mean: Math.round(tumor),
        normal_mean: Math.round(normal),
        log2fc: Math.round(lfc * 1000) / 1000,
        pvalue: Math.round(Math.random() * 0.5 * 10000) / 10000,
      }
    }),
  },
  {
    name: 'PK Time-Concentration Profile',
    description: 'Drug concentration sampled over 24h',
    source: 'manual',
    tags: ['pharmacokinetics'],
    columns: [
      { name: 'time_h', type: 'number', unit: 'hours' },
      { name: 'concentration_mg_L', type: 'number' },
      { name: 'subject', type: 'string' },
    ],
    rows: ['S1', 'S2', 'S3'].flatMap(s =>
      [0.5, 1, 2, 4, 6, 8, 12, 16, 24].map(t => ({
        time_h: t,
        concentration_mg_L: Math.round(10 * Math.exp(-0.15 * t) * (0.9 + Math.random() * 0.2) * 100) / 100,
        subject: s,
      }))
    ),
  },
]

/* ═══ Main Component ═══════════════════════════════════════════════════ */
export default function DataManager() {
  const { showError, showConfirm, AlertDialog } = useAlertDialog()
  // Deep-link support: `?id=…` preselects a dataset and `?view=…`
  // preselects a view-mode tab. Invalid values silently fall back to
  // the defaults; the query is cleaned off the URL after mount so a
  // soft reload doesn't stomp navigation.
  const [searchParams, setSearchParams] = useSearchParams()
  const qDatasetId = searchParams.get('id') || ''
  const qViewRaw = (searchParams.get('view') || '').trim().toLowerCase() as ViewMode
  const initialView: ViewMode = VALID_VIEW_MODES.has(qViewRaw) ? qViewRaw : 'overview'
  const [datasets, setDatasets] = useState<Dataset[]>(() => {
    const stored = loadDatasets()
    if (stored.length === 0) {
      // Seed with samples on first run
      const seeded = SAMPLE_DATASETS.map(s => ({
        ...s,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
      saveDatasets(seeded)
      return seeded
    }
    return stored
  })
  const [selectedId, setSelectedId] = useState<string | null>(qDatasetId || null)
  const [view, setView] = useState<ViewMode>(initialView)

  // Strip deep-link query params after the initial mount.
  useEffect(() => {
    if (searchParams.has('id') || searchParams.has('view')) {
      const next = new URLSearchParams(searchParams)
      next.delete('id')
      next.delete('view')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [ops, setOps] = useState<Op[]>([])
  const [previewRows, setPreviewRows] = useState(50)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => datasets.find(d => d.id === selectedId) || null, [datasets, selectedId])

  // Apply ETL ops to currently selected dataset
  const transformed = useMemo(() => {
    if (!selected) return null
    if (ops.length === 0) return selected
    return applyOps(selected, ops)
  }, [selected, ops])

  // Profile of transformed dataset
  const profiles = useMemo(() => {
    if (!transformed) return []
    return transformed.columns.map(c => profileColumn(c, transformed.rows))
  }, [transformed])

  // Persist on change
  useEffect(() => { saveDatasets(datasets) }, [datasets])

  const filteredDatasets = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return datasets
    return datasets.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      d.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [datasets, search])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string
        let parsed: { columns: Column[]; rows: Record<string, any>[] }
        if (file.name.endsWith('.json')) parsed = parseJSON(text)
        else if (file.name.endsWith('.tsv')) parsed = parseDelimited(text, '\t')
        else parsed = parseDelimited(text, ',')

        const ds: Dataset = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          description: `Uploaded from ${file.name}`,
          source: 'upload',
          columns: parsed.columns,
          rows: parsed.rows,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setDatasets(prev => [ds, ...prev])
        setSelectedId(ds.id)
        setView('table')
      } catch (err) {
        showError(`Failed to parse file: ${err}`, 'Import Error')
      }
    }
    reader.readAsText(file)
  }

  const createBlank = () => {
    if (!newName.trim()) return
    const ds: Dataset = {
      id: crypto.randomUUID(),
      name: newName,
      description: newDesc,
      source: 'manual',
      columns: [],
      rows: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setDatasets(prev => [ds, ...prev])
    setSelectedId(ds.id)
    setNewName('')
    setNewDesc('')
    setShowAddModal(false)
  }

  const deleteDataset = async (id: string) => {
    const ok = await showConfirm('Delete this dataset? This action cannot be undone.', 'Delete Dataset', 'Delete', 'Cancel')
    if (!ok) return
    setDatasets(prev => prev.filter(d => d.id !== id))
    if (selectedId === id) { setSelectedId(null); setView('overview') }
  }

  const exportCSV = () => {
    if (!transformed) return
    const headers = transformed.columns.map(c => c.name).join(',')
    const rows = transformed.rows.map(r =>
      transformed.columns.map(c => {
        const v = r[c.name]
        if (v == null) return ''
        const s = String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${transformed.name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJSON = () => {
    if (!transformed) return
    const blob = new Blob([JSON.stringify(transformed, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${transformed.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportXLSX = () => {
    if (!transformed) return
    const ws = XLSX.utils.json_to_sheet(transformed.rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data')
    XLSX.writeFile(wb, `${transformed.name}.xlsx`)
  }

  const saveTransformed = () => {
    if (!transformed || !selected || ops.length === 0) return
    const newDs: Dataset = {
      ...transformed,
      id: crypto.randomUUID(),
      name: `${selected.name} (transformed)`,
      source: 'derived',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setDatasets(prev => [newDs, ...prev])
    setOps([])
    setSelectedId(newDs.id)
  }

  const addOp = (op: Op) => setOps(prev => [...prev, op])
  const removeOp = (id: string) => setOps(prev => prev.filter(o => o.id !== id))

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      <AlertDialog />
      {/* ── Left: Dataset List ── */}
      <div className="w-64 flex flex-col border-r flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
        <div className="p-3 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <FiDatabase className="text-lg" style={{ color: 'var(--color-text)' }} />
            <h2 className="text-sm font-semibold">Datasets</h2>
            <button aria-label="Click"
              onClick={() => fileInputRef.current?.click()}
              className="ml-auto p-1.5 rounded hover:bg-white/5"
              style={{ border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
              title="Upload CSV/JSON/TSV"
            >
              <FiUpload className="text-xs" />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="p-1.5 rounded hover:bg-white/5"
              style={{ border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
              title="Create blank"
            >
              <FiPlus className="text-xs" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.json,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>

          <div className="relative">
            <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-60" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded outline-none"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredDatasets.length === 0 && (
            <div className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              No datasets
            </div>
          )}
          {filteredDatasets.map(d => {
            const active = selectedId === d.id
            return (
              <button
                key={d.id}
                onClick={() => { setSelectedId(d.id); setView('table'); setOps([]) }}
                className={clsx('w-full text-left p-2 rounded transition-all', active ? 'shadow' : 'hover:bg-white/5')}
                style={{
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${active ? 'var(--color-border-strong, rgba(255,255,255,0.2))' : 'var(--glass-border)'}`,
                }}
              >
                <div className="text-xs font-semibold truncate">{d.name}</div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {d.description || 'No description'}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                    {d.rows.length} rows
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                    {d.columns.length} cols
                  </span>
                  {d.source === 'derived' && <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: '#8b5cf622', color: '#8b5cf6' }}>derived</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Center: Main View ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* View tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
          {selected ? (
            <>
              <span className="text-xs font-semibold truncate max-w-[300px]">{selected.name}</span>
              {ops.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#8b5cf622', color: '#8b5cf6' }}>
                  {ops.length} transform{ops.length === 1 ? '' : 's'} active
                </span>
              )}
              <div className="flex gap-0.5 ml-3">
                {([
                  { id: 'overview', label: 'Overview', icon: FiDatabase },
                  { id: 'table', label: 'Table', icon: FiGrid },
                  { id: 'variables', label: 'Variables', icon: FiList },
                  { id: 'profile', label: 'Profile', icon: FiBarChart2 },
                  { id: 'etl', label: 'ETL', icon: FiSliders },
                ] as const).map(t => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.id}
                      onClick={() => setView(t.id)}
                      className={clsx('flex items-center gap-1 px-2 py-1 rounded text-xs', view === t.id ? 'shadow' : 'hover:bg-white/5')}
                      style={{
                        background: view === t.id ? 'rgba(255,255,255,0.12)' : 'transparent',
                        color: view === t.id ? 'var(--color-text)' : 'var(--color-text-muted)',
                      }}
                    >
                      <Icon className="text-xs" />
                      {t.label}
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {ops.length > 0 && (
                  <button
                    onClick={saveTransformed}
                    className="px-2 py-1 rounded text-xs"
                    style={{ background: '#8b5cf6', color: '#fff' }}
                    title="Save transformed dataset as new" aria-label="Save transformed dataset as new"
                  >
                    Save Result
                  </button>
                )}
                <button onClick={exportCSV} className="p-1.5 rounded hover:bg-white/5" title="Export CSV" aria-label="Export CSV">
                  <FiDownload className="text-xs" />
                </button>
                <button onClick={exportXLSX} className="p-1.5 rounded hover:bg-white/5" title="Export XLSX" aria-label="Export XLSX" style={{ color: 'var(--color-text)' }}>
                  <FiGrid className="text-xs" />
                </button>
                <button onClick={exportJSON} className="p-1.5 rounded hover:bg-white/5" title="Export JSON" aria-label="Export JSON">
                  <FiCopy className="text-xs" />
                </button>
                <button onClick={() => deleteDataset(selected.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: '#ef4444' }}>
                  <FiTrash2 className="text-xs" />
                </button>
              </div>
            </>
          ) : (
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Select a dataset, upload a file, or create one to begin
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {!selected || !transformed ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FiDatabase className="text-6xl mx-auto mb-4 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No dataset selected</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 px-4 py-2 rounded text-xs font-medium text-white"
                  style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--color-text)' }}
                >
                  <FiUpload className="inline mr-1.5" />
                  Upload CSV
                </button>
              </div>
            </div>
          ) : view === 'overview' ? (
            <OverviewView ds={transformed} profiles={profiles} setView={setView} />
          ) : view === 'table' ? (
            <TableView ds={transformed} previewRows={previewRows} setPreviewRows={setPreviewRows} />
          ) : view === 'variables' ? (
            <VariablesView ds={transformed} profiles={profiles} />
          ) : view === 'profile' ? (
            <ProfileView profiles={profiles} totalRows={transformed.rows.length} />
          ) : view === 'etl' ? (
            <EtlView ds={transformed} ops={ops} addOp={addOp} removeOp={removeOp} />
          ) : null}
        </div>
      </div>

      {/* ── Add Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAddModal(false)}>
          <div
            className="w-96 p-4 rounded-lg"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-3">Create blank dataset</h3>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Name"
              className="w-full px-3 py-2 mb-2 text-sm rounded outline-none"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
            />
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Description"
              rows={3}
              className="w-full px-3 py-2 mb-3 text-sm rounded outline-none resize-none"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAddModal(false)} className="px-3 py-1.5 text-xs rounded" style={{ border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}>Cancel</button>
              <button onClick={createBlank} className="px-3 py-1.5 text-xs rounded" style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--color-text)' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Sub-views ──────────────────────────────────────────────────────── */

function OverviewView({ ds, profiles, setView }: { ds: Dataset; profiles: ColumnProfile[]; setView: (v: ViewMode) => void }) {
  const numCols = ds.columns.filter(c => c.type === 'number')
  const numProfiles = profiles.filter(p => p.type === 'number')
  const totalNulls = profiles.reduce((sum, p) => sum + p.nullCount, 0)
  const totalCells = ds.rows.length * ds.columns.length
  const overallCompleteness = totalCells > 0 ? ((totalCells - totalNulls) / totalCells) * 100 : 100
  const memEstimate = JSON.stringify(ds.rows).length

  // Quick correlation between first two numeric columns
  const correlationPairs = useMemo(() => {
    if (numCols.length < 2) return []
    const pairs: { col1: string; col2: string; corr: number }[] = []
    for (let i = 0; i < Math.min(numCols.length, 5); i++) {
      for (let j = i + 1; j < Math.min(numCols.length, 5); j++) {
        const c1 = numCols[i].name, c2 = numCols[j].name
        const vs = ds.rows.filter(r => r[c1] != null && r[c2] != null)
        if (vs.length < 3) continue
        const x = vs.map(r => r[c1]), y = vs.map(r => r[c2])
        const mx = x.reduce((a, b) => a + b, 0) / x.length
        const my = y.reduce((a, b) => a + b, 0) / y.length
        const cov = x.reduce((s, xi, k) => s + (xi - mx) * (y[k] - my), 0) / x.length
        const sx = Math.sqrt(x.reduce((s, xi) => s + (xi - mx) ** 2, 0) / x.length)
        const sy = Math.sqrt(y.reduce((s, yi) => s + (yi - my) ** 2, 0) / y.length)
        const corr = sx * sy > 0 ? cov / (sx * sy) : 0
        pairs.push({ col1: c1, col2: c2, corr: Math.round(corr * 1000) / 1000 })
      }
    }
    return pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr)).slice(0, 6)
  }, [ds, numCols])

  return (
    <div className="p-4 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Rows', value: ds.rows.length.toLocaleString(), color: '#3b82f6' },
          { label: 'Columns', value: ds.columns.length.toString(), color: '#8b5cf6' },
          { label: 'Completeness', value: `${overallCompleteness.toFixed(1)}%`, color: overallCompleteness > 95 ? '#10b981' : overallCompleteness > 80 ? '#f59e0b' : '#ef4444' },
          { label: 'Memory', value: memEstimate > 1e6 ? `${(memEstimate / 1e6).toFixed(1)} MB` : `${(memEstimate / 1024).toFixed(1)} KB`, color: '#06b6d4' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-lg" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderLeft: `3px solid ${s.color}` }}>
            <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{s.label}</div>
            <div className="text-lg font-bold mt-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Column type breakdown */}
      <div className="p-3 rounded-lg" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Column Types</div>
        <div className="flex gap-4 text-xs">
          {[
            { type: 'number', color: '#3b82f6', count: ds.columns.filter(c => c.type === 'number').length },
            { type: 'string', color: '#8b5cf6', count: ds.columns.filter(c => c.type === 'string').length },
            { type: 'boolean', color: '#10b981', count: ds.columns.filter(c => c.type === 'boolean').length },
            { type: 'date', color: '#f59e0b', count: ds.columns.filter(c => c.type === 'date').length },
          ].filter(t => t.count > 0).map(t => (
            <div key={t.type} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ background: t.color }} />
              <span>{t.count} {t.type}</span>
            </div>
          ))}
        </div>
        {/* Column completeness bars */}
        <div className="mt-3 space-y-1">
          {profiles.slice(0, 10).map(p => (
            <div key={p.name} className="flex items-center gap-2 text-[10px]">
              <span className="w-28 truncate" style={{ color: 'var(--color-text-muted)' }}>{p.name}</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
                <div className="h-full rounded-full transition-all" style={{
                  width: `${p.completeness * 100}%`,
                  background: p.completeness > 0.95 ? '#10b981' : p.completeness > 0.8 ? '#f59e0b' : '#ef4444',
                  opacity: 0.7,
                }} />
              </div>
              <span className="w-10 text-right" style={{ fontFamily: 'monospace' }}>{(p.completeness * 100).toFixed(0)}%</span>
            </div>
          ))}
          {profiles.length > 10 && (
            <button onClick={() => setView('variables')} className="text-[10px] mt-1 underline" style={{ color: 'var(--color-text-muted)' }}>
              + {profiles.length - 10} more columns...
            </button>
          )}
        </div>
      </div>

      {/* Quick numeric stats */}
      {numProfiles.length > 0 && (
        <div className="p-3 rounded-lg" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Numeric Summary</div>
          <div className="overflow-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th className="text-left p-1.5">Column</th>
                  <th className="text-right p-1.5">Min</th>
                  <th className="text-right p-1.5">Mean</th>
                  <th className="text-right p-1.5">Median</th>
                  <th className="text-right p-1.5">Max</th>
                  <th className="text-right p-1.5">Std</th>
                </tr>
              </thead>
              <tbody>
                {numProfiles.slice(0, 8).map(p => (
                  <tr key={p.name} style={{ borderTop: '1px solid var(--glass-border)' }}>
                    <td className="p-1.5 font-medium">{p.name}</td>
                    <td className="p-1.5 text-right" style={{ fontFamily: 'monospace' }}>{p.min?.toFixed(2)}</td>
                    <td className="p-1.5 text-right" style={{ fontFamily: 'monospace' }}>{p.mean?.toFixed(2)}</td>
                    <td className="p-1.5 text-right" style={{ fontFamily: 'monospace' }}>{p.median?.toFixed(2)}</td>
                    <td className="p-1.5 text-right" style={{ fontFamily: 'monospace' }}>{p.max?.toFixed(2)}</td>
                    <td className="p-1.5 text-right" style={{ fontFamily: 'monospace' }}>{p.std?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Correlation highlights */}
      {correlationPairs.length > 0 && (
        <div className="p-3 rounded-lg" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Top Correlations</div>
          <div className="space-y-1">
            {correlationPairs.map((p, i) => {
              const absCorr = Math.abs(p.corr)
              const color = absCorr > 0.7 ? (p.corr > 0 ? '#10b981' : '#ef4444') : '#f59e0b'
              return (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="flex-1 truncate">{p.col1} — {p.col2}</span>
                  <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
                    <div className="h-full rounded-full" style={{ width: `${absCorr * 100}%`, background: color, opacity: 0.7 }} />
                  </div>
                  <span className="w-12 text-right font-mono" style={{ color }}>{p.corr > 0 ? '+' : ''}{p.corr.toFixed(3)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2">
        <button onClick={() => setView('table')} className="px-3 py-1.5 text-[10px] rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}>
          <FiGrid className="inline mr-1" /> View Table
        </button>
        <button onClick={() => setView('profile')} className="px-3 py-1.5 text-[10px] rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}>
          <FiBarChart2 className="inline mr-1" /> Full Profile
        </button>
        <button onClick={() => setView('etl')} className="px-3 py-1.5 text-[10px] rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}>
          <FiSliders className="inline mr-1" /> Transform
        </button>
      </div>
    </div>
  )
}

function TableView({ ds, previewRows, setPreviewRows }: { ds: Dataset; previewRows: number; setPreviewRows: (n: number) => void }) {
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  const handleSort = (col: string) => {
    if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortCol(col); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    let rows = ds.rows
    // Apply column filters
    const active = Object.entries(colFilters).filter(([, v]) => v.trim())
    if (active.length > 0) {
      rows = rows.filter(r => active.every(([col, filter]) => {
        const v = r[col]
        if (v == null) return false
        return String(v).toLowerCase().includes(filter.toLowerCase())
      }))
    }
    // Apply sort
    if (sortCol) {
      const col = ds.columns.find(c => c.name === sortCol)
      rows = [...rows].sort((a, b) => {
        const va = a[sortCol], vb = b[sortCol]
        if (va == null) return 1
        if (vb == null) return -1
        if (col?.type === 'number') return sortDir === 'asc' ? Number(va) - Number(vb) : Number(vb) - Number(va)
        return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      })
    }
    return rows
  }, [ds.rows, ds.columns, colFilters, sortCol, sortDir])

  const visible = filtered.slice(0, previewRows)
  const hasFilter = Object.values(colFilters).some(v => v.trim())
  const allSelected = selectedRows.size === visible.length && visible.length > 0

  return (
    <div className="p-3">
      <div className="flex items-center mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <span>Showing {visible.length} of {filtered.length}{hasFilter ? ` (filtered from ${ds.rows.length})` : ''} rows</span>
        <select
          value={previewRows}
          onChange={e => setPreviewRows(parseInt(e.target.value))}
          className="ml-3 px-2 py-1 rounded outline-none text-xs"
          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={5000}>All</option>
        </select>
        {selectedRows.size > 0 && (
          <span className="ml-3" style={{ color: 'var(--color-text)' }}>{selectedRows.size} selected</span>
        )}
        {hasFilter && (
          <button onClick={() => setColFilters({})} className="ml-3 px-2 py-0.5 rounded hover:bg-white/10 text-xxs" style={{ color: 'var(--color-text-muted)' }}>Clear filters</button>
        )}
      </div>
      <div className="overflow-auto rounded" style={{ border: '1px solid var(--glass-border)', maxHeight: 480 }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--glass-bg)', position: 'sticky', top: 0, zIndex: 1 }}>
            <tr>
              <th className="px-2 py-1.5 text-left text-[10px] w-8">
                <input type="checkbox" checked={allSelected} onChange={() => {
                  if (allSelected) setSelectedRows(new Set())
                  else setSelectedRows(new Set(visible.map((_, i) => i)))
                }} />
              </th>
              <th className="px-2 py-1.5 text-left text-[10px] uppercase font-semibold" style={{ color: 'var(--color-text-muted)' }}>#</th>
              {ds.columns.map(c => (
                <th key={c.name} className="px-2 py-1.5 text-left text-[10px] uppercase font-semibold cursor-pointer select-none hover:bg-white/5"
                  style={{ color: 'var(--color-text-muted)' }} onClick={() => handleSort(c.name)}>
                  <div className="flex items-center gap-1">
                    {c.name}
                    {sortCol === c.name && <span style={{ color: 'var(--color-text)', fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </div>
                  <div className="text-[8px] normal-case" style={{ color: c.type === 'number' ? '#3b82f6' : c.type === 'date' ? '#f59e0b' : c.type === 'boolean' ? '#10b981' : '#8b5cf6' }}>
                    {c.type}
                  </div>
                </th>
              ))}
            </tr>
            {/* Filter row */}
            <tr style={{ borderTop: '1px solid var(--glass-border)' }}>
              <td colSpan={2} className="px-2 py-1">
                <FiSearch className="text-[10px]" style={{ color: 'var(--color-text-muted)' }} />
              </td>
              {ds.columns.map(c => (
                <td key={c.name} className="px-1 py-1">
                  <input
                    className="w-full px-1 py-0.5 text-xxs rounded outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
                    placeholder="Filter..."
                    value={colFilters[c.name] || ''}
                    onChange={e => setColFilters(f => ({ ...f, [c.name]: e.target.value }))}
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--glass-border)', background: selectedRows.has(i) ? 'rgba(59,130,246,0.08)' : undefined }}>
                <td className="px-2 py-1">
                  <input type="checkbox" checked={selectedRows.has(i)} onChange={() => {
                    const next = new Set(selectedRows)
                    if (next.has(i)) next.delete(i); else next.add(i)
                    setSelectedRows(next)
                  }} />
                </td>
                <td className="px-2 py-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{i + 1}</td>
                {ds.columns.map(c => {
                  const v = row[c.name]
                  return (
                    <td key={c.name} className="px-2 py-1">
                      {v == null ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        : c.type === 'boolean' ? <span style={{ color: v ? '#22c55e' : '#ef4444' }}>{v ? 'true' : 'false'}</span>
                        : c.type === 'number' ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{typeof v === 'number' ? v.toLocaleString() : v}</span>
                        : String(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VariablesView({ ds, profiles }: { ds: Dataset; profiles: ColumnProfile[] }) {
  return (
    <div className="p-3 space-y-2">
      {ds.columns.length === 0 && (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No variables yet
        </div>
      )}
      {profiles.map(p => (
        <div key={p.name} className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <FiTag className="text-xs" style={{ color: p.type === 'number' ? '#3b82f6' : p.type === 'date' ? '#f59e0b' : p.type === 'boolean' ? '#10b981' : '#8b5cf6' }} />
            <span className="text-sm font-semibold">{p.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>{p.type}</span>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {(p.completeness * 100).toFixed(1)}% complete · {p.uniqueCount} unique
            </span>
          </div>
          {p.type === 'number' && p.mean !== undefined && (
            <div className="grid grid-cols-5 gap-2 text-xs">
              <div><span style={{ color: 'var(--color-text-muted)' }}>min</span><div>{p.min?.toFixed(2)}</div></div>
              <div><span style={{ color: 'var(--color-text-muted)' }}>max</span><div>{p.max?.toFixed(2)}</div></div>
              <div><span style={{ color: 'var(--color-text-muted)' }}>mean</span><div>{p.mean.toFixed(2)}</div></div>
              <div><span style={{ color: 'var(--color-text-muted)' }}>median</span><div>{p.median?.toFixed(2)}</div></div>
              <div><span style={{ color: 'var(--color-text-muted)' }}>std</span><div>{p.std?.toFixed(2)}</div></div>
            </div>
          )}
          {p.topValues && p.topValues.length > 0 && (
            <div className="text-xs mt-1">
              <span style={{ color: 'var(--color-text-muted)' }}>top values: </span>
              {p.topValues.slice(0, 5).map((v, i) => (
                <span key={i} className="mr-2">
                  <span style={{ color: 'var(--color-text)' }}>{v.value}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}> ({v.count})</span>
                </span>
              ))}
            </div>
          )}
          {p.nullCount > 0 && (
            <div className="text-[10px] mt-1" style={{ color: '#ef4444' }}>{p.nullCount} missing values</div>
          )}
        </div>
      ))}
    </div>
  )
}

function ProfileView({ profiles, totalRows }: { profiles: ColumnProfile[]; totalRows: number }) {
  const overall = profiles.length === 0 ? 0 : profiles.reduce((s, p) => s + p.completeness, 0) / profiles.length
  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <div className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--color-text-muted)' }}>Rows</div>
          <div className="text-xl font-semibold">{totalRows}</div>
        </div>
        <div className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--color-text-muted)' }}>Variables</div>
          <div className="text-xl font-semibold">{profiles.length}</div>
        </div>
        <div className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--color-text-muted)' }}>Completeness</div>
          <div className="text-xl font-semibold">{(overall * 100).toFixed(1)}%</div>
        </div>
        <div className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-[10px] uppercase font-semibold" style={{ color: 'var(--color-text-muted)' }}>Numeric vars</div>
          <div className="text-xl font-semibold">{profiles.filter(p => p.type === 'number').length}</div>
        </div>
      </div>
      {profiles.filter(p => p.type === 'number' && p.histogram).map(p => (
        <div key={p.name} className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
          <div className="text-xs font-semibold mb-1">{p.name}</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={p.histogram}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
              <XAxis dataKey="bin" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', fontSize: 11 }} />
              <Bar dataKey="count" fill="var(--color-text)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  )
}

function EtlView({ ds, ops, addOp, removeOp }: { ds: Dataset; ops: Op[]; addOp: (op: Op) => void; removeOp: (id: string) => void }) {
  const [opType, setOpType] = useState<Op['type']>('filter')
  const [config, setConfig] = useState<any>({})

  const submit = () => {
    addOp({ id: crypto.randomUUID(), type: opType, config: { ...config } })
    setConfig({})
  }

  return (
    <div className="p-3 grid grid-cols-2 gap-3">
      <div className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <FiPlus className="text-xs" /> Add operation
        </div>
        <select
          value={opType}
          onChange={e => { setOpType(e.target.value as Op['type']); setConfig({}) }}
          className="w-full mb-2 px-2 py-1.5 text-xs rounded outline-none"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
        >
          <option value="filter">Filter rows</option>
          <option value="sort">Sort</option>
          <option value="select">Select columns</option>
          <option value="drop_nulls">Drop nulls</option>
          <option value="derive">Derive column (expression)</option>
          <option value="rename">Rename column</option>
        </select>

        {opType === 'filter' && (
          <div className="space-y-1.5">
            <select value={config.column || ''} onChange={e => setConfig({ ...config, column: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
              <option value="">Column…</option>
              {ds.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select value={config.operator || '='} onChange={e => setConfig({ ...config, operator: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
              <option value="=">=</option>
              <option value="!=">!=</option>
              <option value=">">{`>`}</option>
              <option value="<">{`<`}</option>
              <option value=">=">{`>=`}</option>
              <option value="<=">{`<=`}</option>
              <option value="contains">contains</option>
            </select>
            <input value={config.value || ''} onChange={e => setConfig({ ...config, value: e.target.value })} placeholder="Value" className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }} />
          </div>
        )}
        {opType === 'sort' && (
          <div className="space-y-1.5">
            <select value={config.column || ''} onChange={e => setConfig({ ...config, column: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
              <option value="">Column…</option>
              {ds.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select value={config.direction || 'asc'} onChange={e => setConfig({ ...config, direction: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        )}
        {opType === 'select' && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {ds.columns.map(c => (
              <label key={c.name} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={(config.columns || []).includes(c.name)}
                  onChange={e => {
                    const cur: string[] = config.columns || []
                    setConfig({ ...config, columns: e.target.checked ? [...cur, c.name] : cur.filter(x => x !== c.name) })
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        )}
        {opType === 'drop_nulls' && (
          <select value={config.column || ''} onChange={e => setConfig({ ...config, column: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
            <option value="">Column…</option>
            {ds.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        {opType === 'derive' && (
          <div className="space-y-1.5">
            <input value={config.name || ''} onChange={e => setConfig({ ...config, name: e.target.value })} placeholder="New column name" className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }} />
            <input value={config.expression || ''} onChange={e => setConfig({ ...config, expression: e.target.value })} placeholder="JS expression e.g. age*2 + bmi" className="w-full px-2 py-1.5 text-xs rounded outline-none font-mono" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }} />
            <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              Available: {ds.columns.map(c => c.name).join(', ')}
            </div>
          </div>
        )}
        {opType === 'rename' && (
          <div className="space-y-1.5">
            <select value={config.from || ''} onChange={e => setConfig({ ...config, from: e.target.value })} className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
              <option value="">From…</option>
              {ds.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <input value={config.to || ''} onChange={e => setConfig({ ...config, to: e.target.value })} placeholder="To" className="w-full px-2 py-1.5 text-xs rounded outline-none" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }} />
          </div>
        )}

        <button onClick={submit} className="w-full mt-3 px-3 py-1.5 rounded text-xs" style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--color-text)' }}>
          <FiPlay className="inline mr-1.5 text-xs" />
          Add to pipeline
        </button>
      </div>

      <div className="p-3 rounded" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <FiSliders className="text-xs" /> Pipeline ({ops.length})
        </div>
        {ops.length === 0 && (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            No operations yet
          </div>
        )}
        <div className="space-y-1">
          {ops.map((op, i) => (
            <div key={op.id} className="flex items-center gap-2 p-2 rounded text-xs" style={{ background: 'var(--color-bg)', border: '1px solid var(--glass-border)' }}>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--color-text)' }}>{i + 1}</span>
              <span className="font-semibold">{op.type}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{JSON.stringify(op.config).slice(0, 60)}</span>
              <button onClick={() => removeOp(op.id)} className="ml-auto p-1 hover:text-red-500"><FiX className="text-xs" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  FiUpload, FiGrid, FiSettings, FiDatabase, FiPlay, FiCpu,
  FiChevronDown, FiChevronRight, FiCopy, FiDownload,
  FiFile, FiAlertCircle, FiCheck, FiLoader
} from 'react-icons/fi'

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || ''
const API = `${API_BASE}/api/v1/compute-engine`

// ── Types ─────────────────────────────────────────────────────────

interface ParamDef {
  name: string; label: string; type: string; required?: boolean
  default?: any; description?: string; min?: number; max?: number
  step?: number; options?: { value: string; label: string }[]
  group?: string; accept?: string; placeholder?: string
  depends_on?: string
}

interface OpSchema {
  title: string; description: string; params: ParamDef[]
  outputs?: string[]
}

interface ParsedFile {
  format: string; filename: string; file_size_bytes: number
  data: any; metadata: any; preview: any; columns: any[]; shape: number[]
}

interface ComputeResult {
  request_id: string; domain: string; operation: string; status: string
  results: Record<string, any>; statistics: any[]; descriptive: Record<string, any>
  figures: { title: string; format: string; data_base64?: string; plotly_json?: any }[]
  warnings: string[]; error?: string; runtime_seconds: number
}

type InputMode = 'form' | 'matrix' | 'file' | 'dataset' | 'code'

// ── Helpers ───────────────────────────────────────────────────────

function parseNumArray(s: string): number[] {
  return s.split(/[,\s]+/).map(Number).filter(n => !isNaN(n))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Main Component ────────────────────────────────────────────────

export default function NumericCompute() {
  // Domain & operation selection
  const [domains, setDomains] = useState<{ domain: string; operations: string[]; description: string }[]>([])
  const [schemas, setSchemas] = useState<Record<string, OpSchema>>({})
  const [selectedDomain, setSelectedDomain] = useState('')
  const [selectedOp, setSelectedOp] = useState('')

  // Input state
  const [inputMode, setInputMode] = useState<InputMode>('form')
  const [paramValues, setParamValues] = useState<Record<string, any>>({})
  const [matrixData, setMatrixData] = useState<string[][]>([['', '', ''], ['', '', ''], ['', '', '']])
  const [matrixTarget, setMatrixTarget] = useState('')  // which param to fill
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null)
  const [datasets, setDatasets] = useState<any[]>([])
  const [selectedDataset, setSelectedDataset] = useState<any>(null)

  // Execution state
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ComputeResult | null>(null)
  const [error, setError] = useState('')

  // UI state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['General']))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // ── Load domains and schemas on mount ──
  useEffect(() => {
    fetch(`${API}/domains`).then(r => r.json()).then(setDomains).catch(() => {})
    fetch(`${API}/schemas`).then(r => r.json()).then(setSchemas).catch(() => {})
    fetch(`${API_BASE}/api/v1/datasets`).then(r => r.json())
      .then(d => setDatasets(Array.isArray(d) ? d : d.items || []))
      .catch(() => {})
  }, [])

  // Current schema
  const schemaKey = `${selectedDomain}/${selectedOp}`
  const currentSchema = schemas[schemaKey] || null

  // Initialize defaults when operation changes
  useEffect(() => {
    if (currentSchema) {
      const defaults: Record<string, any> = {}
      currentSchema.params.forEach(p => {
        if (p.default !== undefined) defaults[p.name] = p.default
      })
      setParamValues(defaults)
      setResult(null)
      setError('')
    }
  }, [schemaKey])

  // Group params by section
  const paramGroups = useMemo(() => {
    if (!currentSchema) return {}
    const groups: Record<string, ParamDef[]> = {}
    currentSchema.params.forEach(p => {
      const g = p.group || 'General'
      if (!groups[g]) groups[g] = []
      // Check depends_on
      if (p.depends_on) {
        const [dep, val] = p.depends_on.split(':')
        if (paramValues[dep] !== val) return
      }
      groups[g].push(p)
    })
    return groups
  }, [currentSchema, paramValues])

  // ── File upload handler ──
  const handleFileUpload = useCallback(async (file: File) => {
    setError('')
    setParsedFile(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Upload failed')
      }
      const parsed = await res.json()
      setParsedFile(parsed)
      setShowFilePreview(true)
      // Auto-populate parameters from parsed data
      if (parsed.data) {
        setParamValues(prev => ({ ...prev, _parsed_data: parsed.data, _file_metadata: parsed.metadata }))
      }
    } catch (e: any) {
      setError(`File parse error: ${e.message}`)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }, [handleFileUpload])

  // ── Execute computation ──
  const executeCompute = useCallback(async () => {
    if (!selectedDomain || !selectedOp) return
    setRunning(true); setError(''); setResult(null)

    // Build parameters - convert array strings to actual arrays
    const params: Record<string, any> = { ...paramValues }
    if (currentSchema) {
      currentSchema.params.forEach(p => {
        const val = params[p.name]
        if (val === undefined || val === '') { delete params[p.name]; return }
        if (p.type === 'array' && typeof val === 'string') {
          params[p.name] = parseNumArray(val)
        }
        if (p.type === 'matrix' && typeof val === 'string') {
          try { params[p.name] = JSON.parse(val) } catch { /* keep as-is */ }
        }
        if (p.type === 'json' && typeof val === 'string') {
          try { params[p.name] = JSON.parse(val) } catch { /* keep as-is */ }
        }
        if (p.type === 'range' && typeof val === 'string') {
          params[p.name] = parseNumArray(val)
        }
      })
    }

    // Inject matrix editor data
    if (matrixTarget && matrixData.length > 0) {
      const numMatrix = matrixData.map(row => row.map(v => parseFloat(v) || 0))
      params[matrixTarget] = numMatrix
    }

    // Inject dataset data
    if (selectedDataset?.data) {
      params._dataset = selectedDataset.data
    }

    try {
      const res = await fetch(`${API}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: selectedDomain, operation: selectedOp, parameters: params }),
      })
      const data = await res.json()
      if (data.status === 'failed') {
        setError(data.error || 'Computation failed')
      } else {
        setResult(data)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }, [selectedDomain, selectedOp, paramValues, currentSchema, matrixData, matrixTarget, selectedDataset])

  // ── Domain label formatting ──
  const domainLabel = (d: string) => d.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  // ── Render ──
  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            <FiCpu className="inline mr-2" />Numeric Compute Engine
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            MATLAB-equivalent biomedical computation — {domains.reduce((s, d) => s + d.operations.length, 0)} operations across {domains.length} domains
          </p>
        </div>
        <div className="flex gap-2">
          {parsedFile && (
            <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--glass-bg)', color: 'var(--color-accent-green)' }}>
              <FiFile className="inline mr-1" />{parsedFile.filename} ({formatBytes(parsedFile.file_size_bytes)})
            </span>
          )}
        </div>
      </div>

      {/* Domain & Operation Selection */}
      <div className="flex gap-3">
        <select
          className="input flex-1"
          value={selectedDomain}
          onChange={e => { setSelectedDomain(e.target.value); setSelectedOp('') }}
        >
          <option value="">Select Domain...</option>
          {domains.map(d => (
            <option key={d.domain} value={d.domain}>{domainLabel(d.domain)} ({d.operations.length} ops)</option>
          ))}
        </select>
        <select
          className="input flex-1"
          value={selectedOp}
          onChange={e => setSelectedOp(e.target.value)}
          disabled={!selectedDomain}
        >
          <option value="">Select Operation...</option>
          {domains.find(d => d.domain === selectedDomain)?.operations.map(op => {
            const sk = `${selectedDomain}/${op}`
            const title = schemas[sk]?.title || op.replace(/_/g, ' ')
            return <option key={op} value={op}>{title}</option>
          })}
        </select>
      </div>

      {/* Operation description */}
      {currentSchema && (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-secondary)' }}>
          {currentSchema.description}
        </div>
      )}

      {/* Main content: Input panels + Results */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Input Panels */}
        <div className="flex flex-col w-1/2 min-h-0">
          {/* Input mode tabs */}
          <div className="flex gap-1 mb-3">
            {([
              { mode: 'form' as InputMode, icon: FiSettings, label: 'Config Form' },
              { mode: 'matrix' as InputMode, icon: FiGrid, label: 'Matrix Editor' },
              { mode: 'file' as InputMode, icon: FiUpload, label: 'File Upload' },
              { mode: 'dataset' as InputMode, icon: FiDatabase, label: 'Datasets' },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                className={`btn text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg ${inputMode === mode ? 'ring-1' : ''}`}
                style={inputMode === mode ? { color: 'var(--color-accent-blue)', borderColor: 'var(--color-accent-blue)' } : {}}
                onClick={() => setInputMode(mode)}
              >
                <Icon size={12} />{label}
              </button>
            ))}
          </div>

          {/* Input panel content */}
          <div className="glass-card flex-1 overflow-y-auto p-4" style={{ minHeight: 0 }}>
            {/* ── Config Form Panel ── */}
            {inputMode === 'form' && currentSchema && (
              <div className="space-y-3">
                {Object.entries(paramGroups).map(([group, params]) => (
                  <div key={group}>
                    <button
                      className="flex items-center gap-1 text-xs font-medium mb-2 w-full text-left"
                      style={{ color: 'var(--color-text-secondary)' }}
                      onClick={() => {
                        const next = new Set(expandedGroups)
                        next.has(group) ? next.delete(group) : next.add(group)
                        setExpandedGroups(next)
                      }}
                    >
                      {expandedGroups.has(group) ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                      {group}
                    </button>
                    {expandedGroups.has(group) && (
                      <div className="space-y-2 pl-4">
                        {params.map(p => (
                          <div key={p.name}>
                            <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                              {p.label} {p.required && <span style={{ color: 'var(--color-error)' }}>*</span>}
                            </label>
                            {p.type === 'boolean' ? (
                              <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!paramValues[p.name]}
                                  onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.checked }))}
                                  className="rounded"
                                />
                                <span style={{ color: 'var(--color-text-muted)' }}>{p.description}</span>
                              </label>
                            ) : p.type === 'select' ? (
                              <select
                                className="input w-full text-xs"
                                value={paramValues[p.name] ?? p.default ?? ''}
                                onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                              >
                                {p.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            ) : p.type === 'number' || p.type === 'integer' ? (
                              <input
                                type="number"
                                className="input w-full text-xs"
                                value={paramValues[p.name] ?? ''}
                                min={p.min} max={p.max} step={p.step || (p.type === 'integer' ? 1 : 0.01)}
                                placeholder={p.placeholder}
                                onChange={e => setParamValues(prev => ({ ...prev, [p.name]: p.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value) }))}
                              />
                            ) : p.type === 'array' || p.type === 'range' ? (
                              <input
                                type="text"
                                className="input w-full text-xs"
                                value={paramValues[p.name] ?? ''}
                                placeholder={p.placeholder || 'Comma-separated values'}
                                onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                              />
                            ) : p.type === 'matrix' || p.type === 'json' ? (
                              <textarea
                                className="input w-full text-xs font-mono"
                                rows={3}
                                value={typeof paramValues[p.name] === 'string' ? paramValues[p.name] : JSON.stringify(paramValues[p.name] || '', null, 2)}
                                placeholder={p.placeholder || (p.type === 'matrix' ? '[[1,2],[3,4]]' : '{"key": "value"}')}
                                onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                              />
                            ) : (
                              <input
                                type="text"
                                className="input w-full text-xs"
                                value={paramValues[p.name] ?? ''}
                                placeholder={p.placeholder}
                                onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                              />
                            )}
                            {p.description && p.type !== 'boolean' && (
                              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{p.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!currentSchema && (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Select a domain and operation to configure parameters</p>
                )}
              </div>
            )}

            {inputMode === 'form' && !currentSchema && selectedOp && (
              <div className="text-xs space-y-2" style={{ color: 'var(--color-text-muted)' }}>
                <p>No schema available for this operation. Enter parameters as JSON:</p>
                <textarea
                  className="input w-full text-xs font-mono"
                  rows={10}
                  value={JSON.stringify(paramValues, null, 2)}
                  onChange={e => { try { setParamValues(JSON.parse(e.target.value)) } catch {} }}
                  placeholder='{"key": "value"}'
                />
              </div>
            )}

            {inputMode === 'form' && !selectedOp && (
              <p className="text-xs text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
                Select a domain and operation above to see configuration options
              </p>
            )}

            {/* ── Matrix Editor Panel ── */}
            {inputMode === 'matrix' && (
              <div className="space-y-3">
                <div className="flex gap-2 items-center">
                  <select
                    className="input text-xs flex-1"
                    value={matrixTarget}
                    onChange={e => setMatrixTarget(e.target.value)}
                  >
                    <option value="">Target parameter...</option>
                    {currentSchema?.params.filter(p => ['array', 'matrix'].includes(p.type)).map(p => (
                      <option key={p.name} value={p.name}>{p.label}</option>
                    ))}
                    <option value="group1">Group 1</option>
                    <option value="group2">Group 2</option>
                    <option value="data">Data</option>
                  </select>
                  <button className="btn text-xs" onClick={() => {
                    setMatrixData(prev => [...prev, Array(prev[0]?.length || 3).fill('')])
                  }}>+ Row</button>
                  <button className="btn text-xs" onClick={() => {
                    setMatrixData(prev => prev.map(row => [...row, '']))
                  }}>+ Col</button>
                  <button className="btn text-xs" style={{ color: 'var(--color-error)' }} onClick={() => {
                    setMatrixData([['', '', ''], ['', '', ''], ['', '', '']])
                  }}>Clear</button>
                </div>
                <div className="overflow-auto max-h-[400px]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="p-1 text-left" style={{ color: 'var(--color-text-muted)' }}>#</th>
                        {matrixData[0]?.map((_, ci) => (
                          <th key={ci} className="p-1 text-center" style={{ color: 'var(--color-text-muted)' }}>C{ci + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrixData.map((row, ri) => (
                        <tr key={ri}>
                          <td className="p-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{ri + 1}</td>
                          {row.map((val, ci) => (
                            <td key={ci} className="p-0.5">
                              <input
                                className="input w-full text-xs text-center px-1 py-0.5"
                                value={val}
                                onChange={e => {
                                  const next = matrixData.map(r => [...r])
                                  next[ri][ci] = e.target.value
                                  setMatrixData(next)
                                }}
                                onPaste={e => {
                                  // Handle paste from Excel/spreadsheet
                                  const text = e.clipboardData.getData('text')
                                  if (text.includes('\t') || text.includes('\n')) {
                                    e.preventDefault()
                                    const rows = text.trim().split('\n').map(r => r.split('\t'))
                                    const newMatrix = [...matrixData.map(r => [...r])]
                                    rows.forEach((row, dr) => {
                                      row.forEach((val, dc) => {
                                        const tr = ri + dr, tc = ci + dc
                                        while (newMatrix.length <= tr) newMatrix.push(Array(newMatrix[0].length).fill(''))
                                        while (newMatrix[0].length <= tc) newMatrix.forEach(r => r.push(''))
                                        newMatrix[tr][tc] = val
                                      })
                                    })
                                    setMatrixData(newMatrix)
                                  }
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  Paste from Excel/Sheets supported. Data will be assigned to the selected target parameter.
                </p>
              </div>
            )}

            {/* ── File Upload Panel ── */}
            {inputMode === 'file' && (
              <div className="space-y-3">
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${dragOver ? 'border-blue-500 bg-blue-500/5' : ''}`}
                  style={{ borderColor: dragOver ? 'var(--color-accent-blue)' : 'var(--glass-border)' }}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FiUpload className="mx-auto mb-2" size={24} style={{ color: 'var(--color-text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    Drop file here or click to browse
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    CSV, Excel, JSON, XML, Parquet, HDF5, MAT, NetCDF, NPY/NPZ, EDF/BDF, WAV, DICOM, NIfTI, TIFF, PNG, FASTA, FASTQ, VCF, C3D, TRC
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".csv,.tsv,.xlsx,.xls,.json,.xml,.parquet,.h5,.hdf5,.mat,.nc,.npy,.npz,.edf,.bdf,.wav,.dcm,.nii,.tif,.tiff,.png,.jpg,.jpeg,.bmp,.fa,.fasta,.fq,.fastq,.vcf,.c3d,.trc"
                  onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]) }}
                />

                {/* File preview */}
                {parsedFile && (
                  <div className="glass-card p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                        <FiFile className="inline mr-1" />{parsedFile.filename}
                      </span>
                      <div className="flex gap-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        <span>{parsedFile.format.toUpperCase()}</span>
                        <span>{formatBytes(parsedFile.file_size_bytes)}</span>
                        {parsedFile.shape.length > 0 && <span>Shape: [{parsedFile.shape.join(' x ')}]</span>}
                      </div>
                    </div>

                    {/* Column info */}
                    {parsedFile.columns.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                              <th className="text-left p-1">Column</th>
                              <th className="text-left p-1">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedFile.columns.slice(0, 15).map((col: any, i: number) => (
                              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td className="p-1" style={{ color: 'var(--color-text)' }}>{col.name}</td>
                                <td className="p-1" style={{ color: 'var(--color-text-muted)' }}>{col.type}{col.unit ? ` (${col.unit})` : ''}</td>
                              </tr>
                            ))}
                            {parsedFile.columns.length > 15 && (
                              <tr><td colSpan={2} className="p-1 text-center" style={{ color: 'var(--color-text-muted)' }}>... +{parsedFile.columns.length - 15} more</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Metadata */}
                    {parsedFile.metadata && Object.keys(parsedFile.metadata).length > 0 && (
                      <details className="text-[10px]">
                        <summary className="cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>Metadata</summary>
                        <pre className="mt-1 p-2 rounded-lg overflow-auto max-h-32 text-[9px]" style={{ background: 'var(--glass-bg)', color: 'var(--color-text-muted)' }}>
                          {JSON.stringify(parsedFile.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Dataset Connector Panel ── */}
            {inputMode === 'dataset' && (
              <div className="space-y-3">
                {datasets.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                    No datasets found. Upload data in the <a href="/data-manager" className="underline">Data Manager</a> first.
                  </p>
                ) : (
                  <>
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Select a dataset to use as input:</p>
                    {datasets.map((ds: any) => (
                      <button
                        key={ds.id}
                        className={`glass-card w-full p-3 text-left text-xs transition-all ${selectedDataset?.id === ds.id ? 'ring-1' : ''}`}
                        style={selectedDataset?.id === ds.id ? { borderColor: 'var(--color-accent-blue)' } : {}}
                        onClick={async () => {
                          try {
                            const res = await fetch(`${API_BASE}/api/v1/datasets/${ds.id}`)
                            const full = await res.json()
                            setSelectedDataset(full)
                            // Map dataset columns to parameters
                            if (full.columns && currentSchema) {
                              const mapped: Record<string, any> = { ...paramValues }
                              full.columns.forEach((col: any) => {
                                const matching = currentSchema.params.find(p =>
                                  p.name.toLowerCase() === col.name.toLowerCase() ||
                                  p.label.toLowerCase().includes(col.name.toLowerCase())
                                )
                                if (matching && full.rows) {
                                  mapped[matching.name] = full.rows.map((r: any) => r[col.name]).filter((v: any) => v != null)
                                }
                              })
                              setParamValues(mapped)
                            }
                          } catch {}
                        }}
                      >
                        <div className="flex justify-between items-center">
                          <span style={{ color: 'var(--color-text)' }}><FiDatabase className="inline mr-1" />{ds.name}</span>
                          <span style={{ color: 'var(--color-text-muted)' }}>{ds.row_count || '?'} rows</span>
                        </div>
                        {ds.description && <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{ds.description}</p>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Execute button */}
          <button
            className="btn mt-3 py-2 w-full flex items-center justify-center gap-2 rounded-xl"
            style={{
              background: running ? 'var(--glass-bg)' : 'var(--color-accent-blue)',
              color: running ? 'var(--color-text-muted)' : '#fff',
            }}
            onClick={executeCompute}
            disabled={running || !selectedDomain || !selectedOp}
          >
            {running ? <FiLoader className="animate-spin" /> : <FiPlay />}
            {running ? 'Computing...' : 'Execute'}
          </button>
        </div>

        {/* Right: Results Panel */}
        <div className="flex flex-col w-1/2 min-h-0 glass-card rounded-2xl p-4 overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl mb-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              <FiAlertCircle className="mt-0.5 flex-shrink-0" />
              <div className="text-xs">{error}</div>
            </div>
          )}

          {!result && !running && !error && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
                <FiCpu size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a domain &amp; operation, configure parameters, then click Execute.</p>
                <p className="text-xs mt-2">Results will appear here.</p>
              </div>
            </div>
          )}

          {running && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--color-text-muted)' }}>
                <FiLoader size={32} className="mx-auto mb-3 animate-spin" style={{ color: 'var(--color-accent-blue)' }} />
                <p className="text-sm">Computing...</p>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              {/* Status bar */}
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1" style={{ color: result.status === 'success' ? 'var(--color-accent-green)' : '#ef4444' }}>
                  {result.status === 'success' ? <FiCheck /> : <FiAlertCircle />}
                  {result.status === 'success' ? 'Completed' : 'Failed'}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {result.runtime_seconds?.toFixed(3)}s · {result.domain}/{result.operation}
                </span>
              </div>

              {/* Warnings */}
              {result.warnings?.length > 0 && (
                <div className="space-y-1">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                      <FiAlertCircle className="mt-0.5 flex-shrink-0" size={12} />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Figures */}
              {result.figures?.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Figures</h3>
                  {result.figures.map((fig, i) => (
                    <div key={i} className="glass-card rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{fig.title}</span>
                        {fig.data_base64 && (
                          <button
                            className="text-[10px] flex items-center gap-1 opacity-60 hover:opacity-100"
                            style={{ color: 'var(--color-text-muted)' }}
                            onClick={() => {
                              const a = document.createElement('a')
                              a.href = `data:image/${fig.format};base64,${fig.data_base64}`
                              a.download = `${fig.title.replace(/\s+/g, '_')}.${fig.format === 'svg' ? 'svg' : 'png'}`
                              a.click()
                            }}
                          >
                            <FiDownload size={10} /> Save
                          </button>
                        )}
                      </div>
                      {fig.data_base64 && (
                        <img
                          src={`data:image/${fig.format === 'svg' ? 'svg+xml' : 'png'};base64,${fig.data_base64}`}
                          alt={fig.title}
                          className="w-full rounded-lg"
                          style={{ background: '#fff' }}
                        />
                      )}
                      {fig.plotly_json && (
                        <div className="text-xs p-2 rounded-lg overflow-auto max-h-48" style={{ background: 'var(--glass-bg)' }}>
                          <pre style={{ color: 'var(--color-text-muted)' }}>{JSON.stringify(fig.plotly_json, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Descriptive statistics */}
              {result.descriptive && Object.keys(result.descriptive).length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Descriptive Statistics</h3>
                  <div className="glass-card rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody>
                        {Object.entries(result.descriptive).map(([k, v]) => (
                          <tr key={k} className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                            <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--color-text-secondary)' }}>{k}</td>
                            <td className="px-3 py-1.5 text-right" style={{ color: 'var(--color-text)' }}>
                              {typeof v === 'number' ? v.toFixed(6) : String(v)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Statistics table */}
              {result.statistics?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Statistical Tests</h3>
                  <div className="glass-card rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: 'var(--glass-bg)' }}>
                          {Object.keys(result.statistics[0]).map(k => (
                            <th key={k} className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-text-secondary)' }}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.statistics.map((row, i) => (
                          <tr key={i} className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                            {Object.values(row).map((v: any, j) => (
                              <td key={j} className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>
                                {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(6)) : String(v ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Results data */}
              {result.results && Object.keys(result.results).length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Results</h3>
                    <button
                      className="text-[10px] flex items-center gap-1 opacity-60 hover:opacity-100"
                      style={{ color: 'var(--color-text-muted)' }}
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(result.results, null, 2))
                      }}
                    >
                      <FiCopy size={10} /> Copy JSON
                    </button>
                  </div>
                  <pre
                    className="glass-card rounded-xl p-3 text-[10px] overflow-auto max-h-64"
                    style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {JSON.stringify(result.results, null, 2)}
                  </pre>
                </div>
              )}

              {/* Export actions */}
              <div className="flex gap-2 pt-2">
                <button
                  className="btn text-xs px-3 py-1.5 flex items-center gap-1 rounded-lg"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = `${result.domain}_${result.operation}_${result.request_id}.json`
                    a.click()
                    URL.revokeObjectURL(a.href)
                  }}
                >
                  <FiDownload size={12} /> Export JSON
                </button>
                <button
                  className="btn text-xs px-3 py-1.5 flex items-center gap-1 rounded-lg"
                  onClick={() => {
                    // Export as CSV if results contain tabular data
                    const data = result.statistics?.length ? result.statistics : result.descriptive ? [result.descriptive] : []
                    if (data.length === 0) return
                    const keys = Object.keys(data[0])
                    const csv = [keys.join(','), ...data.map((r: any) => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
                    const blob = new Blob([csv], { type: 'text/csv' })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = `${result.domain}_${result.operation}.csv`
                    a.click()
                    URL.revokeObjectURL(a.href)
                  }}
                >
                  <FiDownload size={12} /> Export CSV
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

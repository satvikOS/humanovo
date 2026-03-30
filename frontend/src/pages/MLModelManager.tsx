import { useState, useEffect } from 'react'
import { FiCpu, FiPlus, FiTrash2, FiPlay } from 'react-icons/fi'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { logActivity } from '../utils/persistence'

interface MLModel {
  id: string; name: string; model_type: string; status: string; description: string; version: string
  framework: string; hyperparameters: Record<string, any>; features: string[]; target: string
  metrics: Record<string, number | null>; training_history: any[]; feature_importance: any[]
  created_at: string; updated_at: string
}

const API = '/api/v1/ml-models'
const STATUS_COLORS: Record<string, string> = { draft: 'var(--color-text-muted)', training: 'var(--color-accent-blue)', validated: 'var(--color-accent-purple)', deployed: 'var(--color-success)', retired: 'var(--color-error)' }

export default function MLModelManager() {
  const [models, setModels] = useState<MLModel[]>([])
  const [selected, setSelected] = useState<MLModel | null>(null)
  const [metrics, setMetrics] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', model_type: 'classification', description: '', framework: 'scikit-learn' })
  const [predInput, setPredInput] = useState('')
  const [prediction, setPrediction] = useState<any>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const load = async () => { try { const r = await fetch(API); if (r.ok) setModels((await r.json()).items || []) } catch {} }
  useEffect(() => { load() }, [])

  const selectModel = async (m: MLModel) => {
    setSelected(m); setPrediction(null)
    const r = await fetch(`${API}/${m.id}/metrics`)
    if (r.ok) setMetrics(await r.json())
  }

  const createModel = async () => {
    if (!form.name.trim()) return
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (r.ok) { load(); setShowAdd(false); logActivity({ type: 'discovery', action: 'created', title: `Created ML model: ${form.name}` }); setForm({ name: '', model_type: 'classification', description: '', framework: 'scikit-learn' }) }
  }

  const deleteModel = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    const deletedModel = models.find(m => m.id === deleteConfirmId)
    await fetch(`${API}/${deleteConfirmId}`, { method: 'DELETE' })
    if (selected?.id === deleteConfirmId) { setSelected(null); setMetrics(null) }; load()
    setDeleteConfirmId(null)
    logActivity({ type: 'discovery', action: 'deleted', title: `Deleted ML model: ${deletedModel?.name || deleteConfirmId}` })
  }

  const predict = async () => {
    if (!selected) return
    const features: Record<string, any> = {}
    predInput.split(',').forEach(pair => { const [k, v] = pair.split(':').map(s => s.trim()); if (k) features[k] = isNaN(Number(v)) ? v : Number(v) })
    const r = await fetch(`${API}/${selected.id}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: selected.id, features }) })
    if (r.ok) setPrediction(await r.json())
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div><h1 className="text-2xl font-semibold tracking-tight">ML Model Manager</h1><p className="text-sm text-[var(--color-text-muted)] mt-1">Model registry, evaluation, and prediction</p></div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn text-sm" style={{ color: 'var(--color-accent-blue)' }}><FiPlus className="w-4 h-4" /> New Model</button>
        </div>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--glass-bg)]">
          <div className="max-w-xl mx-auto space-y-2">
            <div className="flex gap-2">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Model name *" className="input flex-1 text-xs" />
              <select value={form.model_type} onChange={e => setForm(f => ({ ...f, model_type: e.target.value }))} className="input text-xs w-36">
                <option value="classification">Classification</option><option value="regression">Regression</option><option value="deep_learning">Deep Learning</option>
              </select>
              <select value={form.framework} onChange={e => setForm(f => ({ ...f, framework: e.target.value }))} className="input text-xs w-32">
                <option>scikit-learn</option><option>PyTorch</option><option>TensorFlow</option><option>XGBoost</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" className="input flex-1 text-xs" />
              <button onClick={createModel} disabled={!form.name.trim()} className="btn text-xs" style={{ color: 'var(--color-success)' }}>Create</button>
              <button onClick={() => setShowAdd(false)} className="btn text-xs text-[var(--color-text-muted)]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-1">
          {models.map(m => (
            <div key={m.id} onClick={() => selectModel(m)}
              className={`p-3 rounded-lg cursor-pointer group transition-colors ${selected?.id === m.id ? 'bg-[var(--glass-bg)] border border-[var(--color-border)]' : 'hover:bg-[var(--glass-bg)]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{m.name}</span>
                <button onClick={e => { e.stopPropagation(); deleteModel(m.id) }} className="opacity-0 group-hover:opacity-100 p-1"><FiTrash2 className="w-3 h-3" /></button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xxs px-1.5 py-0.5 rounded-full" style={{ color: STATUS_COLORS[m.status], background: 'var(--glass-bg)' }}>{m.status}</span>
                <span className="text-xxs text-[var(--color-text-muted)]">{m.model_type}</span>
                {m.metrics.accuracy != null && Number.isFinite(m.metrics.accuracy) && <span className="text-xxs text-[var(--color-text-muted)]">Acc: {(m.metrics.accuracy * 100).toFixed(1)}%</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]"><FiCpu className="w-12 h-12 mx-auto mb-4 opacity-20" /><p className="text-sm">Select a model</p></div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              <div><h2 className="text-lg font-semibold">{selected.name}</h2><p className="text-xs text-[var(--color-text-muted)]">{selected.model_type} | {selected.framework} | v{selected.version} | {selected.status}</p></div>
              {selected.description && <p className="text-xs text-[var(--color-text-muted)]">{selected.description}</p>}

              {/* Metrics */}
              {selected.metrics && Object.keys(selected.metrics).length > 0 && (
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(selected.metrics).filter(([, v]) => v !== null).map(([key, val]) => (
                    <div key={key} className="glass-card p-3 text-center">
                      <div className="text-lg font-semibold" style={{ color: 'var(--color-accent-blue)' }}>{typeof val === 'number' && Number.isFinite(val) ? (val < 1 ? (val * 100).toFixed(1) + '%' : val.toFixed(4)) : (val ?? '--')}</div>
                      <div className="text-xxs text-[var(--color-text-muted)] capitalize">{key.replace(/_/g, ' ')}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Training History */}
              {selected.training_history.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-xs font-medium mb-3">Training History</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={selected.training_history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                      <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                      <Line type="monotone" dataKey="train_loss" stroke="var(--color-accent-blue)" strokeWidth={2} dot={false} name="Train Loss" />
                      <Line type="monotone" dataKey="val_loss" stroke="var(--color-accent-purple)" strokeWidth={2} dot={false} name="Val Loss" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Feature Importance */}
              {selected.feature_importance.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-xs font-medium mb-3">Feature Importance</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={selected.feature_importance} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                      <YAxis type="category" dataKey="feature" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} width={80} />
                      <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                      <Bar dataKey="importance" fill="var(--color-accent-blue)" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ROC Curve */}
              {metrics?.roc_curve && (
                <div className="glass-card p-4">
                  <h3 className="text-xs font-medium mb-3">ROC Curve</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={metrics.roc_curve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="fpr" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: 'FPR', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                      <YAxis dataKey="tpr" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: 'TPR', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                      <Line type="monotone" dataKey="tpr" stroke="var(--color-accent-blue)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Prediction */}
              <div className="glass-card p-4">
                <h3 className="text-xs font-medium mb-2">Predict</h3>
                <div className="flex gap-2">
                  <input value={predInput} onChange={e => setPredInput(e.target.value)} placeholder="key1:val1, key2:val2" className="input flex-1 text-xs font-mono" />
                  <button onClick={predict} className="btn text-xs" style={{ color: 'var(--color-accent-blue)' }}><FiPlay className="w-3.5 h-3.5" /> Predict</button>
                </div>
                {prediction && (
                  <div className="mt-3 p-3 rounded-lg bg-[var(--glass-bg)]">
                    <div className="text-sm font-semibold" style={{ color: 'var(--color-accent-blue)' }}>
                      {prediction.class_label || prediction.prediction}
                      {prediction.probability !== undefined && <span className="text-xs text-[var(--color-text-muted)] ml-2">(p={prediction.probability})</span>}
                    </div>
                    {prediction.confidence != null && Number.isFinite(prediction.confidence) && <div className="text-xxs text-[var(--color-text-muted)]">Confidence: {(prediction.confidence * 100).toFixed(1)}%</div>}
                  </div>
                )}
              </div>

              {/* Model Info */}
              <div className="glass-card p-4">
                <h3 className="text-xs font-medium mb-2">Model Details</h3>
                <div className="grid grid-cols-2 gap-2 text-xxs">
                  <div><span className="text-[var(--color-text-muted)]">Features:</span> {selected.features.join(', ')}</div>
                  <div><span className="text-[var(--color-text-muted)]">Target:</span> {selected.target}</div>
                  <div className="col-span-2"><span className="text-[var(--color-text-muted)]">Hyperparameters:</span> {JSON.stringify(selected.hyperparameters)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDeleteDialog
        open={deleteConfirmId !== null}
        entityName="ML Model"
        message="This will permanently delete this ML model. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}

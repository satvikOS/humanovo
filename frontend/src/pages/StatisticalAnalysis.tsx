import { useState } from 'react'
import {
  FiBarChart2, FiTrendingUp, FiGrid, FiActivity, FiTarget,
  FiPlay, FiSave, FiCopy, FiChevronDown, FiChevronUp,
} from 'react-icons/fi'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

type TabId = 'descriptive' | 'hypothesis' | 'regression' | 'survival' | 'sample_size'

interface SavedAnalysis {
  id: string
  title: string
  analysis_type: string
  created_at: string
}

const API = '/api/statistics'

export default function StatisticalAnalysis() {
  const [tab, setTab] = useState<TabId>('descriptive')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<SavedAnalysis[]>([])
  const [showSaved, setShowSaved] = useState(false)

  // ── Descriptive state ──
  const [descData, setDescData] = useState('')
  const [descLabel, setDescLabel] = useState('')

  // ── T-test state ──
  const [g1, setG1] = useState('')
  const [g2, setG2] = useState('')
  const [paired, setPaired] = useState(false)
  const [label1, setLabel1] = useState('')
  const [label2, setLabel2] = useState('')

  // ── ANOVA state ──
  const [anovaGroups, setAnovaGroups] = useState('')
  const [anovaLabels, setAnovaLabels] = useState('')

  // ── Chi-square state ──
  const [chiData, setChiData] = useState('')
  const [chiRowLabels, setChiRowLabels] = useState('')
  const [chiColLabels, setChiColLabels] = useState('')

  // ── Correlation state ──
  const [corrVars, setCorrVars] = useState('')
  const [corrLabels, setCorrLabels] = useState('')
  const [corrMethod, setCorrMethod] = useState<'pearson' | 'spearman'>('pearson')

  // ── Regression state ──
  const [regX, setRegX] = useState('')
  const [regY, setRegY] = useState('')
  const [regFeatureNames, setRegFeatureNames] = useState('')
  const [regType, setRegType] = useState<'linear' | 'logistic'>('linear')

  // ── Survival state ──
  const [survTimes, setSurvTimes] = useState('')
  const [survEvents, setSurvEvents] = useState('')
  const [survGroups, setSurvGroups] = useState('')
  const [survGroupLabels, setSurvGroupLabels] = useState('')

  // ── Sample size state ──
  const [ssEffect, setSsEffect] = useState(0.5)
  const [ssAlpha, setSsAlpha] = useState(0.05)
  const [ssPower, setSsPower] = useState(0.8)
  const [ssTest, setSsTest] = useState('two_sample_t')

  const parseNums = (s: string): number[] => s.split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x))
  const parseRows = (s: string): number[][] => s.split('\n').filter(l => l.trim()).map(l => parseNums(l))
  const parseIntRows = (s: string): number[][] => s.split('\n').filter(l => l.trim()).map(l => l.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x)))
  const parseLabels = (s: string): string[] => s.split(',').map(x => x.trim()).filter(Boolean)

  const runAnalysis = async () => {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      let endpoint = ''
      let body: any = {}

      switch (tab) {
        case 'descriptive':
          endpoint = '/descriptive'
          body = { data: parseNums(descData), label: descLabel }
          break
        case 'hypothesis': {
          const testType = document.querySelector<HTMLSelectElement>('#hyp-test')?.value || 'ttest'
          if (testType === 'ttest') {
            endpoint = '/ttest'
            body = { group1: parseNums(g1), group2: parseNums(g2), paired, label1, label2 }
          } else if (testType === 'anova') {
            endpoint = '/anova'
            body = { groups: parseRows(anovaGroups), labels: parseLabels(anovaLabels) }
          } else {
            endpoint = '/chi-square'
            body = { observed: parseIntRows(chiData), row_labels: parseLabels(chiRowLabels), col_labels: parseLabels(chiColLabels) }
          }
          break
        }
        case 'regression': {
          const corrOrReg = document.querySelector<HTMLSelectElement>('#reg-type')?.value || 'regression'
          if (corrOrReg === 'correlation') {
            endpoint = '/correlation'
            body = { variables: parseRows(corrVars), labels: parseLabels(corrLabels), method: corrMethod }
          } else {
            endpoint = '/regression'
            body = { x: parseRows(regX), y: parseNums(regY), feature_names: parseLabels(regFeatureNames), regression_type: regType }
          }
          break
        }
        case 'survival':
          endpoint = '/survival'
          body = {
            times: parseNums(survTimes),
            events: survEvents.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x)),
            groups: survGroups.trim() ? survGroups.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x)) : null,
            group_labels: parseLabels(survGroupLabels),
          }
          break
        case 'sample_size':
          endpoint = '/sample-size'
          body = { effect_size: ssEffect, alpha: ssAlpha, power: ssPower, test_type: ssTest }
          break
      }

      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Server error' }))
        throw new Error(err.detail || 'Analysis failed')
      }
      setResult(await res.json())
    } catch (e: any) {
      setError(e.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const saveResult = async () => {
    if (!result) return
    try {
      const res = await fetch(`${API}/saved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${tab} - ${new Date().toLocaleString()}`, analysis_type: tab, input_data: {}, results: result }),
      })
      if (res.ok) {
        const entry = await res.json()
        setSaved(prev => [entry, ...prev])
      }
    } catch { /* ignore */ }
  }

  const loadSaved = async () => {
    try {
      const res = await fetch(`${API}/saved`)
      if (res.ok) {
        const data = await res.json()
        setSaved(data.items || [])
      }
    } catch { /* ignore */ }
    setShowSaved(!showSaved)
  }

  const copyResult = () => {
    if (result) navigator.clipboard.writeText(JSON.stringify(result, null, 2))
  }

  const tabs: { id: TabId; label: string; icon: JSX.Element }[] = [
    { id: 'descriptive', label: 'Descriptive', icon: <FiBarChart2 className="w-3.5 h-3.5" /> },
    { id: 'hypothesis', label: 'Hypothesis Testing', icon: <FiTarget className="w-3.5 h-3.5" /> },
    { id: 'regression', label: 'Regression & Correlation', icon: <FiTrendingUp className="w-3.5 h-3.5" /> },
    { id: 'survival', label: 'Survival', icon: <FiActivity className="w-3.5 h-3.5" /> },
    { id: 'sample_size', label: 'Sample Size', icon: <FiGrid className="w-3.5 h-3.5" /> },
  ]

  const [hypTest, setHypTest] = useState('ttest')
  const [regMode, setRegMode] = useState('regression')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Statistical Analysis</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Hypothesis testing, regression, survival analysis, and more</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadSaved} className="btn text-xs text-[var(--color-text-muted)]">
              {showSaved ? <FiChevronUp className="w-3.5 h-3.5" /> : <FiChevronDown className="w-3.5 h-3.5" />} Saved
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setResult(null); setError('') }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === t.id ? 'bg-[var(--glass-bg)] text-[var(--color-text)] border border-[var(--color-border)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Saved panel */}
      {showSaved && (
        <div className="p-3 border-b border-[var(--color-border)] bg-[var(--glass-bg)] max-h-40 overflow-y-auto">
          {saved.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-2">No saved analyses</p>
          ) : saved.map(s => (
            <div key={s.id} className="flex items-center justify-between py-1 text-xs">
              <span>{s.title}</span>
              <span className="text-[var(--color-text-muted)]">{new Date(s.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="glass-card p-5 space-y-4">
            <h3 className="text-sm font-medium mb-3">Input Data</h3>

            {tab === 'descriptive' && (
              <>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Variable Label</label>
                  <input value={descLabel} onChange={e => setDescLabel(e.target.value)} placeholder="e.g., Sample Variable" className="input w-full text-xs" />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Data (comma-separated numbers)</label>
                  <textarea value={descData} onChange={e => setDescData(e.target.value)} rows={4} placeholder="e.g., 23, 45, 67, 34, 56, 78, 12, 90, 43, 65" className="input w-full text-xs font-mono resize-none" />
                </div>
              </>
            )}

            {tab === 'hypothesis' && (
              <>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Test Type</label>
                  <select id="hyp-test" value={hypTest} onChange={e => setHypTest(e.target.value)} className="input w-full text-xs">
                    <option value="ttest">T-Test</option>
                    <option value="anova">One-way ANOVA</option>
                    <option value="chi">Chi-Square</option>
                  </select>
                </div>
                {hypTest === 'ttest' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={label1} onChange={e => setLabel1(e.target.value)} placeholder="e.g., Control" className="input text-xs" />
                      <input value={label2} onChange={e => setLabel2(e.target.value)} placeholder="e.g., Treatment" className="input text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Group 1 data</label>
                      <textarea value={g1} onChange={e => setG1(e.target.value)} rows={2} placeholder="e.g., 23, 45, 67, 34, 56, 78, 12" className="input w-full text-xs font-mono resize-none" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Group 2 data</label>
                      <textarea value={g2} onChange={e => setG2(e.target.value)} rows={2} placeholder="e.g., 34, 56, 78, 90, 43, 65, 88" className="input w-full text-xs font-mono resize-none" />
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={paired} onChange={e => setPaired(e.target.checked)} className="rounded" /> Paired t-test
                    </label>
                  </>
                )}
                {hypTest === 'anova' && (
                  <>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Group Labels (comma-separated)</label>
                      <input value={anovaLabels} onChange={e => setAnovaLabels(e.target.value)} placeholder="e.g., Group A, Group B, Group C" className="input w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Groups (one per line, comma-separated)</label>
                      <textarea value={anovaGroups} onChange={e => setAnovaGroups(e.target.value)} rows={4} placeholder={"e.g.,\n23,45,67,34\n56,78,90,43\n12,34,56,78"} className="input w-full text-xs font-mono resize-none" />
                    </div>
                  </>
                )}
                {hypTest === 'chi' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Row Labels</label>
                        <input value={chiRowLabels} onChange={e => setChiRowLabels(e.target.value)} placeholder="e.g., Male, Female" className="input w-full text-xs" />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Column Labels</label>
                        <input value={chiColLabels} onChange={e => setChiColLabels(e.target.value)} placeholder="e.g., Yes, No" className="input w-full text-xs" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Observed data (rows of comma-separated integers)</label>
                      <textarea value={chiData} onChange={e => setChiData(e.target.value)} rows={3} placeholder={"e.g.,\n40,20\n30,10"} className="input w-full text-xs font-mono resize-none" />
                    </div>
                  </>
                )}
              </>
            )}

            {tab === 'regression' && (
              <>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Analysis Type</label>
                  <select id="reg-type" value={regMode} onChange={e => setRegMode(e.target.value)} className="input w-full text-xs">
                    <option value="regression">Regression</option>
                    <option value="correlation">Correlation Matrix</option>
                  </select>
                </div>
                {regMode === 'regression' ? (
                  <>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Feature Names</label>
                      <input value={regFeatureNames} onChange={e => setRegFeatureNames(e.target.value)} placeholder="e.g., X1, X2" className="input w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">X data (rows = observations, comma-separated features)</label>
                      <textarea value={regX} onChange={e => setRegX(e.target.value)} rows={4} placeholder={"e.g.,\n1,2\n2,3\n3,4\n4,5"} className="input w-full text-xs font-mono resize-none" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Y data (comma-separated)</label>
                      <textarea value={regY} onChange={e => setRegY(e.target.value)} rows={2} placeholder="e.g., 2.1, 4.0, 5.8, 8.1" className="input w-full text-xs font-mono resize-none" />
                    </div>
                    <select value={regType} onChange={e => setRegType(e.target.value as any)} className="input text-xs">
                      <option value="linear">Linear Regression</option>
                      <option value="logistic">Logistic Regression</option>
                    </select>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Variable Labels</label>
                      <input value={corrLabels} onChange={e => setCorrLabels(e.target.value)} placeholder="e.g., Age, BMI, Score" className="input w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Variables (one per line, comma-separated values)</label>
                      <textarea value={corrVars} onChange={e => setCorrVars(e.target.value)} rows={4} placeholder={"e.g.,\n23,45,67,34,56\n34,56,78,90,43"} className="input w-full text-xs font-mono resize-none" />
                    </div>
                    <select value={corrMethod} onChange={e => setCorrMethod(e.target.value as any)} className="input text-xs">
                      <option value="pearson">Pearson</option>
                      <option value="spearman">Spearman</option>
                    </select>
                  </>
                )}
              </>
            )}

            {tab === 'survival' && (
              <>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Times (comma-separated)</label>
                  <textarea value={survTimes} onChange={e => setSurvTimes(e.target.value)} rows={2} placeholder="e.g., 1,2,3,4,5,6,7,8,9,10,11,12" className="input w-full text-xs font-mono resize-none" />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Events (1=event, 0=censored)</label>
                  <textarea value={survEvents} onChange={e => setSurvEvents(e.target.value)} rows={2} placeholder="e.g., 1,0,1,1,0,1,0,1,1,0,1,0" className="input w-full text-xs font-mono resize-none" />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Groups (optional, integers)</label>
                  <textarea value={survGroups} onChange={e => setSurvGroups(e.target.value)} rows={2} placeholder="e.g., 0,0,0,0,0,0,1,1,1,1,1,1" className="input w-full text-xs font-mono resize-none" />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Group Labels</label>
                  <input value={survGroupLabels} onChange={e => setSurvGroupLabels(e.target.value)} placeholder="e.g., Standard, Experimental" className="input w-full text-xs" />
                </div>
              </>
            )}

            {tab === 'sample_size' && (
              <>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Test Type</label>
                  <select value={ssTest} onChange={e => setSsTest(e.target.value)} className="input w-full text-xs">
                    <option value="two_sample_t">Two-sample t-test</option>
                    <option value="one_sample_t">One-sample t-test</option>
                    <option value="chi_square">Chi-square test</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Effect Size (d)</label>
                    <input type="number" step="0.1" value={ssEffect} onChange={e => setSsEffect(parseFloat(e.target.value) || 0.5)} className="input w-full text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Alpha (α)</label>
                    <input type="number" step="0.01" value={ssAlpha} onChange={e => setSsAlpha(parseFloat(e.target.value) || 0.05)} className="input w-full text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Power (1-β)</label>
                    <input type="number" step="0.05" value={ssPower} onChange={e => setSsPower(parseFloat(e.target.value) || 0.8)} className="input w-full text-xs" />
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={runAnalysis} disabled={loading} className="btn text-xs flex items-center gap-1.5" style={{ color: 'var(--color-accent-blue)' }}>
                <FiPlay className="w-3.5 h-3.5" /> {loading ? 'Running...' : 'Run Analysis'}
              </button>
            </div>
          </div>

          {/* Results Panel */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Results</h3>
              {result && (
                <div className="flex gap-1">
                  <button onClick={copyResult} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]" title="Copy JSON"><FiCopy className="w-3.5 h-3.5" /></button>
                  <button onClick={saveResult} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)]" title="Save"><FiSave className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>

            {error && <div className="text-xs text-[var(--color-error)] mb-3 p-2 rounded bg-[var(--glass-bg)]">{error}</div>}

            {!result && !error && (
              <div className="text-center py-12 text-[var(--color-text-muted)]">
                <FiBarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-xs">Configure your analysis and click Run</p>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Interpretation */}
                {result.interpretation && (
                  <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)]">
                    <p className="text-xs leading-relaxed">{result.interpretation}</p>
                  </div>
                )}

                {/* Significance badges */}
                {result.p_value !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-muted)]">p = {result.p_value}</span>
                    <span className={`text-xxs px-2 py-0.5 rounded-full ${result.significant_at_05 ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                      {result.significant_at_05 ? 'p < 0.05' : 'p ≥ 0.05'}
                    </span>
                    {result.significant_at_01 && <span className="text-xxs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">p &lt; 0.01</span>}
                  </div>
                )}

                {/* Descriptive stats table */}
                {result.n !== undefined && result.mean !== undefined && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {['n', 'mean', 'median', 'std', 'min', 'max', 'q1', 'q3', 'iqr', 'skewness', 'kurtosis', 'sem', 'ci_95_lower', 'ci_95_upper'].map(key => (
                          result[key] !== undefined && (
                            <tr key={key} className="border-b border-[var(--color-border)]/30">
                              <td className="py-1.5 text-[var(--color-text-muted)] capitalize">{key.replace(/_/g, ' ')}</td>
                              <td className="py-1.5 text-right font-mono">{typeof result[key] === 'number' ? result[key].toFixed(4) : result[key]}</td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Histogram */}
                {result.histogram && result.histogram.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">Distribution</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={result.histogram}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                        <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Group stats */}
                {result.group_stats && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--color-border)]">
                          <th className="text-left py-1.5 text-[var(--color-text-muted)]">Group</th>
                          <th className="text-right py-1.5 text-[var(--color-text-muted)]">N</th>
                          <th className="text-right py-1.5 text-[var(--color-text-muted)]">Mean</th>
                          <th className="text-right py-1.5 text-[var(--color-text-muted)]">SD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(result.group_stats) ? result.group_stats : [result.group1_stats, result.group2_stats].filter(Boolean)).map((g: any, i: number) => (
                          <tr key={i} className="border-b border-[var(--color-border)]/30">
                            <td className="py-1.5">{g.label}</td>
                            <td className="py-1.5 text-right font-mono">{g.n}</td>
                            <td className="py-1.5 text-right font-mono">{g.mean}</td>
                            <td className="py-1.5 text-right font-mono">{g.std}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* T-test / ANOVA stats */}
                {result.t_statistic !== undefined && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">t</span> <span className="font-mono float-right">{result.t_statistic}</span></div>
                    <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">df</span> <span className="font-mono float-right">{result.degrees_of_freedom}</span></div>
                    {result.effect_size_cohens_d !== undefined && (
                      <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">Cohen's d</span> <span className="font-mono float-right">{result.effect_size_cohens_d}</span></div>
                    )}
                    {result.mean_difference !== undefined && (
                      <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">Δ mean</span> <span className="font-mono float-right">{result.mean_difference}</span></div>
                    )}
                  </div>
                )}
                {result.f_statistic !== undefined && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">F</span> <span className="font-mono float-right">{result.f_statistic}</span></div>
                    <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">df</span> <span className="font-mono float-right">{result.df_between}, {result.df_within}</span></div>
                  </div>
                )}
                {result.chi_square_statistic !== undefined && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">χ²</span> <span className="font-mono float-right">{result.chi_square_statistic}</span></div>
                    <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">Cramér's V</span> <span className="font-mono float-right">{result.cramers_v}</span></div>
                  </div>
                )}

                {/* Correlation matrix */}
                {result.matrix && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="py-1"></th>
                          {result.labels?.map((l: string) => <th key={l} className="py-1 text-right text-[var(--color-text-muted)]">{l}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {result.matrix.map((row: number[], i: number) => (
                          <tr key={i} className="border-b border-[var(--color-border)]/30">
                            <td className="py-1 text-[var(--color-text-muted)]">{result.labels?.[i]}</td>
                            {row.map((val: number, j: number) => (
                              <td key={j} className="py-1 text-right font-mono" style={{ color: i === j ? 'var(--color-text-muted)' : (Math.abs(val) > 0.7 ? 'var(--color-success)' : 'var(--color-text)') }}>
                                {val.toFixed(3)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Regression results */}
                {result.r_squared !== undefined && result.coefficients && Array.isArray(result.coefficients) && result.coefficients[0]?.feature && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">R²</span> <span className="font-mono float-right">{result.r_squared}</span></div>
                      <div className="p-2 rounded bg-[var(--glass-bg)]"><span className="text-[var(--color-text-muted)]">Intercept</span> <span className="font-mono float-right">{result.intercept}</span></div>
                    </div>
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-[var(--color-border)]"><th className="text-left py-1">Feature</th><th className="text-right py-1">Coefficient</th></tr></thead>
                      <tbody>
                        {result.coefficients.map((c: any, i: number) => (
                          <tr key={i} className="border-b border-[var(--color-border)]/30">
                            <td className="py-1">{c.feature}</td>
                            <td className="py-1 text-right font-mono">{c.coefficient}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Survival curve */}
                {result.overall_curve && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">Kaplan-Meier Curve</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={result.overall_curve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: 'Time', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} label={{ value: 'Survival', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-surface-solid)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '11px', color: 'var(--color-text)' }} />
                        <Line type="stepAfter" dataKey="survival" stroke="var(--color-accent-blue)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    {result.median_survival !== null && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-1">Median survival: {result.median_survival}</p>
                    )}
                  </div>
                )}

                {/* Sample size results */}
                {result.total_n !== undefined && result.recommendations && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] text-center">
                        <div className="text-2xl font-semibold" style={{ color: 'var(--color-accent-blue)' }}>{result.total_n}</div>
                        <div className="text-[var(--color-text-muted)] mt-1">Total N Required</div>
                      </div>
                      <div className="p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--color-border)] text-center">
                        <div className="text-2xl font-semibold" style={{ color: 'var(--color-accent-purple)' }}>{result.n_per_group}</div>
                        <div className="text-[var(--color-text-muted)] mt-1">Per Group</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {result.recommendations.map((r: string, i: number) => (
                        <p key={i} className="text-xs text-[var(--color-text-muted)]">• {r}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

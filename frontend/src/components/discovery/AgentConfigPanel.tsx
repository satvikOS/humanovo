// AgentConfigPanel — right-side slide-over for tuning the agent.
//
// Model, temperature, system prompt, max hypotheses, tool toggles
// (RAG / KG / evidence / simulation / web), and verbosity. Changes
// persist immediately via the session's PATCH endpoint — the parent
// component owns the API call so this stays presentation-only.
import { useState, useEffect } from 'react'
import { FiX, FiCpu, FiThermometer, FiMessageSquare, FiTool, FiVolume2 } from 'react-icons/fi'
import type { DiscoveryAgentConfig } from '../../services/api'

interface AgentConfigPanelProps {
  open: boolean
  onClose: () => void
  config: DiscoveryAgentConfig
  onChange: (updates: Partial<DiscoveryAgentConfig>) => void
}

// Model catalogue — surfaced as options in the select. Kept static
// here so the server doesn't need a /models endpoint just for this.
// Order: best -> fastest, per family.
const MODEL_OPTIONS: { value: string; label: string; group: string }[] = [
  { value: 'claude-opus-4-7',     label: 'Claude Opus 4.7',     group: 'Anthropic' },
  { value: 'claude-sonnet-4-6',   label: 'Claude Sonnet 4.6',   group: 'Anthropic' },
  { value: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5',    group: 'Anthropic' },
  { value: 'gpt-4o',              label: 'GPT-4o',              group: 'OpenAI'    },
  { value: 'gpt-4o-mini',         label: 'GPT-4o mini',         group: 'OpenAI'    },
  { value: 'mistral-large-latest', label: 'Mistral Large',      group: 'Mistral'   },
]

export default function AgentConfigPanel({ open, onClose, config, onChange }: AgentConfigPanelProps) {
  // Local mirror so sliders + textareas feel snappy; we push changes
  // upstream via onChange which the parent debounces to the API.
  const [draft, setDraft] = useState(config)
  useEffect(() => { setDraft(config) }, [config])

  const update = (patch: Partial<DiscoveryAgentConfig>) => {
    setDraft({ ...draft, ...patch })
    onChange(patch)
  }

  if (!open) return null

  const grouped: Record<string, typeof MODEL_OPTIONS> = {}
  for (const opt of MODEL_OPTIONS) {
    ;(grouped[opt.group] = grouped[opt.group] || []).push(opt)
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="flex-1 bg-black/40" aria-hidden="true" />
      <div
        onClick={e => e.stopPropagation()}
        className="w-[420px] h-full overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface-solid)] p-5 space-y-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xxs uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mb-1">
              Agent configuration
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text)' }}>
              Tune the model, temperature, prompt, and tools for this session. Changes persist.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Model */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-xxs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
            <FiCpu className="w-3 h-3" /> Model
          </span>
          <select
            value={draft.model}
            onChange={e => update({ model: e.target.value })}
            className="w-full px-2 py-1.5 text-sm rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)]"
            aria-label="Model"
          >
            {Object.entries(grouped).map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>

        {/* Temperature */}
        <label className="block">
          <div className="flex items-center justify-between text-xxs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
            <span className="flex items-center gap-1.5"><FiThermometer className="w-3 h-3" /> Temperature</span>
            <span className="tabular-nums" style={{ color: 'var(--color-text)' }}>{draft.temperature.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={2} step={0.05}
            value={draft.temperature}
            onChange={e => update({ temperature: parseFloat(e.target.value) })}
            className="w-full accent-[var(--color-text-muted)]"
            aria-label="Temperature"
          />
          <div className="flex justify-between text-xxs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            <span>Deterministic</span><span>Creative</span>
          </div>
        </label>

        {/* Max hypotheses */}
        <label className="block">
          <div className="flex items-center justify-between text-xxs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
            <span>Max hypotheses per turn</span>
            <span className="tabular-nums" style={{ color: 'var(--color-text)' }}>{draft.max_hypotheses}</span>
          </div>
          <input
            type="range" min={1} max={10} step={1}
            value={draft.max_hypotheses}
            onChange={e => update({ max_hypotheses: parseInt(e.target.value) })}
            className="w-full accent-[var(--color-text-muted)]"
            aria-label="Max hypotheses"
          />
        </label>

        {/* System prompt */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-xxs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
            <FiMessageSquare className="w-3 h-3" /> System prompt
          </span>
          <textarea
            value={draft.system_prompt}
            onChange={e => update({ system_prompt: e.target.value })}
            rows={6}
            className="w-full px-2 py-1.5 text-xs leading-relaxed rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--color-text)] font-mono resize-y"
            placeholder="You are Humanovo, a biomedical research co-pilot…"
            aria-label="System prompt"
          />
        </label>

        {/* Tools */}
        <div>
          <div className="flex items-center gap-1.5 text-xxs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
            <FiTool className="w-3 h-3" /> Tools
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {([
              ['rag', 'Retrieval (RAG over evidence corpus)'],
              ['kg', 'Knowledge-graph traversal'],
              ['evidence', 'Evidence search'],
              ['simulation', 'Compute-lab simulations'],
              ['web', 'External web search'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs cursor-pointer px-2 py-1.5 rounded hover:bg-[var(--glass-bg)]" style={{ color: 'var(--color-text)' }}>
                <input
                  type="checkbox"
                  checked={!!draft.tools?.[key]}
                  onChange={e => update({ tools: { ...draft.tools, [key]: e.target.checked } })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Verbosity */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-xxs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
            <FiVolume2 className="w-3 h-3" /> Verbosity
          </span>
          <div className="flex gap-1">
            {(['terse', 'normal', 'verbose'] as const).map(v => (
              <button
                key={v}
                onClick={() => update({ verbosity: v })}
                className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                  draft.verbosity === v
                    ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg)] text-[var(--color-text)]'
                    : 'border-[var(--glass-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]'
                }`}
                aria-pressed={draft.verbosity === v}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </label>

        <div className="pt-2 border-t border-[var(--color-border)] text-xxs" style={{ color: 'var(--color-text-muted)' }}>
          Changes save automatically to this session. Fork a session (from the action menu) to try alternate configurations without losing your current state.
        </div>
      </div>
    </div>
  )
}

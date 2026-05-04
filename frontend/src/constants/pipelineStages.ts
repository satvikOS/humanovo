/**
 * Pipeline stage labels.
 *
 * The backend emits stage events with internal codenames (SEED, EXPAND, ...)
 * that we use as state keys for matching trace data. The internal codenames
 * MUST NOT leak into user-visible UI — they reveal the proprietary pipeline
 * architecture. This module is the single source of truth that maps each
 * codename to a generic, biomedical-reviewer-friendly label.
 *
 * Rules:
 * - Use STAGE_CODES for state keys, prop matching, and any code paths that
 *   need to align with backend emissions.
 * - Use stageLabel(code) for ANYTHING rendered to the user.
 * - Never render a raw stage codename in the UI.
 */

export const STAGE_CODES = [
  'SEED',
  'EXPAND',
  'EVIDENCE',
  'COUNTER',
  'REVISE',
  'MECHANISM',
  'VALIDATE',
  'GROUND',
  'SCORE',
  'REFINE',
  'TRANSLATE',
  'FINALIZE',
] as const

export type StageCode = (typeof STAGE_CODES)[number]

const STAGE_LABELS: Record<StageCode, string> = {
  SEED: 'Hypothesis seed',
  EXPAND: 'Hypothesis expansion',
  EVIDENCE: 'Evidence gathering',
  COUNTER: 'Counter-arguments',
  REVISE: 'Revision',
  MECHANISM: 'Mechanism analysis',
  VALIDATE: 'Cross-validation',
  GROUND: 'Evidence grounding',
  SCORE: 'Confidence scoring',
  REFINE: 'Refinement',
  TRANSLATE: 'Translation',
  FINALIZE: 'Synthesis',
}

/**
 * Return the user-facing label for a stage code.
 * Falls back to a generic "Stage <n>" if an unknown code arrives — defensive
 * against the backend ever introducing a stage we haven't mapped here yet.
 */
export function stageLabel(code: string | null | undefined): string {
  if (!code) return ''
  if (code in STAGE_LABELS) return STAGE_LABELS[code as StageCode]
  return 'Stage'
}

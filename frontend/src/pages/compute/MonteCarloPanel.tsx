import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  FiPlay, FiActivity, FiBarChart2, FiCopy, FiDownload,
  FiLoader, FiCheck, FiTarget, FiHeart, FiZap, FiDatabase,
} from 'react-icons/fi';
import clsx from 'clsx';

/* ------------------------------------------------------------------ */
/*  Random number utilities                                           */
/* ------------------------------------------------------------------ */

function randNorm(mean: number, sd: number): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

function randExponential(rate: number): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return -Math.log(u) / rate;
}

function randBinomial(n: number, p: number): number {
  if (n > 50) {
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    return Math.max(0, Math.min(n, Math.round(randNorm(mean, sd))));
  }
  let successes = 0;
  for (let i = 0; i < n; i++) {
    if (Math.random() < p) successes++;
  }
  return successes;
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type SimulationType =
  | 'clinical_outcome'
  | 'dose_response'
  | 'survival_analysis'
  | 'epidemiological'
  | 'pathway_dynamics'
  | 'drug_interaction';

interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

interface SimDef {
  id: SimulationType;
  name: string;
  description: string;
  icon: React.ReactNode;
  params: ParamDef[];
}

interface SimResults {
  values: number[];
  convergence: { iteration: number; runningMean: number }[];
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Simulation definitions                                            */
/* ------------------------------------------------------------------ */

const SIMULATIONS: SimDef[] = [
  {
    id: 'clinical_outcome',
    name: 'Clinical Outcome Trial',
    description: 'Simulate clinical trial outcomes with treatment vs control arms',
    icon: <FiHeart />,
    params: [
      { key: 'sampleSize', label: 'Sample Size', min: 20, max: 10000, step: 10, default: 500 },
      { key: 'baselineRate', label: 'Baseline Rate', min: 0.01, max: 0.99, step: 0.01, default: 0.3 },
      { key: 'treatmentEffect', label: 'Treatment Effect', min: 0.01, max: 0.5, step: 0.01, default: 0.15 },
    ],
  },
  {
    id: 'dose_response',
    name: 'Dose-Response (Hill Model)',
    description: 'Monte Carlo dose-response with noise for EC50 estimation',
    icon: <FiActivity />,
    params: [
      { key: 'ec50', label: 'EC50', min: 0.1, max: 100, step: 0.1, default: 10 },
      { key: 'hillCoeff', label: 'Hill Coefficient', min: 0.5, max: 5, step: 0.1, default: 2 },
      { key: 'emax', label: 'Emax', min: 10, max: 500, step: 1, default: 100 },
      { key: 'noiseSD', label: 'Noise SD', min: 0.1, max: 50, step: 0.1, default: 5 },
    ],
  },
  {
    id: 'survival_analysis',
    name: 'Survival Analysis',
    description: 'Simulate survival times with Weibull distribution and censoring',
    icon: <FiTarget />,
    params: [
      { key: 'medianSurvivalControl', label: 'Median Survival (Control)', min: 1, max: 60, step: 1, default: 12 },
      { key: 'hazardRatio', label: 'Hazard Ratio', min: 0.1, max: 2, step: 0.01, default: 0.7 },
      { key: 'sampleSize', label: 'Sample Size', min: 20, max: 5000, step: 10, default: 200 },
    ],
  },
  {
    id: 'epidemiological',
    name: 'SIR Epidemic Model',
    description: 'Stochastic SIR epidemic simulation with random transmission events',
    icon: <FiZap />,
    params: [
      { key: 'population', label: 'Population', min: 100, max: 1000000, step: 100, default: 10000 },
      { key: 'initialInfected', label: 'Initial Infected', min: 1, max: 1000, step: 1, default: 10 },
      { key: 'beta', label: 'Beta (transmission)', min: 0.01, max: 1, step: 0.01, default: 0.3 },
      { key: 'gamma', label: 'Gamma (recovery)', min: 0.01, max: 1, step: 0.01, default: 0.1 },
    ],
  },
  {
    id: 'pathway_dynamics',
    name: 'Gene Regulatory Pathway (Gillespie)',
    description: 'Stochastic gene expression using Gillespie algorithm',
    icon: <FiDatabase />,
    params: [
      { key: 'transcriptionRate', label: 'Transcription Rate', min: 1, max: 100, step: 1, default: 10 },
      { key: 'degradationRate', label: 'Degradation Rate', min: 0.1, max: 10, step: 0.1, default: 1 },
      { key: 'translationRate', label: 'Translation Rate', min: 0.5, max: 50, step: 0.5, default: 5 },
    ],
  },
  {
    id: 'drug_interaction',
    name: 'Drug Interaction (Bliss Independence)',
    description: 'Assess drug combination synergy via Bliss independence model',
    icon: <FiBarChart2 />,
    params: [
      { key: 'drugA_effect', label: 'Drug A Effect', min: 0.05, max: 0.95, step: 0.01, default: 0.4 },
      { key: 'drugB_effect', label: 'Drug B Effect', min: 0.05, max: 0.95, step: 0.01, default: 0.3 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Simulation runners                                                */
/* ------------------------------------------------------------------ */

function runClinicalOutcome(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    const controlEvents = randBinomial(p.sampleSize, p.baselineRate);
    const txRate = Math.max(0.001, p.baselineRate - p.treatmentEffect);
    const txEvents = randBinomial(p.sampleSize, txRate);
    const riskDiff = controlEvents / p.sampleSize - txEvents / p.sampleSize;
    results.push(riskDiff);
  }
  return results;
}

function runDoseResponse(p: Record<string, number>, iters: number): number[] {
  const doses = [0.1, 0.3, 1, 3, 10, 30, 100];
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    const observations = doses.map((d) => {
      const trueResponse = p.emax * Math.pow(d, p.hillCoeff) /
        (Math.pow(p.ec50, p.hillCoeff) + Math.pow(d, p.hillCoeff));
      return { dose: d, response: trueResponse + randNorm(0, p.noiseSD) };
    });
    // Bisection to find EC50 (dose at half-max response)
    const maxResp = Math.max(...observations.map((o) => o.response));
    const halfMax = maxResp / 2;
    let lo = 0.01, hi = 200;
    for (let j = 0; j < 30; j++) {
      const mid = (lo + hi) / 2;
      // Interpolate response at mid from observations
      let interpResp = 0;
      for (let k = 0; k < observations.length - 1; k++) {
        if (observations[k].dose <= mid && observations[k + 1].dose >= mid) {
          const frac = (mid - observations[k].dose) /
            (observations[k + 1].dose - observations[k].dose);
          interpResp = observations[k].response +
            frac * (observations[k + 1].response - observations[k].response);
          break;
        }
      }
      if (mid > observations[observations.length - 1].dose) {
        interpResp = maxResp;
      }
      if (interpResp < halfMax) lo = mid;
      else hi = mid;
    }
    results.push((lo + hi) / 2);
  }
  return results;
}

function runSurvivalAnalysis(p: Record<string, number>, iters: number): number[] {
  const shape = 1.5;
  const scaleControl = p.medianSurvivalControl / Math.pow(Math.log(2), 1 / shape);
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    const controlTimes: number[] = [];
    const txTimes: number[] = [];
    for (let j = 0; j < p.sampleSize; j++) {
      const uC = Math.random();
      controlTimes.push(scaleControl * Math.pow(-Math.log(1 - uC), 1 / shape));
      const scaleTx = scaleControl * Math.pow(1 / p.hazardRatio, 1 / shape);
      const uT = Math.random();
      txTimes.push(scaleTx * Math.pow(-Math.log(1 - uT), 1 / shape));
    }
    controlTimes.sort((a, b) => a - b);
    txTimes.sort((a, b) => a - b);
    const medianControl = controlTimes[Math.floor(controlTimes.length / 2)];
    const medianTx = txTimes[Math.floor(txTimes.length / 2)];
    results.push(medianTx - medianControl);
  }
  return results;
}

function runEpidemiological(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  const dt = 1;
  for (let i = 0; i < iters; i++) {
    let S = p.population - p.initialInfected;
    let I = p.initialInfected;
    let peakI = I;
    for (let t = 0; t < 365 && I > 0; t++) {
      const pInfect = 1 - Math.exp(-p.beta * I / p.population * dt);
      const pRecover = 1 - Math.exp(-p.gamma * dt);
      const newInfected = randBinomial(Math.round(S), Math.min(pInfect, 1));
      const newRecovered = randBinomial(Math.round(I), Math.min(pRecover, 1));
      S = S - newInfected;
      I = I + newInfected - newRecovered;
      if (I < 0) I = 0;
      if (I > peakI) peakI = I;
    }
    results.push(peakI);
  }
  return results;
}

function runPathwayDynamics(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  const tMax = 100;
  for (let i = 0; i < iters; i++) {
    let mRNA = 0;
    let protein = 0;
    let t = 0;
    while (t < tMax) {
      const r1 = p.transcriptionRate;           // mRNA production
      const r2 = p.degradationRate * mRNA;      // mRNA degradation
      const r3 = p.translationRate * mRNA;      // protein production
      const r4 = p.degradationRate * 0.3 * protein; // protein degradation
      const totalRate = r1 + r2 + r3 + r4;
      if (totalRate === 0) break;
      const dt = randExponential(totalRate);
      t += dt;
      if (t > tMax) break;
      const rand = Math.random() * totalRate;
      if (rand < r1) {
        mRNA++;
      } else if (rand < r1 + r2) {
        mRNA = Math.max(0, mRNA - 1);
      } else if (rand < r1 + r2 + r3) {
        protein++;
      } else {
        protein = Math.max(0, protein - 1);
      }
    }
    results.push(protein);
  }
  return results;
}

function runDrugInteraction(p: Record<string, number>, iters: number): number[] {
  const expected = 1 - (1 - p.drugA_effect) * (1 - p.drugB_effect);
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    const noisyA = Math.max(0, Math.min(1, p.drugA_effect + randNorm(0, 0.05)));
    const noisyB = Math.max(0, Math.min(1, p.drugB_effect + randNorm(0, 0.05)));
    const observed = 1 - (1 - noisyA) * (1 - noisyB) + randNorm(0, 0.03);
    const ci = observed / expected;
    results.push(ci);
  }
  return results;
}

const RESULT_LABELS: Record<SimulationType, string> = {
  clinical_outcome: 'Risk Difference',
  dose_response: 'Estimated EC50',
  survival_analysis: 'Median Survival Difference (months)',
  epidemiological: 'Peak Infected Count',
  pathway_dynamics: 'Steady-State Protein Level',
  drug_interaction: 'Combination Index',
};

function runSimulation(
  type: SimulationType,
  params: Record<string, number>,
  iterations: number,
): SimResults {
  let values: number[];
  switch (type) {
    case 'clinical_outcome':
      values = runClinicalOutcome(params, iterations);
      break;
    case 'dose_response':
      values = runDoseResponse(params, iterations);
      break;
    case 'survival_analysis':
      values = runSurvivalAnalysis(params, iterations);
      break;
    case 'epidemiological':
      values = runEpidemiological(params, iterations);
      break;
    case 'pathway_dynamics':
      values = runPathwayDynamics(params, iterations);
      break;
    case 'drug_interaction':
      values = runDrugInteraction(params, iterations);
      break;
  }

  // Build convergence series
  const convergence: { iteration: number; runningMean: number }[] = [];
  let sum = 0;
  const step = Math.max(1, Math.floor(iterations / 200));
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i % step === 0 || i === values.length - 1) {
      convergence.push({ iteration: i + 1, runningMean: sum / (i + 1) });
    }
  }

  return { values, convergence, label: RESULT_LABELS[type] };
}

/* ------------------------------------------------------------------ */
/*  Stats helpers                                                     */
/* ------------------------------------------------------------------ */

function computeStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  const ci95Low = sorted[Math.floor(n * 0.025)];
  const ci95High = sorted[Math.floor(n * 0.975)];
  return { mean, median, std, ci95Low, ci95High };
}

function buildHistogram(values: number[], bins = 20) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const binWidth = range / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / binWidth));
    counts[idx]++;
  }
  return counts.map((count, i) => ({
    bin: (min + (i + 0.5) * binWidth).toPrecision(4),
    count,
  }));
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    padding: '20px 24px 32px',
    color: 'var(--color-text)',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  heading: {
    fontSize: 16,
    fontWeight: 600,
    margin: 0,
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--color-text-muted)',
    margin: '2px 0 0',
  },
  grid3x2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 8,
  },
  card: {
    background: 'var(--glass-bg)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  },
  cardSelected: {
    borderColor: 'var(--color-accent-blue)',
    background: 'rgba(59, 130, 246, 0.08)',
  },
  cardName: {
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
    color: 'var(--color-text)',
  },
  cardDesc: {
    fontSize: 11,
    color: 'var(--color-text-muted)',
    lineHeight: 1.35,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.4fr)',
    gap: 16,
  },
  panel: {
    background: 'var(--glass-bg)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 14,
    minWidth: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--color-text-muted)',
    marginBottom: 4,
  },
  slider: {
    width: '100%',
    accentColor: 'var(--color-accent-blue)',
  },
  input: {
    width: 80,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid var(--glass-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 12,
    textAlign: 'right' as const,
    outline: 'none',
  },
  runBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '9px 0',
    borderRadius: 6,
    border: 'none',
    background: 'var(--color-accent-blue)',
    color: '#fff',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    marginTop: 'auto',
  },
  statsTable: {
    width: '100%',
    fontSize: 12,
    borderCollapse: 'collapse' as const,
  },
  td: {
    padding: '6px 8px',
    borderBottom: '1px solid var(--glass-border)',
  },
  exportRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  exportBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 6,
    border: '1px solid var(--glass-border)',
    background: 'var(--glass-bg)',
    color: 'var(--color-text-secondary)',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 500,
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function MonteCarloPanel() {
  const [selectedType, setSelectedType] = useState<SimulationType>('clinical_outcome');
  const [iterations, setIterations] = useState(5000);
  const [paramValues, setParamValues] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const sim of SIMULATIONS) {
      init[sim.id] = {};
      for (const p of sim.params) {
        init[sim.id][p.key] = p.default;
      }
    }
    return init;
  });
  const [results, setResults] = useState<SimResults | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSim = useMemo(
    () => SIMULATIONS.find((s) => s.id === selectedType)!,
    [selectedType],
  );

  const currentParams = paramValues[selectedType];

  const setParam = useCallback(
    (key: string, value: number) => {
      setParamValues((prev) => ({
        ...prev,
        [selectedType]: { ...prev[selectedType], [key]: value },
      }));
    },
    [selectedType],
  );

  const handleRun = useCallback(() => {
    setRunning(true);
    // Defer to allow UI update
    setTimeout(() => {
      const res = runSimulation(selectedType, currentParams, iterations);
      setResults(res);
      setRunning(false);
    }, 20);
  }, [selectedType, currentParams, iterations]);

  const stats = useMemo(() => {
    if (!results) return null;
    return computeStats(results.values);
  }, [results]);

  const histogram = useMemo(() => {
    if (!results) return [];
    return buildHistogram(results.values, 20);
  }, [results]);

  const fmt = (v: number) => {
    if (Math.abs(v) >= 1000) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(3);
    return v.toPrecision(4);
  };

  const handleCopy = useCallback(() => {
    if (!results || !stats) return;
    const text = [
      `Simulation: ${activeSim.name}`,
      `Iterations: ${results.values.length}`,
      `Mean: ${fmt(stats.mean)}`,
      `Median: ${fmt(stats.median)}`,
      `Std Dev: ${fmt(stats.std)}`,
      `95% CI: [${fmt(stats.ci95Low)}, ${fmt(stats.ci95High)}]`,
    ].join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [results, stats, activeSim]);

  const handleExportJSON = useCallback(() => {
    if (!results || !stats) return;
    const blob = new Blob(
      [JSON.stringify({ simulation: activeSim.name, params: currentParams, iterations, stats, values: results.values }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monte_carlo_${selectedType}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results, stats, activeSim, currentParams, iterations, selectedType]);

  const handleExportCSV = useCallback(() => {
    if (!results) return;
    const header = 'iteration,value\n';
    const rows = results.values.map((v, i) => `${i + 1},${v}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monte_carlo_${selectedType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results, selectedType]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div>
        <h2 style={styles.heading}>Monte Carlo Simulations</h2>
        <p style={styles.subtitle}>
          Select a model, configure parameters, and inspect the output distribution.
        </p>
      </div>

      {/* Simulation selector */}
      <div style={styles.grid3x2}>
        {SIMULATIONS.map((sim) => (
          <div
            key={sim.id}
            style={{
              ...styles.card,
              ...(selectedType === sim.id ? styles.cardSelected : {}),
            }}
            className={clsx(selectedType === sim.id && 'selected')}
            onClick={() => setSelectedType(sim.id)}
          >
            <div style={styles.cardName}>
              {sim.icon}
              {sim.name}
            </div>
            <div style={styles.cardDesc}>{sim.description}</div>
          </div>
        ))}
      </div>

      {/* Two-column layout: params | results */}
      <div style={styles.columns}>
        {/* Left column: parameters */}
        <div style={styles.panel}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Parameters</h3>

          {activeSim.params.map((p) => (
            <div key={p.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={styles.label}>{p.label}</label>
                <input
                  type="number"
                  style={styles.input}
                  value={currentParams[p.key]}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setParam(p.key, Math.max(p.min, Math.min(p.max, v)));
                  }}
                />
              </div>
              <input
                type="range"
                style={styles.slider}
                min={p.min}
                max={p.max}
                step={p.step}
                value={currentParams[p.key]}
                onChange={(e) => setParam(p.key, parseFloat(e.target.value))}
              />
            </div>
          ))}

          {/* Iterations */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>Iterations</label>
              <input
                type="number"
                style={styles.input}
                value={iterations}
                min={100}
                max={50000}
                step={100}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setIterations(Math.max(100, Math.min(50000, v)));
                }}
              />
            </div>
            <input
              type="range"
              style={styles.slider}
              min={100}
              max={50000}
              step={100}
              value={iterations}
              onChange={(e) => setIterations(parseInt(e.target.value, 10))}
            />
          </div>

          {/* Run button */}
          <button style={styles.runBtn} onClick={handleRun} disabled={running}>
            {running ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : <FiPlay />}
            {running ? 'Running...' : 'Run Simulation'}
          </button>
        </div>

        {/* Right column: results */}
        <div style={styles.panel}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Results</h3>

          {!results && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 12, minHeight: 180 }}>
              Configure parameters and run a simulation to see results.
            </div>
          )}

          {results && stats && (
            <>
              {/* Summary stats table */}
              <table style={styles.statsTable}>
                <tbody>
                  <tr>
                    <td style={{ ...styles.td, fontWeight: 600 }}>Metric</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{results.label}</td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Mean</td>
                    <td style={styles.td}>{fmt(stats.mean)}</td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Median</td>
                    <td style={styles.td}>{fmt(stats.median)}</td>
                  </tr>
                  <tr>
                    <td style={styles.td}>Std Dev</td>
                    <td style={styles.td}>{fmt(stats.std)}</td>
                  </tr>
                  <tr>
                    <td style={styles.td}>95% CI</td>
                    <td style={styles.td}>
                      [{fmt(stats.ci95Low)}, {fmt(stats.ci95High)}]
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Histogram */}
              <div>
                <div style={{ ...styles.label, marginBottom: 8 }}>Distribution Histogram</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={histogram}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                    <XAxis dataKey="bin" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Convergence plot */}
              <div>
                <div style={{ ...styles.label, marginBottom: 8 }}>Convergence (Running Mean)</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={results.convergence}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                    <XAxis dataKey="iteration" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="runningMean"
                      stroke="var(--color-accent-blue)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom: export buttons */}
      {results && (
        <div style={styles.exportRow}>
          <button style={styles.exportBtn} onClick={handleExportJSON}>
            <FiDownload /> Export JSON
          </button>
          <button style={styles.exportBtn} onClick={handleExportCSV}>
            <FiDownload /> Export CSV
          </button>
          <button style={styles.exportBtn} onClick={handleCopy}>
            {copied ? <FiCheck /> : <FiCopy />}
            {copied ? 'Copied!' : 'Copy Results'}
          </button>
        </div>
      )}
    </div>
  );
}

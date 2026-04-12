import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, AreaChart, Area, Brush, Legend,
} from 'recharts';
import {
  FiPlay, FiActivity, FiBarChart2, FiCopy, FiDownload,
  FiLoader, FiCheck, FiTarget, FiHeart, FiZap, FiDatabase,
  FiRefreshCw, FiTrendingUp, FiPercent, FiSliders,
} from 'react-icons/fi';


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
  | 'drug_interaction'
  | 'bootstrap'
  | 'pk_variability'
  | 'random_walk'
  | 'pi_estimation'
  | 'bayesian_coin'
  | 'protein_folding';

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
  {
    id: 'bootstrap',
    name: 'Bootstrap Resampling',
    description: 'Estimate confidence intervals via non-parametric bootstrap',
    icon: <FiActivity />,
    params: [
      { key: 'sampleSize', label: 'Sample Size', min: 10, max: 500, step: 5, default: 50 },
      { key: 'trueMean', label: 'True Mean', min: 0, max: 200, step: 1, default: 100 },
      { key: 'trueSD', label: 'True SD', min: 1, max: 50, step: 1, default: 15 },
    ],
  },
  {
    id: 'pk_variability',
    name: 'PK Population Variability',
    description: 'Simulate inter-individual variability in drug concentration profiles',
    icon: <FiHeart />,
    params: [
      { key: 'dose', label: 'Dose (mg)', min: 10, max: 1000, step: 10, default: 200 },
      { key: 'clMean', label: 'Mean CL (L/h)', min: 1, max: 100, step: 1, default: 20 },
      { key: 'clCV', label: 'CL %CV', min: 5, max: 100, step: 5, default: 30 },
      { key: 'vMean', label: 'Mean Vd (L)', min: 10, max: 500, step: 10, default: 100 },
    ],
  },
  {
    id: 'random_walk',
    name: 'Random Walk (Brownian Motion)',
    description: 'Simulate 1D Brownian motion — models diffusion, stock prices, molecular motion',
    icon: <FiZap />,
    params: [
      { key: 'steps', label: 'Steps', min: 50, max: 5000, step: 50, default: 500 },
      { key: 'stepSD', label: 'Step Size SD', min: 0.1, max: 5, step: 0.1, default: 1 },
    ],
  },
  {
    id: 'pi_estimation',
    name: 'Pi Estimation',
    description: 'Estimate pi using random points in a unit square (classic MC demo)',
    icon: <FiTarget />,
    params: [
      { key: 'dummy', label: 'Points per trial', min: 100, max: 100000, step: 100, default: 10000 },
    ],
  },
  {
    id: 'bayesian_coin',
    name: 'Bayesian Inference (Coin Flip)',
    description: 'Update prior belief about coin fairness via Bayesian updating',
    icon: <FiDatabase />,
    params: [
      { key: 'trueBias', label: 'True P(Heads)', min: 0.05, max: 0.95, step: 0.05, default: 0.6 },
      { key: 'nFlips', label: 'Flips per trial', min: 5, max: 500, step: 5, default: 50 },
    ],
  },
  {
    id: 'protein_folding',
    name: 'Protein Folding (Energy Landscape)',
    description: 'Simulate folding on a simplified energy landscape with thermal fluctuations',
    icon: <FiActivity />,
    params: [
      { key: 'temperature', label: 'Temperature (kT)', min: 0.1, max: 5, step: 0.1, default: 1 },
      { key: 'nSteps', label: 'Steps', min: 100, max: 10000, step: 100, default: 1000 },
    ],
  },
];

/* Simulation categories for the overlay library */
const SIM_CATEGORIES: { name: string; ids: SimulationType[] }[] = [
  { name: 'Clinical & PK', ids: ['clinical_outcome', 'dose_response', 'survival_analysis', 'drug_interaction', 'pk_variability'] },
  { name: 'Epidemiology & Population', ids: ['epidemiological', 'bootstrap', 'bayesian_coin'] },
  { name: 'Molecular & Cellular', ids: ['pathway_dynamics', 'protein_folding'] },
  { name: 'General Probability', ids: ['random_walk', 'pi_estimation'] },
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

function runBootstrap(p: Record<string, number>, iters: number): number[] {
  // Generate one sample, then bootstrap its mean
  const sample: number[] = [];
  for (let i = 0; i < p.sampleSize; i++) sample.push(randNorm(p.trueMean, p.trueSD));
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < sample.length; j++) sum += sample[Math.floor(Math.random() * sample.length)];
    results.push(sum / sample.length);
  }
  return results;
}

function runPKVariability(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    const cl = Math.max(0.1, randNorm(p.clMean, p.clMean * p.clCV / 100));
    const ke = cl / p.vMean;
    const c0 = p.dose / p.vMean;
    // AUC = C0 / ke
    results.push(c0 / ke);
  }
  return results;
}

function runRandomWalk(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    let pos = 0;
    for (let s = 0; s < p.steps; s++) pos += randNorm(0, p.stepSD);
    results.push(pos);
  }
  return results;
}

function runPiEstimation(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    let inside = 0;
    for (let j = 0; j < p.dummy; j++) {
      const x = Math.random(), y = Math.random();
      if (x * x + y * y <= 1) inside++;
    }
    results.push(4 * inside / p.dummy);
  }
  return results;
}

function runBayesianCoin(p: Record<string, number>, iters: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    let heads = 0;
    for (let j = 0; j < p.nFlips; j++) if (Math.random() < p.trueBias) heads++;
    // Posterior mean with uniform prior: (heads+1)/(nFlips+2)
    results.push((heads + 1) / (p.nFlips + 2));
  }
  return results;
}

function runProteinFolding(p: Record<string, number>, iters: number): number[] {
  // Simple 1D energy landscape: E(x) = x^4 - 2*x^2 (two minima at +-1)
  const results: number[] = [];
  for (let i = 0; i < iters; i++) {
    let x = randNorm(0, 2);
    for (let s = 0; s < p.nSteps; s++) {
      const xNew = x + randNorm(0, 0.3);
      const eOld = Math.pow(x, 4) - 2 * Math.pow(x, 2);
      const eNew = Math.pow(xNew, 4) - 2 * Math.pow(xNew, 2);
      const dE = eNew - eOld;
      if (dE < 0 || Math.random() < Math.exp(-dE / p.temperature)) x = xNew;
    }
    results.push(x);
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
  bootstrap: 'Bootstrap Mean Estimate',
  pk_variability: 'AUC (mg·h/L)',
  random_walk: 'Final Position',
  pi_estimation: 'Pi Estimate',
  bayesian_coin: 'Posterior P(Heads)',
  protein_folding: 'Final Conformation (x)',
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
    case 'bootstrap':
      values = runBootstrap(params, iterations);
      break;
    case 'pk_variability':
      values = runPKVariability(params, iterations);
      break;
    case 'random_walk':
      values = runRandomWalk(params, iterations);
      break;
    case 'pi_estimation':
      values = runPiEstimation(params, iterations);
      break;
    case 'bayesian_coin':
      values = runBayesianCoin(params, iterations);
      break;
    case 'protein_folding':
      values = runProteinFolding(params, iterations);
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

// buildHistogram is now inline in histogramEnriched useMemo

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
    borderColor: 'var(--color-border-strong)',
    background: 'var(--glass-bg-hover)',
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
    accentColor: 'var(--color-text)',
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
    gap: 6,
    padding: '5px 14px',
    borderRadius: 6,
    border: '1px solid var(--color-border-strong)',
    background: 'var(--glass-bg-hover)',
    color: 'var(--color-text)',
    fontWeight: 600,
    fontSize: 11,
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap' as const,
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
    gap: 4,
    padding: '5px 8px',
    borderRadius: 5,
    border: '1px solid var(--glass-border)',
    background: 'var(--glass-bg)',
    color: 'var(--color-text-secondary)',
    fontSize: 10,
    cursor: 'pointer',
    fontWeight: 500,
  },
  plotChip: {
    padding: '4px 10px',
    borderRadius: 5,
    border: '1px solid var(--glass-border)',
    background: 'var(--glass-bg)',
    color: 'var(--color-text-secondary)',
    fontSize: 11,
    cursor: 'pointer',
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function MonteCarloPanel() {
  const [selectedType, setSelectedType] = useState<SimulationType>('clinical_outcome');
  const [iterations, setIterations] = useState(5000);
  const [showLibrary, setShowLibrary] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const [activeChart, setActiveChart] = useState<'histogram' | 'convergence' | 'cdf'>('histogram');
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
  const [_runHistory, setRunHistory] = useState<{ type: SimulationType; params: Record<string, number>; mean: number; std: number; timestamp: number }[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Record in history
      const s = computeStats(res.values);
      setRunHistory(prev => [...prev.slice(-19), { type: selectedType, params: { ...currentParams }, mean: s.mean, std: s.std, timestamp: Date.now() }]);
    }, 20);
  }, [selectedType, currentParams, iterations]);

  // Auto-run on parameter/iteration change with debounce
  useEffect(() => {
    if (!autoRun) return;
    if (autoRunRef.current) clearTimeout(autoRunRef.current);
    autoRunRef.current = setTimeout(() => {
      handleRun();
    }, 350);
    return () => { if (autoRunRef.current) clearTimeout(autoRunRef.current); };
  }, [autoRun, selectedType, currentParams, iterations]); // eslint-disable-line

  // CDF data
  const cdfData = useMemo(() => {
    if (!results) return [];
    const sorted = [...results.values].sort((a, b) => a - b);
    const n = sorted.length;
    const step = Math.max(1, Math.floor(n / 200));
    const data: { value: number; percentile: number }[] = [];
    for (let i = 0; i < n; i += step) {
      data.push({ value: sorted[i], percentile: ((i + 1) / n) * 100 });
    }
    return data;
  }, [results]);

  const stats = useMemo(() => {
    if (!results) return null;
    return computeStats(results.values);
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

  const chartTabs: { id: 'histogram' | 'convergence' | 'cdf'; label: string; icon: React.ReactNode }[] = [
    { id: 'histogram', label: 'Distribution', icon: <FiBarChart2 style={{ fontSize: 10 }} /> },
    { id: 'convergence', label: 'Convergence', icon: <FiTrendingUp style={{ fontSize: 10 }} /> },
    { id: 'cdf', label: 'CDF', icon: <FiPercent style={{ fontSize: 10 }} /> },
  ];

  // Histogram with enriched bins (storing numeric midpoint for reference lines).
  // Single-pass min/max loop — Math.min(...vals) would blow the argument
  // limit at the higher iteration counts (the slider allows up to 50 000).
  const histogramEnriched = useMemo(() => {
    if (!results) return [];
    // Drop NaN/Infinity so the binner doesn't anchor to bogus extrema —
    // a single rogue value makes min=-Infinity / max=Infinity and the
    // whole range collapses into one bin with 'NaN' labels that Recharts
    // can't coerce to a numeric axis.
    const vals = results.values.filter(v => Number.isFinite(v));
    if (vals.length === 0) return [];
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    const range = max - min || 1;
    const bins = 30;
    const binWidth = range / bins;
    const counts = new Array(bins).fill(0);
    for (const v of vals) {
      const idx = Math.min(bins - 1, Math.floor((v - min) / binWidth));
      counts[idx]++;
    }
    return counts.map((count, i) => ({
      bin: (min + (i + 0.5) * binWidth).toPrecision(4),
      binMid: min + (i + 0.5) * binWidth,
      count,
      density: count / (vals.length * binWidth),
    }));
  }, [results]);

  return (
    <div style={styles.container}>
      {/* ── Top toolbar ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          style={{ ...styles.plotChip, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={() => setShowLibrary(true)}
        ><FiSliders style={{ fontSize: 10 }} /> Library</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
          {activeSim.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1 }}>
          {activeSim.description}
        </span>

        {/* Auto-run toggle */}
        <button
          style={{
            ...styles.plotChip,
            display: 'flex', alignItems: 'center', gap: 4,
            borderColor: autoRun ? 'var(--color-border-strong)' : 'var(--glass-border)',
            background: autoRun ? 'var(--glass-bg-hover)' : 'var(--glass-bg)',
          }}
          onClick={() => setAutoRun(!autoRun)}
          title={autoRun ? 'Auto-run enabled — simulation re-runs on parameter changes' : 'Auto-run disabled — click Run manually'}
        >
          <FiRefreshCw style={{ fontSize: 10 }} />
          <span style={{ fontSize: 10 }}>Auto</span>
        </button>

        <button style={styles.runBtn} onClick={handleRun} disabled={running}>
          {running ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : <FiPlay />}
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      {/* ── Main content: left parameters + right results ─────────── */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left panel: reactive sliders ─────────────────────────── */}
        <div style={{ ...styles.panel, width: 280, flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 2 }}>
            Parameters
          </div>

          {activeSim.params.map((p) => {
            const val = currentParams[p.key];
            const pct = ((val - p.min) / (p.max - p.min)) * 100;
            return (
              <div key={p.key} style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{p.label}</label>
                  <input
                    type="number"
                    style={{ ...styles.input, width: 72, fontSize: 11 }}
                    value={val}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) setParam(p.key, Math.max(p.min, Math.min(p.max, v)));
                    }}
                  />
                </div>
                <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={val}
                    onChange={(e) => setParam(p.key, parseFloat(e.target.value))}
                    style={{ ...styles.slider, margin: 0 }}
                  />
                  {/* Progress fill indicator */}
                  <div style={{
                    position: 'absolute', top: '50%', left: 0, height: 3,
                    width: `${pct}%`, borderRadius: 2,
                    background: 'var(--color-text)', opacity: 0.15,
                    pointerEvents: 'none', transform: 'translateY(-50%)',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6 }}>{p.min}</span>
                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6 }}>{p.max}</span>
                </div>
              </div>
            );
          })}

          {/* Iterations slider */}
          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 10, marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Iterations</label>
              <input
                type="number"
                style={{ ...styles.input, width: 72, fontSize: 11 }}
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
              min={100}
              max={50000}
              step={100}
              value={iterations}
              onChange={(e) => setIterations(parseInt(e.target.value, 10))}
              style={styles.slider}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6 }}>100</span>
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6 }}>50,000</span>
            </div>
          </div>
        </div>

        {/* ── Right panel: results ─────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, overflow: 'hidden' }}>

          {/* Stats cards row */}
          {results && stats ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Mean', value: fmt(stats.mean), color: '#5B8DB8' },
                  { label: 'Median', value: fmt(stats.median), color: '#8B7EAF' },
                  { label: 'Std Dev', value: fmt(stats.std), color: '#C4956A' },
                  { label: '95% CI', value: `${fmt(stats.ci95Low)} — ${fmt(stats.ci95High)}`, color: '#6BA594' },
                ].map((s) => (
                  <div key={s.label} style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    borderLeft: `3px solid ${s.color}`,
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--color-text)', lineHeight: 1.2 }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Chart tabs + chart */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 6 }}>
                  {chartTabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveChart(tab.id)}
                      style={{
                        ...styles.plotChip,
                        display: 'flex', alignItems: 'center', gap: 3,
                        borderColor: activeChart === tab.id ? 'var(--color-border-strong)' : 'var(--glass-border)',
                        background: activeChart === tab.id ? 'var(--glass-bg-hover)' : 'transparent',
                        fontWeight: activeChart === tab.id ? 600 : 400,
                        fontSize: 10,
                      }}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                    {results.label} &middot; {results.values.length.toLocaleString()} iterations
                  </span>
                  <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                    <button style={styles.exportBtn} onClick={handleExportJSON}><FiDownload style={{ fontSize: 9 }} /> JSON</button>
                    <button style={styles.exportBtn} onClick={handleExportCSV}><FiDownload style={{ fontSize: 9 }} /> CSV</button>
                    <button style={styles.exportBtn} onClick={handleCopy}>
                      {copied ? <FiCheck style={{ fontSize: 9 }} /> : <FiCopy style={{ fontSize: 9 }} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0 }}>
                  {activeChart === 'histogram' && (() => {
                    // Recharts ReferenceLine on a category axis needs an exact
                    // bin label, so we snap each stat to its nearest bin midpoint.
                    // Guard: if the histogram is empty (no results, or all-NaN
                    // values collapsing bins), return null so the reference
                    // line is omitted entirely instead of rendering with
                    // `x={undefined}` which crashes Recharts.
                    const snap = (v: number): string | null => {
                      if (!histogramEnriched.length || !Number.isFinite(v)) return null
                      let closest: string | null = null
                      let minD = Infinity
                      for (const h of histogramEnriched) {
                        if (!Number.isFinite(h.binMid)) continue
                        const d = Math.abs(h.binMid - v)
                        if (d < minD) { minD = d; closest = h.bin }
                      }
                      return closest
                    }
                    const meanBin = snap(stats.mean)
                    const medianBin = snap(stats.median)
                    const ciLoBin = snap(stats.ci95Low)
                    const ciHiBin = snap(stats.ci95High)
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={histogramEnriched} margin={{ top: 8, right: 16, bottom: 30, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                          <XAxis dataKey="bin" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" stroke="var(--glass-border)" label={{ value: results.label, position: 'insideBottom', offset: -12, fontSize: 10, fill: 'var(--color-text-muted)' }} />
                          <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--color-text-muted)' }} />
                          <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} cursor={{ stroke: 'var(--color-text-muted)', strokeDasharray: '4 4' }} />
                          {ciLoBin && <ReferenceLine x={ciLoBin} stroke="#6BA594" strokeWidth={1} strokeDasharray="2 3" label={{ value: '2.5%', position: 'top', fontSize: 8, fill: '#6BA594' }} />}
                          {ciHiBin && <ReferenceLine x={ciHiBin} stroke="#6BA594" strokeWidth={1} strokeDasharray="2 3" label={{ value: '97.5%', position: 'top', fontSize: 8, fill: '#6BA594' }} />}
                          {medianBin && <ReferenceLine x={medianBin} stroke="#8B7EAF" strokeWidth={1.5} strokeDasharray="3 3" label={{ value: 'Median', position: 'top', fontSize: 9, fill: '#8B7EAF' }} />}
                          {meanBin && <ReferenceLine x={meanBin} stroke="#5B8DB8" strokeWidth={2} strokeDasharray="4 3" label={{ value: 'Mean', position: 'top', fontSize: 9, fill: '#5B8DB8' }} />}
                          <Bar dataKey="count" fill="#5B8DB8" fillOpacity={0.35} radius={[2, 2, 0, 0]} />
                          {histogramEnriched.length > 8 && <Brush dataKey="bin" height={16} stroke="#5B8DB8" fill="var(--glass-bg)" travellerWidth={6} />}
                        </BarChart>
                      </ResponsiveContainer>
                    )
                  })()}

                  {activeChart === 'convergence' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={results.convergence} margin={{ top: 8, right: 16, bottom: 30, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="iteration" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" label={{ value: 'Iteration', position: 'insideBottom', offset: -12, fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" label={{ value: 'Running Mean', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} cursor={{ stroke: 'var(--color-text-muted)', strokeDasharray: '4 4' }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={stats.mean} stroke="#5B8DB8" strokeDasharray="4 3" strokeWidth={1} label={{ value: `Final: ${fmt(stats.mean)}`, position: 'right', fontSize: 9, fill: '#5B8DB8' }} />
                        <Line type="monotone" dataKey="runningMean" name="Running Mean" stroke="#8B7EAF" strokeWidth={2} dot={false} />
                        {results.convergence.length > 10 && <Brush dataKey="iteration" height={16} stroke="#8B7EAF" fill="var(--glass-bg)" travellerWidth={6} />}
                      </LineChart>
                    </ResponsiveContainer>
                  )}

                  {activeChart === 'cdf' && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cdfData} margin={{ top: 8, right: 16, bottom: 30, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="value" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" type="number" label={{ value: results.label, position: 'insideBottom', offset: -12, fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" domain={[0, 100]} label={{ value: 'Percentile (%)', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--color-text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} cursor={{ stroke: 'var(--color-text-muted)', strokeDasharray: '4 4' }} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                        <ReferenceLine y={50} stroke="#C4956A" strokeDasharray="4 3" strokeWidth={1} label={{ value: 'Median', position: 'right', fontSize: 9, fill: '#C4956A' }} />
                        <Area type="monotone" dataKey="percentile" stroke="#6BA594" fill="#6BA594" fillOpacity={0.15} strokeWidth={2} dot={false} />
                        {cdfData.length > 10 && <Brush dataKey="value" height={16} stroke="#6BA594" fill="var(--glass-bg)" travellerWidth={6} />}
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-text-muted)', gap: 8,
            }}>
              <FiActivity style={{ fontSize: 28, opacity: 0.3 }} />
              <div style={{ fontSize: 12 }}>
                {autoRun ? 'Adjust sliders to run simulation automatically' : 'Configure parameters and click Run'}
              </div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>
                Choose from {SIMULATIONS.length} biomedical simulations in the Library
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Library overlay ──────────────────────────────────────── */}
      {showLibrary && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowLibrary(false) }}
        >
          <div style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--glass-border)',
            borderRadius: 12,
            width: 620, maxWidth: '92vw', maxHeight: '80vh',
            overflow: 'auto',
            padding: '24px 28px',
            boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
                  Simulation Library
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {SIMULATIONS.length} biomedical Monte Carlo simulations
                </p>
              </div>
              <button
                style={{ ...styles.plotChip, fontSize: 11, padding: '5px 12px' }}
                onClick={() => setShowLibrary(false)}
              >Close</button>
            </div>
            {SIM_CATEGORIES.map(cat => (
              <div key={cat.name} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  {cat.name} &middot; {cat.ids.length}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                  {cat.ids.map(id => {
                    const sim = SIMULATIONS.find(s => s.id === id)!;
                    const isActive = selectedType === id;
                    return (
                      <div
                        key={id}
                        style={{
                          ...styles.card,
                          ...(isActive ? styles.cardSelected : {}),
                          padding: '10px 12px',
                          display: 'flex', flexDirection: 'column', gap: 3,
                        }}
                        onClick={() => { setSelectedType(id); setShowLibrary(false); setResults(null); }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {sim.icon} {sim.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                          {sim.description}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6 }}>
                          {sim.params.length} parameter{sim.params.length > 1 ? 's' : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

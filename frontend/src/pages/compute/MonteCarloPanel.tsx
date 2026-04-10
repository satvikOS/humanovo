import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  FiPlay, FiActivity, FiBarChart2, FiCopy, FiDownload,
  FiLoader, FiCheck, FiTarget, FiHeart, FiZap, FiDatabase,
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
      {/* ── Top toolbar ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          style={{ ...styles.plotChip, fontWeight: 600 }}
          onClick={() => setShowLibrary(true)}
        >Library</button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
          {activeSim.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flex: 1 }}>
          {activeSim.description}
        </span>
        <button style={styles.runBtn} onClick={handleRun} disabled={running}>
          {running ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : <FiPlay />}
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      {/* ── Compact parameters row ───────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {activeSim.params.map((p) => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{p.label}</label>
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
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Iterations</label>
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
      </div>

      {/* ── Results ──────────────────────────────────────────────── */}
      {!results && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 12, minHeight: 200 }}>
          Select a simulation from the Library, configure parameters, and click Run.
        </div>
      )}

      {results && stats && (
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* Left: stats + export */}
          <div style={{ ...styles.panel, width: 220, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>{results.label}</div>
            <table style={styles.statsTable}>
              <tbody>
                {[
                  ['Mean', fmt(stats.mean)],
                  ['Median', fmt(stats.median)],
                  ['Std Dev', fmt(stats.std)],
                  ['95% CI', `[${fmt(stats.ci95Low)}, ${fmt(stats.ci95High)}]`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...styles.td, fontSize: 11 }}>{k}</td>
                    <td style={{ ...styles.td, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ ...styles.exportRow, marginTop: 8 }}>
              <button style={styles.exportBtn} onClick={handleExportJSON}><FiDownload /> JSON</button>
              <button style={styles.exportBtn} onClick={handleExportCSV}><FiDownload /> CSV</button>
              <button style={styles.exportBtn} onClick={handleCopy}>
                {copied ? <FiCheck /> : <FiCopy />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Right: charts */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Distribution</div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={histogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                  <XAxis dataKey="bin" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" stroke="var(--glass-border)" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" />
                  <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} />
                  <Bar dataKey="count" fill="var(--color-text)" fillOpacity={0.35} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Convergence</div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={results.convergence}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                  <XAxis dataKey="iteration" tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-text-muted)' }} stroke="var(--glass-border)" />
                  <Tooltip contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text)' }} />
                  <Line type="monotone" dataKey="runningMean" stroke="var(--color-text)" strokeWidth={1.5} strokeOpacity={0.55} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── Library overlay ──────────────────────────────────────── */}
      {showLibrary && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowLibrary(false) }}
        >
          <div style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--glass-border)',
            borderRadius: 10,
            width: 560, maxWidth: '90vw', maxHeight: '80vh',
            overflow: 'auto',
            padding: '20px 24px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                Simulation Library
              </h2>
              <button
                style={{ ...styles.plotChip, fontSize: 11 }}
                onClick={() => setShowLibrary(false)}
              >Close</button>
            </div>
            {SIM_CATEGORIES.map(cat => (
              <div key={cat.name} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                  {cat.name}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                  {cat.ids.map(id => {
                    const sim = SIMULATIONS.find(s => s.id === id)!;
                    const isActive = selectedType === id;
                    return (
                      <div
                        key={id}
                        style={{
                          ...styles.card,
                          ...(isActive ? styles.cardSelected : {}),
                          padding: '8px 10px',
                        }}
                        onClick={() => { setSelectedType(id); setShowLibrary(false); setResults(null); }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          {sim.icon} {sim.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.35, marginTop: 2 }}>
                          {sim.description}
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

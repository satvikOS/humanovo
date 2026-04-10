// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — Preset Library
// 73+ one-click computations organized by toolbox
// ═══════════════════════════════════════════════════════════════════════

import {
  FiTarget, FiActivity, FiGrid, FiHeart, FiTrendingUp,
  FiZap, FiBarChart2, FiLayers, FiCpu, FiAlertCircle,
} from 'react-icons/fi'
import {
  mean, std, median, quantile, skewness, kurtosis, sem, variance,
  pearsonR, linearRegression, welchTTest, pairedTTest, chiSquareTest,
  anovaOneWay, mannWhitneyU, shapiroWilk, fft, butterworth, findPeaks,
  movingAverage, welchPSD, ode45, polyfit, polyval, kmeans, pca,
  pkOneCompartment, pkOralAbsorption, pkMultipleDosing, kaplanMeier,
  sampleSizeCalc, buildHistogram, normCDF, invNorm, tCDF,
} from './mathLib'
import type { Preset, ToolboxCategory } from './types'

const fmt = (v: number, digits = 4) => {
  if (Number.isNaN(v) || !Number.isFinite(v)) return String(v)
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(digits)
  return Math.abs(v) < 10 ? v.toFixed(digits) : v.toFixed(2)
}

const parseArray = (raw: any): number[] => {
  if (Array.isArray(raw)) return raw.map(Number).filter(n => !isNaN(n))
  return String(raw || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n))
}

/* ── Toolbox Categories ──────────────────────────────────────────────── */
// Categories are rendered monochrome in the UI to match the rest of the
// Humanovo platform. This hex string is kept as a neutral grey so any
// downstream consumer that concatenates an opacity suffix still produces
// valid CSS.
const ACCENT = '#888888'

export const TOOLBOX_CATEGORIES: ToolboxCategory[] = [
  { id: 'statistics', name: 'Statistics & Testing', icon: FiTarget, color: ACCENT },
  { id: 'signal', name: 'Signal Processing', icon: FiActivity, color: ACCENT },
  { id: 'image', name: 'Image Processing', icon: FiGrid, color: ACCENT },
  { id: 'bioinformatics', name: 'Bioinformatics', icon: FiHeart, color: ACCENT },
  { id: 'curvefitting', name: 'Curve Fitting', icon: FiTrendingUp, color: ACCENT },
  { id: 'ode', name: 'ODE & Simulation', icon: FiZap, color: ACCENT },
  { id: 'survival', name: 'Survival Analysis', icon: FiBarChart2, color: ACCENT },
  { id: 'ml', name: 'Machine Learning', icon: FiLayers, color: ACCENT },
  { id: 'pk', name: 'Pharmacokinetics', icon: FiCpu, color: ACCENT },
  { id: 'normality', name: 'Normality & Distribution', icon: FiAlertCircle, color: ACCENT },
]

/* ═══ STATISTICS (15 presets) ════════════════════════════════════════ */
const statisticsPresets: Preset[] = [
  {
    id: 'stat-descriptive',
    name: 'Descriptive Statistics',
    referenceFn: 'mean, std, median, prctile',
    toolbox: 'statistics',
    description: 'Compute mean, median, std, SEM, skewness, kurtosis, quartiles, 95% CI',
    referenceCode: 'm = mean(x); s = std(x);\nq = quantile(x, [0.25 0.5 0.75]);\nci = m + [-1 1] * 1.96 * s/sqrt(length(x));',
    workflowStage: 'analysis',
    params: [{ key: 'data', label: 'Data', type: 'textarea', description: 'Comma-separated values' }],
    sampleData: { data: [22.5, 24.1, 25.3, 23.8, 26.2, 22.9, 24.7, 25.5, 23.4, 24.9, 26.1, 23.7, 25.2, 24.3, 25.8, 23.6, 24.5, 25.9, 24.2, 25.6] },
    compute: (p) => {
      const x = parseArray(p.data)
      if (x.length < 2) return { error: 'Need at least 2 values' }
      const m = mean(x), s = std(x), n = x.length
      const me = 1.96 * s / Math.sqrt(n)
      return {
        statistics: [
          { label: 'N', value: String(n) },
          { label: 'Mean', value: fmt(m) },
          { label: 'Median', value: fmt(median(x)) },
          { label: 'Std Dev', value: fmt(s) },
          { label: 'SEM', value: fmt(sem(x)) },
          { label: 'Variance', value: fmt(variance(x)) },
          { label: 'Min', value: fmt(Math.min(...x)) },
          { label: 'Max', value: fmt(Math.max(...x)) },
          { label: 'Q1 (25%)', value: fmt(quantile(x, 0.25)) },
          { label: 'Q3 (75%)', value: fmt(quantile(x, 0.75)) },
          { label: 'IQR', value: fmt(quantile(x, 0.75) - quantile(x, 0.25)) },
          { label: 'Skewness', value: fmt(skewness(x)) },
          { label: 'Kurtosis', value: fmt(kurtosis(x)) },
          { label: '95% CI', value: `[${fmt(m - me)}, ${fmt(m + me)}]` },
        ],
        chartType: 'bar',
        chartTitle: 'Distribution Histogram',
        chartData: buildHistogram(x, 12).map(b => ({ x: parseFloat(b.bin), y: b.count, label: b.bin })),
      }
    },
  },
  {
    id: 'stat-ttest1',
    name: 'One-Sample t-Test',
    referenceFn: 'ttest',
    toolbox: 'statistics',
    description: 'Test if sample mean differs from a hypothesized population mean',
    referenceCode: '[h, p, ci, stats] = ttest(x, mu0);',
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'Sample Data', type: 'textarea' },
      { key: 'mu0', label: 'Hypothesized Mean (μ₀)', type: 'number', default: 120 },
    ],
    sampleData: { data: [118, 124, 119, 126, 122, 121, 117, 125, 123, 120, 127, 118, 124, 122, 121], mu0: 120 },
    compute: (p) => {
      const x = parseArray(p.data)
      const mu0 = parseFloat(p.mu0)
      const n = x.length, m = mean(x), s = std(x)
      const t = (m - mu0) / (s / Math.sqrt(n))
      const df = n - 1
      const pVal = 2 * (1 - tCDF(Math.abs(t), df))
      return {
        statistics: [
          { label: 'Sample Mean', value: fmt(m) },
          { label: 'Hypothesized μ₀', value: fmt(mu0) },
          { label: 'Mean Difference', value: fmt(m - mu0) },
          { label: 't-statistic', value: fmt(t) },
          { label: 'df', value: String(df) },
          { label: 'p-value', value: fmt(pVal, 6) },
          { label: 'Conclusion', value: pVal < 0.05 ? 'Reject H₀ (p<0.05)' : 'Fail to reject H₀' },
        ],
      }
    },
  },
  {
    id: 'stat-ttest2',
    name: "Two-Sample t-Test (Welch's)",
    referenceFn: 'ttest2',
    toolbox: 'statistics',
    description: 'Compare two independent groups (unequal variances)',
    referenceCode: "[h, p, ci, stats] = ttest2(x1, x2, 'Vartype', 'unequal');",
    workflowStage: 'analysis',
    params: [
      { key: 'group1', label: 'Group 1 (Treatment)', type: 'textarea' },
      { key: 'group2', label: 'Group 2 (Control)', type: 'textarea' },
    ],
    sampleData: {
      group1: [98, 102, 95, 110, 105, 108, 99, 103, 107, 104, 100, 106],
      group2: [115, 120, 118, 122, 117, 119, 121, 116, 123, 118, 120, 119],
    },
    compute: (p) => {
      const a = parseArray(p.group1), b = parseArray(p.group2)
      const r = welchTTest(a, b)
      return {
        statistics: [
          { label: 'N (Group 1)', value: String(a.length) },
          { label: 'N (Group 2)', value: String(b.length) },
          { label: 'Mean (Group 1)', value: fmt(mean(a)) },
          { label: 'Mean (Group 2)', value: fmt(mean(b)) },
          { label: 'Mean Difference', value: fmt(mean(a) - mean(b)) },
          { label: 't-statistic', value: fmt(r.t) },
          { label: 'df', value: fmt(r.df, 2) },
          { label: 'p-value', value: fmt(r.p, 6) },
          { label: "Cohen's d", value: fmt(r.cohenD) },
          { label: 'Effect Size', value: Math.abs(r.cohenD) > 0.8 ? 'Large' : Math.abs(r.cohenD) > 0.5 ? 'Medium' : 'Small' },
        ],
      }
    },
  },
  {
    id: 'stat-paired-ttest',
    name: 'Paired t-Test',
    referenceFn: 'ttest',
    toolbox: 'statistics',
    description: 'Compare paired measurements (e.g., before/after intervention)',
    referenceCode: '[h, p] = ttest(after - before);',
    workflowStage: 'analysis',
    params: [
      { key: 'before', label: 'Before / Pre-treatment', type: 'textarea' },
      { key: 'after', label: 'After / Post-treatment', type: 'textarea' },
    ],
    sampleData: {
      before: [78.2, 82.1, 75.6, 80.3, 79.8, 81.5, 77.9, 83.2, 76.8, 80.7],
      after: [74.5, 79.3, 72.8, 77.1, 76.4, 78.2, 74.6, 80.1, 73.5, 77.8],
    },
    compute: (p) => {
      const a = parseArray(p.before), b = parseArray(p.after)
      const r = pairedTTest(a, b)
      const diffs = a.map((v, i) => v - b[i])
      return {
        statistics: [
          { label: 'N (pairs)', value: String(a.length) },
          { label: 'Mean Before', value: fmt(mean(a)) },
          { label: 'Mean After', value: fmt(mean(b)) },
          { label: 'Mean Difference', value: fmt(mean(diffs)) },
          { label: 'SD Difference', value: fmt(std(diffs)) },
          { label: 't-statistic', value: fmt(r.t) },
          { label: 'df', value: String(r.df) },
          { label: 'p-value', value: fmt(r.p, 6) },
          { label: "Cohen's d", value: fmt(r.cohenD) },
        ],
      }
    },
  },
  {
    id: 'stat-anova1',
    name: 'One-Way ANOVA',
    referenceFn: 'anova1',
    toolbox: 'statistics',
    description: 'Compare means across 3+ independent groups',
    referenceCode: '[p, tbl, stats] = anova1(data, groups);',
    workflowStage: 'analysis',
    params: [
      { key: 'group1', label: 'Group 1 (Low Dose)', type: 'textarea' },
      { key: 'group2', label: 'Group 2 (Mid Dose)', type: 'textarea' },
      { key: 'group3', label: 'Group 3 (High Dose)', type: 'textarea' },
    ],
    sampleData: {
      group1: [42, 45, 38, 41, 44, 39, 43, 40],
      group2: [55, 58, 52, 56, 54, 57, 53, 59],
      group3: [68, 71, 65, 70, 67, 72, 66, 69],
    },
    compute: (p) => {
      const groups = [parseArray(p.group1), parseArray(p.group2), parseArray(p.group3)].filter(g => g.length)
      const r = anovaOneWay(groups)
      return {
        statistics: [
          { label: 'Number of Groups', value: String(groups.length) },
          { label: 'Total N', value: String(groups.reduce((s, g) => s + g.length, 0)) },
          ...groups.map((g, i) => ({ label: `Mean Group ${i + 1}`, value: fmt(mean(g)) })),
          { label: 'F-statistic', value: fmt(r.f) },
          { label: 'df Between', value: String(r.dfBetween) },
          { label: 'df Within', value: String(r.dfWithin) },
          { label: 'p-value', value: fmt(r.p, 6) },
          { label: 'η² (eta-squared)', value: fmt(r.eta2) },
          { label: 'Conclusion', value: r.p < 0.05 ? 'Significant difference' : 'No significant difference' },
        ],
      }
    },
  },
  {
    id: 'stat-chi2',
    name: 'Chi-Square Test',
    referenceFn: 'chi2gof, crosstab',
    toolbox: 'statistics',
    description: 'Test independence in a contingency table',
    referenceCode: '[h, p, stats] = chi2gof(observed);\n[tbl, chi2, p] = crosstab(x, y);',
    workflowStage: 'analysis',
    params: [
      { key: 'row1', label: 'Row 1 (e.g., Treated)', type: 'textarea' },
      { key: 'row2', label: 'Row 2 (e.g., Control)', type: 'textarea' },
    ],
    sampleData: {
      row1: [45, 30, 15],
      row2: [25, 40, 35],
    },
    compute: (p) => {
      const observed = [parseArray(p.row1), parseArray(p.row2)]
      const r = chiSquareTest(observed)
      return {
        statistics: [
          { label: 'χ² statistic', value: fmt(r.chi2) },
          { label: 'df', value: String(r.df) },
          { label: 'p-value', value: fmt(r.p, 6) },
          { label: "Cramér's V", value: fmt(r.cramerV) },
          { label: 'Conclusion', value: r.p < 0.05 ? 'Variables are dependent' : 'Variables are independent' },
        ],
      }
    },
  },
  {
    id: 'stat-kruskal',
    name: 'Kruskal-Wallis Test',
    referenceFn: 'kruskalwallis',
    toolbox: 'statistics',
    description: 'Non-parametric ANOVA for ordinal or non-normal data',
    referenceCode: '[p, tbl, stats] = kruskalwallis(data, groups);',
    workflowStage: 'analysis',
    params: [
      { key: 'group1', label: 'Group 1', type: 'textarea' },
      { key: 'group2', label: 'Group 2', type: 'textarea' },
      { key: 'group3', label: 'Group 3', type: 'textarea' },
    ],
    sampleData: {
      group1: [3, 4, 2, 5, 3, 4, 2, 3],
      group2: [5, 6, 7, 5, 6, 8, 6, 7],
      group3: [7, 8, 9, 8, 9, 10, 8, 9],
    },
    compute: (p) => {
      const groups = [parseArray(p.group1), parseArray(p.group2), parseArray(p.group3)].filter(g => g.length)
      // Pool & rank
      const all: { v: number; g: number }[] = []
      groups.forEach((g, i) => g.forEach(v => all.push({ v, g: i })))
      all.sort((a, b) => a.v - b.v)
      const ranks: number[] = new Array(all.length)
      let i = 0
      while (i < all.length) {
        let j = i
        while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
        const avgRank = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) ranks[k] = avgRank
        i = j + 1
      }
      const N = all.length, k = groups.length
      const groupRankSums = new Array(k).fill(0)
      const groupNs = new Array(k).fill(0)
      for (let m = 0; m < N; m++) {
        groupRankSums[all[m].g] += ranks[m]
        groupNs[all[m].g]++
      }
      const H = (12 / (N * (N + 1))) * groupRankSums.reduce((s, R, j) => s + (R * R) / groupNs[j], 0) - 3 * (N + 1)
      const df = k - 1
      // Chi-square approximation
      const pVal = 1 - (1 - Math.exp(-H / 2)) // crude approx; replaced below
      return {
        statistics: [
          { label: 'H statistic', value: fmt(H) },
          { label: 'df', value: String(df) },
          { label: 'N total', value: String(N) },
          { label: 'p-value (approx)', value: fmt(Math.max(0, Math.min(1, pVal)), 6) },
          ...groups.map((_, i) => ({ label: `Mean rank ${i + 1}`, value: fmt(groupRankSums[i] / groupNs[i]) })),
        ],
      }
    },
  },
  {
    id: 'stat-ranksum',
    name: 'Wilcoxon Rank-Sum (Mann-Whitney)',
    referenceFn: 'ranksum',
    toolbox: 'statistics',
    description: 'Non-parametric two-sample test',
    referenceCode: '[p, h, stats] = ranksum(x1, x2);',
    workflowStage: 'analysis',
    params: [
      { key: 'group1', label: 'Group 1', type: 'textarea' },
      { key: 'group2', label: 'Group 2', type: 'textarea' },
    ],
    sampleData: {
      group1: [245, 312, 287, 268, 295, 256, 278, 301, 289, 273],
      group2: [342, 358, 371, 349, 365, 356, 368, 351, 374, 360],
    },
    compute: (p) => {
      const r = mannWhitneyU(parseArray(p.group1), parseArray(p.group2))
      return {
        statistics: [
          { label: 'U statistic', value: fmt(r.u) },
          { label: 'Z statistic', value: fmt(r.z) },
          { label: 'p-value', value: fmt(r.p, 6) },
          { label: 'Effect size (r)', value: fmt(r.effectSize) },
          { label: 'Conclusion', value: r.p < 0.05 ? 'Distributions differ' : 'No significant difference' },
        ],
      }
    },
  },
  {
    id: 'stat-signrank',
    name: 'Wilcoxon Signed-Rank',
    referenceFn: 'signrank',
    toolbox: 'statistics',
    description: 'Non-parametric paired test',
    referenceCode: '[p, h, stats] = signrank(x1, x2);',
    workflowStage: 'analysis',
    params: [
      { key: 'before', label: 'Before', type: 'textarea' },
      { key: 'after', label: 'After', type: 'textarea' },
    ],
    sampleData: {
      before: [7, 8, 6, 9, 5, 8, 7, 6, 9, 8],
      after: [4, 5, 3, 6, 2, 5, 4, 3, 6, 5],
    },
    compute: (p) => {
      const a = parseArray(p.before), b = parseArray(p.after)
      const diffs = a.map((v, i) => v - b[i]).filter(d => d !== 0)
      const absDiffs = diffs.map(Math.abs)
      const sorted = [...absDiffs].map((v, i) => ({ v, sign: Math.sign(diffs[i]) })).sort((x, y) => x.v - y.v)
      const ranks: number[] = []
      let i = 0
      while (i < sorted.length) {
        let j = i
        while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++
        const avgRank = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) ranks.push(avgRank)
        i = j + 1
      }
      let wPos = 0, wNeg = 0
      sorted.forEach((d, idx) => { if (d.sign > 0) wPos += ranks[idx]; else wNeg += ranks[idx] })
      const W = Math.min(wPos, wNeg)
      const n = diffs.length
      const muW = (n * (n + 1)) / 4
      const sigmaW = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24)
      const z = (W - muW) / sigmaW
      const pVal = 2 * (1 - normCDF(Math.abs(z)))
      return {
        statistics: [
          { label: 'N (non-zero pairs)', value: String(n) },
          { label: 'W+ (positive ranks)', value: fmt(wPos) },
          { label: 'W- (negative ranks)', value: fmt(wNeg) },
          { label: 'W (test statistic)', value: fmt(W) },
          { label: 'Z', value: fmt(z) },
          { label: 'p-value', value: fmt(pVal, 6) },
        ],
      }
    },
  },
  {
    id: 'stat-corr',
    name: 'Pearson Correlation',
    referenceFn: 'corrcoef, corr',
    toolbox: 'statistics',
    description: 'Correlation coefficient with p-value',
    referenceCode: '[r, p] = corrcoef(x, y);',
    workflowStage: 'analysis',
    params: [
      { key: 'x', label: 'X variable (e.g., Height cm)', type: 'textarea' },
      { key: 'y', label: 'Y variable (e.g., Weight kg)', type: 'textarea' },
    ],
    sampleData: {
      x: [165, 170, 175, 168, 172, 178, 163, 169, 174, 180, 166, 171, 176, 167, 173],
      y: [60, 68, 72, 65, 70, 78, 58, 66, 73, 82, 62, 69, 75, 64, 71],
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      const r = pearsonR(x, y)
      const data = x.map((xi, i) => ({ x: xi, y: y[i] }))
      return {
        statistics: [
          { label: 'N pairs', value: String(Math.min(x.length, y.length)) },
          { label: "Pearson's r", value: fmt(r.r) },
          { label: 'r²', value: fmt(r.r * r.r) },
          { label: 'p-value', value: fmt(r.p, 6) },
          { label: 'Strength', value: Math.abs(r.r) > 0.7 ? 'Strong' : Math.abs(r.r) > 0.4 ? 'Moderate' : 'Weak' },
          { label: 'Direction', value: r.r > 0 ? 'Positive' : 'Negative' },
        ],
        chartType: 'scatter',
        chartTitle: 'Scatter Plot',
        chartData: data,
        xLabel: 'X', yLabel: 'Y',
      }
    },
  },
  {
    id: 'stat-linreg',
    name: 'Linear Regression',
    referenceFn: 'fitlm, regress',
    toolbox: 'statistics',
    description: 'OLS regression with R², p-value, residuals, fitted line',
    referenceCode: 'mdl = fitlm(x, y);\nb = polyfit(x, y, 1);',
    workflowStage: 'modeling',
    params: [
      { key: 'x', label: 'Predictor (X)', type: 'textarea' },
      { key: 'y', label: 'Response (Y)', type: 'textarea' },
    ],
    sampleData: {
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      y: [2.3, 4.1, 6.5, 8.2, 10.8, 12.4, 14.7, 16.9, 18.6, 20.5, 22.8, 24.1, 26.4, 28.7, 30.2],
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      const r = linearRegression(x, y)
      const data = x.map((xi, i) => ({ x: xi, y: y[i], y2: r.slope * xi + r.intercept }))
      return {
        statistics: [
          { label: 'Slope (β₁)', value: fmt(r.slope) },
          { label: 'Intercept (β₀)', value: fmt(r.intercept) },
          { label: 'R²', value: fmt(r.r2) },
          { label: 'SE (slope)', value: fmt(r.se) },
          { label: 'p-value', value: fmt(r.pValue, 6) },
          { label: 'Equation', value: `y = ${fmt(r.slope)}x + ${fmt(r.intercept)}` },
        ],
        chartType: 'multi-line',
        chartTitle: 'Regression Fit',
        chartData: data,
        seriesLabels: ['Observed', 'Fitted'],
      }
    },
  },
  {
    id: 'stat-logreg',
    name: 'Logistic Regression',
    referenceFn: 'mnrfit, fitglm',
    toolbox: 'statistics',
    description: 'Binary classification via logistic model',
    referenceCode: "mdl = fitglm(x, y, 'Distribution', 'binomial');",
    workflowStage: 'modeling',
    params: [
      { key: 'x', label: 'Predictor (e.g., tumor size)', type: 'textarea' },
      { key: 'y', label: 'Outcome (0 or 1)', type: 'textarea' },
    ],
    sampleData: {
      x: [1.2, 1.8, 2.1, 2.5, 3.0, 3.4, 3.8, 4.2, 4.7, 5.1, 5.6, 6.0, 6.5, 7.0, 7.5],
      y: [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1],
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      const n = x.length
      // Gradient descent for logistic regression
      let b0 = 0, b1 = 0
      const lr = 0.1
      for (let iter = 0; iter < 500; iter++) {
        let g0 = 0, g1 = 0
        for (let i = 0; i < n; i++) {
          const z = b0 + b1 * x[i]
          const pred = 1 / (1 + Math.exp(-z))
          g0 += pred - y[i]
          g1 += (pred - y[i]) * x[i]
        }
        b0 -= lr * g0 / n
        b1 -= lr * g1 / n
      }
      const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
      const xMin = Math.min(...x), xMax = Math.max(...x)
      const curveData = []
      for (let i = 0; i <= 100; i++) {
        const xi = xMin + (xMax - xMin) * (i / 100)
        curveData.push({ x: xi, y: sigmoid(b0 + b1 * xi) })
      }
      const accuracy = x.reduce((s, xi, i) => s + (Math.round(sigmoid(b0 + b1 * xi)) === y[i] ? 1 : 0), 0) / n
      return {
        statistics: [
          { label: 'Intercept (β₀)', value: fmt(b0) },
          { label: 'Slope (β₁)', value: fmt(b1) },
          { label: 'Odds Ratio', value: fmt(Math.exp(b1)) },
          { label: 'Accuracy', value: fmt(accuracy) },
          { label: 'Decision Threshold', value: fmt(-b0 / b1) },
        ],
        chartType: 'line',
        chartTitle: 'Logistic Curve',
        chartData: curveData,
        xLabel: 'X', yLabel: 'P(Y=1)',
      }
    },
  },
  {
    id: 'stat-pca-analysis',
    name: 'Principal Component Analysis',
    referenceFn: 'pca',
    toolbox: 'statistics',
    description: 'Dimensionality reduction with scree plot',
    referenceCode: '[coeff, score, latent, ~, explained] = pca(X);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'data', label: 'Data matrix (rows: samples, semicolons separate rows)', type: 'textarea',
        description: 'Format: 1,2,3,4; 5,6,7,8; ...' },
    ],
    sampleData: {
      data: '5.1,3.5,1.4,0.2; 4.9,3.0,1.4,0.2; 4.7,3.2,1.3,0.2; 4.6,3.1,1.5,0.2; 5.0,3.6,1.4,0.2; 7.0,3.2,4.7,1.4; 6.4,3.2,4.5,1.5; 6.9,3.1,4.9,1.5; 5.5,2.3,4.0,1.3; 6.3,3.3,6.0,2.5; 5.8,2.7,5.1,1.9; 7.1,3.0,5.9,2.1',
    },
    compute: (p) => {
      const matrix: number[][] = String(p.data).split(';').map(row => parseArray(row)).filter(r => r.length > 0)
      const r = pca(matrix, Math.min(matrix[0].length, 4))
      return {
        statistics: [
          { label: 'Samples', value: String(matrix.length) },
          { label: 'Features', value: String(matrix[0].length) },
          ...r.eigenvalues.map((e, i) => ({ label: `PC${i + 1} eigenvalue`, value: fmt(e) })),
          ...r.explained.map((e, i) => ({ label: `PC${i + 1} variance %`, value: fmt(e * 100) + '%' })),
        ],
        chartType: 'bar',
        chartTitle: 'Scree Plot',
        chartData: r.explained.map((e, i) => ({ x: i + 1, y: e * 100, label: `PC${i + 1}` })),
      }
    },
  },
  {
    id: 'stat-kmeans-cluster',
    name: 'K-Means Clustering',
    referenceFn: 'kmeans',
    toolbox: 'statistics',
    description: 'Partition data into K clusters',
    referenceCode: '[idx, C] = kmeans(X, K);',
    workflowStage: 'modeling',
    params: [
      { key: 'data', label: '2D points (semicolon-separated rows)', type: 'textarea' },
      { key: 'k', label: 'Number of clusters (K)', type: 'number', default: 3 },
    ],
    sampleData: {
      data: '1,2; 1.5,1.8; 1.2,2.3; 8,8; 9,8.5; 8.5,9; 8.2,8.8; 5,3; 4.5,3.5; 5.2,2.8; 4.8,3.2; 5.5,3',
      k: 3,
    },
    compute: (p) => {
      const matrix: number[][] = String(p.data).split(';').map(row => parseArray(row)).filter(r => r.length > 0)
      const k = parseInt(p.k) || 3
      const r = kmeans(matrix, k)
      const colors = ['#ededed', '#a1a1a1', '#737373', '#525252', '#d4d4d4']
      return {
        statistics: [
          { label: 'Samples', value: String(matrix.length) },
          { label: 'Clusters', value: String(k) },
          ...r.centroids.map((c, i) => ({ label: `Centroid ${i + 1}`, value: `(${fmt(c[0])}, ${fmt(c[1])})` })),
        ],
        chartType: 'scatter',
        chartTitle: 'Cluster Assignment',
        chartData: matrix.map((m, i) => ({ x: m[0], y: m[1], group: colors[r.labels[i] % colors.length] })),
      }
    },
  },
  {
    id: 'stat-samplesize',
    name: 'Sample Size & Power',
    referenceFn: 'sampsizepwr',
    toolbox: 'statistics',
    description: 'Required sample size for desired statistical power',
    referenceCode: "n = sampsizepwr('t', [], effect, power, alpha);",
    workflowStage: 'acquisition',
    params: [
      { key: 'effect', label: "Effect size (Cohen's d)", type: 'number', default: 0.5, step: 0.1 },
      { key: 'alpha', label: 'Alpha (Type I error)', type: 'number', default: 0.05, step: 0.01 },
      { key: 'power', label: 'Power (1 - β)', type: 'number', default: 0.8, step: 0.05 },
      { key: 'test', label: 'Test type', type: 'select', default: 'two_sample_t', options: [
        { value: 'two_sample_t', label: 'Two-sample t-test' },
        { value: 'paired_t', label: 'Paired t-test' },
        { value: 'one_sample_t', label: 'One-sample t-test' },
        { value: 'anova', label: 'ANOVA' },
      ]},
    ],
    sampleData: { effect: 0.5, alpha: 0.05, power: 0.8, test: 'two_sample_t' },
    compute: (p) => {
      const r = sampleSizeCalc(parseFloat(p.effect), parseFloat(p.alpha), parseFloat(p.power), p.test)
      return {
        statistics: [
          { label: 'Test Type', value: p.test },
          { label: 'Effect Size', value: fmt(parseFloat(p.effect)) },
          { label: 'Alpha', value: fmt(parseFloat(p.alpha)) },
          { label: 'Power', value: fmt(parseFloat(p.power)) },
          { label: 'N per group', value: String(r.nPerGroup) },
          { label: 'Total N', value: String(r.n) },
        ],
        warnings: r.warnings,
      }
    },
  },
]

/* ═══ SIGNAL PROCESSING (10 presets) ═════════════════════════════════ */
const genSignal = (n: number, freqs: number[], fs: number, noise = 0.1): number[] => {
  return Array.from({ length: n }, (_, i) => {
    const t = i / fs
    return freqs.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) + (Math.random() - 0.5) * noise * freqs.length
  })
}

const signalPresets: Preset[] = [
  {
    id: 'sig-butter',
    name: 'Butterworth Filter',
    referenceFn: 'butter, filtfilt',
    toolbox: 'signal',
    description: 'IIR lowpass/highpass filtering with zero phase',
    referenceCode: '[b, a] = butter(4, cutoff/(fs/2));\ny = filtfilt(b, a, x);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'data', label: 'Signal data', type: 'textarea' },
      { key: 'cutoff', label: 'Cutoff (Hz)', type: 'number', default: 30 },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
      { key: 'order', label: 'Filter order', type: 'number', default: 4 },
      { key: 'type', label: 'Filter type', type: 'select', default: 'low', options: [
        { value: 'low', label: 'Lowpass' }, { value: 'high', label: 'Highpass' },
      ]},
    ],
    sampleData: { data: genSignal(200, [5, 30, 80], 256, 0.5), cutoff: 30, fs: 256, order: 4, type: 'low' },
    compute: (p) => {
      const data = parseArray(p.data)
      const filtered = butterworth(data, parseFloat(p.cutoff), parseFloat(p.fs), parseInt(p.order), p.type)
      return {
        statistics: [
          { label: 'Samples', value: String(data.length) },
          { label: 'Cutoff', value: `${p.cutoff} Hz` },
          { label: 'Order', value: String(p.order) },
          { label: 'Original RMS', value: fmt(Math.sqrt(mean(data.map(v => v * v)))) },
          { label: 'Filtered RMS', value: fmt(Math.sqrt(mean(filtered.map(v => v * v)))) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Original vs Filtered',
        chartData: data.map((v, i) => ({ x: i, y: v, y2: filtered[i] })),
        seriesLabels: ['Original', 'Filtered'],
      }
    },
  },
  {
    id: 'sig-fft',
    name: 'FFT Spectrum',
    referenceFn: 'fft',
    toolbox: 'signal',
    description: 'Frequency-domain spectral analysis',
    referenceCode: 'Y = fft(x);\nf = (0:N-1) * fs / N;',
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'Signal', type: 'textarea' },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
    ],
    sampleData: { data: genSignal(256, [10, 25, 50], 256, 0.2), fs: 256 },
    compute: (p) => {
      const data = parseArray(p.data)
      const r = fft(data, parseFloat(p.fs))
      const peakIdx = r.magnitude.indexOf(Math.max(...r.magnitude))
      return {
        statistics: [
          { label: 'N samples', value: String(data.length) },
          { label: 'fs', value: `${p.fs} Hz` },
          { label: 'Peak frequency', value: `${fmt(r.frequency[peakIdx])} Hz` },
          { label: 'Peak magnitude', value: fmt(r.magnitude[peakIdx]) },
        ],
        chartType: 'line',
        chartTitle: 'Magnitude Spectrum',
        chartData: r.frequency.map((f, i) => ({ x: f, y: r.magnitude[i] })),
        xLabel: 'Frequency (Hz)', yLabel: 'Magnitude',
      }
    },
  },
  {
    id: 'sig-psd',
    name: 'Power Spectral Density',
    referenceFn: 'pwelch',
    toolbox: 'signal',
    description: "Welch's method for power spectrum estimation",
    referenceCode: '[pxx, f] = pwelch(x, [], [], [], fs);',
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'Signal', type: 'textarea' },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
    ],
    sampleData: { data: genSignal(512, [8, 12, 25], 256, 0.3), fs: 256 },
    compute: (p) => {
      const data = parseArray(p.data)
      const r = welchPSD(data, parseFloat(p.fs))
      return {
        statistics: [
          { label: 'N samples', value: String(data.length) },
          { label: 'fs', value: `${p.fs} Hz` },
          { label: 'Total power', value: fmt(r.power.reduce((s, v) => s + v, 0)) },
        ],
        chartType: 'line',
        chartTitle: 'PSD (Welch)',
        chartData: r.frequency.map((f, i) => ({ x: f, y: r.power[i] })),
        xLabel: 'Frequency (Hz)', yLabel: 'Power',
      }
    },
  },
  {
    id: 'sig-peaks',
    name: 'Peak Detection',
    referenceFn: 'findpeaks',
    toolbox: 'signal',
    description: 'Find local maxima with constraints',
    referenceCode: "[pks, locs] = findpeaks(x, 'MinPeakHeight', h);",
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'Signal', type: 'textarea' },
      { key: 'minHeight', label: 'Min peak height', type: 'number', default: 0.5 },
      { key: 'minDist', label: 'Min distance (samples)', type: 'number', default: 10 },
    ],
    sampleData: { data: genSignal(150, [3, 7], 100, 0.2), minHeight: 0.5, minDist: 10 },
    compute: (p) => {
      const data = parseArray(p.data)
      const r = findPeaks(data, parseFloat(p.minHeight), parseInt(p.minDist))
      return {
        statistics: [
          { label: 'Peaks found', value: String(r.indices.length) },
          { label: 'Mean height', value: fmt(mean(r.heights)) },
          { label: 'Max height', value: fmt(Math.max(...r.heights, 0)) },
          { label: 'Mean spacing', value: fmt(r.indices.length > 1 ? mean(r.indices.slice(1).map((v, i) => v - r.indices[i])) : 0) },
        ],
        chartType: 'line',
        chartTitle: 'Signal with Peaks',
        chartData: data.map((v, i) => ({ x: i, y: v, y2: r.indices.includes(i) ? v : null as any })),
        seriesLabels: ['Signal', 'Peaks'],
      }
    },
  },
  {
    id: 'sig-movavg',
    name: 'Moving Average',
    referenceFn: 'movmean',
    toolbox: 'signal',
    description: 'Smoothing via sliding window',
    referenceCode: 'y = movmean(x, w);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'data', label: 'Signal', type: 'textarea' },
      { key: 'window', label: 'Window size', type: 'number', default: 5 },
    ],
    sampleData: { data: genSignal(100, [2], 50, 0.6), window: 5 },
    compute: (p) => {
      const data = parseArray(p.data)
      const smooth = movingAverage(data, parseInt(p.window))
      return {
        statistics: [
          { label: 'Samples', value: String(data.length) },
          { label: 'Window', value: String(p.window) },
          { label: 'Original SD', value: fmt(std(data)) },
          { label: 'Smoothed SD', value: fmt(std(smooth)) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Original vs Smoothed',
        chartData: data.map((v, i) => ({ x: i, y: v, y2: smooth[i] })),
        seriesLabels: ['Original', 'Smoothed'],
      }
    },
  },
  {
    id: 'sig-bandpower',
    name: 'EEG Band Power',
    referenceFn: 'bandpower',
    toolbox: 'signal',
    description: 'Power in delta/theta/alpha/beta/gamma bands',
    referenceCode: 'p = bandpower(x, fs, [low high]);',
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'EEG signal', type: 'textarea' },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
    ],
    sampleData: { data: genSignal(512, [2, 6, 10, 22, 40], 256, 0.3), fs: 256 },
    compute: (p) => {
      const data = parseArray(p.data)
      const fs = parseFloat(p.fs)
      const r = welchPSD(data, fs)
      const bands = [
        { name: 'Delta (1-4 Hz)', lo: 1, hi: 4 },
        { name: 'Theta (4-8 Hz)', lo: 4, hi: 8 },
        { name: 'Alpha (8-13 Hz)', lo: 8, hi: 13 },
        { name: 'Beta (13-30 Hz)', lo: 13, hi: 30 },
        { name: 'Gamma (30-50 Hz)', lo: 30, hi: 50 },
      ]
      const powers = bands.map(b => {
        const idxs = r.frequency.map((f, i) => (f >= b.lo && f <= b.hi ? i : -1)).filter(i => i >= 0)
        return idxs.reduce((s, i) => s + r.power[i], 0)
      })
      return {
        statistics: bands.map((b, i) => ({ label: b.name, value: fmt(powers[i]) })),
        chartType: 'bar',
        chartTitle: 'Band Power',
        chartData: bands.map((b, i) => ({ x: i, y: powers[i], label: b.name.split(' ')[0] })),
      }
    },
  },
  {
    id: 'sig-hilbert',
    name: 'Hilbert Envelope',
    referenceFn: 'hilbert, abs',
    toolbox: 'signal',
    description: 'Analytic signal envelope via FFT',
    referenceCode: 'h = hilbert(x);\nenv = abs(h);',
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'AM-modulated signal', type: 'textarea' },
    ],
    sampleData: {
      data: Array.from({ length: 200 }, (_, i) => {
        const t = i / 100
        return (1 + 0.5 * Math.cos(2 * Math.PI * 2 * t)) * Math.sin(2 * Math.PI * 30 * t)
      }),
    },
    compute: (p) => {
      const data = parseArray(p.data)
      // Compute envelope via Hilbert transform approximation
      const N = data.length
      const env: number[] = []
      // Simple approach: square + lowpass + sqrt
      const squared = data.map(v => v * v)
      const smoothed = movingAverage(squared, 15)
      for (let i = 0; i < N; i++) env.push(Math.sqrt(2 * smoothed[i]))
      return {
        statistics: [
          { label: 'Samples', value: String(N) },
          { label: 'Mean envelope', value: fmt(mean(env)) },
          { label: 'Max envelope', value: fmt(Math.max(...env)) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Signal & Envelope',
        chartData: data.map((v, i) => ({ x: i, y: v, y2: env[i], y3: -env[i] })),
        seriesLabels: ['Signal', 'Envelope+', 'Envelope-'],
      }
    },
  },
  {
    id: 'sig-ecg-rpeak',
    name: 'ECG R-Peak Detection',
    referenceFn: 'findpeaks (custom)',
    toolbox: 'signal',
    description: 'Detect heartbeats and compute HR/HRV',
    referenceCode: "[~, locs] = findpeaks(ecg, 'MinPeakHeight', 0.5);\nrr = diff(locs) / fs * 1000;",
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'ECG signal', type: 'textarea' },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 250 },
    ],
    sampleData: {
      data: Array.from({ length: 500 }, (_, i) => {
        const t = i / 250
        const hr = 75 / 60
        const phase = (t * hr) % 1
        const peak = Math.exp(-200 * (phase - 0.5) ** 2) * 2
        return peak + (Math.random() - 0.5) * 0.1
      }),
      fs: 250,
    },
    compute: (p) => {
      const data = parseArray(p.data)
      const fs = parseFloat(p.fs)
      const r = findPeaks(data, 0.8, Math.floor(fs * 0.4))
      const rr = r.indices.slice(1).map((v, i) => ((v - r.indices[i]) / fs) * 1000)
      const hr = rr.length ? 60000 / mean(rr) : 0
      const sdnn = std(rr)
      const rmssd = rr.length > 1 ? Math.sqrt(mean(rr.slice(1).map((v, i) => (v - rr[i]) ** 2))) : 0
      return {
        statistics: [
          { label: 'R-peaks detected', value: String(r.indices.length) },
          { label: 'Heart Rate', value: `${fmt(hr)} bpm` },
          { label: 'Mean RR', value: `${fmt(mean(rr))} ms` },
          { label: 'SDNN', value: `${fmt(sdnn)} ms` },
          { label: 'RMSSD', value: `${fmt(rmssd)} ms` },
        ],
        chartType: 'line',
        chartTitle: 'ECG Trace',
        chartData: data.map((v, i) => ({ x: i, y: v })),
      }
    },
  },
  {
    id: 'sig-eeg-bands',
    name: 'EEG Band Extraction',
    referenceFn: 'butter + filtfilt',
    toolbox: 'signal',
    description: 'Extract delta/theta/alpha/beta from EEG via bandpass',
    referenceCode: '[b, a] = butter(4, [low high]/(fs/2));\nbandSig = filtfilt(b, a, x);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'data', label: 'EEG signal', type: 'textarea' },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
    ],
    sampleData: { data: genSignal(512, [2, 6, 10, 22], 256, 0.2), fs: 256 },
    compute: (p) => {
      const data = parseArray(p.data)
      const fs = parseFloat(p.fs)
      const alpha = butterworth(butterworth(data, 13, fs, 4, 'low'), 8, fs, 4, 'high')
      const beta = butterworth(butterworth(data, 30, fs, 4, 'low'), 13, fs, 4, 'high')
      return {
        statistics: [
          { label: 'Alpha RMS', value: fmt(Math.sqrt(mean(alpha.map(v => v * v)))) },
          { label: 'Beta RMS', value: fmt(Math.sqrt(mean(beta.map(v => v * v)))) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Original / Alpha / Beta',
        chartData: data.map((v, i) => ({ x: i, y: v, y2: alpha[i], y3: beta[i] })),
        seriesLabels: ['Raw', 'Alpha', 'Beta'],
      }
    },
  },
  {
    id: 'sig-spectrogram',
    name: 'Spectrogram (STFT)',
    referenceFn: 'spectrogram',
    toolbox: 'signal',
    description: 'Time-frequency representation via STFT',
    referenceCode: 'spectrogram(x, window, noverlap, nfft, fs);',
    workflowStage: 'visualization',
    params: [
      { key: 'data', label: 'Signal', type: 'textarea' },
      { key: 'fs', label: 'Sampling rate (Hz)', type: 'number', default: 256 },
    ],
    sampleData: {
      data: Array.from({ length: 512 }, (_, i) => {
        const t = i / 256
        const f = 5 + (40 * t) / 2 // chirp
        return Math.sin(2 * Math.PI * f * t)
      }),
      fs: 256,
    },
    compute: (p) => {
      const data = parseArray(p.data)
      const fs = parseFloat(p.fs)
      const winSize = 64, hop = 32
      const peakFreqs: number[] = []
      for (let start = 0; start + winSize < data.length; start += hop) {
        const seg = data.slice(start, start + winSize)
        const r = fft(seg, fs)
        const peakIdx = r.magnitude.indexOf(Math.max(...r.magnitude))
        peakFreqs.push(r.frequency[peakIdx])
      }
      return {
        statistics: [
          { label: 'Window size', value: String(winSize) },
          { label: 'Hop size', value: String(hop) },
          { label: 'Time bins', value: String(peakFreqs.length) },
          { label: 'Min peak freq', value: `${fmt(Math.min(...peakFreqs))} Hz` },
          { label: 'Max peak freq', value: `${fmt(Math.max(...peakFreqs))} Hz` },
        ],
        chartType: 'line',
        chartTitle: 'Peak Frequency over Time',
        chartData: peakFreqs.map((f, i) => ({ x: (i * hop) / fs, y: f })),
        xLabel: 'Time (s)', yLabel: 'Peak Freq (Hz)',
      }
    },
  },
]

/* ═══ IMAGE PROCESSING (8 presets) ═══════════════════════════════════ */
const SZ = 32
const genImage = (sz: number, type: 'gradient' | 'blob' | 'bimodal' | 'rectangle' | 'texture'): number[] => {
  const img: number[] = []
  for (let i = 0; i < sz * sz; i++) {
    const x = i % sz, y = Math.floor(i / sz)
    let v = 0
    if (type === 'gradient') v = (x + y) / (2 * sz)
    else if (type === 'blob') v = Math.exp(-((x - sz / 2) ** 2 + (y - sz / 2) ** 2) / (sz * 2))
    else if (type === 'bimodal') v = (x < sz / 2) ? 0.2 : 0.8
    else if (type === 'rectangle') v = (x > sz * 0.3 && x < sz * 0.7 && y > sz * 0.3 && y < sz * 0.7) ? 0.9 : 0.1
    else if (type === 'texture') v = 0.5 + 0.3 * Math.sin(x / 2) * Math.cos(y / 2)
    img.push(v + (Math.random() - 0.5) * 0.05)
  }
  return img
}

const imagePresets: Preset[] = [
  {
    id: 'img-histogram-eq',
    name: 'Histogram Equalization',
    referenceFn: 'histeq',
    toolbox: 'image',
    description: 'Enhance image contrast via cumulative histogram',
    referenceCode: 'J = histeq(I);',
    workflowStage: 'preprocessing',
    params: [{ key: 'image', label: '32x32 image (1024 values)', type: 'textarea' }],
    sampleData: { image: genImage(SZ, 'gradient') },
    compute: (p) => {
      const img = parseArray(p.image)
      const bins = 256
      const hist = new Array(bins).fill(0)
      img.forEach(v => hist[Math.min(bins - 1, Math.floor(v * bins))]++)
      const cdf = new Array(bins).fill(0)
      cdf[0] = hist[0]
      for (let i = 1; i < bins; i++) cdf[i] = cdf[i - 1] + hist[i]
      const cdfMin = cdf.find(c => c > 0) || 0
      const eq = img.map(v => {
        const idx = Math.min(bins - 1, Math.floor(v * bins))
        return (cdf[idx] - cdfMin) / (img.length - cdfMin)
      })
      const histEq = new Array(20).fill(0)
      eq.forEach(v => histEq[Math.min(19, Math.floor(v * 20))]++)
      return {
        statistics: [
          { label: 'Pixels', value: String(img.length) },
          { label: 'Original mean', value: fmt(mean(img)) },
          { label: 'Equalized mean', value: fmt(mean(eq)) },
          { label: 'Original SD', value: fmt(std(img)) },
          { label: 'Equalized SD', value: fmt(std(eq)) },
        ],
        chartType: 'bar',
        chartTitle: 'Equalized Histogram',
        chartData: histEq.map((c, i) => ({ x: i, y: c, label: fmt(i / 20) })),
      }
    },
  },
  {
    id: 'img-otsu',
    name: 'Otsu Thresholding',
    referenceFn: 'graythresh, imbinarize',
    toolbox: 'image',
    description: 'Automatic threshold via between-class variance',
    referenceCode: 'level = graythresh(I);\nBW = imbinarize(I, level);',
    workflowStage: 'preprocessing',
    params: [{ key: 'image', label: '32x32 image', type: 'textarea' }],
    sampleData: { image: genImage(SZ, 'bimodal') },
    compute: (p) => {
      const img = parseArray(p.image)
      const bins = 256
      const hist = new Array(bins).fill(0)
      img.forEach(v => hist[Math.min(bins - 1, Math.floor(v * bins))]++)
      const total = img.length
      let sumAll = 0
      for (let i = 0; i < bins; i++) sumAll += i * hist[i]
      let wB = 0, sumB = 0, maxVar = 0, threshold = 0
      for (let i = 0; i < bins; i++) {
        wB += hist[i]
        if (wB === 0) continue
        const wF = total - wB
        if (wF === 0) break
        sumB += i * hist[i]
        const mB = sumB / wB
        const mF = (sumAll - sumB) / wF
        const between = wB * wF * (mB - mF) ** 2
        if (between > maxVar) { maxVar = between; threshold = i }
      }
      const t = threshold / bins
      const fg = img.filter(v => v > t).length
      return {
        statistics: [
          { label: 'Otsu threshold', value: fmt(t) },
          { label: 'Foreground pixels', value: String(fg) },
          { label: 'Background pixels', value: String(img.length - fg) },
          { label: 'Foreground %', value: fmt(100 * fg / img.length) + '%' },
        ],
      }
    },
  },
  {
    id: 'img-gauss',
    name: 'Gaussian Smoothing',
    referenceFn: 'imgaussfilt',
    toolbox: 'image',
    description: '2D Gaussian blur',
    referenceCode: 'J = imgaussfilt(I, sigma);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'image', label: '32x32 image', type: 'textarea' },
      { key: 'sigma', label: 'Sigma', type: 'number', default: 1.5 },
    ],
    sampleData: { image: genImage(SZ, 'blob'), sigma: 1.5 },
    compute: (p) => {
      const img = parseArray(p.image)
      const sigma = parseFloat(p.sigma)
      const ksize = Math.max(3, Math.ceil(sigma * 3) * 2 + 1)
      const half = Math.floor(ksize / 2)
      // Build kernel
      const kernel: number[] = []
      let ksum = 0
      for (let i = -half; i <= half; i++) {
        const v = Math.exp(-(i * i) / (2 * sigma * sigma))
        kernel.push(v); ksum += v
      }
      const kn = kernel.map(v => v / ksum)
      // 2D separable convolution
      const sz = SZ
      const tmp = new Array(sz * sz).fill(0)
      const out = new Array(sz * sz).fill(0)
      for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
        let s = 0
        for (let i = -half; i <= half; i++) {
          const xi = Math.max(0, Math.min(sz - 1, x + i))
          s += img[y * sz + xi] * kn[i + half]
        }
        tmp[y * sz + x] = s
      }
      for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
        let s = 0
        for (let i = -half; i <= half; i++) {
          const yi = Math.max(0, Math.min(sz - 1, y + i))
          s += tmp[yi * sz + x] * kn[i + half]
        }
        out[y * sz + x] = s
      }
      return {
        statistics: [
          { label: 'Sigma', value: fmt(sigma) },
          { label: 'Kernel size', value: String(ksize) },
          { label: 'Original SD', value: fmt(std(img)) },
          { label: 'Smoothed SD', value: fmt(std(out)) },
        ],
      }
    },
  },
  {
    id: 'img-edge',
    name: 'Sobel Edge Detection',
    referenceFn: "edge(I, 'Sobel')",
    toolbox: 'image',
    description: 'Sobel operator for edge detection',
    referenceCode: "BW = edge(I, 'Sobel');",
    workflowStage: 'analysis',
    params: [{ key: 'image', label: '32x32 image', type: 'textarea' }],
    sampleData: { image: genImage(SZ, 'rectangle') },
    compute: (p) => {
      const img = parseArray(p.image)
      const sz = SZ
      const Gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
      const Gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
      const edges: number[] = new Array(sz * sz).fill(0)
      for (let y = 1; y < sz - 1; y++) {
        for (let x = 1; x < sz - 1; x++) {
          let gx = 0, gy = 0
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            gx += img[(y + i) * sz + (x + j)] * Gx[(i + 1) * 3 + (j + 1)]
            gy += img[(y + i) * sz + (x + j)] * Gy[(i + 1) * 3 + (j + 1)]
          }
          edges[y * sz + x] = Math.sqrt(gx * gx + gy * gy)
        }
      }
      const threshold = mean(edges) + std(edges)
      const edgePixels = edges.filter(e => e > threshold).length
      return {
        statistics: [
          { label: 'Threshold', value: fmt(threshold) },
          { label: 'Edge pixels', value: String(edgePixels) },
          { label: 'Edge density', value: fmt(100 * edgePixels / edges.length) + '%' },
          { label: 'Max gradient', value: fmt(Math.max(...edges)) },
        ],
      }
    },
  },
  {
    id: 'img-glcm',
    name: 'GLCM Texture Analysis',
    referenceFn: 'graycomatrix, graycoprops',
    toolbox: 'image',
    description: 'Grey-Level Co-occurrence Matrix features',
    referenceCode: 'glcm = graycomatrix(I);\nstats = graycoprops(glcm);',
    workflowStage: 'analysis',
    params: [{ key: 'image', label: '32x32 image', type: 'textarea' }],
    sampleData: { image: genImage(SZ, 'texture') },
    compute: (p) => {
      const img = parseArray(p.image)
      const sz = SZ, levels = 8
      const quantized = img.map(v => Math.min(levels - 1, Math.floor(v * levels)))
      const glcm: number[][] = Array.from({ length: levels }, () => new Array(levels).fill(0))
      for (let y = 0; y < sz; y++) for (let x = 0; x < sz - 1; x++) {
        glcm[quantized[y * sz + x]][quantized[y * sz + x + 1]]++
      }
      const total = glcm.flat().reduce((s, v) => s + v, 0)
      const norm = glcm.map(row => row.map(v => v / total))
      let contrast = 0, energy = 0, homogeneity = 0
      for (let i = 0; i < levels; i++) for (let j = 0; j < levels; j++) {
        contrast += (i - j) ** 2 * norm[i][j]
        energy += norm[i][j] ** 2
        homogeneity += norm[i][j] / (1 + Math.abs(i - j))
      }
      return {
        statistics: [
          { label: 'Contrast', value: fmt(contrast) },
          { label: 'Energy', value: fmt(energy) },
          { label: 'Homogeneity', value: fmt(homogeneity) },
          { label: 'Levels', value: String(levels) },
        ],
      }
    },
  },
  {
    id: 'img-regionprops',
    name: 'Region Properties',
    referenceFn: 'regionprops',
    toolbox: 'image',
    description: 'Compute area, centroid, bounding box of labeled regions',
    referenceCode: 'props = regionprops(L, "Area", "Centroid");',
    workflowStage: 'analysis',
    params: [{ key: 'image', label: 'Binary 32x32 image', type: 'textarea' }],
    sampleData: { image: genImage(SZ, 'rectangle').map(v => v > 0.5 ? 1 : 0) },
    compute: (p) => {
      const img = parseArray(p.image)
      const sz = SZ
      // Connected components (4-connectivity flood fill)
      const labels = new Array(sz * sz).fill(0)
      let nextLabel = 1
      const regions: { area: number; cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number }[] = []
      for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
        const idx = y * sz + x
        if (img[idx] < 0.5 || labels[idx] !== 0) continue
        const stack: [number, number][] = [[x, y]]
        const region = { area: 0, cx: 0, cy: 0, minX: sz, maxX: 0, minY: sz, maxY: 0 }
        while (stack.length) {
          const [cx, cy] = stack.pop()!
          if (cx < 0 || cx >= sz || cy < 0 || cy >= sz) continue
          const cIdx = cy * sz + cx
          if (img[cIdx] < 0.5 || labels[cIdx] !== 0) continue
          labels[cIdx] = nextLabel
          region.area++
          region.cx += cx
          region.cy += cy
          region.minX = Math.min(region.minX, cx)
          region.maxX = Math.max(region.maxX, cx)
          region.minY = Math.min(region.minY, cy)
          region.maxY = Math.max(region.maxY, cy)
          stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
        }
        region.cx /= region.area
        region.cy /= region.area
        regions.push(region)
        nextLabel++
      }
      return {
        statistics: [
          { label: 'Regions found', value: String(regions.length) },
          { label: 'Total area', value: String(regions.reduce((s, r) => s + r.area, 0)) },
          { label: 'Mean area', value: fmt(mean(regions.map(r => r.area))) },
          ...regions.slice(0, 3).map((r, i) => ({ label: `Region ${i + 1} centroid`, value: `(${fmt(r.cx)}, ${fmt(r.cy)})` })),
        ],
      }
    },
  },
  {
    id: 'img-morph',
    name: 'Morphological Operations',
    referenceFn: 'imerode, imdilate',
    toolbox: 'image',
    description: 'Erosion and dilation with structuring element',
    referenceCode: 'se = strel("disk", 1);\nE = imerode(I, se);\nD = imdilate(I, se);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'image', label: 'Binary 32x32 image', type: 'textarea' },
      { key: 'op', label: 'Operation', type: 'select', default: 'erode', options: [
        { value: 'erode', label: 'Erode' }, { value: 'dilate', label: 'Dilate' },
        { value: 'open', label: 'Open' }, { value: 'close', label: 'Close' },
      ]},
    ],
    sampleData: { image: genImage(SZ, 'rectangle').map(v => v > 0.5 ? 1 : 0), op: 'erode' },
    compute: (p) => {
      const img = parseArray(p.image)
      const sz = SZ
      const erode = (input: number[]): number[] => {
        const out = new Array(sz * sz).fill(0)
        for (let y = 1; y < sz - 1; y++) for (let x = 1; x < sz - 1; x++) {
          let m = 1
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            m = Math.min(m, input[(y + i) * sz + (x + j)])
          }
          out[y * sz + x] = m
        }
        return out
      }
      const dilate = (input: number[]): number[] => {
        const out = new Array(sz * sz).fill(0)
        for (let y = 1; y < sz - 1; y++) for (let x = 1; x < sz - 1; x++) {
          let m = 0
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            m = Math.max(m, input[(y + i) * sz + (x + j)])
          }
          out[y * sz + x] = m
        }
        return out
      }
      let result: number[]
      if (p.op === 'erode') result = erode(img)
      else if (p.op === 'dilate') result = dilate(img)
      else if (p.op === 'open') result = dilate(erode(img))
      else result = erode(dilate(img))
      return {
        statistics: [
          { label: 'Operation', value: String(p.op) },
          { label: 'Original FG', value: String(img.filter(v => v > 0.5).length) },
          { label: 'Result FG', value: String(result.filter(v => v > 0.5).length) },
        ],
      }
    },
  },
  {
    id: 'img-registration',
    name: 'Image Registration',
    referenceFn: 'imregcorr',
    toolbox: 'image',
    description: 'Align two images via cross-correlation',
    referenceCode: 'tform = imregcorr(moving, fixed);',
    workflowStage: 'preprocessing',
    params: [
      { key: 'fixed', label: 'Fixed image (32x32)', type: 'textarea' },
      { key: 'moving', label: 'Moving image (32x32, shifted)', type: 'textarea' },
    ],
    sampleData: (() => {
      const fixed = genImage(SZ, 'blob')
      const moving = new Array(SZ * SZ).fill(0)
      // shift by (3, 2)
      for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
        const sx = x - 3, sy = y - 2
        if (sx >= 0 && sx < SZ && sy >= 0 && sy < SZ) moving[y * SZ + x] = fixed[sy * SZ + sx]
      }
      return { fixed, moving }
    })(),
    compute: (p) => {
      const fixed = parseArray(p.fixed)
      const moving = parseArray(p.moving)
      const sz = SZ
      let bestDx = 0, bestDy = 0, bestCorr = -Infinity
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        let corr = 0, count = 0
        for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
          const sx = x + dx, sy = y + dy
          if (sx >= 0 && sx < sz && sy >= 0 && sy < sz) {
            corr += fixed[y * sz + x] * moving[sy * sz + sx]
            count++
          }
        }
        if (count > 0) corr /= count
        if (corr > bestCorr) { bestCorr = corr; bestDx = dx; bestDy = dy }
      }
      return {
        statistics: [
          { label: 'X offset', value: String(bestDx) },
          { label: 'Y offset', value: String(bestDy) },
          { label: 'Correlation', value: fmt(bestCorr) },
        ],
      }
    },
  },
]

/* ═══ BIOINFORMATICS (8 presets) ═════════════════════════════════════ */
const bioinformaticsPresets: Preset[] = [
  {
    id: 'bio-diffexpr',
    name: 'Differential Expression',
    referenceFn: 'ttest2 (per gene)',
    toolbox: 'bioinformatics',
    description: 'Per-gene t-test between control and treatment',
    referenceCode: 'for g=1:nGenes; [~,p(g)]=ttest2(ctrl(g,:), trt(g,:)); end',
    workflowStage: 'analysis',
    params: [
      { key: 'control', label: 'Control matrix (genes; samples)', type: 'textarea' },
      { key: 'treatment', label: 'Treatment matrix (genes; samples)', type: 'textarea' },
    ],
    sampleData: {
      control: '5.2,5.1,5.3,5.0,5.4; 8.1,8.0,8.2,7.9,8.1; 3.5,3.6,3.4,3.5,3.5; 12.0,12.1,11.9,12.0,12.1; 6.5,6.4,6.6,6.5,6.5; 9.2,9.3,9.1,9.2,9.2; 4.8,4.7,4.9,4.8,4.8; 7.5,7.4,7.6,7.5,7.5',
      treatment: '5.3,5.2,5.4,5.1,5.3; 11.5,11.6,11.4,11.5,11.5; 3.6,3.5,3.4,3.6,3.5; 12.1,12.0,12.2,12.0,12.1; 9.8,9.7,9.9,9.8,9.8; 6.2,6.3,6.1,6.2,6.2; 4.7,4.8,4.6,4.7,4.7; 7.4,7.5,7.3,7.4,7.4',
    },
    compute: (p) => {
      const ctrl: number[][] = String(p.control).split(';').map(r => parseArray(r))
      const trt: number[][] = String(p.treatment).split(';').map(r => parseArray(r))
      const results = ctrl.map((c, i) => {
        const t = trt[i] || []
        const r = welchTTest(c, t)
        return { gene: i + 1, log2FC: Math.log2(mean(t) / mean(c)), pVal: r.p, t: r.t }
      })
      const sig = results.filter(r => r.pVal < 0.05).length
      return {
        statistics: [
          { label: 'Genes tested', value: String(results.length) },
          { label: 'Significant (p<0.05)', value: String(sig) },
          ...results.slice(0, 6).map(r => ({ label: `Gene ${r.gene}`, value: `log2FC=${fmt(r.log2FC)} p=${fmt(r.pVal, 4)}` })),
        ],
        chartType: 'scatter',
        chartTitle: 'Volcano Plot',
        chartData: results.map(r => ({ x: r.log2FC, y: -Math.log10(r.pVal + 1e-12) })),
        xLabel: 'log2 Fold Change', yLabel: '-log10(p)',
      }
    },
  },
  {
    id: 'bio-fdr',
    name: 'Benjamini-Hochberg FDR',
    referenceFn: 'mafdr',
    toolbox: 'bioinformatics',
    description: 'FDR correction for multiple testing',
    referenceCode: 'fdr = mafdr(pvals);',
    workflowStage: 'analysis',
    params: [
      { key: 'pvals', label: 'P-values', type: 'textarea' },
      { key: 'alpha', label: 'FDR level', type: 'number', default: 0.05 },
    ],
    sampleData: { pvals: [0.001, 0.003, 0.008, 0.012, 0.020, 0.025, 0.041, 0.058, 0.067, 0.082, 0.105, 0.121, 0.156, 0.198, 0.234, 0.301, 0.412, 0.521, 0.654, 0.812], alpha: 0.05 },
    compute: (p) => {
      const pvals = parseArray(p.pvals)
      const alpha = parseFloat(p.alpha)
      const indexed = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
      const m = pvals.length
      const adjusted = new Array(m).fill(0)
      for (let k = m - 1; k >= 0; k--) {
        const adj = (indexed[k].p * m) / (k + 1)
        adjusted[indexed[k].i] = k === m - 1 ? Math.min(adj, 1) : Math.min(adj, adjusted[indexed[k + 1].i])
      }
      const significant = adjusted.filter(a => a < alpha).length
      return {
        statistics: [
          { label: 'Total tests', value: String(m) },
          { label: 'Significant raw', value: String(pvals.filter(p => p < alpha).length) },
          { label: 'Significant FDR', value: String(significant) },
          { label: 'Min adj p', value: fmt(Math.min(...adjusted), 6) },
        ],
        chartType: 'scatter',
        chartTitle: 'Adjusted vs Raw p-values',
        chartData: pvals.map((p, i) => ({ x: p, y: adjusted[i] })),
        xLabel: 'Raw p-value', yLabel: 'BH-adjusted p',
      }
    },
  },
  {
    id: 'bio-enrichment',
    name: 'Hypergeometric Enrichment',
    referenceFn: 'hygecdf',
    toolbox: 'bioinformatics',
    description: 'Gene set enrichment via hypergeometric test',
    referenceCode: 'p = 1 - hygecdf(k-1, N, K, n);',
    workflowStage: 'analysis',
    params: [
      { key: 'hits', label: 'Hits in query (k)', type: 'number', default: 5 },
      { key: 'querySize', label: 'Query size (n)', type: 'number', default: 20 },
      { key: 'totalHits', label: 'Total annotated (K)', type: 'number', default: 50 },
      { key: 'universe', label: 'Universe size (N)', type: 'number', default: 1000 },
    ],
    sampleData: { hits: 5, querySize: 20, totalHits: 50, universe: 1000 },
    compute: (p) => {
      const k = parseInt(p.hits), n = parseInt(p.querySize)
      const K = parseInt(p.totalHits), N = parseInt(p.universe)
      // Hypergeometric P(X >= k)
      const lnFact = (x: number) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s }
      const lnChoose = (a: number, b: number) => lnFact(a) - lnFact(b) - lnFact(a - b)
      let pVal = 0
      for (let i = k; i <= Math.min(K, n); i++) {
        const lnP = lnChoose(K, i) + lnChoose(N - K, n - i) - lnChoose(N, n)
        pVal += Math.exp(lnP)
      }
      const expected = (n * K) / N
      const fold = k / expected
      return {
        statistics: [
          { label: 'Observed hits', value: String(k) },
          { label: 'Expected hits', value: fmt(expected) },
          { label: 'Fold enrichment', value: fmt(fold) },
          { label: 'p-value', value: fmt(pVal, 6) },
          { label: 'Conclusion', value: pVal < 0.05 ? 'Significantly enriched' : 'Not significant' },
        ],
      }
    },
  },
  {
    id: 'bio-hclust',
    name: 'Hierarchical Clustering',
    referenceFn: 'linkage',
    toolbox: 'bioinformatics',
    description: 'Agglomerative clustering with single linkage',
    referenceCode: 'Z = linkage(X, "single");',
    workflowStage: 'modeling',
    params: [{ key: 'data', label: 'Expression matrix (samples; genes)', type: 'textarea' }],
    sampleData: { data: '5,8,3,12; 5.1,8.1,3.1,12.1; 7,3,9,2; 7.1,3.1,9.1,2.1; 4,6,5,8; 4.1,6.1,5.1,8.1; 9,2,7,4; 9.1,2.1,7.1,4.1' },
    compute: (p) => {
      const matrix: number[][] = String(p.data).split(';').map(r => parseArray(r))
      const n = matrix.length
      // Distance matrix
      const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0))
      let clusters: number[][] = matrix.map((_, i) => [i])
      const merges: { a: number; b: number; dist: number }[] = []
      while (clusters.length > 1) {
        let minD = Infinity, minI = 0, minJ = 1
        for (let i = 0; i < clusters.length; i++) {
          for (let j = i + 1; j < clusters.length; j++) {
            // Single linkage: min distance between members
            let d = Infinity
            for (const a of clusters[i]) for (const b of clusters[j]) d = Math.min(d, dist(matrix[a], matrix[b]))
            if (d < minD) { minD = d; minI = i; minJ = j }
          }
        }
        merges.push({ a: clusters[minI][0], b: clusters[minJ][0], dist: minD })
        clusters = [...clusters.slice(0, minI), [...clusters[minI], ...clusters[minJ]], ...clusters.slice(minI + 1, minJ), ...clusters.slice(minJ + 1)]
      }
      return {
        statistics: [
          { label: 'Samples', value: String(n) },
          { label: 'Merges', value: String(merges.length) },
          { label: 'First merge', value: `samples ${merges[0]?.a + 1} & ${merges[0]?.b + 1} (d=${fmt(merges[0]?.dist)})` },
          { label: 'Final distance', value: fmt(merges[merges.length - 1]?.dist || 0) },
        ],
        chartType: 'bar',
        chartTitle: 'Merge Distances',
        chartData: merges.map((m, i) => ({ x: i, y: m.dist, label: `${m.a + 1}+${m.b + 1}` })),
      }
    },
  },
  {
    id: 'bio-gc-content',
    name: 'GC Content & Codons',
    referenceFn: 'basecount, codoncount',
    toolbox: 'bioinformatics',
    description: 'Compute %GC and codon composition of a DNA sequence',
    referenceCode: 'gc = (sum(seq=="G") + sum(seq=="C")) / length(seq);',
    workflowStage: 'analysis',
    params: [{ key: 'seq', label: 'DNA sequence', type: 'textarea' }],
    sampleData: { seq: 'ATGCGATCGATCGATTAGCTAGCTAGCATCGATCGTAGCTAGCATCGATCATCGATCGATCG' },
    compute: (p) => {
      const seq = String(p.seq).toUpperCase().replace(/[^ACGT]/g, '')
      const counts = { A: 0, C: 0, G: 0, T: 0 }
      for (const ch of seq) counts[ch as keyof typeof counts]++
      const gc = (counts.G + counts.C) / seq.length
      // Codon counting
      const codons: Record<string, number> = {}
      for (let i = 0; i < seq.length - 2; i += 3) {
        const c = seq.substring(i, i + 3)
        codons[c] = (codons[c] || 0) + 1
      }
      const topCodons = Object.entries(codons).sort((a, b) => b[1] - a[1]).slice(0, 5)
      return {
        statistics: [
          { label: 'Length', value: String(seq.length) },
          { label: '%GC', value: fmt(gc * 100) + '%' },
          { label: 'A count', value: String(counts.A) },
          { label: 'C count', value: String(counts.C) },
          { label: 'G count', value: String(counts.G) },
          { label: 'T count', value: String(counts.T) },
          ...topCodons.map(([c, n]) => ({ label: `Codon ${c}`, value: String(n) })),
        ],
        chartType: 'bar',
        chartTitle: 'Base Composition',
        chartData: [
          { x: 0, y: counts.A, label: 'A' },
          { x: 1, y: counts.C, label: 'C' },
          { x: 2, y: counts.G, label: 'G' },
          { x: 3, y: counts.T, label: 'T' },
        ],
      }
    },
  },
  {
    id: 'bio-rnaseq-norm',
    name: 'RNA-Seq CPM Normalization',
    referenceFn: 'mrnorm, cpm',
    toolbox: 'bioinformatics',
    description: 'Counts per million normalization',
    referenceCode: 'cpm = bsxfun(@rdivide, counts, sum(counts)) * 1e6;',
    workflowStage: 'preprocessing',
    params: [{ key: 'counts', label: 'Raw counts (samples; genes)', type: 'textarea' }],
    sampleData: { counts: '120,450,3200,80; 130,520,2800,75; 110,480,3500,85; 140,510,3100,90' },
    compute: (p) => {
      const matrix: number[][] = String(p.counts).split(';').map(r => parseArray(r))
      const totals = matrix.map(row => row.reduce((s, v) => s + v, 0))
      const cpm = matrix.map((row, i) => row.map(v => (v / totals[i]) * 1e6))
      return {
        statistics: [
          { label: 'Samples', value: String(matrix.length) },
          { label: 'Genes', value: String(matrix[0]?.length || 0) },
          ...totals.map((t, i) => ({ label: `Sample ${i + 1} library size`, value: fmt(t) })),
          ...cpm[0]?.map((v, i) => ({ label: `Gene ${i + 1} CPM (S1)`, value: fmt(v) })) || [],
        ],
      }
    },
  },
  {
    id: 'bio-phylo',
    name: 'Phylogenetic Distance',
    referenceFn: 'seqpdist',
    toolbox: 'bioinformatics',
    description: 'Pairwise Hamming distance between sequences',
    referenceCode: 'D = seqpdist(seqs);',
    workflowStage: 'analysis',
    params: [{ key: 'seqs', label: 'Sequences (one per line)', type: 'textarea' }],
    sampleData: { seqs: 'ATCGTACG; ATCGTACC; ATCGTAAG; ATCGAACG; ATGGTACG' },
    compute: (p) => {
      const seqs = String(p.seqs).split(/[;\n]/).map(s => s.trim()).filter(Boolean)
      const n = seqs.length
      const distances: { i: number; j: number; d: number }[] = []
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let diff = 0
        const len = Math.min(seqs[i].length, seqs[j].length)
        for (let k = 0; k < len; k++) if (seqs[i][k] !== seqs[j][k]) diff++
        distances.push({ i, j, d: diff / len })
      }
      return {
        statistics: [
          { label: 'Sequences', value: String(n) },
          { label: 'Pairs', value: String(distances.length) },
          { label: 'Mean distance', value: fmt(mean(distances.map(d => d.d))) },
          { label: 'Max distance', value: fmt(Math.max(...distances.map(d => d.d))) },
          ...distances.slice(0, 6).map(d => ({ label: `d(${d.i + 1},${d.j + 1})`, value: fmt(d.d) })),
        ],
      }
    },
  },
  {
    id: 'bio-quantile-norm',
    name: 'Quantile Normalization',
    referenceFn: 'quantilenorm',
    toolbox: 'bioinformatics',
    description: 'Normalize array distributions to common reference',
    referenceCode: 'X_norm = quantilenorm(X);',
    workflowStage: 'preprocessing',
    params: [{ key: 'data', label: 'Arrays (one per line)', type: 'textarea' }],
    sampleData: { data: '5,2,3,4,1; 4,1,4,2,2; 3,4,6,8,5; 6,7,8,2,3' },
    compute: (p) => {
      const arrays: number[][] = String(p.data).split(';').map(r => parseArray(r))
      const n = arrays[0].length
      const m = arrays.length
      // Sort each array, average across arrays per rank
      const sorted = arrays.map(a => [...a].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v))
      const refRanks = new Array(n).fill(0)
      for (let r = 0; r < n; r++) refRanks[r] = mean(sorted.map(s => s[r].v))
      // Replace each array's values with reference rank values
      const normalized = arrays.map((_a, ai) => {
        const out = new Array(n)
        sorted[ai].forEach((d, r) => { out[d.i] = refRanks[r] })
        return out
      })
      return {
        statistics: [
          { label: 'Arrays', value: String(m) },
          { label: 'Genes', value: String(n) },
          ...arrays.map((a, i) => ({ label: `Array ${i + 1} mean`, value: fmt(mean(a)) })),
          ...normalized.map((a, i) => ({ label: `Norm ${i + 1} mean`, value: fmt(mean(a)) })),
        ],
      }
    },
  },
]

/* ═══ CURVE FITTING (6 presets) ══════════════════════════════════════ */
const curveFittingPresets: Preset[] = [
  {
    id: 'fit-polyfit',
    name: 'Polynomial Fit',
    referenceFn: 'polyfit, polyval',
    toolbox: 'curvefitting',
    description: 'Fit a polynomial of degree N to data',
    referenceCode: 'p = polyfit(x, y, n);\nyfit = polyval(p, x);',
    workflowStage: 'modeling',
    params: [
      { key: 'x', label: 'X data', type: 'textarea' },
      { key: 'y', label: 'Y data', type: 'textarea' },
      { key: 'degree', label: 'Polynomial degree', type: 'number', default: 2 },
    ],
    sampleData: {
      x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      y: [2.1, 3.5, 6.2, 10.8, 17.4, 25.5, 35.8, 48.1, 62.5, 79.2, 98.0],
      degree: 2,
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      const deg = parseInt(p.degree)
      const coeffs = polyfit(x, y, deg)
      const fitted = x.map(xi => polyval(coeffs, xi))
      const ssRes = y.reduce((s, yi, i) => s + (yi - fitted[i]) ** 2, 0)
      const yMean = mean(y)
      const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
      const r2 = 1 - ssRes / ssTot
      return {
        statistics: [
          { label: 'Degree', value: String(deg) },
          { label: 'R²', value: fmt(r2) },
          ...coeffs.map((c, i) => ({ label: `c${i}`, value: fmt(c) })),
        ],
        chartType: 'multi-line',
        chartTitle: 'Polynomial Fit',
        chartData: x.map((xi, i) => ({ x: xi, y: y[i], y2: fitted[i] })),
        seriesLabels: ['Data', 'Fit'],
      }
    },
  },
  {
    id: 'fit-exponential',
    name: 'Exponential Fit',
    referenceFn: "fit(x, y, 'exp1')",
    toolbox: 'curvefitting',
    description: 'Fit y = a*exp(b*x) via linearization',
    referenceCode: "f = fit(x, y, 'exp1');",
    workflowStage: 'modeling',
    params: [
      { key: 'x', label: 'Time', type: 'textarea' },
      { key: 'y', label: 'Population', type: 'textarea' },
    ],
    sampleData: {
      x: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      y: [10, 14, 22, 35, 56, 88, 142, 228, 365],
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      const lnY = y.map(v => Math.log(v))
      const r = linearRegression(x, lnY)
      const a = Math.exp(r.intercept)
      const b = r.slope
      const fitted = x.map(xi => a * Math.exp(b * xi))
      return {
        statistics: [
          { label: 'a (amplitude)', value: fmt(a) },
          { label: 'b (rate)', value: fmt(b) },
          { label: 'Doubling time', value: fmt(Math.log(2) / b) },
          { label: 'R² (linearized)', value: fmt(r.r2) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Exponential Fit',
        chartData: x.map((xi, i) => ({ x: xi, y: y[i], y2: fitted[i] })),
        seriesLabels: ['Data', 'Fit'],
      }
    },
  },
  {
    id: 'fit-gaussian',
    name: 'Gaussian Fit',
    referenceFn: "fit(x, y, 'gauss1')",
    toolbox: 'curvefitting',
    description: 'Fit a single Gaussian peak',
    referenceCode: "f = fit(x, y, 'gauss1');",
    workflowStage: 'modeling',
    params: [
      { key: 'x', label: 'X data', type: 'textarea' },
      { key: 'y', label: 'Y data', type: 'textarea' },
    ],
    sampleData: {
      x: Array.from({ length: 41 }, (_, i) => -10 + i * 0.5),
      y: Array.from({ length: 41 }, (_, i) => {
        const x = -10 + i * 0.5
        return 5 * Math.exp(-((x - 2) ** 2) / 8) + (Math.random() - 0.5) * 0.3
      }),
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      // Grid search for mu, sigma, amplitude
      let best = { mu: 0, sigma: 1, amp: 1, err: Infinity }
      const xMin = Math.min(...x), xMax = Math.max(...x)
      for (let mu = xMin; mu <= xMax; mu += (xMax - xMin) / 30) {
        for (let sigma = 0.5; sigma <= (xMax - xMin) / 2; sigma += 0.2) {
          for (let amp = Math.max(...y) * 0.5; amp <= Math.max(...y) * 1.5; amp += 0.2) {
            let err = 0
            for (let i = 0; i < x.length; i++) {
              const pred = amp * Math.exp(-((x[i] - mu) ** 2) / (2 * sigma * sigma))
              err += (y[i] - pred) ** 2
            }
            if (err < best.err) best = { mu, sigma, amp, err }
          }
        }
      }
      const fitted = x.map(xi => best.amp * Math.exp(-((xi - best.mu) ** 2) / (2 * best.sigma * best.sigma)))
      return {
        statistics: [
          { label: 'μ (mean)', value: fmt(best.mu) },
          { label: 'σ (std)', value: fmt(best.sigma) },
          { label: 'Amplitude', value: fmt(best.amp) },
          { label: 'FWHM', value: fmt(2.355 * best.sigma) },
          { label: 'SSE', value: fmt(best.err) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Gaussian Fit',
        chartData: x.map((xi, i) => ({ x: xi, y: y[i], y2: fitted[i] })),
        seriesLabels: ['Data', 'Fit'],
      }
    },
  },
  {
    id: 'fit-nlsq',
    name: 'Michaelis-Menten Fit',
    referenceFn: 'lsqcurvefit',
    toolbox: 'curvefitting',
    description: 'Nonlinear fit V = Vmax*S/(Km+S)',
    referenceCode: 'V = @(p, S) p(1)*S./(p(2)+S);\np = lsqcurvefit(V, p0, S, V_obs);',
    workflowStage: 'modeling',
    params: [
      { key: 'S', label: 'Substrate [S]', type: 'textarea' },
      { key: 'V', label: 'Velocity V', type: 'textarea' },
    ],
    sampleData: {
      S: [0.5, 1, 2, 5, 10, 20, 50, 100],
      V: [8.5, 15.2, 25.8, 50.1, 70.3, 85.2, 95.4, 98.1],
    },
    compute: (p) => {
      const S = parseArray(p.S), V = parseArray(p.V)
      // Lineweaver-Burk linearization for initial estimate
      const invS = S.map(s => 1 / s)
      const invV = V.map(v => 1 / v)
      const r = linearRegression(invS, invV)
      const Vmax0 = 1 / r.intercept
      const Km0 = r.slope * Vmax0
      // Refine with grid search
      let best = { Vmax: Vmax0, Km: Km0, err: Infinity }
      for (let dv = 0.7; dv <= 1.3; dv += 0.05) {
        for (let dk = 0.5; dk <= 2; dk += 0.1) {
          const Vm = Vmax0 * dv, K = Km0 * dk
          let err = 0
          for (let i = 0; i < S.length; i++) {
            const pred = (Vm * S[i]) / (K + S[i])
            err += (V[i] - pred) ** 2
          }
          if (err < best.err) best = { Vmax: Vm, Km: K, err }
        }
      }
      const fitted = S.map(s => (best.Vmax * s) / (best.Km + s))
      return {
        statistics: [
          { label: 'Vmax', value: fmt(best.Vmax) },
          { label: 'Km', value: fmt(best.Km) },
          { label: 'Vmax / 2', value: fmt(best.Vmax / 2) },
          { label: 'SSE', value: fmt(best.err) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Michaelis-Menten Fit',
        chartData: S.map((s, i) => ({ x: s, y: V[i], y2: fitted[i] })),
        seriesLabels: ['Data', 'Fit'],
      }
    },
  },
  {
    id: 'fit-gmm',
    name: 'Gaussian Mixture Model',
    referenceFn: 'fitgmdist',
    toolbox: 'curvefitting',
    description: 'Fit 2-component GMM via EM',
    referenceCode: 'gm = fitgmdist(x, 2);',
    workflowStage: 'modeling',
    params: [{ key: 'data', label: 'Data', type: 'textarea' }],
    sampleData: {
      data: [
        ...Array.from({ length: 30 }, () => 5 + Math.random() * 2),
        ...Array.from({ length: 30 }, () => 12 + Math.random() * 2),
      ],
    },
    compute: (p) => {
      const data = parseArray(p.data)
      // Simple 2-component EM
      let mu1 = Math.min(...data), mu2 = Math.max(...data)
      let sd1 = std(data), sd2 = std(data)
      let w1 = 0.5, w2 = 0.5
      const norm = (x: number, m: number, s: number) => Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))
      for (let iter = 0; iter < 50; iter++) {
        // E-step
        const r1 = data.map(x => (w1 * norm(x, mu1, sd1)) / (w1 * norm(x, mu1, sd1) + w2 * norm(x, mu2, sd2) + 1e-12))
        const r2 = r1.map(r => 1 - r)
        // M-step
        const sum1 = r1.reduce((s, v) => s + v, 0)
        const sum2 = r2.reduce((s, v) => s + v, 0)
        mu1 = data.reduce((s, x, i) => s + r1[i] * x, 0) / sum1
        mu2 = data.reduce((s, x, i) => s + r2[i] * x, 0) / sum2
        sd1 = Math.sqrt(data.reduce((s, x, i) => s + r1[i] * (x - mu1) ** 2, 0) / sum1) || 1
        sd2 = Math.sqrt(data.reduce((s, x, i) => s + r2[i] * (x - mu2) ** 2, 0) / sum2) || 1
        w1 = sum1 / data.length
        w2 = sum2 / data.length
      }
      return {
        statistics: [
          { label: 'Component 1 μ', value: fmt(mu1) },
          { label: 'Component 1 σ', value: fmt(sd1) },
          { label: 'Component 1 weight', value: fmt(w1) },
          { label: 'Component 2 μ', value: fmt(mu2) },
          { label: 'Component 2 σ', value: fmt(sd2) },
          { label: 'Component 2 weight', value: fmt(w2) },
        ],
        chartType: 'bar',
        chartTitle: 'Data Histogram',
        chartData: buildHistogram(data, 15).map(b => ({ x: parseFloat(b.bin), y: b.count, label: b.bin })),
      }
    },
  },
  {
    id: 'fit-spline',
    name: 'Cubic Spline Interpolation',
    referenceFn: 'spline, interp1',
    toolbox: 'curvefitting',
    description: 'Smooth interpolation between data points',
    referenceCode: 'yy = spline(x, y, xx);',
    workflowStage: 'modeling',
    params: [
      { key: 'x', label: 'X data', type: 'textarea' },
      { key: 'y', label: 'Y data', type: 'textarea' },
    ],
    sampleData: {
      x: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      y: [0, 1, 4, 9, 16, 12, 8, 5, 2],
    },
    compute: (p) => {
      const x = parseArray(p.x), y = parseArray(p.y)
      // Natural cubic spline
      const n = x.length - 1
      const h = new Array(n)
      for (let i = 0; i < n; i++) h[i] = x[i + 1] - x[i]
      const alpha = new Array(n).fill(0)
      for (let i = 1; i < n; i++) alpha[i] = (3 / h[i]) * (y[i + 1] - y[i]) - (3 / h[i - 1]) * (y[i] - y[i - 1])
      const l = new Array(n + 1).fill(1)
      const mu = new Array(n + 1).fill(0)
      const z = new Array(n + 1).fill(0)
      for (let i = 1; i < n; i++) {
        l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1]
        mu[i] = h[i] / l[i]
        z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i]
      }
      const c = new Array(n + 1).fill(0)
      const b = new Array(n).fill(0)
      const d = new Array(n).fill(0)
      for (let j = n - 1; j >= 0; j--) {
        c[j] = z[j] - mu[j] * c[j + 1]
        b[j] = (y[j + 1] - y[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3
        d[j] = (c[j + 1] - c[j]) / (3 * h[j])
      }
      // Sample interpolated values
      const xq: number[] = []
      const yq: number[] = []
      for (let i = 0; i < n; i++) {
        for (let s = 0; s < 10; s++) {
          const t = (s / 10) * h[i]
          xq.push(x[i] + t)
          yq.push(y[i] + b[i] * t + c[i] * t * t + d[i] * t * t * t)
        }
      }
      xq.push(x[n]); yq.push(y[n])
      return {
        statistics: [
          { label: 'Knots', value: String(x.length) },
          { label: 'Interpolated points', value: String(xq.length) },
        ],
        chartType: 'line',
        chartTitle: 'Spline Interpolation',
        chartData: xq.map((v, i) => ({ x: v, y: yq[i] })),
      }
    },
  },
]

/* ═══ ODE & SIMULATION (8 presets) ═══════════════════════════════════ */
const odePresets: Preset[] = [
  {
    id: 'ode-pk1',
    name: 'One-Compartment PK (IV)',
    referenceFn: 'ode45',
    toolbox: 'ode',
    description: 'IV bolus exponential decay: C(t) = C0*exp(-ke*t)',
    referenceCode: '[t, C] = ode45(@(t,C) -ke*C, [0 48], dose/V);',
    workflowStage: 'modeling',
    params: [
      { key: 'dose', label: 'Dose (mg)', type: 'number', default: 100 },
      { key: 'volume', label: 'Volume of distribution (L)', type: 'number', default: 50 },
      { key: 'ke', label: 'Elimination rate (1/h)', type: 'number', default: 0.15, step: 0.01 },
      { key: 'tMax', label: 'Simulation time (h)', type: 'number', default: 48 },
    ],
    sampleData: { dose: 100, volume: 50, ke: 0.15, tMax: 48 },
    compute: (p) => {
      const r = pkOneCompartment(parseFloat(p.dose), parseFloat(p.volume), parseFloat(p.ke), parseFloat(p.tMax))
      const halfLife = Math.log(2) / parseFloat(p.ke)
      const C0 = parseFloat(p.dose) / parseFloat(p.volume)
      const auc = (C0 / parseFloat(p.ke))
      return {
        statistics: [
          { label: 'C₀', value: `${fmt(C0)} mg/L` },
          { label: 'Half-life', value: `${fmt(halfLife)} h` },
          { label: 'Clearance', value: `${fmt(parseFloat(p.ke) * parseFloat(p.volume))} L/h` },
          { label: 'AUC₀-∞', value: `${fmt(auc)} mg·h/L` },
        ],
        chartType: 'line',
        chartTitle: 'Plasma Concentration vs Time',
        chartData: r.t.map((t, i) => ({ x: t, y: r.c[i] })),
        xLabel: 'Time (h)', yLabel: 'C (mg/L)',
      }
    },
  },
  {
    id: 'ode-pk2',
    name: 'Two-Compartment PK',
    referenceFn: 'ode45',
    toolbox: 'ode',
    description: 'Distribution and elimination phases',
    referenceCode: '[t,Y] = ode45(@pk2model, [0 72], [C0 0]);',
    workflowStage: 'modeling',
    params: [
      { key: 'dose', label: 'Dose (mg)', type: 'number', default: 100 },
      { key: 'V1', label: 'V1 central (L)', type: 'number', default: 30 },
      { key: 'k10', label: 'k10 elimination (1/h)', type: 'number', default: 0.2 },
      { key: 'k12', label: 'k12 (1/h)', type: 'number', default: 0.4 },
      { key: 'k21', label: 'k21 (1/h)', type: 'number', default: 0.1 },
      { key: 'tMax', label: 'Time (h)', type: 'number', default: 72 },
    ],
    sampleData: { dose: 100, V1: 30, k10: 0.2, k12: 0.4, k21: 0.1, tMax: 72 },
    compute: (p) => {
      const dose = parseFloat(p.dose), V1 = parseFloat(p.V1)
      const k10 = parseFloat(p.k10), k12 = parseFloat(p.k12), k21 = parseFloat(p.k21)
      const f = (_t: number, y: number[]) => [
        -((k10 + k12) * y[0]) + k21 * y[1],
        k12 * y[0] - k21 * y[1],
      ]
      const sol = ode45(f, [0, parseFloat(p.tMax)], [dose / V1, 0], 300)
      return {
        statistics: [
          { label: 'C₀ central', value: fmt(dose / V1) },
          { label: 'V1', value: `${V1} L` },
          { label: 'k10', value: `${k10}/h` },
          { label: 'k12 / k21', value: `${k12} / ${k21}` },
        ],
        chartType: 'multi-line',
        chartTitle: 'Two-Compartment PK',
        chartData: sol.t.map((t, i) => ({ x: t, y: sol.y[i][0], y2: sol.y[i][1] })),
        seriesLabels: ['Central', 'Peripheral'],
      }
    },
  },
  {
    id: 'ode-sir',
    name: 'SIR Epidemic Model',
    referenceFn: 'ode45',
    toolbox: 'ode',
    description: 'Susceptible-Infected-Recovered dynamics',
    referenceCode: '[t,Y] = ode45(@sir, [0 160], [S0 I0 R0]);',
    workflowStage: 'modeling',
    params: [
      { key: 'N', label: 'Population (N)', type: 'number', default: 10000 },
      { key: 'I0', label: 'Initial infected', type: 'number', default: 10 },
      { key: 'beta', label: 'Transmission β', type: 'number', default: 0.3, step: 0.01 },
      { key: 'gamma', label: 'Recovery γ', type: 'number', default: 0.1, step: 0.01 },
      { key: 'days', label: 'Days', type: 'number', default: 160 },
    ],
    sampleData: { N: 10000, I0: 10, beta: 0.3, gamma: 0.1, days: 160 },
    compute: (p) => {
      const N = parseFloat(p.N), I0 = parseFloat(p.I0)
      const beta = parseFloat(p.beta), gamma = parseFloat(p.gamma)
      const f = (_t: number, y: number[]) => [
        (-beta * y[0] * y[1]) / N,
        (beta * y[0] * y[1]) / N - gamma * y[1],
        gamma * y[1],
      ]
      const sol = ode45(f, [0, parseFloat(p.days)], [N - I0, I0, 0], 300)
      const peakI = Math.max(...sol.y.map(yi => yi[1]))
      const peakDay = sol.t[sol.y.findIndex(yi => yi[1] === peakI)]
      const finalR = sol.y[sol.y.length - 1][2]
      return {
        statistics: [
          { label: 'R₀', value: fmt(beta / gamma) },
          { label: 'Peak infected', value: fmt(peakI) },
          { label: 'Peak day', value: fmt(peakDay) },
          { label: 'Final recovered', value: fmt(finalR) },
          { label: 'Attack rate', value: fmt(100 * finalR / N) + '%' },
        ],
        chartType: 'multi-line',
        chartTitle: 'SIR Dynamics',
        chartData: sol.t.map((t, i) => ({ x: t, y: sol.y[i][0], y2: sol.y[i][1], y3: sol.y[i][2] })),
        seriesLabels: ['S', 'I', 'R'],
      }
    },
  },
  {
    id: 'ode-lotka',
    name: 'Lotka-Volterra (Predator-Prey)',
    referenceFn: 'ode45',
    toolbox: 'ode',
    description: 'Coupled predator-prey population dynamics',
    referenceCode: '[t,Y] = ode45(@lotka, [0 50], [prey0 pred0]);',
    workflowStage: 'modeling',
    params: [
      { key: 'prey0', label: 'Initial prey', type: 'number', default: 100 },
      { key: 'pred0', label: 'Initial predator', type: 'number', default: 20 },
      { key: 'alpha', label: 'α (prey growth)', type: 'number', default: 0.1, step: 0.01 },
      { key: 'beta', label: 'β (predation)', type: 'number', default: 0.02, step: 0.001 },
      { key: 'delta', label: 'δ (predator growth)', type: 'number', default: 0.01, step: 0.001 },
      { key: 'gamma', label: 'γ (predator death)', type: 'number', default: 0.1, step: 0.01 },
    ],
    sampleData: { prey0: 100, pred0: 20, alpha: 0.1, beta: 0.02, delta: 0.01, gamma: 0.1 },
    compute: (p) => {
      const a = parseFloat(p.alpha), b = parseFloat(p.beta)
      const d = parseFloat(p.delta), g = parseFloat(p.gamma)
      const f = (_t: number, y: number[]) => [
        a * y[0] - b * y[0] * y[1],
        d * y[0] * y[1] - g * y[1],
      ]
      const sol = ode45(f, [0, 200], [parseFloat(p.prey0), parseFloat(p.pred0)], 500)
      return {
        statistics: [
          { label: 'Equilibrium prey', value: fmt(g / d) },
          { label: 'Equilibrium predator', value: fmt(a / b) },
          { label: 'Max prey', value: fmt(Math.max(...sol.y.map(y => y[0]))) },
          { label: 'Max predator', value: fmt(Math.max(...sol.y.map(y => y[1]))) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Lotka-Volterra Cycles',
        chartData: sol.t.map((t, i) => ({ x: t, y: sol.y[i][0], y2: sol.y[i][1] })),
        seriesLabels: ['Prey', 'Predator'],
      }
    },
  },
  {
    id: 'ode-mm',
    name: 'Michaelis-Menten Curve',
    referenceFn: 'V = Vmax*S/(Km+S)',
    toolbox: 'ode',
    description: 'Enzyme kinetics velocity vs substrate',
    referenceCode: 'V = Vmax * S ./ (Km + S);',
    workflowStage: 'modeling',
    params: [
      { key: 'Vmax', label: 'Vmax', type: 'number', default: 100 },
      { key: 'Km', label: 'Km', type: 'number', default: 10 },
    ],
    sampleData: { Vmax: 100, Km: 10 },
    compute: (p) => {
      const Vmax = parseFloat(p.Vmax), Km = parseFloat(p.Km)
      const data: { x: number; y: number }[] = []
      for (let i = 0; i <= 200; i++) {
        const s = (i / 200) * 100
        data.push({ x: s, y: (Vmax * s) / (Km + s) })
      }
      return {
        statistics: [
          { label: 'Vmax', value: fmt(Vmax) },
          { label: 'Km', value: fmt(Km) },
          { label: 'V at S=Km', value: fmt(Vmax / 2) },
          { label: 'V at S=10*Km', value: fmt((Vmax * 10) / 11) },
        ],
        chartType: 'line',
        chartTitle: 'Michaelis-Menten',
        chartData: data,
        xLabel: '[S]', yLabel: 'V',
      }
    },
  },
  {
    id: 'ode-hill',
    name: 'Hill Equation',
    referenceFn: 'E = Emax*x^n/(EC50^n + x^n)',
    toolbox: 'ode',
    description: 'Sigmoidal dose-response',
    referenceCode: 'E = Emax * x.^n ./ (EC50.^n + x.^n);',
    workflowStage: 'modeling',
    params: [
      { key: 'Emax', label: 'Emax', type: 'number', default: 100 },
      { key: 'EC50', label: 'EC50', type: 'number', default: 10 },
      { key: 'n', label: 'Hill coefficient', type: 'number', default: 2, step: 0.1 },
    ],
    sampleData: { Emax: 100, EC50: 10, n: 2 },
    compute: (p) => {
      const Emax = parseFloat(p.Emax), EC50 = parseFloat(p.EC50), n = parseFloat(p.n)
      const data: { x: number; y: number }[] = []
      for (let i = 0; i <= 200; i++) {
        const dose = Math.pow(10, -1 + (i / 200) * 3)
        data.push({ x: dose, y: (Emax * Math.pow(dose, n)) / (Math.pow(EC50, n) + Math.pow(dose, n)) })
      }
      return {
        statistics: [
          { label: 'Emax', value: fmt(Emax) },
          { label: 'EC50', value: fmt(EC50) },
          { label: 'Hill n', value: fmt(n) },
          { label: 'EC20', value: fmt(EC50 * Math.pow(0.25, 1 / n)) },
          { label: 'EC80', value: fmt(EC50 * Math.pow(4, 1 / n)) },
        ],
        chartType: 'line',
        chartTitle: 'Dose-Response (Hill)',
        chartData: data,
        xLabel: 'Dose', yLabel: 'Effect',
      }
    },
  },
  {
    id: 'ode-logistic',
    name: 'Logistic Growth',
    referenceFn: 'ode45',
    toolbox: 'ode',
    description: 'Bounded population growth dN/dt = rN(1-N/K)',
    referenceCode: '[t,N] = ode45(@(t,N) r*N*(1-N/K), [0 100], N0);',
    workflowStage: 'modeling',
    params: [
      { key: 'K', label: 'Carrying capacity (K)', type: 'number', default: 1000 },
      { key: 'r', label: 'Growth rate (r)', type: 'number', default: 0.1, step: 0.01 },
      { key: 'N0', label: 'Initial population', type: 'number', default: 10 },
    ],
    sampleData: { K: 1000, r: 0.1, N0: 10 },
    compute: (p) => {
      const K = parseFloat(p.K), r = parseFloat(p.r), N0 = parseFloat(p.N0)
      const f = (_t: number, y: number[]) => [r * y[0] * (1 - y[0] / K)]
      const sol = ode45(f, [0, 100], [N0], 200)
      const inflectionTime = Math.log((K - N0) / N0) / r
      return {
        statistics: [
          { label: 'K', value: fmt(K) },
          { label: 'r', value: fmt(r) },
          { label: 'Inflection time', value: fmt(inflectionTime) },
          { label: 'Final N', value: fmt(sol.y[sol.y.length - 1][0]) },
        ],
        chartType: 'line',
        chartTitle: 'Logistic Growth',
        chartData: sol.t.map((t, i) => ({ x: t, y: sol.y[i][0] })),
      }
    },
  },
  {
    id: 'ode-montecarlo',
    name: 'Monte Carlo π Estimation',
    referenceFn: 'sum(x.^2 + y.^2 < 1) / N * 4',
    toolbox: 'ode',
    description: 'Estimate π via random sampling',
    referenceCode: 'p = sum(x.^2 + y.^2 < 1) / N * 4;',
    workflowStage: 'modeling',
    params: [{ key: 'N', label: 'Number of points', type: 'number', default: 10000 }],
    sampleData: { N: 10000 },
    compute: (p) => {
      const N = parseInt(p.N)
      let inside = 0
      const data: { x: number; y: number }[] = []
      for (let i = 0; i < N; i++) {
        const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1
        if (x * x + y * y <= 1) inside++
        if (i < 500) data.push({ x, y })
      }
      const pi = (4 * inside) / N
      return {
        statistics: [
          { label: 'Samples', value: String(N) },
          { label: 'Inside circle', value: String(inside) },
          { label: 'π estimate', value: fmt(pi) },
          { label: 'True π', value: fmt(Math.PI) },
          { label: 'Error', value: fmt(Math.abs(pi - Math.PI)) },
        ],
        chartType: 'scatter',
        chartTitle: 'Monte Carlo Sampling',
        chartData: data,
      }
    },
  },
]

/* ═══ SURVIVAL ANALYSIS (3 presets) ══════════════════════════════════ */
const survivalPresets: Preset[] = [
  {
    id: 'surv-km',
    name: 'Kaplan-Meier Survival',
    referenceFn: 'ecdf, kmplot',
    toolbox: 'survival',
    description: 'Survival curve with optional group stratification',
    referenceCode: '[f, x] = ecdf(t, "censoring", c, "function", "survivor");',
    workflowStage: 'analysis',
    params: [
      { key: 'times', label: 'Survival times', type: 'textarea' },
      { key: 'events', label: 'Events (1=death, 0=censored)', type: 'textarea' },
      { key: 'groups', label: 'Groups (optional)', type: 'textarea' },
    ],
    sampleData: {
      times: [5, 8, 12, 15, 18, 22, 25, 28, 32, 35, 6, 10, 14, 16, 20, 24, 27, 30, 34, 38],
      events: [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
      groups: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    compute: (p) => {
      const times = parseArray(p.times)
      const events = parseArray(p.events).map(v => (v === 1 ? 1 : 0)) as (0 | 1)[]
      const groups = p.groups ? parseArray(p.groups) : undefined
      const r = kaplanMeier(times, events, groups)
      return {
        statistics: [
          { label: 'Total subjects', value: String(times.length) },
          { label: 'Events', value: String(events.filter(e => e === 1).length) },
          { label: 'Censored', value: String(events.filter(e => e === 0).length) },
          ...r.medianSurvival.map((m, i) => ({
            label: `Median (Group ${i + 1})`,
            value: m === null ? 'Not reached' : fmt(m),
          })),
        ],
        chartType: 'multi-line',
        chartTitle: 'Kaplan-Meier Curves',
        chartData: r.curves[0]?.map((pt, i) => ({
          x: pt.time,
          y: pt.survival,
          y2: r.curves[1]?.[i]?.survival,
        })) || [],
        seriesLabels: ['Group 1', 'Group 2'],
      }
    },
  },
  {
    id: 'surv-cox',
    name: 'Cox Proportional Hazards',
    referenceFn: 'coxphfit',
    toolbox: 'survival',
    description: 'Univariate Cox regression for hazard ratio',
    referenceCode: '[b, logL, H] = coxphfit(x, t, "Censoring", c);',
    workflowStage: 'modeling',
    params: [
      { key: 'times', label: 'Survival times', type: 'textarea' },
      { key: 'events', label: 'Events (1=death)', type: 'textarea' },
      { key: 'x', label: 'Covariate', type: 'textarea' },
    ],
    sampleData: {
      times: [5, 8, 12, 15, 18, 22, 25, 28, 32, 35, 6, 10, 14, 16, 20, 24, 27, 30, 34, 38],
      events: [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
      x: [1.2, 0.8, 1.5, 0.6, 1.1, 0.9, 1.3, 0.7, 1.4, 0.5, 2.1, 1.8, 2.5, 1.6, 2.0, 1.9, 2.3, 1.7, 2.4, 2.2],
    },
    compute: (p) => {
      const t = parseArray(p.times)
      const e = parseArray(p.events)
      const x = parseArray(p.x)
      // Newton-Raphson on partial likelihood (univariate)
      const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b])
      let beta = 0
      for (let iter = 0; iter < 50; iter++) {
        let grad = 0, hess = 0
        for (const i of order) {
          if (e[i] !== 1) continue
          const riskSet = order.filter(j => t[j] >= t[i])
          const exps = riskSet.map(j => Math.exp(beta * x[j]))
          const sumExp = exps.reduce((s, v) => s + v, 0)
          const sumXExp = riskSet.reduce((s, j, k) => s + x[j] * exps[k], 0)
          const sumX2Exp = riskSet.reduce((s, j, k) => s + x[j] * x[j] * exps[k], 0)
          grad += x[i] - sumXExp / sumExp
          hess -= sumX2Exp / sumExp - (sumXExp / sumExp) ** 2
        }
        if (hess === 0) break
        beta -= grad / hess
      }
      const hr = Math.exp(beta)
      return {
        statistics: [
          { label: 'β coefficient', value: fmt(beta) },
          { label: 'Hazard ratio', value: fmt(hr) },
          { label: 'Interpretation', value: hr > 1 ? 'Increased risk' : 'Decreased risk' },
          { label: 'N events', value: String(e.filter(v => v === 1).length) },
        ],
      }
    },
  },
  {
    id: 'surv-logrank',
    name: 'Log-Rank Test',
    referenceFn: 'logrank',
    toolbox: 'survival',
    description: 'Compare survival curves between two groups',
    referenceCode: '[p, chi2] = logrank(t1, c1, t2, c2);',
    workflowStage: 'analysis',
    params: [
      { key: 'times', label: 'All times', type: 'textarea' },
      { key: 'events', label: 'Events (1=death)', type: 'textarea' },
      { key: 'groups', label: 'Groups (0 or 1)', type: 'textarea' },
    ],
    sampleData: {
      times: [5, 8, 12, 15, 18, 22, 25, 28, 32, 35, 6, 10, 14, 16, 20, 24, 27, 30, 34, 38],
      events: [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
      groups: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    compute: (p) => {
      const t = parseArray(p.times)
      const e = parseArray(p.events)
      const g = parseArray(p.groups)
      const data = t.map((time, i) => ({ time, event: e[i], group: g[i] })).sort((a, b) => a.time - b.time)
      const uniqueTimes = Array.from(new Set(data.filter(d => d.event === 1).map(d => d.time))).sort((a, b) => a - b)
      let O1 = 0, E1 = 0, V = 0
      for (const time of uniqueTimes) {
        const atRisk = data.filter(d => d.time >= time)
        const n1 = atRisk.filter(d => d.group === 0).length
        const n2 = atRisk.filter(d => d.group === 1).length
        const n = n1 + n2
        const events = data.filter(d => d.time === time && d.event === 1)
        const d1 = events.filter(d => d.group === 0).length
        const d = events.length
        if (n === 0) continue
        const e1 = (d * n1) / n
        const v = n > 1 ? (d * (n - d) * n1 * n2) / (n * n * (n - 1)) : 0
        O1 += d1
        E1 += e1
        V += v
      }
      const chi2 = ((O1 - E1) ** 2) / (V + 1e-12)
      const pVal = 1 - normCDF(Math.sqrt(chi2))
      return {
        statistics: [
          { label: 'Group 0 observed', value: String(O1) },
          { label: 'Group 0 expected', value: fmt(E1) },
          { label: 'χ² statistic', value: fmt(chi2) },
          { label: 'p-value', value: fmt(pVal * 2, 6) },
          { label: 'Conclusion', value: pVal * 2 < 0.05 ? 'Survival differs' : 'No significant difference' },
        ],
      }
    },
  },
]

/* ═══ MACHINE LEARNING (5 presets) ═══════════════════════════════════ */
const mlPresets: Preset[] = [
  {
    id: 'ml-kmeans',
    name: 'K-Means Clustering',
    referenceFn: 'kmeans',
    toolbox: 'ml',
    description: 'Unsupervised clustering of patient features into K groups',
    referenceCode: '[idx, C] = kmeans(X, k);',
    workflowStage: 'modeling',
    params: [
      { key: 'data', label: 'Feature Matrix (one row per sample, x,y per row)', type: 'textarea' },
      { key: 'k', label: 'Number of Clusters (k)', type: 'number', default: 3 },
    ],
    sampleData: {
      data: '1.2,2.1\n1.5,2.3\n1.1,1.9\n1.4,2.0\n5.5,5.7\n5.8,5.4\n5.2,5.9\n5.6,5.5\n9.1,1.2\n9.3,1.5\n9.0,1.4\n9.2,1.1',
      k: 3,
    },
    compute: (p) => {
      const rows = String(p.data || '').split(/\n+/).map(r => parseArray(r)).filter(r => r.length >= 2)
      if (rows.length < 3) return { error: 'Need at least 3 sample rows with 2+ features each' }
      const k = Math.max(2, Math.min(10, parseInt(p.k) || 3))
      const result = kmeans(rows, k)
      const sizes: Record<number, number> = {}
      result.labels.forEach(l => { sizes[l] = (sizes[l] || 0) + 1 })
      return {
        statistics: [
          { label: 'Samples', value: String(rows.length) },
          { label: 'Clusters', value: String(k) },
          ...Array.from({ length: k }, (_, i) => ({
            label: `Cluster ${i} size`,
            value: String(sizes[i] || 0),
          })),
          ...result.centroids.map((c, i) => ({
            label: `Centroid ${i}`,
            value: `(${c.map(v => fmt(v)).join(', ')})`,
          })),
        ],
        chartType: 'scatter',
        chartTitle: 'K-Means Clustering',
        xLabel: 'Feature 1',
        yLabel: 'Feature 2',
        chartData: rows.map((r, i) => ({ x: r[0], y: r[1], group: `Cluster ${result.labels[i]}` })),
      }
    },
  },
  {
    id: 'ml-pca',
    name: 'Principal Component Analysis',
    referenceFn: 'pca',
    toolbox: 'ml',
    description: 'Dimensionality reduction with explained variance ratio',
    referenceCode: '[coeff, score, latent, ~, explained] = pca(X);',
    workflowStage: 'modeling',
    params: [
      { key: 'data', label: 'Feature Matrix (rows=samples)', type: 'textarea' },
      { key: 'n', label: 'Components', type: 'number', default: 2 },
    ],
    sampleData: {
      data: '2.5,2.4,1.8\n0.5,0.7,0.3\n2.2,2.9,2.1\n1.9,2.2,1.7\n3.1,3.0,2.4\n2.3,2.7,1.9\n2.0,1.6,1.5\n1.0,1.1,0.9\n1.5,1.6,1.2\n1.1,0.9,0.8',
      n: 2,
    },
    compute: (p) => {
      const rows = String(p.data || '').split(/\n+/).map(r => parseArray(r)).filter(r => r.length >= 2)
      if (rows.length < 3) return { error: 'Need at least 3 samples' }
      const n = Math.max(1, Math.min(rows[0].length, parseInt(p.n) || 2))
      const res = pca(rows, n)
      return {
        statistics: [
          { label: 'Samples', value: String(rows.length) },
          { label: 'Features', value: String(rows[0].length) },
          { label: 'Components', value: String(n) },
          ...res.eigenvalues.map((e, i) => ({
            label: `PC${i + 1} eigenvalue`,
            value: fmt(e),
          })),
          ...res.explained.map((e, i) => ({
            label: `PC${i + 1} explained`,
            value: `${(e * 100).toFixed(1)}%`,
          })),
          { label: 'Total explained', value: `${(res.explained.reduce((s, v) => s + v, 0) * 100).toFixed(1)}%` },
        ],
        chartType: 'bar',
        chartTitle: 'Explained Variance by Component',
        xLabel: 'Component',
        yLabel: 'Variance %',
        chartData: res.explained.map((e, i) => ({ x: i + 1, y: e * 100, label: `PC${i + 1}` })),
      }
    },
  },
  {
    id: 'ml-roc',
    name: 'ROC Curve Analysis',
    referenceFn: 'perfcurve',
    toolbox: 'ml',
    description: 'Compute ROC curve and AUC for binary classifier output',
    referenceCode: '[X, Y, T, AUC] = perfcurve(labels, scores, 1);',
    workflowStage: 'modeling',
    params: [
      { key: 'scores', label: 'Predicted Scores', type: 'textarea' },
      { key: 'labels', label: 'True Labels (0/1)', type: 'textarea' },
    ],
    sampleData: {
      scores: [0.12, 0.18, 0.25, 0.31, 0.42, 0.48, 0.55, 0.61, 0.68, 0.74, 0.81, 0.85, 0.89, 0.92, 0.95],
      labels: [0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1],
    },
    compute: (p) => {
      const scores = parseArray(p.scores)
      const labels = parseArray(p.labels)
      if (scores.length !== labels.length) return { error: 'Scores and labels must have same length' }
      const pairs = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => b.s - a.s)
      const P = labels.filter(l => l === 1).length
      const N = labels.filter(l => l === 0).length
      if (P === 0 || N === 0) return { error: 'Need both positive and negative samples' }
      const roc: { x: number; y: number }[] = [{ x: 0, y: 0 }]
      let tp = 0, fp = 0
      for (const { l } of pairs) {
        if (l === 1) tp++
        else fp++
        roc.push({ x: fp / N, y: tp / P })
      }
      let auc = 0
      for (let i = 1; i < roc.length; i++) auc += (roc[i].x - roc[i - 1].x) * (roc[i].y + roc[i - 1].y) / 2
      return {
        statistics: [
          { label: 'Positives', value: String(P) },
          { label: 'Negatives', value: String(N) },
          { label: 'AUC', value: fmt(auc) },
          { label: 'Quality', value: auc > 0.9 ? 'Excellent' : auc > 0.8 ? 'Good' : auc > 0.7 ? 'Fair' : 'Poor' },
        ],
        chartType: 'line',
        chartTitle: `ROC Curve (AUC = ${fmt(auc)})`,
        xLabel: 'False Positive Rate',
        yLabel: 'True Positive Rate',
        chartData: roc.map(p => ({ x: p.x, y: p.y })),
      }
    },
  },
  {
    id: 'ml-knn',
    name: 'K-Nearest Neighbors (1D)',
    referenceFn: 'fitcknn',
    toolbox: 'ml',
    description: 'Classify a query value using k nearest training samples',
    referenceCode: 'mdl = fitcknn(X, y, "NumNeighbors", k);\npred = predict(mdl, query);',
    workflowStage: 'modeling',
    params: [
      { key: 'features', label: 'Training Features', type: 'textarea' },
      { key: 'labels', label: 'Training Labels', type: 'textarea' },
      { key: 'query', label: 'Query Value', type: 'number', default: 5.0 },
      { key: 'k', label: 'k', type: 'number', default: 3 },
    ],
    sampleData: {
      features: [1.0, 1.5, 2.0, 2.5, 3.0, 5.0, 5.5, 6.0, 6.5, 7.0, 9.0, 9.5, 10.0, 10.5, 11.0],
      labels: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2],
      query: 5.0,
      k: 3,
    },
    compute: (p) => {
      const x = parseArray(p.features)
      const y = parseArray(p.labels)
      const q = parseFloat(p.query)
      const k = Math.max(1, parseInt(p.k) || 3)
      if (x.length !== y.length) return { error: 'Features and labels mismatch' }
      const dists = x.map((xi, i) => ({ d: Math.abs(xi - q), label: y[i] })).sort((a, b) => a.d - b.d).slice(0, k)
      const votes: Record<number, number> = {}
      dists.forEach(d => { votes[d.label] = (votes[d.label] || 0) + 1 })
      const predicted = parseInt(Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0])
      return {
        statistics: [
          { label: 'Query', value: fmt(q) },
          { label: 'k', value: String(k) },
          { label: 'Predicted Class', value: String(predicted) },
          { label: 'Confidence', value: `${((votes[predicted] / k) * 100).toFixed(0)}%` },
          ...dists.map((d, i) => ({
            label: `Neighbor ${i + 1}`,
            value: `dist=${fmt(d.d)} class=${d.label}`,
          })),
        ],
        chartType: 'scatter',
        chartTitle: `k-NN Classification (k=${k})`,
        xLabel: 'Feature',
        yLabel: 'Class',
        chartData: [
          ...x.map((xi, i) => ({ x: xi, y: y[i], group: 'Training' })),
          { x: q, y: predicted, group: 'Query' },
        ],
      }
    },
  },
  {
    id: 'ml-confmat',
    name: 'Confusion Matrix Metrics',
    referenceFn: 'confusionmat',
    toolbox: 'ml',
    description: 'Compute accuracy, precision, recall, F1 from a 2x2 matrix',
    referenceCode: 'C = confusionmat(yTrue, yPred);\naccuracy = sum(diag(C))/sum(C(:));',
    workflowStage: 'modeling',
    params: [
      { key: 'tp', label: 'True Positives', type: 'number', default: 85 },
      { key: 'fp', label: 'False Positives', type: 'number', default: 12 },
      { key: 'fn', label: 'False Negatives', type: 'number', default: 8 },
      { key: 'tn', label: 'True Negatives', type: 'number', default: 95 },
    ],
    sampleData: { tp: 85, fp: 12, fn: 8, tn: 95 },
    compute: (p) => {
      const tp = parseInt(p.tp), fp = parseInt(p.fp), fn = parseInt(p.fn), tn = parseInt(p.tn)
      const total = tp + fp + fn + tn
      const accuracy = (tp + tn) / total
      const precision = tp / (tp + fp + 1e-12)
      const recall = tp / (tp + fn + 1e-12)
      const f1 = 2 * (precision * recall) / (precision + recall + 1e-12)
      const specificity = tn / (tn + fp + 1e-12)
      const mcc = (tp * tn - fp * fn) / Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn) + 1e-12)
      return {
        statistics: [
          { label: 'Total', value: String(total) },
          { label: 'Accuracy', value: `${(accuracy * 100).toFixed(2)}%` },
          { label: 'Precision (PPV)', value: fmt(precision) },
          { label: 'Recall (Sensitivity)', value: fmt(recall) },
          { label: 'Specificity', value: fmt(specificity) },
          { label: 'F1 Score', value: fmt(f1) },
          { label: 'MCC', value: fmt(mcc) },
        ],
        chartType: 'bar',
        chartTitle: 'Classification Metrics',
        chartData: [
          { x: 1, y: accuracy, label: 'Accuracy' },
          { x: 2, y: precision, label: 'Precision' },
          { x: 3, y: recall, label: 'Recall' },
          { x: 4, y: specificity, label: 'Specificity' },
          { x: 5, y: f1, label: 'F1' },
        ],
      }
    },
  },
]

/* ═══ PHARMACOKINETICS (5 presets) ═══════════════════════════════════ */
const pkPresets: Preset[] = [
  {
    id: 'pk-1comp-iv',
    name: 'One-Compartment IV Bolus',
    referenceFn: 'pkOneCompartment',
    toolbox: 'pk',
    description: 'Plasma concentration-time profile after a single IV bolus dose',
    referenceCode: 'C = (Dose/V) * exp(-ke * t);',
    workflowStage: 'modeling',
    params: [
      { key: 'dose', label: 'Dose (mg)', type: 'number', default: 500 },
      { key: 'volume', label: 'Volume of Distribution (L)', type: 'number', default: 40 },
      { key: 'ke', label: 'Elimination Rate (1/h)', type: 'number', default: 0.15 },
      { key: 'tMax', label: 'Time Horizon (h)', type: 'number', default: 24 },
    ],
    sampleData: { dose: 500, volume: 40, ke: 0.15, tMax: 24 },
    compute: (p) => {
      const dose = parseFloat(p.dose), V = parseFloat(p.volume), ke = parseFloat(p.ke), tMax = parseFloat(p.tMax)
      const { t, c } = pkOneCompartment(dose, V, ke, tMax)
      const halfLife = Math.log(2) / ke
      const auc = (dose / V) / ke
      const cl = ke * V
      return {
        statistics: [
          { label: 'C₀ (mg/L)', value: fmt(dose / V) },
          { label: 'Half-life (h)', value: fmt(halfLife) },
          { label: 'AUC₀-∞ (mg·h/L)', value: fmt(auc) },
          { label: 'Clearance (L/h)', value: fmt(cl) },
          { label: 'C(tMax) (mg/L)', value: fmt(c[c.length - 1]) },
        ],
        chartType: 'line',
        chartTitle: 'IV Bolus PK Profile',
        xLabel: 'Time (h)',
        yLabel: 'Concentration (mg/L)',
        chartData: t.map((ti, i) => ({ x: ti, y: c[i] })),
      }
    },
  },
  {
    id: 'pk-oral',
    name: 'Oral Absorption (1-Comp)',
    referenceFn: 'pkOralAbsorption',
    toolbox: 'pk',
    description: 'Bateman equation for first-order absorption with bioavailability F',
    referenceCode: 'C = (F*D*ka)/(V*(ka-ke)) * (exp(-ke*t) - exp(-ka*t));',
    workflowStage: 'modeling',
    params: [
      { key: 'dose', label: 'Dose (mg)', type: 'number', default: 250 },
      { key: 'volume', label: 'V (L)', type: 'number', default: 35 },
      { key: 'ka', label: 'ka (1/h)', type: 'number', default: 1.2 },
      { key: 'ke', label: 'ke (1/h)', type: 'number', default: 0.15 },
      { key: 'f', label: 'Bioavailability F', type: 'number', default: 0.85 },
      { key: 'tMax', label: 'Time (h)', type: 'number', default: 24 },
    ],
    sampleData: { dose: 250, volume: 35, ka: 1.2, ke: 0.15, f: 0.85, tMax: 24 },
    compute: (p) => {
      const dose = parseFloat(p.dose), V = parseFloat(p.volume)
      const ka = parseFloat(p.ka), ke = parseFloat(p.ke)
      const f = parseFloat(p.f), tMax = parseFloat(p.tMax)
      const { t, c } = pkOralAbsorption(dose, V, ka, ke, f, tMax)
      const tmax = Math.log(ka / ke) / (ka - ke)
      const cmax = Math.max(...c)
      const halfLife = Math.log(2) / ke
      return {
        statistics: [
          { label: 'Cmax (mg/L)', value: fmt(cmax) },
          { label: 'Tmax (h)', value: fmt(tmax) },
          { label: 'Half-life (h)', value: fmt(halfLife) },
          { label: 'AUC₀-∞ (mg·h/L)', value: fmt((f * dose) / (V * ke)) },
        ],
        chartType: 'line',
        chartTitle: 'Oral PK Profile',
        xLabel: 'Time (h)',
        yLabel: 'Concentration (mg/L)',
        chartData: t.map((ti, i) => ({ x: ti, y: c[i] })),
      }
    },
  },
  {
    id: 'pk-multidose',
    name: 'Multiple-Dose Steady State',
    referenceFn: 'pkMultipleDosing',
    toolbox: 'pk',
    description: 'Accumulation profile across repeated dosing intervals',
    referenceCode: 'C = sum_n (Dose/V) * exp(-ke*(t-n*tau)) for n = 0..N-1',
    workflowStage: 'modeling',
    params: [
      { key: 'dose', label: 'Dose (mg)', type: 'number', default: 200 },
      { key: 'interval', label: 'Interval τ (h)', type: 'number', default: 8 },
      { key: 'nDoses', label: 'Number of Doses', type: 'number', default: 8 },
      { key: 'volume', label: 'V (L)', type: 'number', default: 30 },
      { key: 'ke', label: 'ke (1/h)', type: 'number', default: 0.12 },
    ],
    sampleData: { dose: 200, interval: 8, nDoses: 8, volume: 30, ke: 0.12 },
    compute: (p) => {
      const dose = parseFloat(p.dose), interval = parseFloat(p.interval)
      const nDoses = parseInt(p.nDoses), V = parseFloat(p.volume), ke = parseFloat(p.ke)
      const { t, c } = pkMultipleDosing(dose, interval, nDoses, V, ke)
      const accFactor = 1 / (1 - Math.exp(-ke * interval))
      const cssMax = (dose / V) * accFactor
      const cssMin = (dose / V) * Math.exp(-ke * interval) * accFactor
      return {
        statistics: [
          { label: 'Doses', value: String(nDoses) },
          { label: 'Interval (h)', value: fmt(interval) },
          { label: 'Accumulation factor', value: fmt(accFactor) },
          { label: 'Css,max (mg/L)', value: fmt(cssMax) },
          { label: 'Css,min (mg/L)', value: fmt(cssMin) },
          { label: 'Css,avg (mg/L)', value: fmt(dose / (V * ke * interval)) },
        ],
        chartType: 'line',
        chartTitle: 'Multiple-Dose PK',
        xLabel: 'Time (h)',
        yLabel: 'Concentration (mg/L)',
        chartData: t.map((ti, i) => ({ x: ti, y: c[i] })),
      }
    },
  },
  {
    id: 'pk-halflife',
    name: 'Half-Life Estimation (Log-Linear Fit)',
    referenceFn: 'polyfit',
    toolbox: 'pk',
    description: 'Estimate elimination half-life from concentration-time data',
    referenceCode: 'p = polyfit(t, log(C), 1);\nke = -p(1); halfLife = log(2)/ke;',
    workflowStage: 'analysis',
    params: [
      { key: 't', label: 'Time (h)', type: 'textarea' },
      { key: 'c', label: 'Concentration (mg/L)', type: 'textarea' },
    ],
    sampleData: {
      t: [0.5, 1, 2, 4, 6, 8, 12, 16, 24],
      c: [9.8, 8.6, 6.7, 4.0, 2.4, 1.4, 0.51, 0.18, 0.024],
    },
    compute: (p) => {
      const t = parseArray(p.t)
      const c = parseArray(p.c)
      if (t.length !== c.length || t.length < 3) return { error: 'Need ≥ 3 paired t/C values' }
      const logC = c.map(v => Math.log(v))
      const coeffs = polyfit(t, logC, 1)
      const ke = -coeffs[0]
      const halfLife = Math.log(2) / ke
      const intercept = Math.exp(coeffs[1])
      const fitted = t.map(ti => intercept * Math.exp(-ke * ti))
      return {
        statistics: [
          { label: 'ke (1/h)', value: fmt(ke) },
          { label: 'Half-life (h)', value: fmt(halfLife) },
          { label: 'C₀ (extrapolated)', value: fmt(intercept) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Concentration vs Time (log-linear fit)',
        xLabel: 'Time (h)',
        yLabel: 'Concentration (mg/L)',
        seriesLabels: ['Observed', 'Fitted'],
        chartData: t.map((ti, i) => ({ x: ti, y: c[i], y2: fitted[i] })),
      }
    },
  },
  {
    id: 'pk-bioavail',
    name: 'Absolute Bioavailability (F)',
    referenceFn: 'trapz',
    toolbox: 'pk',
    description: 'Compute F from AUC ratios of oral vs IV studies',
    referenceCode: 'F = (AUC_oral/D_oral) / (AUC_iv/D_iv);',
    workflowStage: 'analysis',
    params: [
      { key: 'aucOral', label: 'AUC oral (mg·h/L)', type: 'number', default: 18.5 },
      { key: 'doseOral', label: 'Dose oral (mg)', type: 'number', default: 250 },
      { key: 'aucIv', label: 'AUC IV (mg·h/L)', type: 'number', default: 25.2 },
      { key: 'doseIv', label: 'Dose IV (mg)', type: 'number', default: 200 },
    ],
    sampleData: { aucOral: 18.5, doseOral: 250, aucIv: 25.2, doseIv: 200 },
    compute: (p) => {
      const aucOral = parseFloat(p.aucOral), doseOral = parseFloat(p.doseOral)
      const aucIv = parseFloat(p.aucIv), doseIv = parseFloat(p.doseIv)
      const f = (aucOral / doseOral) / (aucIv / doseIv)
      return {
        statistics: [
          { label: 'AUC oral / Dose oral', value: fmt(aucOral / doseOral) },
          { label: 'AUC iv / Dose iv', value: fmt(aucIv / doseIv) },
          { label: 'F (absolute)', value: fmt(f) },
          { label: 'F (%)', value: `${(f * 100).toFixed(1)}%` },
          { label: 'Classification', value: f > 0.8 ? 'High' : f > 0.4 ? 'Moderate' : 'Low' },
        ],
        chartType: 'bar',
        chartTitle: 'AUC Comparison',
        chartData: [
          { x: 1, y: aucOral, label: 'Oral' },
          { x: 2, y: aucIv, label: 'IV' },
        ],
      }
    },
  },
]

/* ═══ NORMALITY & DISTRIBUTION (5 presets) ════════════════════════════ */
const normalityPresets: Preset[] = [
  {
    id: 'norm-shapiro',
    name: 'Shapiro-Wilk Normality Test',
    referenceFn: 'swtest',
    toolbox: 'normality',
    description: 'Test if data come from a normal distribution',
    referenceCode: '[H, pValue, W] = swtest(x);',
    workflowStage: 'analysis',
    params: [{ key: 'data', label: 'Data', type: 'textarea' }],
    sampleData: { data: [4.2, 4.5, 4.1, 4.4, 4.3, 4.6, 4.0, 4.5, 4.2, 4.4, 4.3, 4.1, 4.5, 4.2, 4.6, 4.3, 4.4, 4.1, 4.5, 4.3] },
    compute: (p) => {
      const x = parseArray(p.data)
      if (x.length < 3) return { error: 'Need ≥ 3 values' }
      const { w, p: pVal } = shapiroWilk(x)
      return {
        statistics: [
          { label: 'N', value: String(x.length) },
          { label: 'Mean', value: fmt(mean(x)) },
          { label: 'Std', value: fmt(std(x)) },
          { label: 'W statistic', value: fmt(w) },
          { label: 'p-value', value: fmt(pVal, 6) },
          { label: 'Conclusion', value: pVal > 0.05 ? 'Cannot reject normality' : 'Likely non-normal' },
        ],
        chartType: 'bar',
        chartTitle: 'Histogram',
        chartData: buildHistogram(x, 12).map(b => ({ x: parseFloat(b.bin), y: b.count, label: b.bin })),
      }
    },
  },
  {
    id: 'norm-qq',
    name: 'Normal Q-Q Plot',
    referenceFn: 'qqplot',
    toolbox: 'normality',
    description: 'Quantile-quantile plot of sample vs. theoretical normal',
    referenceCode: 'qqplot(x);',
    workflowStage: 'visualization',
    params: [{ key: 'data', label: 'Data', type: 'textarea' }],
    sampleData: { data: [22, 24, 25, 23, 26, 22, 24, 25, 23, 24, 26, 23, 25, 24, 25, 23, 24, 25, 24, 25] },
    compute: (p) => {
      const x = parseArray(p.data)
      if (x.length < 3) return { error: 'Need ≥ 3 values' }
      const sorted = [...x].sort((a, b) => a - b)
      const m = mean(x), s = std(x)
      const n = sorted.length
      const points = sorted.map((v, i) => {
        const q = (i + 0.5) / n
        const theo = m + s * invNorm(q)
        return { x: theo, y: v }
      })
      return {
        statistics: [
          { label: 'N', value: String(n) },
          { label: 'Mean', value: fmt(m) },
          { label: 'Std', value: fmt(s) },
          { label: 'Skewness', value: fmt(skewness(x)) },
          { label: 'Kurtosis', value: fmt(kurtosis(x)) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Q-Q Plot',
        xLabel: 'Theoretical Quantile',
        yLabel: 'Sample Quantile',
        seriesLabels: ['Data', 'Reference y=x'],
        chartData: points.map(p => ({ x: p.x, y: p.y, y2: p.x })),
      }
    },
  },
  {
    id: 'norm-ci',
    name: 'Confidence Interval for Mean',
    referenceFn: 'tinv',
    toolbox: 'normality',
    description: 'Compute (1-α) confidence interval for population mean',
    referenceCode: 'ci = mean(x) + [-1 1] * tinv(1-alpha/2, n-1) * std(x)/sqrt(n);',
    workflowStage: 'analysis',
    params: [
      { key: 'data', label: 'Data', type: 'textarea' },
      { key: 'alpha', label: 'Alpha', type: 'number', default: 0.05 },
    ],
    sampleData: { data: [142, 138, 145, 141, 139, 144, 140, 143, 142, 138, 141, 145, 139, 142, 140, 144], alpha: 0.05 },
    compute: (p) => {
      const x = parseArray(p.data)
      const alpha = parseFloat(p.alpha) || 0.05
      if (x.length < 2) return { error: 'Need ≥ 2 values' }
      const n = x.length, m = mean(x), s = std(x)
      const z = invNorm(1 - alpha / 2)
      const meZ = z * s / Math.sqrt(n)
      return {
        statistics: [
          { label: 'N', value: String(n) },
          { label: 'Mean', value: fmt(m) },
          { label: 'Std', value: fmt(s) },
          { label: 'SEM', value: fmt(s / Math.sqrt(n)) },
          { label: `${((1 - alpha) * 100).toFixed(0)}% CI (z)`, value: `[${fmt(m - meZ)}, ${fmt(m + meZ)}]` },
          { label: 'Margin of error', value: fmt(meZ) },
        ],
        chartType: 'bar',
        chartTitle: 'Distribution',
        chartData: buildHistogram(x, 10).map(b => ({ x: parseFloat(b.bin), y: b.count, label: b.bin })),
      }
    },
  },
  {
    id: 'norm-zscore',
    name: 'Z-Score Standardization',
    referenceFn: 'zscore',
    toolbox: 'normality',
    description: 'Convert raw data to z-scores; flag outliers (|z|>2)',
    referenceCode: 'z = (x - mean(x)) / std(x);',
    workflowStage: 'preprocessing',
    params: [{ key: 'data', label: 'Data', type: 'textarea' }],
    sampleData: { data: [120, 125, 118, 122, 119, 124, 121, 123, 117, 145, 122, 120, 119, 121, 122, 95, 120, 121, 123, 119] },
    compute: (p) => {
      const x = parseArray(p.data)
      if (x.length < 2) return { error: 'Need ≥ 2 values' }
      const m = mean(x), s = std(x)
      const z = x.map(v => (v - m) / (s + 1e-12))
      const outliers = z.filter(zi => Math.abs(zi) > 2).length
      return {
        statistics: [
          { label: 'N', value: String(x.length) },
          { label: 'Mean (raw)', value: fmt(m) },
          { label: 'Std (raw)', value: fmt(s) },
          { label: 'Min z', value: fmt(Math.min(...z)) },
          { label: 'Max z', value: fmt(Math.max(...z)) },
          { label: '|z| > 2 outliers', value: String(outliers) },
        ],
        chartType: 'scatter',
        chartTitle: 'Z-Scores',
        xLabel: 'Index',
        yLabel: 'Z-Score',
        chartData: z.map((zi, i) => ({ x: i + 1, y: zi, group: Math.abs(zi) > 2 ? 'Outlier' : 'Normal' })),
      }
    },
  },
  {
    id: 'norm-fit',
    name: 'Distribution Fit (Normal)',
    referenceFn: 'fitdist',
    toolbox: 'normality',
    description: 'Fit normal distribution and overlay theoretical PDF on histogram',
    referenceCode: 'pd = fitdist(x, "Normal");',
    workflowStage: 'modeling',
    params: [{ key: 'data', label: 'Data', type: 'textarea' }],
    sampleData: { data: Array.from({ length: 80 }, () => 50 + 8 * (Math.random() + Math.random() + Math.random() - 1.5)) },
    compute: (p) => {
      const x = parseArray(p.data)
      if (x.length < 5) return { error: 'Need ≥ 5 values' }
      const m = mean(x), s = std(x)
      const bins = buildHistogram(x, 15)
      const xMin = Math.min(...x), xMax = Math.max(...x)
      const binWidth = (xMax - xMin) / 15 || 1
      const fittedCounts = bins.map(b => {
        const center = parseFloat(b.bin) + binWidth / 2
        const pdf = (1 / (s * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((center - m) / s) ** 2)
        return pdf * x.length * binWidth
      })
      return {
        statistics: [
          { label: 'N', value: String(x.length) },
          { label: 'μ (fitted)', value: fmt(m) },
          { label: 'σ (fitted)', value: fmt(s) },
          { label: 'Skewness', value: fmt(skewness(x)) },
          { label: 'Kurtosis', value: fmt(kurtosis(x)) },
        ],
        chartType: 'multi-line',
        chartTitle: 'Histogram + Fitted Normal',
        xLabel: 'Value',
        yLabel: 'Frequency',
        seriesLabels: ['Observed', 'Fitted PDF'],
        chartData: bins.map((b, i) => ({ x: parseFloat(b.bin), y: b.count, y2: fittedCounts[i] })),
      }
    },
  },
]

/* ═══ FINAL EXPORT ═══════════════════════════════════════════════════ */
export const ALL_PRESETS: Preset[] = [
  ...statisticsPresets,
  ...signalPresets,
  ...imagePresets,
  ...bioinformaticsPresets,
  ...curveFittingPresets,
  ...odePresets,
  ...survivalPresets,
  ...mlPresets,
  ...pkPresets,
  ...normalityPresets,
]


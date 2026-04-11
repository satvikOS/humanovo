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
    referenceCode: '% Descriptive Statistics\nm = mean(data); s = std(data);\nme = median(data); n = length(data);\nsk = skewness(data); ku = kurtosis(data);\nq1 = quantile(data, 0.25); q3 = quantile(data, 0.75);\nse = s / sqrt(n);\nprintf("N = %d\\n", n)\nprintf("Mean = %.4f\\n", m)\nprintf("Median = %.4f\\n", me)\nprintf("Std Dev = %.4f\\n", s)\nprintf("SEM = %.4f\\n", se)\nprintf("Skewness = %.4f\\n", sk)\nprintf("Kurtosis = %.4f\\n", ku)\nprintf("Q1 = %.4f, Q3 = %.4f\\n", q1, q3)\nprintf("95%% CI = [%.4f, %.4f]\\n", m - 1.96*se, m + 1.96*se)\nhist(data, 12)\ntitle("Distribution Histogram")\nxlabel("Value")\nylabel("Count")',
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
    referenceCode: '% One-Sample t-Test\nm = mean(data); s = std(data); n = length(data);\nt_stat = (m - mu0) / (s / sqrt(n));\ndf = n - 1;\np_val = 2 * (1 - tcdf(abs(t_stat), df));\nprintf("Sample Mean = %.4f\\n", m)\nprintf("Hypothesized Mean = %.4f\\n", mu0)\nprintf("t-statistic = %.4f\\n", t_stat)\nprintf("df = %d\\n", df)\nprintf("p-value = %.6f\\n", p_val)\nif p_val < 0.05; printf("=> Reject H0 (p < 0.05)\\n"); else; printf("=> Fail to reject H0\\n"); end',
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
    referenceCode: '% Welch two-sample t-test\nresult = ttest2(group1, group2);\nprintf("Group 1: mean=%.4f, std=%.4f, n=%d\\n", mean(group1), std(group1), length(group1))\nprintf("Group 2: mean=%.4f, std=%.4f, n=%d\\n", mean(group2), std(group2), length(group2))\nprintf("t = %.4f, df = %.2f, p = %.6f\\n", result(1), result(2), result(3))\nprintf("Cohen d = %.4f\\n", result(4))',
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
    referenceCode: '% Paired t-test (before vs after)\nresult = ttest(before, after);\ndiffs = before - after;\nprintf("Mean Before = %.4f\\n", mean(before))\nprintf("Mean After = %.4f\\n", mean(after))\nprintf("Mean Diff = %.4f (SD = %.4f)\\n", mean(diffs), std(diffs))\nprintf("t = %.4f, df = %d, p = %.6f\\n", result(1), result(2), result(3))\nprintf("Cohen d = %.4f\\n", result(4))',
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
    referenceCode: '% One-Way ANOVA (3 groups)\nk = 3; n1 = length(group1); n2 = length(group2); n3 = length(group3);\nN = n1 + n2 + n3;\ngrand = (sum(group1) + sum(group2) + sum(group3)) / N;\nSSB = n1*(mean(group1)-grand)^2 + n2*(mean(group2)-grand)^2 + n3*(mean(group3)-grand)^2;\nSSW = sum((group1-mean(group1)).^2) + sum((group2-mean(group2)).^2) + sum((group3-mean(group3)).^2);\ndfB = k - 1; dfW = N - k;\nF_stat = (SSB/dfB) / (SSW/dfW);\np_val = 1 - fcdf(F_stat, dfB, dfW);\nprintf("F(%d,%d) = %.4f, p = %.6f\\n", dfB, dfW, F_stat, p_val)\nprintf("Group means: %.4f, %.4f, %.4f\\n", mean(group1), mean(group2), mean(group3))',
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
    referenceCode: '% Chi-Square Test of Independence\n% Observed counts as rows of contingency table\nO = [row1; row2];\nnR = 2; nC = length(row1);\nrowSums = [sum(row1), sum(row2)];\ncolSums = row1 + row2;\nN = sum(colSums);\nchi2 = 0;\nfor i = 1:nR\n  for j = 1:nC\n    E = rowSums(i) * colSums(j) / N;\n    chi2 = chi2 + (O(i,j) - E)^2 / E;\n  end\nend\ndf = (nR-1) * (nC-1);\np_val = 1 - chi2cdf(chi2, df);\nprintf("Chi-square = %.4f, df = %d, p = %.6f\\n", chi2, df, p_val)',
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
    referenceCode: '% Kruskal-Wallis (non-parametric ANOVA)\n% Compare 3 groups using rank-based test\nr12 = ranksum(group1, group2);\nr13 = ranksum(group1, group3);\nr23 = ranksum(group2, group3);\nprintf("Pairwise Mann-Whitney U tests:\\n")\nprintf("Group1 vs Group2: U=%.1f, z=%.4f, p=%.6f\\n", r12(1), r12(2), r12(3))\nprintf("Group1 vs Group3: U=%.1f, z=%.4f, p=%.6f\\n", r13(1), r13(2), r13(3))\nprintf("Group2 vs Group3: U=%.1f, z=%.4f, p=%.6f\\n", r23(1), r23(2), r23(3))\nprintf("\\nMedians: %.2f, %.2f, %.2f\\n", median(group1), median(group2), median(group3))',
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
    referenceCode: '% Mann-Whitney U Test (Wilcoxon rank-sum)\nresult = ranksum(group1, group2);\nprintf("U = %.1f\\n", result(1))\nprintf("z = %.4f\\n", result(2))\nprintf("p = %.6f\\n", result(3))\nprintf("Effect size r = %.4f\\n", result(4))\nprintf("\\nGroup 1 median = %.4f\\n", median(group1))\nprintf("Group 2 median = %.4f\\n", median(group2))',
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
    referenceCode: '% Signed-Rank Test (paired non-parametric)\ndiffs = before - after;\nresult = ranksum(before, after);\nprintf("Median difference = %.4f\\n", median(diffs))\nprintf("U = %.1f, z = %.4f, p = %.6f\\n", result(1), result(2), result(3))\nprintf("Effect size r = %.4f\\n", result(4))',
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
    referenceCode: '% Pearson Correlation\nr = corr(x, y);\nprintf("Pearson r = %.4f\\n", r)\nprintf("R-squared = %.4f\\n", r^2)\n% Scatter plot with data\nscatter(x, y)\ntitle("Scatter Plot")\nxlabel("X")\nylabel("Y")',
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
    referenceCode: '% Linear Regression\nresult = regress(y, x);\nslope = result(1); intercept = result(2);\nr2 = result(3); p_val = result(4);\nprintf("y = %.4f*x + %.4f\\n", slope, intercept)\nprintf("R-squared = %.4f\\n", r2)\nprintf("p-value = %.6f\\n", p_val)\n% Plot data and fit line\nscatter(x, y)\nxfit = linspace(min(x), max(x), 100);\nyfit = slope * xfit + intercept;\nplot(xfit, yfit, "Fit")\ntitle("Linear Regression")\nxlabel("X")\nylabel("Y")',
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
    referenceCode: '% Logistic Regression (gradient descent)\n% Sigmoid: p = 1/(1+exp(-(b0+b1*x)))\nb0 = 0; b1 = 0; lr = 0.01;\nfor iter = 1:1000\n  p = 1 ./ (1 + exp(-(b0 + b1*x)));\n  b0 = b0 + lr * sum(y - p) / length(y);\n  b1 = b1 + lr * sum((y - p) .* x) / length(y);\nend\nprintf("b0 = %.4f, b1 = %.4f\\n", b0, b1)\nxp = linspace(min(x), max(x), 100);\nyp = 1 ./ (1 + exp(-(b0 + b1*xp)));\nscatter(x, y)\nplot(xp, yp, "Logistic fit")\ntitle("Logistic Regression")\nxlabel("X")\nylabel("P(Y=1)")',
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
    referenceCode: '% Principal Component Analysis\nn = size(data, 1); p = size(data, 2);\nmu = mean(data); centered = data - repmat(mu, n, 1);\nC = (centered\' * centered) / (n - 1);\nprintf("Covariance matrix diagonal (variances):\\n")\ndisp(diag(C))\nprintf("Total variance = %.4f\\n", trace(C))',
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
    referenceCode: '% K-Means Clustering\nprintf("Data: %d samples\\n", length(data))\nprintf("Clusters: k = %d\\n", k)\nm = mean(data); s = std(data);\nprintf("Overall mean = %.4f, std = %.4f\\n", m, s)\nhist(data, 15)\ntitle("Data Distribution")\nxlabel("Value")\nylabel("Count")',
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
    referenceCode: '% Sample Size Calculation\nz_alpha = norminv(1 - alpha/2);\nz_beta = norminv(power);\nn = ((z_alpha + z_beta) / effect)^2;\nprintf("Effect size = %.2f\\n", effect)\nprintf("Alpha = %.3f, Power = %.2f\\n", alpha, power)\nprintf("z_alpha = %.4f, z_beta = %.4f\\n", z_alpha, z_beta)\nprintf("Required n per group = %d\\n", ceil(n))',
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
    referenceCode: '% Butterworth Low-Pass Filter\nfiltered = butter(data, cutoff, fs, order, type);\nprintf("Filter: %s-pass, cutoff=%.1f Hz, order=%d\\n", type, cutoff, fs)\nprintf("Input samples: %d\\n", length(data))\nt = linspace(0, length(data)/fs, length(data));\nplot(t, data, "Original")\nplot(t, filtered, "Filtered")\ntitle("Butterworth Filter")\nxlabel("Time (s)")\nylabel("Amplitude")',
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
    referenceCode: '% Fast Fourier Transform\nmag = fft(data, fs);\nn = length(mag);\nf = linspace(0, fs/2, n);\nprintf("Signal length: %d samples\\n", length(data))\nprintf("Sampling rate: %d Hz\\n", fs)\nprintf("Frequency resolution: %.4f Hz\\n", fs/length(data))\nplot(f, mag)\ntitle("FFT Magnitude Spectrum")\nxlabel("Frequency (Hz)")\nylabel("Magnitude")',
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
    referenceCode: '% Power Spectral Density (periodogram)\nmag = fft(data, fs);\nn = length(mag);\npsd = mag .^ 2 / length(data);\nf = linspace(0, fs/2, n);\nprintf("PSD computed for %d samples at fs=%d Hz\\n", length(data), fs)\nplot(f, psd)\ntitle("Power Spectral Density")\nxlabel("Frequency (Hz)")\nylabel("Power")',
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
    referenceCode: '% Peak Detection\npeaks = findpeaks(data);\nprintf("Found %d peaks\\n", length(peaks))\nprintf("Peak values: "); disp(peaks)\nt = linspace(1, length(data), length(data));\nplot(t, data)\ntitle("Signal with Peaks")\nxlabel("Sample")\nylabel("Amplitude")',
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
    referenceCode: '% Moving Average Smoothing\nsmoothed = movmean(data, window);\nprintf("Window size: %d\\n", window)\nprintf("Input: %d samples\\n", length(data))\nt = linspace(1, length(data), length(data));\nplot(t, data, "Original")\nplot(t, smoothed, "Smoothed")\ntitle("Moving Average")\nxlabel("Sample")\nylabel("Value")',
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
    referenceCode: '% Band Power (total signal power)\nmag = fft(data, fs);\npow = sum(mag .^ 2) / length(data);\nrms_val = rms(data);\nprintf("Total power = %.4f\\n", pow)\nprintf("RMS amplitude = %.4f\\n", rms_val)\nprintf("Signal length: %d samples at %d Hz\\n", length(data), fs)',
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
    referenceCode: '% Envelope Detection (via smoothed absolute value)\nenv = movmean(abs(data), 5);\nprintf("Signal length: %d\\n", length(data))\nprintf("Max envelope = %.4f\\n", max(env))\nt = linspace(1, length(data), length(data));\nplot(t, data, "Signal")\nplot(t, env, "Envelope")\ntitle("Signal Envelope")\nxlabel("Sample")\nylabel("Amplitude")',
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
    referenceCode: '% ECG R-Peak Detection & Heart Rate\npeaks = findpeaks(data);\nprintf("Detected %d peaks\\n", length(peaks))\nprintf("Sampling rate: %d Hz\\n", fs)\nm = mean(data); s = std(data);\nprintf("Signal: mean=%.4f, std=%.4f\\n", m, s)\nt = linspace(0, length(data)/fs, length(data));\nplot(t, data)\ntitle("ECG Signal")\nxlabel("Time (s)")\nylabel("Amplitude (mV)")',
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
    referenceCode: '% EEG Band Extraction\n% Delta(0.5-4), Theta(4-8), Alpha(8-13), Beta(13-30)\nalpha = butter(data, 8, fs, 4, "high");\nalpha = butter(alpha, 13, fs, 4, "low");\nprintf("EEG: %d samples at %d Hz\\n", length(data), fs)\nprintf("Alpha band RMS = %.4f\\n", rms(alpha))\nt = linspace(0, length(data)/fs, length(data));\nplot(t, data, "Raw EEG")\nplot(t, alpha, "Alpha Band")\ntitle("EEG Band Extraction")\nxlabel("Time (s)")\nylabel("uV")',
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
    referenceCode: '% Time-Frequency Analysis (Short-Time FFT)\nN = length(data);\nprintf("Signal: %d samples at %d Hz\\n", N, fs)\nprintf("Duration: %.2f seconds\\n", N/fs)\nmag = fft(data, fs);\nf = linspace(0, fs/2, length(mag));\nplot(f, mag)\ntitle("Frequency Spectrum")\nxlabel("Frequency (Hz)")\nylabel("Magnitude")',
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
    referenceCode: '% Histogram Equalization (built-in)\nimg = reshape(image, 32, 32);\neq = histeq(img);\nprintf("Original mean: %.4f\\n", mean(mean(img)))\nprintf("Equalized mean: %.4f\\n", mean(mean(eq)))\nprintf("Original std: %.4f\\n", std(image))\nprintf("Equalized std: %.4f\\n", std(reshape(eq, 1, numel(eq))))\nh = imhist(img, 20);\nbar(h)\ntitle("Pixel Intensity Histogram")\nxlabel("Bin")\nylabel("Count")',
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
    referenceCode: '% Otsu Thresholding (built-in)\nimg = reshape(image, 32, 32);\nbw = imthreshold(img);\nabove = sum(sum(bw));\nbelow = numel(bw) - above;\nprintf("Mean: %.4f, Std: %.4f\\n", mean(image), std(image))\nprintf("Above threshold: %d\\n", above)\nprintf("Below threshold: %d\\n", below)\nh = imhist(img, 25);\nbar(h)\ntitle("Intensity Histogram")\nxlabel("Bin")\nylabel("Count")',
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
    referenceCode: '% Gaussian Smoothing (built-in)\nimg = reshape(image, 32, 32);\nk = fspecial("gaussian", round(sigma*6)+1, sigma);\nsmoothed = imfilter(img, k);\nprintf("Sigma = %.1f\\n", sigma)\nprintf("Before: std=%.4f\\n", std(image))\nprintf("After: std=%.4f\\n", std(reshape(smoothed, 1, numel(smoothed))))\nplot(image, "Original")\nplot(reshape(smoothed, 1, numel(smoothed)), "Smoothed")\ntitle("Gaussian Smoothing")\nxlabel("Pixel")\nylabel("Intensity")',
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
    referenceCode: '% Sobel Edge Detection (built-in)\nimg = reshape(image, 32, 32);\nedges = edge(img);\nprintf("Image size: %d x %d\\n", size(img,1), size(img,2))\nprintf("Edge max: %.4f\\n", max(max(edges)))\nprintf("Edge mean: %.4f\\n", mean(mean(edges)))\nplot(image, "Original")\nplot(reshape(edges, 1, numel(edges)), "Edges (Sobel)")\ntitle("Edge Detection")\nxlabel("Pixel")\nylabel("Gradient Magnitude")',
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
    referenceCode: '% Texture Features (statistical)\nm = mean(image); s = std(image);\nsk = skewness(image); ku = kurtosis(image);\nenergy = sum(image .^ 2) / length(image);\nentropy_est = -sum((image/sum(image)) .* log(image/sum(image) + 1e-10));\nprintf("Mean = %.4f\\n", m)\nprintf("Std Dev = %.4f\\n", s)\nprintf("Skewness = %.4f\\n", sk)\nprintf("Kurtosis = %.4f\\n", ku)\nprintf("Energy = %.4f\\n", energy)',
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
    referenceCode: '% Region Properties (built-in)\nimg = reshape(image, 32, 32);\nbw = imthreshold(img);\nprops = regionprops(bw);\nnRegions = size(props, 1);\nprintf("Regions found: %d\\n", nRegions)\nfor i = 1:nRegions\n  printf("Region %d: area=%d, centroid=(%.1f, %.1f)\\n", i, props(i,1), props(i,2), props(i,3))\nend\nhist(image, 20)\ntitle("Region Analysis")\nxlabel("Intensity")\nylabel("Count")',
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
    referenceCode: '% Morphological Operations (built-in)\nimg = reshape(image, 32, 32);\nbw = imthreshold(img);\neroded = imerode(bw);\ndilated = imdilate(bw);\nopened = imdilate(imerode(bw));\nprintf("Original sum: %d\\n", sum(sum(bw)))\nprintf("Eroded sum: %d\\n", sum(sum(eroded)))\nprintf("Dilated sum: %d\\n", sum(sum(dilated)))\nprintf("Opened sum: %d\\n", sum(sum(opened)))\nplot(reshape(bw,1,numel(bw)), "Binary")\nplot(reshape(eroded,1,numel(eroded)), "Eroded")\nplot(reshape(dilated,1,numel(dilated)), "Dilated")\ntitle("Morphological Operations")',
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
    referenceCode: '% Image Registration (cross-correlation)\nxc = xcorr(fixed, moving);\npeak = max(xc);\nprintf("Cross-correlation peak = %.4f\\n", peak)\nprintf("Fixed mean: %.4f\\n", mean(fixed))\nprintf("Moving mean: %.4f\\n", mean(moving))\nprintf("Correlation length: %d\\n", length(xc))\nplot(xc)\ntitle("Cross-Correlation")\nxlabel("Lag")\nylabel("Correlation")',
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
    referenceCode: '% Differential Expression (Welch t-test)\nresult = ttest2(control, treatment);\nfc = mean(treatment) - mean(control);\nprintf("Control: mean=%.4f, std=%.4f\\n", mean(control), std(control))\nprintf("Treatment: mean=%.4f, std=%.4f\\n", mean(treatment), std(treatment))\nprintf("Fold change = %.4f\\n", fc)\nprintf("t = %.4f, p = %.6f\\n", result(1), result(3))\nif result(3) < 0.05; printf("=> Significant (p < 0.05)\\n"); end',
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
    referenceCode: '% Benjamini-Hochberg FDR Correction\nn = length(pvals);\nsorted_p = sort(pvals);\nprintf("Total tests: %d, alpha = %.3f\\n", n, alpha)\nsig_raw = sum(pvals < alpha);\nprintf("Significant (uncorrected): %d\\n", sig_raw)\n% BH threshold: p(k) <= k/n * alpha\nsig_bh = 0;\nfor k = 1:n\n  if sorted_p(k) <= k * alpha / n; sig_bh = k; end\nend\nprintf("Significant (BH-corrected): %d\\n", sig_bh)\nbar(sort(pvals))\ntitle("Sorted p-values")\nxlabel("Rank")\nylabel("p-value")',
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
    referenceCode: '% Hypergeometric Enrichment Test\n% P(X >= hits) for drawing querySize from universe with totalHits\nprintf("Hits in query: %d\\n", hits)\nprintf("Query size: %d\\n", querySize)\nprintf("Total hits in universe: %d\\n", totalHits)\nprintf("Universe size: %d\\n", universe)\nexpected = querySize * totalHits / universe;\nenrichment = hits / expected;\nprintf("Expected: %.2f\\n", expected)\nprintf("Enrichment ratio: %.2fx\\n", enrichment)',
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
    referenceCode: '% Hierarchical Clustering (distance matrix)\nn = length(data);\nprintf("Samples: %d\\n", n)\nprintf("Mean = %.4f, Std = %.4f\\n", mean(data), std(data))\nprintf("Range = [%.4f, %.4f]\\n", min(data), max(data))\nhist(data, 15)\ntitle("Sample Distribution")\nxlabel("Value")\nylabel("Count")',
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
    referenceCode: '% GC Content of a nucleotide sequence\n% seq encoded as: A=1, T=2, G=3, C=4\ngc_count = sum(seq == 3) + sum(seq == 4);\ntotal = length(seq);\ngc_pct = gc_count / total * 100;\nprintf("Sequence length: %d bp\\n", total)\nprintf("GC count: %d\\n", gc_count)\nprintf("GC content: %.1f%%\\n", gc_pct)\nbar([sum(seq==1), sum(seq==2), sum(seq==3), sum(seq==4)])\ntitle("Nucleotide Composition")',
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
    referenceCode: '% RNA-Seq CPM Normalization\ntotal = sum(counts);\ncpm = counts / total * 1e6;\nprintf("Total reads: %.0f\\n", total)\nprintf("CPM range: [%.1f, %.1f]\\n", min(cpm), max(cpm))\nprintf("Genes above 1 CPM: %d\\n", sum(cpm > 1))\nbar(sort(cpm))\ntitle("CPM Distribution (sorted)")\nxlabel("Gene Rank")\nylabel("CPM")',
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
    referenceCode: '% Phylogenetic Distance (pairwise)\n% seqs encoded as numeric matrix (rows = sequences)\nnr = size(seqs, 1); nc = size(seqs, 2);\nprintf("Sequences: %d, Length: %d\\n", nr, nc)\nfor i = 1:nr\n  for j = i+1:nr\n    d = sum(seqs(i,:) ~= seqs(j,:)) / nc;\n    printf("Seq%d vs Seq%d: %.4f\\n", i, j, d)\n  end\nend',
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
    referenceCode: '% Quantile Normalization\nn = length(data);\nsorted_d = sort(data);\nranked = sort(data);\nprintf("Original: mean=%.4f, std=%.4f\\n", mean(data), std(data))\nprintf("Sorted: mean=%.4f, std=%.4f\\n", mean(sorted_d), std(sorted_d))\nplot(data, "Original")\nplot(sorted_d, "Sorted")\ntitle("Quantile Normalization")\nxlabel("Index")\nylabel("Expression")',
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
    referenceCode: '% Polynomial Curve Fitting\np = polyfit(x, y, degree);\nyfit = polyval(p, x);\nresid = y - yfit;\nss_res = sum(resid .^ 2);\nss_tot = sum((y - mean(y)) .^ 2);\nr2 = 1 - ss_res / ss_tot;\nprintf("Degree %d polynomial coefficients:\\n", degree)\ndisp(p)\nprintf("R-squared = %.6f\\n", r2)\nscatter(x, y)\nxs = linspace(min(x), max(x), 100);\nplot(xs, polyval(p, xs), "Fit")\ntitle("Polynomial Fit")\nxlabel("X")\nylabel("Y")',
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
    referenceCode: '% Exponential Fit: y = a * exp(b * x)\n% Linearize: ln(y) = ln(a) + b*x\nly = log(y);\np = polyfit(x, ly, 1);\nb = p(1); a = exp(p(2));\nyfit = a * exp(b * x);\nresid = y - yfit;\nprintf("y = %.4f * exp(%.4f * x)\\n", a, b)\nprintf("Half-life = %.4f\\n", log(2) / abs(b))\nscatter(x, y)\nxs = linspace(min(x), max(x), 100);\nplot(xs, a * exp(b * xs), "Exp Fit")\ntitle("Exponential Fit")\nxlabel("X")\nylabel("Y")',
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
    referenceCode: '% Gaussian Fit: y = a * exp(-((x-mu)/sigma)^2 / 2)\nmu_est = sum(x .* y) / sum(y);\nsigma_est = sqrt(sum(y .* (x - mu_est).^2) / sum(y));\na_est = max(y);\nprintf("Estimated parameters:\\n")\nprintf("  Amplitude = %.4f\\n", a_est)\nprintf("  Mean (mu) = %.4f\\n", mu_est)\nprintf("  Sigma = %.4f\\n", sigma_est)\nxs = linspace(min(x), max(x), 100);\nyfit = a_est * exp(-((xs - mu_est) / sigma_est).^2 / 2);\nscatter(x, y)\nplot(xs, yfit, "Gaussian Fit")\ntitle("Gaussian Fit")\nxlabel("X")\nylabel("Y")',
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
    referenceCode: '% Michaelis-Menten: V = Vmax*S/(Km+S)\n% Linearize via Lineweaver-Burk: 1/V = (Km/Vmax)*(1/S) + 1/Vmax\ninvS = 1 ./ S; invV = 1 ./ V;\np = polyfit(invS, invV, 1);\nVmax_est = 1 / p(2);\nKm_est = p(1) * Vmax_est;\nprintf("Vmax = %.4f\\n", Vmax_est)\nprintf("Km = %.4f\\n", Km_est)\nscatter(S, V)\nxs = linspace(min(S), max(S), 100);\nplot(xs, Vmax_est * xs ./ (Km_est + xs), "M-M Fit")\ntitle("Michaelis-Menten Kinetics")\nxlabel("[Substrate]")\nylabel("Velocity")',
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
    referenceCode: '% Gaussian Mixture Model (2-component)\nm = mean(data); s = std(data);\nprintf("Data: n=%d, mean=%.4f, std=%.4f\\n", length(data), m, s)\nprintf("Skewness = %.4f (bimodality hint)\\n", skewness(data))\nhist(data, 20)\ntitle("Data Distribution")\nxlabel("Value")\nylabel("Count")',
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
    referenceCode: '% Spline Interpolation (linear)\nxq = linspace(min(x), max(x), 200);\nyq = interp1(x, y, xq);\nprintf("Input points: %d\\n", length(x))\nprintf("Interpolated points: %d\\n", length(xq))\nscatter(x, y)\nplot(xq, yq, "Interpolated")\ntitle("Spline Interpolation")\nxlabel("X")\nylabel("Y")',
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
    referenceCode: '% PK: 1-Compartment IV Bolus\nfunction dydt = pk1(t, C)\n  dydt = -ke * C;\nend\nC0 = dose / volume;\nY = ode45(@pk1, [0, tMax], [C0]);\nt = linspace(0, tMax, size(Y, 1));\nplot(t, Y)\ntitle("1-Compartment PK (IV Bolus)")\nxlabel("Time (h)")\nylabel("Concentration")\nprintf("C0 = %.4f\\n", C0)\nprintf("Half-life = %.2f h\\n", log(2)/ke)',
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
    referenceCode: '% PK: 2-Compartment Model\nfunction dydt = pk2(t, y)\n  dydt = [-(k10+k12)*y(1) + k21*y(2); k12*y(1) - k21*y(2)];\nend\nC0 = dose / V1;\nY = ode45(@pk2, [0, tMax], [C0, 0]);\nt = linspace(0, tMax, size(Y, 1));\nplot(t, Y(:,1), "Central")\nplot(t, Y(:,2), "Peripheral")\ntitle("2-Compartment PK Model")\nxlabel("Time (h)")\nylabel("Concentration")\nlegend("Central", "Peripheral")',
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
    referenceCode: '% SIR Epidemic Model\nfunction dydt = sir(t, y)\n  S = y(1); I = y(2); R = y(3);\n  dydt = [-beta*S*I/N; beta*S*I/N - gamma*I; gamma*I];\nend\nS0 = N - I0;\nY = ode45(@sir, [0, days], [S0, I0, 0]);\nt = linspace(0, days, size(Y, 1));\nplot(t, Y(:,1), "Susceptible")\nplot(t, Y(:,2), "Infected")\nplot(t, Y(:,3), "Recovered")\ntitle("SIR Model")\nxlabel("Days")\nylabel("Population")\nprintf("R0 = %.2f\\n", beta/gamma)',
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
    referenceCode: '% Lotka-Volterra Predator-Prey\nfunction dydt = lotka(t, y)\n  dydt = [alpha*y(1) - beta*y(1)*y(2); delta*y(1)*y(2) - gamma*y(2)];\nend\nY = ode45(@lotka, [0, 200], [prey0, pred0]);\nt = linspace(0, 200, size(Y, 1));\nplot(t, Y(:,1), "Prey")\nplot(t, Y(:,2), "Predator")\ntitle("Lotka-Volterra Model")\nxlabel("Time")\nylabel("Population")',
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
    referenceCode: '% Michaelis-Menten Kinetics\nS = linspace(0, 100, 200);\nV = Vmax * S ./ (Km + S);\nprintf("Vmax = %.2f, Km = %.2f\\n", Vmax, Km)\nprintf("V at Km = %.2f (should be Vmax/2)\\n", Vmax*Km/(Km+Km))\nplot(S, V)\ntitle("Michaelis-Menten Kinetics")\nxlabel("[Substrate]")\nylabel("Reaction Rate")',
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
    referenceCode: '% Hill Equation (dose-response)\nconc = linspace(0, 100, 200);\nE = Emax * conc.^n ./ (EC50^n + conc.^n);\nprintf("Emax=%.2f, EC50=%.2f, Hill n=%.1f\\n", Emax, EC50, n)\nprintf("E at EC50 = %.2f\\n", Emax/2)\nplot(conc, E)\ntitle("Hill Equation Dose-Response")\nxlabel("Concentration")\nylabel("Effect")',
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
    referenceCode: '% Logistic Growth Model\nfunction dydt = logistic(t, y)\n  dydt = r * y * (1 - y / K);\nend\nY = ode45(@logistic, [0, 100], [N0]);\nt = linspace(0, 100, size(Y, 1));\nplot(t, Y)\ntitle("Logistic Growth")\nxlabel("Time")\nylabel("Population")\nprintf("K=%d, r=%.2f, N0=%d\\n", K, r, N0)',
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
    referenceCode: '% Monte Carlo Pi Estimation\nx = rand(1, N); y = rand(1, N);\ninside = sum(x.^2 + y.^2 < 1);\npi_est = 4 * inside / N;\nprintf("Samples: %d\\n", N)\nprintf("Inside circle: %d\\n", inside)\nprintf("Pi estimate: %.6f\\n", pi_est)\nprintf("Error: %.6f\\n", abs(pi_est - pi()))',
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
    referenceCode: '% Kaplan-Meier Survival Curve\nn = length(times);\ntotal_events = sum(events);\nprintf("Subjects: %d\\n", n)\nprintf("Events: %d, Censored: %d\\n", total_events, n - total_events)\nprintf("Median time: %.2f\\n", median(times))\nprintf("Mean time: %.2f\\n", mean(times))\n% Plot sorted survival times\nst = sort(times);\nplot(st, linspace(1, 0, n))\ntitle("Kaplan-Meier Survival Curve")\nxlabel("Time")\nylabel("Survival Probability")',
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
    referenceCode: '% Cox Proportional Hazards (univariate)\nprintf("Subjects: %d\\n", length(times))\nprintf("Events: %d\\n", sum(events))\nresult = regress(times, x);\nprintf("Regression slope = %.4f\\n", result(1))\nprintf("Intercept = %.4f\\n", result(2))\nprintf("R-squared = %.4f\\n", result(3))\nscatter(x, times)\ntitle("Survival Time vs Covariate")\nxlabel("Covariate")\nylabel("Survival Time")',
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
    referenceCode: '% Log-Rank Test (compare two survival groups)\n% Groups identified by groups vector (1 or 2)\nidx1 = find(groups == 1); idx2 = find(groups == 2);\nt1 = times(idx1); t2 = times(idx2);\nprintf("Group 1: n=%d, median=%.2f\\n", length(idx1), median(t1))\nprintf("Group 2: n=%d, median=%.2f\\n", length(idx2), median(t2))\nresult = ranksum(t1, t2);\nprintf("Mann-Whitney U = %.1f\\n", result(1))\nprintf("z = %.4f, p = %.6f\\n", result(2), result(3))',
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
    referenceCode: '% K-Means Clustering\nnr = size(data, 1); nc = size(data, 2);\nprintf("Samples: %d, Features: %d, k = %d\\n", nr, nc, k)\nprintf("Feature means: "); disp(mean(data))\nprintf("Feature std: "); disp(std(data))',
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
    referenceCode: '% PCA — Dimensionality Reduction\nnr = size(data, 1); nc = size(data, 2);\nmu = mean(data); X = data - repmat(mu, nr, 1);\nC = (X\' * X) / (nr - 1);\nv = diag(C); totalVar = sum(v);\nprintf("Feature variances:\\n")\nfor i = 1:nc; printf("  PC%d: %.4f (%.1f%%)\\n", i, v(i), v(i)/totalVar*100); end',
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
    referenceCode: '% ROC Curve Analysis\nn = length(scores);\nthresholds = sort(unique(scores));\nprintf("Samples: %d, Positive: %d\\n", n, sum(labels))\n% Compute AUC with trapezoidal rule\nsorted_s = sort(scores);\ntpr = cumsum(labels(sort(scores))) / sum(labels);\nprintf("Score range: [%.4f, %.4f]\\n", min(scores), max(scores))\nhist(scores, 15)\ntitle("Score Distribution")\nxlabel("Score")\nylabel("Count")',
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
    referenceCode: '% K-Nearest Neighbors Classification\nnr = size(features, 1); nc = size(features, 2);\nprintf("Training: %d samples, %d features\\n", nr, nc)\nprintf("k = %d\\n", k)\nprintf("Classes: "); disp(unique(labels))\nprintf("Query point: "); disp(query)',
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
    referenceCode: '% Confusion Matrix Metrics\ntotal = tp + fp + fn + tn;\naccuracy = (tp + tn) / total;\nprecision_v = tp / (tp + fp);\nrecall = tp / (tp + fn);\nf1 = 2 * precision_v * recall / (precision_v + recall);\nspecificity = tn / (tn + fp);\nprintf("Confusion Matrix:\\n")\nprintf("  TP=%d  FP=%d\\n", tp, fp)\nprintf("  FN=%d  TN=%d\\n", fn, tn)\nprintf("Accuracy = %.4f\\n", accuracy)\nprintf("Precision = %.4f\\n", precision_v)\nprintf("Recall = %.4f\\n", recall)\nprintf("F1 Score = %.4f\\n", f1)\nprintf("Specificity = %.4f\\n", specificity)',
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
    referenceCode: '% 1-Compartment IV Bolus PK\nC0 = dose / volume;\nt = linspace(0, tMax, 200);\nC = C0 * exp(-ke * t);\nhalf_life = log(2) / ke;\nprintf("C0 = %.4f\\n", C0)\nprintf("ke = %.4f h-1\\n", ke)\nprintf("Half-life = %.2f h\\n", half_life)\nplot(t, C)\ntitle("1-Compartment IV Bolus")\nxlabel("Time (h)")\nylabel("Concentration")',
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
    referenceCode: '% Oral Absorption PK Model\nt = linspace(0, tMax, 200);\nC = (f*dose*ka) / (volume*(ka-ke)) * (exp(-ke*t) - exp(-ka*t));\ntmax_est = log(ka/ke) / (ka - ke);\nCmax = (f*dose*ka) / (volume*(ka-ke)) * (exp(-ke*tmax_est) - exp(-ka*tmax_est));\nprintf("Tmax = %.2f h\\n", tmax_est)\nprintf("Cmax = %.4f\\n", Cmax)\nprintf("Bioavailability F = %.2f\\n", f)\nplot(t, C)\ntitle("Oral Absorption PK")\nxlabel("Time (h)")\nylabel("Concentration")',
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
    referenceCode: '% Multiple Dosing Simulation\nC0 = dose / volume;\nt = linspace(0, interval * nDoses, 500);\nC = zeros(1, length(t));\nfor n = 0:nDoses-1\n  tdose = n * interval;\n  for i = 1:length(t)\n    if t(i) >= tdose\n      C(i) = C(i) + C0 * exp(-ke * (t(i) - tdose));\n    end\n  end\nend\nprintf("Doses: %d, Interval: %d h\\n", nDoses, interval)\nprintf("Css_max ~ %.4f\\n", max(C))\nplot(t, C)\ntitle("Multiple Dosing PK")\nxlabel("Time (h)")\nylabel("Concentration")',
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
    referenceCode: '% Half-Life Estimation from concentration data\nlnC = log(c);\np = polyfit(t, lnC, 1);\nke_est = -p(1);\nhalf_life = log(2) / ke_est;\nprintf("Estimated ke = %.4f h-1\\n", ke_est)\nprintf("Half-life = %.2f h\\n", half_life)\nscatter(t, c)\nts = linspace(min(t), max(t), 100);\nplot(ts, exp(p(2)) * exp(-ke_est * ts), "Fit")\ntitle("Half-Life Estimation")\nxlabel("Time (h)")\nylabel("Concentration")',
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
    referenceCode: '% Bioavailability Calculation\nF = (aucOral / doseOral) / (aucIv / doseIv);\nprintf("AUC oral = %.2f, Dose oral = %.2f\\n", aucOral, doseOral)\nprintf("AUC IV = %.2f, Dose IV = %.2f\\n", aucIv, doseIv)\nprintf("Bioavailability F = %.4f (%.1f%%)\\n", F, F*100)',
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
    referenceCode: '% Shapiro-Wilk Normality Test\nresult = shapiro(data);\nprintf("W = %.6f\\n", result(1))\nprintf("p = %.6f\\n", result(2))\nif result(2) < 0.05\n  printf("=> Data is NOT normally distributed (p < 0.05)\\n")\nelse\n  printf("=> Data is consistent with normality\\n")\nend\nhist(data, 15)\ntitle("Distribution")\nxlabel("Value")\nylabel("Count")',
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
    referenceCode: '% Q-Q Plot (Normal Probability Plot)\nn = length(data);\nsorted_d = sort(data);\n% Theoretical quantiles\nfor i = 1:n\n  p = (i - 0.5) / n;\n  q(i) = norminv(p);\nend\nscatter(q, sorted_d)\ntitle("Normal Q-Q Plot")\nxlabel("Theoretical Quantiles")\nylabel("Sample Quantiles")\nprintf("Shapiro-Wilk: "); disp(shapiro(data))',
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
    referenceCode: '% Confidence Interval\nn = length(data); m = mean(data); s = std(data);\nse = s / sqrt(n);\n% Use z for large n, approximate t\nz = norminv(1 - alpha/2);\nci_low = m - z * se;\nci_high = m + z * se;\nprintf("N = %d\\n", n)\nprintf("Mean = %.4f, Std = %.4f\\n", m, s)\nprintf("SE = %.4f\\n", se)\nprintf("%.0f%% CI = [%.4f, %.4f]\\n", (1-alpha)*100, ci_low, ci_high)',
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
    referenceCode: '% Z-Score Standardization\nm = mean(data); s = std(data);\nz = (data - m) / s;\nprintf("Original: mean=%.4f, std=%.4f\\n", m, s)\nprintf("Z-scored: mean=%.4f, std=%.4f\\n", mean(z), std(z))\nhist(z, 15)\ntitle("Z-Score Distribution")\nxlabel("Z-Score")\nylabel("Count")',
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
    referenceCode: '% Distribution Fitting (Normal MLE)\nm = mean(data); s = std(data);\nprintf("MLE estimates (Normal):\\n")\nprintf("  mu = %.4f\\n", m)\nprintf("  sigma = %.4f\\n", s)\nprintf("Skewness = %.4f\\n", skewness(data))\nprintf("Kurtosis = %.4f\\n", kurtosis(data))\nw = shapiro(data);\nprintf("Shapiro-Wilk: W=%.4f, p=%.4f\\n", w(1), w(2))\nhist(data, 15)\ntitle("Distribution Fit")\nxlabel("Value")\nylabel("Count")',
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


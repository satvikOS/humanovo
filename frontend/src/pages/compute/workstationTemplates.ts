// ═══════════════════════════════════════════════════════════════════════
// Workstation — curated MATLAB/Octave script templates
// Hand-picked to run end-to-end on the in-browser octaveEngine (no
// toolboxes, no network calls). Each entry is shown in the Workstation
// preset sidebar and becomes the active script when clicked.
// ═══════════════════════════════════════════════════════════════════════

export interface WorkstationTemplate {
  id: string
  name: string
  category: string
  description: string
  code: string
}

export const WORKSTATION_CATEGORIES = [
  'Getting Started',
  'Statistics',
  'Signal Processing',
  'Linear Algebra',
  'Curve Fitting',
  'Simulation',
  'Plotting',
]

export const WORKSTATION_TEMPLATES: WorkstationTemplate[] = [
  // ── Getting Started ────────────────────────────────────────────────
  {
    id: 'gs-hello',
    name: 'Hello, workspace',
    category: 'Getting Started',
    description: 'The smallest program that creates a variable and prints it.',
    code: `% Hello, workspace
x = 42;
y = x^2 + 1;
printf('x = %d, y = %d\\n', x, y);`,
  },
  {
    id: 'gs-vectors',
    name: 'Vector arithmetic',
    category: 'Getting Started',
    description: 'Ranges, element-wise operations, and reductions.',
    code: `% Vector arithmetic
v = 1:10;              % row vector 1..10
sq = v.^2;             % element-wise square
s  = sum(sq);          % reduction
printf('sum of squares = %d\\n', s);
disp(sq);`,
  },
  {
    id: 'gs-control',
    name: 'Control flow',
    category: 'Getting Started',
    description: 'if/else and a for loop that builds a vector.',
    code: `% Control flow
out = zeros(1, 10);
for i = 1:10
  if mod(i, 2) == 0
    out(i) = i^2;
  else
    out(i) = -i;
  end
end
disp(out);`,
  },

  // ── Statistics ─────────────────────────────────────────────────────
  {
    id: 'stat-descriptive',
    name: 'Descriptive statistics',
    category: 'Statistics',
    description: 'Mean, std, median, quantiles, skewness and kurtosis.',
    code: `% Descriptive statistics on a sample
x = [22.5 24.1 25.3 23.8 26.2 22.9 24.7 25.5 23.4 24.9 ...
     26.1 23.7 25.2 24.3 25.8 23.6 24.5 25.9 24.2 25.6];

m   = mean(x);
sd  = std(x);
med = median(x);
q1  = quantile(x, 0.25);
q3  = quantile(x, 0.75);
sk  = skewness(x);
kt  = kurtosis(x);

printf('n    = %d\\n', length(x));
printf('mean = %.3f\\n', m);
printf('std  = %.3f\\n', sd);
printf('med  = %.3f\\n', med);
printf('IQR  = [%.3f, %.3f]\\n', q1, q3);
printf('skew = %.3f, kurt = %.3f\\n', sk, kt);`,
  },
  {
    id: 'stat-histogram',
    name: 'Histogram of normal sample',
    category: 'Statistics',
    description: 'Draw 500 samples from N(0,1) and histogram them.',
    code: `% Histogram of a normal sample
x = randn(1, 500);
hist(x, 25);
title('N(0,1) — 500 samples');
xlabel('bin'); ylabel('count');
printf('sample mean = %.3f, std = %.3f\\n', mean(x), std(x));`,
  },
  {
    id: 'stat-correlation',
    name: 'Linear correlation',
    category: 'Statistics',
    description: 'Compute Pearson r and visualise the relationship.',
    code: `% Linear correlation
x = 1:30;
y = 2*x + 3 + randn(1, 30) * 4;

r = corr(x, y);
printf('Pearson r = %.4f\\n', r);

scatter(x, y);
title('Scatter with linear trend');
xlabel('x'); ylabel('y');`,
  },

  // ── Signal Processing ──────────────────────────────────────────────
  {
    id: 'sig-fft',
    name: 'FFT of mixed sinusoid',
    category: 'Signal Processing',
    description: 'Generate a two-tone signal, take the FFT, and plot its magnitude.',
    code: `% FFT of a two-tone signal
fs = 500;                       % sampling rate, Hz
t  = 0:1/fs:1-1/fs;
f1 = 30; f2 = 80;
x  = 1.5*sin(2*pi*f1*t) + 0.7*sin(2*pi*f2*t) + 0.3*randn(1, length(t));

mag = fft(x, fs);
half = 1:floor(length(mag)/2);
freq = (half - 1) * fs / length(mag);

plot(freq, mag(half));
title('FFT magnitude spectrum');
xlabel('Hz'); ylabel('|X(f)|');`,
  },
  {
    id: 'sig-butter',
    name: 'Butterworth low-pass filter',
    category: 'Signal Processing',
    description: 'Filter a noisy sine and compare raw vs. filtered signals.',
    code: `% Low-pass filter
fs = 200;
t  = 0:1/fs:2-1/fs;
clean = sin(2*pi*5*t);
noisy = clean + 0.6*randn(1, length(t));

filtered = butter(noisy, 10, fs, 4, 'low');

plot(t, noisy, 'noisy');
plot(t, filtered, 'filtered');
title('Butterworth low-pass (fc = 10 Hz)');
xlabel('t (s)'); ylabel('amplitude');`,
  },

  // ── Linear Algebra ─────────────────────────────────────────────────
  {
    id: 'la-matmul',
    name: 'Matrix multiplication',
    category: 'Linear Algebra',
    description: 'Build matrices, multiply and transpose.',
    code: `% Matrix operations
A = [1 2 3; 4 5 6; 7 8 10];
B = [1; 0; -1];

C = A * B;          % matrix-vector product
D = A' * A;         % A transpose times A
disp(C);
disp(D);
printf('size(D) = %dx%d\\n', size(D, 1), size(D, 2));`,
  },
  {
    id: 'la-range',
    name: 'Range and reshape',
    category: 'Linear Algebra',
    description: 'Construct vectors with ranges and reshape into matrices.',
    code: `% Range + reshape
v = 1:12;
M = reshape(v, 3, 4);
disp(M);
printf('sum by row 1 = %d\\n', sum(M(1,:)));
printf('sum by col 2 = %d\\n', sum(M(:,2)));`,
  },

  // ── Curve Fitting ──────────────────────────────────────────────────
  {
    id: 'cf-polyfit',
    name: 'Polynomial fit',
    category: 'Curve Fitting',
    description: 'Fit a cubic polynomial to noisy data and overlay the result.',
    code: `% Polynomial fit
x = linspace(-3, 3, 40);
y = 0.5*x.^3 - 2*x + 1 + randn(1, length(x)) * 1.2;

p = polyfit(x, y, 3);
xf = linspace(-3, 3, 200);
yf = polyval(p, xf);

scatter(x, y);
plot(xf, yf, 'fit');
title('Cubic fit to noisy data');
xlabel('x'); ylabel('y');
disp(p);`,
  },

  // ── Simulation ─────────────────────────────────────────────────────
  {
    id: 'sim-random-walk',
    name: 'Random walk',
    category: 'Simulation',
    description: 'Three independent 1-D random walks.',
    code: `% Random walks
n = 500;
for k = 1:3
  steps = randn(1, n);
  walk  = cumsum(steps);
  plot(1:n, walk, sprintf('walk %d', k));
end
title('Three random walks');
xlabel('step'); ylabel('position');`,
  },
  {
    id: 'sim-monte-pi',
    name: 'Monte Carlo \u03c0 estimate',
    category: 'Simulation',
    description: 'Estimate \u03c0 by sampling points in the unit square.',
    code: `% Monte Carlo estimate of pi
n = 20000;
x = rand(1, n);
y = rand(1, n);
inside = (x.^2 + y.^2) <= 1;
pi_est = 4 * sum(inside) / n;
printf('pi estimate (n = %d): %.5f\\n', n, pi_est);
printf('error vs. true pi: %.5f\\n', abs(pi_est - pi));`,
  },

  // ── Plotting ───────────────────────────────────────────────────────
  {
    id: 'plot-multiline',
    name: 'Overlay three lines',
    category: 'Plotting',
    description: 'Plot sin, cos and their product on the same axes.',
    code: `% Overlay plots
t = linspace(0, 2*pi, 200);
plot(t, sin(t), 'sin');
plot(t, cos(t), 'cos');
plot(t, sin(t) .* cos(t), 'sin*cos');
title('Overlay demo');
xlabel('t'); ylabel('value');
legend('sin', 'cos', 'sin*cos');`,
  },
]

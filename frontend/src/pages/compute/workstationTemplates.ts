// ═══════════════════════════════════════════════════════════════════════
// Workstation — curated numeric compute script templates
// Hand-picked to run end-to-end on the in-browser computeEngine (no
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
  'Differential Equations',
  'Plotting',
  '3D Visualization',
  'Image Processing',
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

  // ── New: Getting Started extras ─────────────────────────────────────
  {
    id: 'gs-anon',
    name: 'Anonymous functions',
    category: 'Getting Started',
    description: 'Define an anonymous function and apply it with arrayfun.',
    code: `% Anonymous function via arrayfun
f = @(x) x.^2 - 2*x + 1;
x = linspace(-2, 4, 60);
y = arrayfun(f, x);
plot(x, y, 'f(x) = x^2 - 2x + 1');
title('Anonymous function');
xlabel('x'); ylabel('f(x)');`,
  },

  // ── New: Statistics extras ─────────────────────────────────────────
  {
    id: 'stat-ttest',
    name: 'Two-sample t-test',
    category: 'Statistics',
    description: 'Welch two-sample t-test between two normal samples.',
    code: `% Two-sample Welch t-test
a = 5 + randn(1, 40) * 1.2;
b = 5.6 + randn(1, 40) * 1.1;

r = ttest2(a, b);     % [t, df, p, cohenD]
printf('t = %.3f, df = %.1f, p = %.4f, d = %.3f\\n', ...
       r(1), r(2), r(3), r(4));

printf('mean A = %.3f, mean B = %.3f\\n', mean(a), mean(b));`,
  },
  {
    id: 'stat-regress',
    name: 'Linear regression',
    category: 'Statistics',
    description: 'Fit a linear model and extract slope, intercept, R^2 and p.',
    code: `% Linear regression
x = linspace(0, 10, 40);
y = 1.8 * x + 2 + randn(1, 40) * 1.5;

r = regress(y, x);    % [slope, intercept, r2, p]
printf('slope     = %.4f\\n', r(1));
printf('intercept = %.4f\\n', r(2));
printf('R^2       = %.4f\\n', r(3));
printf('p         = %.4g\\n', r(4));

xf = linspace(0, 10, 100);
yf = r(1) * xf + r(2);

scatter(x, y);
plot(xf, yf, 'fit');
title('Linear regression');
xlabel('x'); ylabel('y');`,
  },
  {
    id: 'stat-shapiro',
    name: 'Shapiro\u2013Wilk normality',
    category: 'Statistics',
    description: 'Test whether a sample looks normal vs. log-normal.',
    code: `% Normality check on two samples
a = randn(1, 60);
b = exp(0.5 * randn(1, 60));  % log-normal

ra = shapiro(a);    % [W, p]
rb = shapiro(b);

printf('normal sample   : W = %.4f, p = %.4f\\n', ra(1), ra(2));
printf('lognormal sample: W = %.4f, p = %.4f\\n', rb(1), rb(2));`,
  },

  // ── New: Linear Algebra extras ─────────────────────────────────────
  {
    id: 'la-solve',
    name: 'Solve Ax = b',
    category: 'Linear Algebra',
    description: 'Compare the \\ operator with inv(A)*b for a 4x4 system.',
    code: `% Linear system solve
A = [4 1 0 0; 1 4 1 0; 0 1 4 1; 0 0 1 4];
b = [15; 10; 10; 15];

x1 = A \\ b;        % preferred: LU solve
x2 = inv(A) * b;   % explicit inverse

printf('x (via \\\\):\\n');
disp(x1);
printf('residual = %.2e\\n', norm(A*x1 - b));
printf('diff vs inv: %.2e\\n', norm(x1 - x2));`,
  },
  {
    id: 'la-det-inv',
    name: 'Determinant & inverse',
    category: 'Linear Algebra',
    description: 'Build a random matrix, compute det, inv, and verify A*inv(A)=I.',
    code: `% Determinant & inverse
A = [3 1 2; 1 4 1; 2 1 5];

d  = det(A);
Ai = inv(A);
I  = A * Ai;

printf('det(A) = %.4f\\n', d);
printf('trace(A) = %.4f\\n', trace(A));
printf('||A*inv(A) - eye(3)|| = %.2e\\n', norm(I - eye(3)));
disp(Ai);`,
  },
  {
    id: 'la-rank',
    name: 'Rank & null structure',
    category: 'Linear Algebra',
    description: 'Rank of a deliberately-singular matrix.',
    code: `% Rank of a rank-2 matrix
A = [1 2 3; 2 4 6; 1 0 1];
printf('rank(A) = %d\\n', rank(A));
printf('det(A)  = %.4e\\n', det(A));

B = eye(3) + 0.01 * randn(3, 3);
printf('rank(B) = %d  (expect 3)\\n', rank(B));`,
  },

  // ── New: Differential Equations ────────────────────────────────────
  {
    id: 'ode-lorenz',
    name: 'Lorenz attractor',
    category: 'Differential Equations',
    description: 'Integrate the Lorenz system with ode45 and plot x vs z.',
    code: `% Lorenz attractor via ode45
sigma = 10; rho = 28; beta = 8/3;
f = @(t, y) [sigma*(y(2)-y(1)); y(1)*(rho-y(3))-y(2); y(1)*y(2)-beta*y(3)];

Y = ode45(f, [0 40], [1; 1; 1], 4000);  % [N x 3]
x = Y(:,1); z = Y(:,3);

plot(x, z, 'lorenz');
title('Lorenz attractor (x vs z)');
xlabel('x'); ylabel('z');`,
  },
  {
    id: 'ode-predator',
    name: 'Predator\u2013prey model',
    category: 'Differential Equations',
    description: 'Lotka\u2013Volterra equations integrated with ode45.',
    code: `% Lotka-Volterra predator-prey
a = 1.1; b = 0.4; c = 0.4; d = 0.1;
f = @(t, y) [a*y(1) - b*y(1)*y(2); -c*y(2) + d*y(1)*y(2)];

Y = ode45(f, [0 50], [10; 2], 1500);
prey = Y(:,1); pred = Y(:,2);
t = __ode_t__;

plot(t, prey, 'prey');
plot(t, pred, 'predator');
title('Lotka-Volterra');
xlabel('t'); ylabel('population');
legend('prey', 'predator');`,
  },
  {
    id: 'ode-harmonic',
    name: 'Damped harmonic oscillator',
    category: 'Differential Equations',
    description: 'Classic second-order ODE rewritten as a 2-D first-order system.',
    code: `% Damped harmonic oscillator: x'' + 2*zeta*w*x' + w^2 x = 0
w = 2*pi; zeta = 0.1;
f = @(t, y) [y(2); -2*zeta*w*y(2) - w^2*y(1)];

Y = ode45(f, [0 6], [1; 0], 800);
t = __ode_t__;

plot(t, Y(:,1), 'x(t)');
plot(t, Y(:,2), "x'(t)");
title('Damped harmonic oscillator');
xlabel('t'); ylabel('state');
legend('position', 'velocity');`,
  },

  // ── New: Simulation extras ─────────────────────────────────────────
  {
    id: 'sim-logistic',
    name: 'Logistic map orbit',
    category: 'Simulation',
    description: 'Iterate the logistic map and watch chaos emerge at r = 3.9.',
    code: `% Logistic map orbit
r = 3.9; n = 200; x = zeros(1, n);
x(1) = 0.4;
for k = 1:n-1
  x(k+1) = r * x(k) * (1 - x(k));
end
plot(1:n, x, 'orbit');
title(sprintf('Logistic map (r = %.2f)', r));
xlabel('iteration'); ylabel('x_k');`,
  },

  // ── New: Signal Processing extras ──────────────────────────────────
  {
    id: 'sig-smoothing',
    name: 'Moving average smoothing',
    category: 'Signal Processing',
    description: 'Compare raw and smoothed signal with movmean.',
    code: `% Moving average smoothing
fs = 200;
t = 0:1/fs:3-1/fs;
clean = sin(2*pi*1.5*t) + 0.5*sin(2*pi*0.3*t);
noisy = clean + 0.6*randn(1, length(t));
smooth = movmean(noisy, 15);

plot(t, noisy, 'noisy');
plot(t, smooth, 'smooth');
title('Moving-average smoothing (window = 15)');
xlabel('t (s)'); ylabel('amplitude');`,
  },

  // ── 3D Visualization ─────────────────────────────────────────────────
  {
    id: '3d-gaussian',
    name: '3D Gaussian surface',
    category: '3D Visualization',
    description: 'Classic 2D Gaussian bell rendered as an interactive 3D surface.',
    code: `% 3D Gaussian surface
n = 40;
x = linspace(-3, 3, n);
y = linspace(-3, 3, n);
Z = zeros(n, n);
for i = 1:n
  for j = 1:n
    Z(i,j) = exp(-(x(j)^2 + y(i)^2) / 2);
  end
end
title('Gaussian Surface');
xlabel('x'); ylabel('y'); zlabel('z');
surface(Z, x, y);`,
  },
  {
    id: '3d-sinc',
    name: 'Sinc ripple',
    category: '3D Visualization',
    description: 'The sinc function sin(r)/r creates a circular ripple pattern.',
    code: `% Sinc ripple surface
n = 50;
x = linspace(-10, 10, n);
y = linspace(-10, 10, n);
Z = zeros(n, n);
for i = 1:n
  for j = 1:n
    r = sqrt(x(j)^2 + y(i)^2) + 0.001;
    Z(i,j) = sin(r) / r;
  end
end
title('sinc(r) = sin(r)/r');
surface(Z, x, y);`,
  },
  {
    id: '3d-heatmap-dose',
    name: 'Radiation dose heatmap',
    category: '3D Visualization',
    description: 'Dual-beam radiation dose distribution as a heatmap.',
    code: `% Radiation dose distribution — heatmap
n = 50;
x = linspace(-3, 3, n);
y = linspace(-3, 3, n);
D = zeros(n, n);
for i = 1:n
  for j = 1:n
    D(i,j) = 100*exp(-((x(j)-0.5)^2+(y(i)-0.3)^2)/0.8) ...
           +  40*exp(-((x(j)+0.5)^2+(y(i)+0.5)^2)/1.2);
  end
end
title('Radiation Dose Distribution (Gy)');
xlabel('x (cm)'); ylabel('y (cm)');
heatmap(D, x, y);`,
  },
  {
    id: '3d-wireframe-saddle',
    name: 'Saddle wireframe',
    category: '3D Visualization',
    description: 'Hyperbolic paraboloid x²−y² as a wireframe mesh.',
    code: `% Saddle point wireframe
n = 30;
x = linspace(-2, 2, n);
y = linspace(-2, 2, n);
Z = zeros(n, n);
for i = 1:n
  for j = 1:n
    Z(i,j) = x(j)^2 - y(i)^2;
  end
end
title('Saddle Point: x^2 - y^2');
wireframe(Z, x, y);`,
  },
  {
    id: '3d-scatter-cloud',
    name: '3D scatter cloud',
    category: '3D Visualization',
    description: 'Random point cloud colored by z-height.',
    code: `% 3D scatter point cloud
n = 300;
x = randn(n, 1);
y = randn(n, 1);
z = sin(x).*cos(y) + 0.2*randn(n, 1);
title('3D Point Cloud');
scatter3d(x, y, z);`,
  },
  {
    id: '3d-contour-wave',
    name: 'Contour: wave interference',
    category: '3D Visualization',
    description: 'Two-source wave interference viewed as a contour surface.',
    code: `% Wave interference contour
n = 50;
x = linspace(-6, 6, n);
y = linspace(-6, 6, n);
Z = zeros(n, n);
for i = 1:n
  for j = 1:n
    r1 = sqrt((x(j)-2)^2 + y(i)^2);
    r2 = sqrt((x(j)+2)^2 + y(i)^2);
    Z(i,j) = sin(3*r1) + sin(3*r2);
  end
end
title('Two-Source Wave Interference');
contour(Z, x, y);`,
  },

  // ── Image Processing ─────────────────────────────────────────────────
  {
    id: 'img-edge-detect',
    name: 'Edge detection pipeline',
    category: 'Image Processing',
    description: 'Create a synthetic image and run Sobel edge detection.',
    code: `% Edge detection on a synthetic image
n = 64;
img = zeros(n, n);

% Draw a bright rectangle
for i = 15:45
  for j = 20:50
    img(i, j) = 200;
  end
end

% Add a circle
for i = 1:n
  for j = 1:n
    if (i-32)^2 + (j-32)^2 < 100
      img(i, j) = 180;
    end
  end
end

E = edge(img);

printf('Original: %d x %d\\n', n, n);
printf('Edge pixels: %d\\n', sum(sum(E > 0)));

% Visualize as heatmaps
title('Original Image');
heatmap(img);`,
  },
  {
    id: 'img-filter-demo',
    name: 'Gaussian & Laplacian filters',
    category: 'Image Processing',
    description: 'Apply Gaussian smoothing then Laplacian sharpening.',
    code: `% Gaussian + Laplacian filtering demo
n = 50;
img = zeros(n, n);

% Create gradient + noise pattern
for i = 1:n
  for j = 1:n
    img(i,j) = 128 + 50*sin(2*pi*i/n) + 20*cos(4*pi*j/n) + 10*randn(1,1);
  end
end

% Gaussian smoothing
K_gauss = fspecial('gaussian', 5);
smooth = imfilter(img, K_gauss);

% Laplacian edge enhancement
K_lap = fspecial('laplacian');
edges = imfilter(smooth, K_lap);

printf('Original range: [%.1f, %.1f]\\n', min(min(img)), max(max(img)));
printf('Smoothed range: [%.1f, %.1f]\\n', min(min(smooth)), max(max(smooth)));

title('Gaussian Smoothed');
heatmap(smooth);`,
  },
  {
    id: 'img-threshold',
    name: 'Otsu thresholding',
    category: 'Image Processing',
    description: 'Automatic Otsu threshold on a bimodal synthetic image.',
    code: `% Otsu automatic thresholding
n = 60;
img = zeros(n, n);

% Create bimodal intensity — dark background, bright foreground
for i = 1:n
  for j = 1:n
    r2 = (i-30)^2 + (j-30)^2;
    if r2 < 200
      img(i,j) = 180 + 20*randn(1,1);   % bright object
    else
      img(i,j) = 40 + 15*randn(1,1);    % dark background
    end
  end
end

% Otsu threshold (auto)
bw = imthreshold(img);
printf('Foreground pixels: %d / %d\\n', sum(sum(bw > 0)), n*n);

% Histogram
H = imhist(img, 64);
bar(1:64, H);
title('Intensity Histogram');
xlabel('Bin'); ylabel('Count');`,
  },
  {
    id: 'img-morphology',
    name: 'Morphological operations',
    category: 'Image Processing',
    description: 'Erosion and dilation on a binary image.',
    code: `% Morphological erosion & dilation
n = 50;
img = zeros(n, n);

% Draw a cross shape
for i = 20:30
  for j = 10:40
    img(i, j) = 255;
  end
end
for i = 10:40
  for j = 20:30
    img(i, j) = 255;
  end
end

% 3x3 structuring element
se = ones(3, 3);

eroded  = imerode(img, se);
dilated = imdilate(img, se);

printf('Original white pixels: %d\\n', sum(sum(img > 0)));
printf('Eroded white pixels:   %d\\n', sum(sum(eroded > 0)));
printf('Dilated white pixels:  %d\\n', sum(sum(dilated > 0)));

title('Dilated Cross');
heatmap(dilated);`,
  },
]

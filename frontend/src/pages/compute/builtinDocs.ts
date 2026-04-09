// Reference documentation for the Workstation's built-in MATLAB/Octave
// functions. Used by the library sidebar to surface a searchable index so
// users can discover what the in-browser engine supports.
//
// Keep descriptions short (they render in a compact sidebar). The
// `snippet` field is what gets inserted when the user clicks a row — it
// should leave the caret in a sensible place (we put `${1:x}` placeholders
// inline; Workstation inserts them as literal text for now).
export type BuiltinCategory =
  | 'Math'
  | 'Matrix'
  | 'Statistics'
  | 'Linear algebra'
  | 'Signal'
  | 'Calculus'
  | 'Sets'
  | 'Plotting'
  | 'I/O'
  | 'Logic'

export interface BuiltinDoc {
  name: string
  category: BuiltinCategory
  signature: string
  description: string
  snippet: string
}

export const BUILTIN_CATEGORIES: BuiltinCategory[] = [
  'Math', 'Matrix', 'Statistics', 'Linear algebra', 'Calculus',
  'Signal', 'Sets', 'Logic', 'Plotting', 'I/O',
]

export const BUILTIN_DOCS: BuiltinDoc[] = [
  // ─── Math ────────────────────────────────────────────────────────────
  { name: 'sin', category: 'Math', signature: 'sin(x)', description: 'Element-wise sine', snippet: 'sin(x)' },
  { name: 'cos', category: 'Math', signature: 'cos(x)', description: 'Element-wise cosine', snippet: 'cos(x)' },
  { name: 'tan', category: 'Math', signature: 'tan(x)', description: 'Element-wise tangent', snippet: 'tan(x)' },
  { name: 'asin', category: 'Math', signature: 'asin(x)', description: 'Inverse sine', snippet: 'asin(x)' },
  { name: 'acos', category: 'Math', signature: 'acos(x)', description: 'Inverse cosine', snippet: 'acos(x)' },
  { name: 'atan', category: 'Math', signature: 'atan(x)', description: 'Inverse tangent', snippet: 'atan(x)' },
  { name: 'atan2', category: 'Math', signature: 'atan2(y, x)', description: 'Four-quadrant inverse tangent', snippet: 'atan2(y, x)' },
  { name: 'sinh', category: 'Math', signature: 'sinh(x)', description: 'Hyperbolic sine', snippet: 'sinh(x)' },
  { name: 'cosh', category: 'Math', signature: 'cosh(x)', description: 'Hyperbolic cosine', snippet: 'cosh(x)' },
  { name: 'tanh', category: 'Math', signature: 'tanh(x)', description: 'Hyperbolic tangent', snippet: 'tanh(x)' },
  { name: 'exp', category: 'Math', signature: 'exp(x)', description: 'Exponential e^x', snippet: 'exp(x)' },
  { name: 'log', category: 'Math', signature: 'log(x)', description: 'Natural logarithm', snippet: 'log(x)' },
  { name: 'log2', category: 'Math', signature: 'log2(x)', description: 'Base-2 logarithm', snippet: 'log2(x)' },
  { name: 'log10', category: 'Math', signature: 'log10(x)', description: 'Base-10 logarithm', snippet: 'log10(x)' },
  { name: 'sqrt', category: 'Math', signature: 'sqrt(x)', description: 'Square root', snippet: 'sqrt(x)' },
  { name: 'cbrt', category: 'Math', signature: 'cbrt(x)', description: 'Cube root', snippet: 'cbrt(x)' },
  { name: 'abs', category: 'Math', signature: 'abs(x)', description: 'Absolute value', snippet: 'abs(x)' },
  { name: 'sign', category: 'Math', signature: 'sign(x)', description: 'Signum function', snippet: 'sign(x)' },
  { name: 'floor', category: 'Math', signature: 'floor(x)', description: 'Round toward -Inf', snippet: 'floor(x)' },
  { name: 'ceil', category: 'Math', signature: 'ceil(x)', description: 'Round toward +Inf', snippet: 'ceil(x)' },
  { name: 'round', category: 'Math', signature: 'round(x)', description: 'Round to nearest integer', snippet: 'round(x)' },
  { name: 'fix', category: 'Math', signature: 'fix(x)', description: 'Round toward zero', snippet: 'fix(x)' },
  { name: 'mod', category: 'Math', signature: 'mod(a, b)', description: 'Modulo (MATLAB semantics)', snippet: 'mod(a, b)' },
  { name: 'rem', category: 'Math', signature: 'rem(a, b)', description: 'Remainder (C semantics)', snippet: 'rem(a, b)' },
  { name: 'hypot', category: 'Math', signature: 'hypot(a, b)', description: 'sqrt(a^2 + b^2) without overflow', snippet: 'hypot(a, b)' },
  { name: 'erf', category: 'Math', signature: 'erf(x)', description: 'Error function', snippet: 'erf(x)' },
  { name: 'gammaln', category: 'Math', signature: 'gammaln(x)', description: 'Log of gamma function', snippet: 'gammaln(x)' },
  { name: 'factorial', category: 'Math', signature: 'factorial(n)', description: 'n!', snippet: 'factorial(n)' },
  { name: 'nchoosek', category: 'Math', signature: 'nchoosek(n, k)', description: 'Binomial coefficient', snippet: 'nchoosek(n, k)' },
  { name: 'deg2rad', category: 'Math', signature: 'deg2rad(x)', description: 'Degrees to radians', snippet: 'deg2rad(x)' },
  { name: 'rad2deg', category: 'Math', signature: 'rad2deg(x)', description: 'Radians to degrees', snippet: 'rad2deg(x)' },

  // ─── Matrix ──────────────────────────────────────────────────────────
  { name: 'zeros', category: 'Matrix', signature: 'zeros(m, n)', description: 'Zero matrix', snippet: 'zeros(m, n)' },
  { name: 'ones', category: 'Matrix', signature: 'ones(m, n)', description: 'Matrix of ones', snippet: 'ones(m, n)' },
  { name: 'eye', category: 'Matrix', signature: 'eye(n)', description: 'Identity matrix', snippet: 'eye(n)' },
  { name: 'rand', category: 'Matrix', signature: 'rand(m, n)', description: 'Uniform random matrix', snippet: 'rand(m, n)' },
  { name: 'randn', category: 'Matrix', signature: 'randn(m, n)', description: 'Standard normal random matrix', snippet: 'randn(m, n)' },
  { name: 'randi', category: 'Matrix', signature: 'randi(imax, m, n)', description: 'Uniform random integers', snippet: 'randi(imax, m, n)' },
  { name: 'linspace', category: 'Matrix', signature: 'linspace(a, b, n)', description: 'Linearly spaced vector', snippet: 'linspace(a, b, n)' },
  { name: 'logspace', category: 'Matrix', signature: 'logspace(a, b, n)', description: 'Logarithmically spaced vector', snippet: 'logspace(a, b, n)' },
  { name: 'repmat', category: 'Matrix', signature: 'repmat(M, r, c)', description: 'Tile matrix', snippet: 'repmat(M, r, c)' },
  { name: 'reshape', category: 'Matrix', signature: 'reshape(M, r, c)', description: 'Change matrix shape', snippet: 'reshape(M, r, c)' },
  { name: 'size', category: 'Matrix', signature: 'size(M)', description: 'Matrix dimensions', snippet: 'size(M)' },
  { name: 'length', category: 'Matrix', signature: 'length(v)', description: 'Length of longest dimension', snippet: 'length(v)' },
  { name: 'numel', category: 'Matrix', signature: 'numel(M)', description: 'Number of elements', snippet: 'numel(M)' },
  { name: 'flipud', category: 'Matrix', signature: 'flipud(M)', description: 'Flip rows', snippet: 'flipud(M)' },
  { name: 'fliplr', category: 'Matrix', signature: 'fliplr(M)', description: 'Flip columns', snippet: 'fliplr(M)' },
  { name: 'rot90', category: 'Matrix', signature: 'rot90(M)', description: 'Rotate matrix 90°', snippet: 'rot90(M)' },
  { name: 'horzcat', category: 'Matrix', signature: 'horzcat(A, B)', description: 'Horizontal concatenate', snippet: 'horzcat(A, B)' },
  { name: 'vertcat', category: 'Matrix', signature: 'vertcat(A, B)', description: 'Vertical concatenate', snippet: 'vertcat(A, B)' },
  { name: 'cat', category: 'Matrix', signature: 'cat(dim, A, B)', description: 'Concatenate along dim', snippet: 'cat(dim, A, B)' },
  { name: 'kron', category: 'Matrix', signature: 'kron(A, B)', description: 'Kronecker tensor product', snippet: 'kron(A, B)' },
  { name: 'circshift', category: 'Matrix', signature: 'circshift(M, [r c])', description: 'Circular shift', snippet: 'circshift(M, [r c])' },

  // ─── Statistics ──────────────────────────────────────────────────────
  { name: 'sum', category: 'Statistics', signature: 'sum(v)', description: 'Sum of elements', snippet: 'sum(v)' },
  { name: 'prod', category: 'Statistics', signature: 'prod(v)', description: 'Product of elements', snippet: 'prod(v)' },
  { name: 'mean', category: 'Statistics', signature: 'mean(v)', description: 'Arithmetic mean', snippet: 'mean(v)' },
  { name: 'median', category: 'Statistics', signature: 'median(v)', description: 'Median', snippet: 'median(v)' },
  { name: 'std', category: 'Statistics', signature: 'std(v)', description: 'Standard deviation', snippet: 'std(v)' },
  { name: 'var', category: 'Statistics', signature: 'var(v)', description: 'Variance', snippet: 'var(v)' },
  { name: 'min', category: 'Statistics', signature: 'min(v)', description: 'Minimum', snippet: 'min(v)' },
  { name: 'max', category: 'Statistics', signature: 'max(v)', description: 'Maximum', snippet: 'max(v)' },
  { name: 'range', category: 'Statistics', signature: 'range(v)', description: 'max − min', snippet: 'range(v)' },
  { name: 'quantile', category: 'Statistics', signature: 'quantile(v, p)', description: 'Quantile at p (0..1)', snippet: 'quantile(v, 0.5)' },
  { name: 'prctile', category: 'Statistics', signature: 'prctile(v, p)', description: 'Percentile (0..100)', snippet: 'prctile(v, 50)' },
  { name: 'iqr', category: 'Statistics', signature: 'iqr(v)', description: 'Interquartile range', snippet: 'iqr(v)' },
  { name: 'skewness', category: 'Statistics', signature: 'skewness(v)', description: 'Sample skewness', snippet: 'skewness(v)' },
  { name: 'kurtosis', category: 'Statistics', signature: 'kurtosis(v)', description: 'Sample kurtosis', snippet: 'kurtosis(v)' },
  { name: 'sem', category: 'Statistics', signature: 'sem(v)', description: 'Standard error of the mean', snippet: 'sem(v)' },
  { name: 'cov', category: 'Statistics', signature: 'cov(x, y)', description: 'Covariance', snippet: 'cov(x, y)' },
  { name: 'corr', category: 'Statistics', signature: 'corr(x, y)', description: 'Pearson correlation', snippet: 'corr(x, y)' },
  { name: 'normcdf', category: 'Statistics', signature: 'normcdf(x)', description: 'Standard normal CDF', snippet: 'normcdf(x)' },
  { name: 'norminv', category: 'Statistics', signature: 'norminv(p)', description: 'Standard normal quantile', snippet: 'norminv(p)' },
  { name: 'tcdf', category: 'Statistics', signature: 'tcdf(x, df)', description: "Student's t CDF", snippet: 'tcdf(x, df)' },
  { name: 'chi2cdf', category: 'Statistics', signature: 'chi2cdf(x, df)', description: 'Chi-squared CDF', snippet: 'chi2cdf(x, df)' },
  { name: 'fcdf', category: 'Statistics', signature: 'fcdf(x, d1, d2)', description: 'F-distribution CDF', snippet: 'fcdf(x, d1, d2)' },
  { name: 'ttest', category: 'Statistics', signature: 'ttest(x, mu)', description: 'One-sample t-test', snippet: 'ttest(x, 0)' },
  { name: 'ttest2', category: 'Statistics', signature: 'ttest2(x, y)', description: 'Two-sample t-test', snippet: 'ttest2(x, y)' },
  { name: 'ranksum', category: 'Statistics', signature: 'ranksum(x, y)', description: 'Wilcoxon rank-sum test', snippet: 'ranksum(x, y)' },
  { name: 'shapiro', category: 'Statistics', signature: 'shapiro(x)', description: 'Shapiro-Wilk normality test', snippet: 'shapiro(x)' },
  { name: 'regress', category: 'Statistics', signature: 'regress(y, X)', description: 'Linear regression', snippet: 'regress(y, X)' },
  { name: 'polyfit', category: 'Statistics', signature: 'polyfit(x, y, n)', description: 'Fit polynomial of degree n', snippet: 'polyfit(x, y, 2)' },
  { name: 'polyval', category: 'Statistics', signature: 'polyval(p, x)', description: 'Evaluate polynomial', snippet: 'polyval(p, x)' },

  // ─── Linear algebra ──────────────────────────────────────────────────
  { name: 'det', category: 'Linear algebra', signature: 'det(A)', description: 'Determinant', snippet: 'det(A)' },
  { name: 'inv', category: 'Linear algebra', signature: 'inv(A)', description: 'Matrix inverse', snippet: 'inv(A)' },
  { name: 'trace', category: 'Linear algebra', signature: 'trace(A)', description: 'Sum of diagonal', snippet: 'trace(A)' },
  { name: 'rank', category: 'Linear algebra', signature: 'rank(A)', description: 'Matrix rank', snippet: 'rank(A)' },
  { name: 'diag', category: 'Linear algebra', signature: 'diag(A)', description: 'Diagonal or create diagonal', snippet: 'diag(A)' },
  { name: 'norm', category: 'Linear algebra', signature: 'norm(v)', description: 'Vector / matrix norm', snippet: 'norm(v)' },
  { name: 'linsolve', category: 'Linear algebra', signature: 'linsolve(A, b)', description: 'Solve A·x = b', snippet: 'linsolve(A, b)' },
  { name: 'transpose', category: 'Linear algebra', signature: 'transpose(A)', description: 'Transpose', snippet: 'transpose(A)' },
  { name: 'dot', category: 'Linear algebra', signature: 'dot(a, b)', description: 'Dot product', snippet: 'dot(a, b)' },
  { name: 'cross', category: 'Linear algebra', signature: 'cross(a, b)', description: 'Cross product (3-vectors)', snippet: 'cross(a, b)' },

  // ─── Calculus ────────────────────────────────────────────────────────
  { name: 'diff', category: 'Calculus', signature: 'diff(v)', description: 'Successive differences', snippet: 'diff(v)' },
  { name: 'gradient', category: 'Calculus', signature: 'gradient(v)', description: 'Numerical gradient', snippet: 'gradient(v)' },
  { name: 'trapz', category: 'Calculus', signature: 'trapz(x, y)', description: 'Trapezoidal integration', snippet: 'trapz(x, y)' },
  { name: 'cumtrapz', category: 'Calculus', signature: 'cumtrapz(x, y)', description: 'Cumulative trapezoidal integral', snippet: 'cumtrapz(x, y)' },
  { name: 'interp1', category: 'Calculus', signature: 'interp1(x, y, xq)', description: '1-D linear interpolation', snippet: 'interp1(x, y, xq)' },
  { name: 'ode45', category: 'Calculus', signature: 'ode45(f, tspan, y0)', description: 'Non-stiff ODE solver', snippet: 'ode45(@(t,y) f, [0 1], y0)' },
  { name: 'cumsum', category: 'Calculus', signature: 'cumsum(v)', description: 'Cumulative sum', snippet: 'cumsum(v)' },
  { name: 'cumprod', category: 'Calculus', signature: 'cumprod(v)', description: 'Cumulative product', snippet: 'cumprod(v)' },

  // ─── Signal ──────────────────────────────────────────────────────────
  { name: 'fft', category: 'Signal', signature: 'fft(x)', description: 'Fast Fourier transform', snippet: 'fft(x)' },
  { name: 'butter', category: 'Signal', signature: 'butter(n, Wn)', description: 'Butterworth filter coefficients', snippet: 'butter(4, 0.3)' },
  { name: 'movmean', category: 'Signal', signature: 'movmean(x, k)', description: 'Moving mean', snippet: 'movmean(x, 5)' },
  { name: 'findpeaks', category: 'Signal', signature: 'findpeaks(x)', description: 'Local maxima of a signal', snippet: 'findpeaks(x)' },
  { name: 'sinc', category: 'Signal', signature: 'sinc(x)', description: 'Normalized sinc', snippet: 'sinc(x)' },

  // ─── Sets ────────────────────────────────────────────────────────────
  { name: 'unique', category: 'Sets', signature: 'unique(v)', description: 'Unique sorted elements', snippet: 'unique(v)' },
  { name: 'ismember', category: 'Sets', signature: 'ismember(a, b)', description: 'Element-wise set membership', snippet: 'ismember(a, b)' },
  { name: 'union', category: 'Sets', signature: 'union(a, b)', description: 'Set union', snippet: 'union(a, b)' },
  { name: 'intersect', category: 'Sets', signature: 'intersect(a, b)', description: 'Set intersection', snippet: 'intersect(a, b)' },
  { name: 'setdiff', category: 'Sets', signature: 'setdiff(a, b)', description: 'Set difference', snippet: 'setdiff(a, b)' },

  // ─── Logic ───────────────────────────────────────────────────────────
  { name: 'any', category: 'Logic', signature: 'any(v)', description: 'True if any element is non-zero', snippet: 'any(v)' },
  { name: 'all', category: 'Logic', signature: 'all(v)', description: 'True if all elements are non-zero', snippet: 'all(v)' },
  { name: 'find', category: 'Logic', signature: 'find(v)', description: 'Indices of non-zero elements', snippet: 'find(v)' },
  { name: 'nnz', category: 'Logic', signature: 'nnz(v)', description: 'Number of non-zeros', snippet: 'nnz(v)' },
  { name: 'isnan', category: 'Logic', signature: 'isnan(x)', description: 'Element-wise NaN test', snippet: 'isnan(x)' },
  { name: 'isinf', category: 'Logic', signature: 'isinf(x)', description: 'Element-wise infinity test', snippet: 'isinf(x)' },
  { name: 'isfinite', category: 'Logic', signature: 'isfinite(x)', description: 'Element-wise finiteness test', snippet: 'isfinite(x)' },
  { name: 'isempty', category: 'Logic', signature: 'isempty(v)', description: 'True if empty', snippet: 'isempty(v)' },
  { name: 'isequal', category: 'Logic', signature: 'isequal(a, b)', description: 'Deep equality test', snippet: 'isequal(a, b)' },

  // ─── Plotting ────────────────────────────────────────────────────────
  { name: 'plot', category: 'Plotting', signature: 'plot(x, y)', description: 'Line plot', snippet: 'plot(x, y)' },
  { name: 'scatter', category: 'Plotting', signature: 'scatter(x, y)', description: 'Scatter plot', snippet: 'scatter(x, y)' },
  { name: 'bar', category: 'Plotting', signature: 'bar(x, y)', description: 'Bar chart', snippet: 'bar(x, y)' },
  { name: 'stem', category: 'Plotting', signature: 'stem(x, y)', description: 'Stem plot', snippet: 'stem(x, y)' },
  { name: 'hist', category: 'Plotting', signature: 'hist(x, nbins)', description: 'Histogram', snippet: 'hist(x, 20)' },
  { name: 'title', category: 'Plotting', signature: 'title(s)', description: 'Figure title', snippet: "title('...')" },
  { name: 'xlabel', category: 'Plotting', signature: 'xlabel(s)', description: 'X-axis label', snippet: "xlabel('...')" },
  { name: 'ylabel', category: 'Plotting', signature: 'ylabel(s)', description: 'Y-axis label', snippet: "ylabel('...')" },
  { name: 'legend', category: 'Plotting', signature: 'legend(...)', description: 'Legend labels', snippet: "legend('a', 'b')" },
  { name: 'figure', category: 'Plotting', signature: 'figure()', description: 'New figure', snippet: 'figure()' },
  { name: 'clf', category: 'Plotting', signature: 'clf()', description: 'Clear current figure', snippet: 'clf()' },

  // ─── I/O ─────────────────────────────────────────────────────────────
  { name: 'disp', category: 'I/O', signature: 'disp(x)', description: 'Display value', snippet: 'disp(x)' },
  { name: 'printf', category: 'I/O', signature: 'printf(fmt, ...)', description: 'Formatted output', snippet: "printf('%.3f\\n', x)" },
  { name: 'fprintf', category: 'I/O', signature: 'fprintf(fmt, ...)', description: 'Formatted output (alias)', snippet: "fprintf('%.3f\\n', x)" },
  { name: 'sprintf', category: 'I/O', signature: 'sprintf(fmt, ...)', description: 'Formatted string', snippet: "sprintf('%.3f', x)" },
  { name: 'num2str', category: 'I/O', signature: 'num2str(x)', description: 'Number to string', snippet: 'num2str(x)' },
  { name: 'str2num', category: 'I/O', signature: 'str2num(s)', description: 'Parse string to number', snippet: "str2num('1')" },
  { name: 'mat2str', category: 'I/O', signature: 'mat2str(M)', description: 'Matrix to compact string', snippet: 'mat2str(M)' },
  { name: 'tic', category: 'I/O', signature: 'tic()', description: 'Start stopwatch', snippet: 'tic()' },
  { name: 'toc', category: 'I/O', signature: 'toc()', description: 'Elapsed time since tic', snippet: 'toc()' },
]

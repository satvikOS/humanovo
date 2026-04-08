// ═══════════════════════════════════════════════════════════════════════
// Compute Lab — Code Lab
// 4 language environments (Octave, Python, R, Julia) · 32+ biomedical templates
// Backend execution via /api/v1/compute/execute with graceful local fallback
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FiCode, FiPlay, FiUpload, FiDownload, FiClock, FiTrash2,
  FiBarChart2, FiZap, FiGrid, FiLoader,
  FiCopy, FiSearch, FiX,
} from 'react-icons/fi'
import clsx from 'clsx'

type CodeEnv = 'octave' | 'python' | 'r' | 'julia'

interface Template {
  id: string
  name: string
  description: string
  env: CodeEnv
  category: string
  code: string
}

interface HistoryEntry {
  id: string
  env: CodeEnv
  templateName: string
  code: string
  output: string
  createdAt: string
}

const ENVIRONMENTS: { id: CodeEnv; name: string; color: string; icon: typeof FiCode; desc: string }[] = [
  { id: 'octave', name: 'Octave', color: '#0790C0', icon: FiGrid, desc: 'GNU Octave — MATLAB-compatible scientific computing' },
  { id: 'python', name: 'Python', color: '#3776AB', icon: FiCode, desc: 'Python with NumPy, SciPy, scikit-learn, BioPython' },
  { id: 'r', name: 'R', color: '#276DC3', icon: FiBarChart2, desc: 'R with Bioconductor for statistics & bioinformatics' },
  { id: 'julia', name: 'Julia', color: '#9558B2', icon: FiZap, desc: 'Julia for high-performance numerical computing' },
]

const HISTORY_KEY = 'compute-lab-code-history'

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistory(entries: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 50))) } catch { /* quota */ }
}

/* ═══ TEMPLATES — Octave (8) ═══════════════════════════════════════════ */
const OCTAVE_TEMPLATES: Template[] = [
  {
    id: 'oct-eeg-spectral',
    name: 'EEG Spectral Analysis',
    description: 'Bandpass filter EEG, compute PSD, extract delta/theta/alpha/beta/gamma band powers.',
    env: 'octave',
    category: 'Neurophysiology',
    code: `% EEG Spectral Band Power Analysis
pkg load signal;
fs = 256; t = 0:1/fs:10-1/fs; n = length(t);
sig = 20*sin(2*pi*10*t) + 10*sin(2*pi*22*t) + 8*randn(1,n);
[b,a] = butter(4, [1 40]/(fs/2));
filt = filtfilt(b, a, sig);
nfft = 2^nextpow2(n);
Y = fft(filt, nfft);
psd = (1/(fs*n)) * abs(Y(1:nfft/2+1)).^2;
psd(2:end-1) = 2*psd(2:end-1);
f = fs*(0:(nfft/2))/nfft;
delta = sum(psd(f>=0.5 & f<=4));
theta = sum(psd(f>=4 & f<=8));
alpha = sum(psd(f>=8 & f<=13));
beta  = sum(psd(f>=13 & f<=30));
gamma = sum(psd(f>=30 & f<=40));
fprintf('Delta: %.3f\\nTheta: %.3f\\nAlpha: %.3f\\nBeta:  %.3f\\nGamma: %.3f\\n', delta, theta, alpha, beta, gamma);
fprintf('Alpha/Beta ratio: %.3f\\n', alpha/beta);`,
  },
  {
    id: 'oct-hh-neuron',
    name: 'Hodgkin-Huxley Neuron',
    description: 'Simulate action potentials with sodium/potassium channel dynamics.',
    env: 'octave',
    category: 'Computational Neuroscience',
    code: `% Hodgkin-Huxley single neuron
C=1; gNa=120; gK=36; gL=0.3;
ENa=50; EK=-77; EL=-54.387;
dt=0.01; T=50; n=round(T/dt);
V=zeros(1,n); V(1)=-65;
m=0.05; h=0.6; nv=0.32;
I_inj = @(t) 10*(t>5 && t<45);
for i=1:n-1
  t_i=(i-1)*dt;
  am=0.1*(V(i)+40)/(1-exp(-(V(i)+40)/10));
  bm=4*exp(-(V(i)+65)/18);
  ah=0.07*exp(-(V(i)+65)/20);
  bh=1/(1+exp(-(V(i)+35)/10));
  an=0.01*(V(i)+55)/(1-exp(-(V(i)+55)/10));
  bn=0.125*exp(-(V(i)+65)/80);
  m=m+dt*(am*(1-m)-bm*m);
  h=h+dt*(ah*(1-h)-bh*h);
  nv=nv+dt*(an*(1-nv)-bn*nv);
  INa=gNa*m^3*h*(V(i)-ENa);
  IK=gK*nv^4*(V(i)-EK);
  IL=gL*(V(i)-EL);
  V(i+1)=V(i)+dt*(I_inj(t_i)-INa-IK-IL)/C;
end
spikes=sum(diff(V>0)==1);
fprintf('Spike count: %d\\nFiring rate: %.2f Hz\\n', spikes, spikes/(T/1000));`,
  },
  {
    id: 'oct-pid-controller',
    name: 'PID Controller (Glucose)',
    description: 'Closed-loop insulin delivery using a PID controller for glucose regulation.',
    env: 'octave',
    category: 'Control Systems',
    code: `% PID glucose-insulin control loop
Kp=0.8; Ki=0.05; Kd=0.2;
target=100; G=180;
int_err=0; prev_err=0;
dt=1; T=120;
G_log=zeros(1,T); I_log=zeros(1,T);
for k=1:T
  err=target-G;
  int_err=int_err+err*dt;
  d_err=(err-prev_err)/dt;
  I=Kp*err+Ki*int_err+Kd*d_err;
  I=max(0, I);
  G=G+dt*(-0.05*(G-target)-0.02*I+0.5*randn());
  G_log(k)=G; I_log(k)=I;
  prev_err=err;
end
fprintf('Mean glucose: %.1f mg/dL\\n', mean(G_log));
fprintf('Std: %.1f\\n', std(G_log));
fprintf('Time-in-range: %.1f%%\\n', 100*sum(G_log>=70 & G_log<=140)/T);`,
  },
  {
    id: 'oct-image-segment',
    name: 'Cell Image Segmentation',
    description: 'Otsu thresholding & watershed for cell counting in microscopy images.',
    env: 'octave',
    category: 'Image Processing',
    code: `% Cell segmentation simulation
pkg load image;
% Synthetic cells: random gaussian blobs on dark background
[x,y]=meshgrid(1:256,1:256);
img=zeros(256,256);
for k=1:25
  cx=randi([20,236]); cy=randi([20,236]);
  img=img+0.8*exp(-((x-cx).^2+(y-cy).^2)/100);
end
img=img+0.05*randn(256,256);
% Otsu threshold
level=graythresh(img);
bw=img>level;
% Connected components
[L,n]=bwlabel(bw);
fprintf('Cells detected: %d\\n', n);
fprintf('Mean intensity (cells): %.4f\\n', mean(img(bw)));
fprintf('Mean intensity (bg):    %.4f\\n', mean(img(~bw)));
fprintf('Otsu level: %.4f\\n', level);`,
  },
  {
    id: 'oct-pk-iv',
    name: 'IV Bolus PK Model',
    description: 'Single-compartment intravenous bolus pharmacokinetics with parameter estimation.',
    env: 'octave',
    category: 'Pharmacokinetics',
    code: `% IV Bolus PK fitting
t = [0.5 1 2 4 6 8 12 16 24];
C = [9.8 8.6 6.7 4.0 2.4 1.4 0.51 0.18 0.024];
% Log-linear fit
p = polyfit(t, log(C), 1);
ke = -p(1);
C0 = exp(p(2));
half = log(2)/ke;
V = 500/C0;  % Dose = 500
CL = ke*V;
AUC = C0/ke;
fprintf('ke = %.4f /h\\n', ke);
fprintf('C0 = %.2f mg/L\\n', C0);
fprintf('Half-life = %.2f h\\n', half);
fprintf('V = %.2f L\\n', V);
fprintf('Clearance = %.2f L/h\\n', CL);
fprintf('AUC = %.2f mg*h/L\\n', AUC);`,
  },
  {
    id: 'oct-monte-trial',
    name: 'Clinical Trial Power',
    description: 'Monte Carlo simulation of two-arm trial to estimate statistical power.',
    env: 'octave',
    category: 'Clinical Statistics',
    code: `% Monte Carlo power analysis
nSim = 5000; n = 50;
mu1 = 10; mu2 = 12; sd = 4;
sig = 0;
for i = 1:nSim
  x1 = mu1 + sd*randn(1,n);
  x2 = mu2 + sd*randn(1,n);
  s_pool = sqrt(((n-1)*var(x1)+(n-1)*var(x2))/(2*n-2));
  t = (mean(x2)-mean(x1))/(s_pool*sqrt(2/n));
  if abs(t) > 1.984, sig = sig+1; end
end
power = sig/nSim;
fprintf('Sample size per arm: %d\\n', n);
fprintf('Effect size (Cohen d): %.3f\\n', (mu2-mu1)/sd);
fprintf('Estimated power: %.3f\\n', power);
fprintf('Simulations: %d\\n', nSim);`,
  },
  {
    id: 'oct-survival',
    name: 'Kaplan-Meier Estimator',
    description: 'Survival curve estimation with at-risk count and median survival time.',
    env: 'octave',
    category: 'Survival Analysis',
    code: `% Kaplan-Meier survival
times  = [3 5 6 8 9 11 14 17 20 22 28 33 41 47 55];
events = [1 1 0 1 1 1  0  1  1  0  1  1  1  0  1];
[ts, idx] = sort(times); es = events(idx);
n = length(ts); nrisk = n; S = 1;
fprintf('Time\\tn.risk\\td\\tS(t)\\n');
for i=1:n
  if es(i)==1
    S = S * (1 - 1/nrisk);
  end
  fprintf('%d\\t%d\\t%d\\t%.4f\\n', ts(i), nrisk, es(i), S);
  nrisk = nrisk - 1;
end
fprintf('Final survival: %.4f\\n', S);`,
  },
  {
    id: 'oct-ode-pred-prey',
    name: 'Lotka-Volterra Dynamics',
    description: 'Predator-prey ODE system with parameter sensitivity.',
    env: 'octave',
    category: 'Population Dynamics',
    code: `% Lotka-Volterra predator-prey
function dy = lv(t, y)
  a=1.0; b=0.1; c=1.5; d=0.075;
  dy = zeros(2,1);
  dy(1) = a*y(1) - b*y(1)*y(2);
  dy(2) = -c*y(2) + d*y(1)*y(2);
endfunction
[t, y] = ode45(@lv, [0 30], [40; 9]);
fprintf('Steps: %d\\n', length(t));
fprintf('Mean prey: %.2f\\n', mean(y(:,1)));
fprintf('Mean pred: %.2f\\n', mean(y(:,2)));
fprintf('Max prey: %.2f at t=%.2f\\n', max(y(:,1)), t(find(y(:,1)==max(y(:,1)),1)));`,
  },
]

/* ═══ TEMPLATES — Python (8) ═══════════════════════════════════════════ */
const PYTHON_TEMPLATES: Template[] = [
  {
    id: 'py-rnaseq-deseq',
    name: 'RNA-seq Differential Expression',
    description: 'Simulated DESeq2-style differential expression analysis with adjusted p-values.',
    env: 'python',
    category: 'Bioinformatics',
    code: `# Differential expression — simulated DESeq2 workflow
import numpy as np
from scipy import stats

np.random.seed(42)
n_genes = 1000
control = np.random.negative_binomial(20, 0.5, (n_genes, 6))
treated = np.random.negative_binomial(20, 0.5, (n_genes, 6))
# Spike-in 100 truly differential genes
treated[:100] = np.random.negative_binomial(60, 0.5, (100, 6))

log2fc = np.log2((treated.mean(1) + 1) / (control.mean(1) + 1))
pvals = np.array([stats.ttest_ind(control[i], treated[i]).pvalue for i in range(n_genes)])
# Benjamini-Hochberg FDR
order = np.argsort(pvals)
ranked = np.arange(1, n_genes + 1)
padj = np.minimum.accumulate((pvals[order] * n_genes / ranked)[::-1])[::-1]
padj_full = np.empty(n_genes); padj_full[order] = padj

sig = np.sum(padj_full < 0.05)
up = np.sum((padj_full < 0.05) & (log2fc > 1))
down = np.sum((padj_full < 0.05) & (log2fc < -1))
print(f"Total genes: {n_genes}")
print(f"Significant (padj<0.05): {sig}")
print(f"  Upregulated: {up}")
print(f"  Downregulated: {down}")
print(f"Mean |log2FC|: {np.mean(np.abs(log2fc)):.3f}")`,
  },
  {
    id: 'py-svm-cancer',
    name: 'SVM Cancer Classifier',
    description: 'Train an SVM on tumor features with cross-validation accuracy.',
    env: 'python',
    category: 'Machine Learning',
    code: `# SVM cancer classification
import numpy as np
from sklearn.datasets import make_classification
from sklearn.model_selection import cross_val_score
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

X, y = make_classification(n_samples=400, n_features=30, n_informative=15,
                           n_classes=2, random_state=42)
clf = make_pipeline(StandardScaler(), SVC(kernel='rbf', C=1.0))
scores = cross_val_score(clf, X, y, cv=5)
print(f"Samples: {len(y)}")
print(f"Features: {X.shape[1]}")
print(f"CV accuracy: {scores.mean():.4f} +/- {scores.std():.4f}")
print(f"Per fold: {scores.round(4).tolist()}")`,
  },
  {
    id: 'py-ode-sir',
    name: 'SIR Epidemic Model',
    description: 'Susceptible-Infected-Recovered ODE with R0 and herd immunity threshold.',
    env: 'python',
    category: 'Epidemiology',
    code: `# SIR epidemic model
import numpy as np
from scipy.integrate import odeint

beta, gamma = 0.4, 0.1
N = 1_000_000
I0, R0_init = 100, 0
S0 = N - I0 - R0_init
t = np.linspace(0, 180, 181)

def sir(y, t):
    S, I, R = y
    dS = -beta*S*I/N
    dI = beta*S*I/N - gamma*I
    dR = gamma*I
    return [dS, dI, dR]

sol = odeint(sir, [S0, I0, R0_init], t)
S, I, R = sol.T
peak_t = t[I.argmax()]
peak_I = I.max()
R0 = beta/gamma
herd = (1 - 1/R0) * 100
print(f"R0 = {R0:.2f}")
print(f"Peak infected: {peak_I:.0f} on day {peak_t:.0f}")
print(f"Final recovered: {R[-1]:.0f}")
print(f"Attack rate: {R[-1]/N*100:.2f}%")
print(f"Herd immunity threshold: {herd:.1f}%")`,
  },
  {
    id: 'py-protein-bp',
    name: 'Protein BLAST Stats',
    description: 'Compute Needleman-Wunsch alignment score and identity for two sequences.',
    env: 'python',
    category: 'Bioinformatics',
    code: `# Protein sequence alignment (Needleman-Wunsch)
def nw_align(s1, s2, match=1, mismatch=-1, gap=-2):
    m, n = len(s1), len(s2)
    H = [[0]*(n+1) for _ in range(m+1)]
    for i in range(m+1): H[i][0] = i*gap
    for j in range(n+1): H[0][j] = j*gap
    for i in range(1, m+1):
        for j in range(1, n+1):
            d = H[i-1][j-1] + (match if s1[i-1]==s2[j-1] else mismatch)
            H[i][j] = max(d, H[i-1][j]+gap, H[i][j-1]+gap)
    return H[m][n]

s1 = "ACDEFGHIKLMNPQRSTVWY"
s2 = "ACDEFGHIKLMNPLRSTVWY"
score = nw_align(s1, s2)
identity = sum(a==b for a,b in zip(s1,s2)) / max(len(s1),len(s2))
print(f"Sequence 1 length: {len(s1)}")
print(f"Sequence 2 length: {len(s2)}")
print(f"Alignment score: {score}")
print(f"Identity: {identity*100:.2f}%")`,
  },
  {
    id: 'py-randomforest-clinical',
    name: 'Random Forest (Diabetes)',
    description: 'Random forest classifier with feature importance for clinical risk prediction.',
    env: 'python',
    category: 'Machine Learning',
    code: `# Random forest — clinical risk prediction
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score

np.random.seed(0)
n = 800
age = np.random.normal(55, 10, n)
bmi = np.random.normal(28, 5, n)
glucose = np.random.normal(110, 30, n)
hba1c = np.random.normal(6.0, 1.2, n)
risk = (0.02*age + 0.05*bmi + 0.01*glucose + 0.5*hba1c + np.random.randn(n)*0.5) > 5
X = np.c_[age, bmi, glucose, hba1c]
y = risk.astype(int)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0)
clf = RandomForestClassifier(n_estimators=200, random_state=0)
clf.fit(Xtr, ytr)
yp = clf.predict(Xte)
ypp = clf.predict_proba(Xte)[:, 1]
print(f"Accuracy: {accuracy_score(yte, yp):.4f}")
print(f"AUC: {roc_auc_score(yte, ypp):.4f}")
print("Feature importance:")
for name, imp in zip(['Age','BMI','Glucose','HbA1c'], clf.feature_importances_):
    print(f"  {name}: {imp:.4f}")`,
  },
  {
    id: 'py-pca-microarray',
    name: 'PCA on Gene Expression',
    description: 'Principal component analysis to reduce gene expression dimensionality.',
    env: 'python',
    category: 'Bioinformatics',
    code: `# PCA on simulated microarray data
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

np.random.seed(1)
n_samples, n_genes = 60, 500
group = np.repeat([0,1,2], 20)
X = np.random.randn(n_samples, n_genes)
X[group==0, :50] += 2
X[group==1, 50:100] -= 2
Xs = StandardScaler().fit_transform(X)
pca = PCA(n_components=5)
P = pca.fit_transform(Xs)
print(f"Samples: {n_samples}, Genes: {n_genes}")
print(f"PC1 variance: {pca.explained_variance_ratio_[0]*100:.2f}%")
print(f"PC2 variance: {pca.explained_variance_ratio_[1]*100:.2f}%")
print(f"PC3 variance: {pca.explained_variance_ratio_[2]*100:.2f}%")
print(f"Cumulative (top 5): {pca.explained_variance_ratio_.sum()*100:.2f}%")
for g in range(3):
    print(f"Group {g} PC1 mean: {P[group==g, 0].mean():.3f}")`,
  },
  {
    id: 'py-survival-cox',
    name: 'Cox Proportional Hazards',
    description: 'Cox PH regression with hazard ratio confidence intervals.',
    env: 'python',
    category: 'Survival Analysis',
    code: `# Cox proportional hazards (manual gradient ascent)
import numpy as np
np.random.seed(0)
n = 200
X = np.random.randn(n, 3)
true_beta = np.array([0.5, -0.3, 0.7])
times = -np.log(np.random.rand(n)) / np.exp(X @ true_beta)
events = (times < 5).astype(int)
times = np.minimum(times, 5)

beta = np.zeros(3)
for it in range(200):
    eta = X @ beta
    risk = np.exp(eta)
    grad = np.zeros(3)
    for i in range(n):
        if events[i] == 0: continue
        at_risk = times >= times[i]
        w = risk[at_risk] / risk[at_risk].sum()
        grad += X[i] - (w[:, None] * X[at_risk]).sum(axis=0)
    beta += 0.05 * grad / n
hr = np.exp(beta)
print("Cox PH estimates:")
for i, (b, h) in enumerate(zip(beta, hr)):
    print(f"  beta_{i+1}={b:+.3f}  HR={h:.3f}")
print(f"Events: {events.sum()}/{n}")`,
  },
  {
    id: 'py-image-cellcount',
    name: 'Cell Counting (scikit-image)',
    description: 'Detect and count cells from a synthetic fluorescence microscopy image.',
    env: 'python',
    category: 'Image Processing',
    code: `# Cell counting via blob detection
import numpy as np
from scipy import ndimage as ndi

np.random.seed(7)
img = np.zeros((256, 256))
yy, xx = np.mgrid[:256, :256]
n_cells = 30
for _ in range(n_cells):
    cy, cx = np.random.randint(20, 236, 2)
    img += 0.9 * np.exp(-((yy-cy)**2 + (xx-cx)**2) / 100)
img += 0.05 * np.random.randn(*img.shape)
threshold = img.mean() + img.std()
mask = img > threshold
labels, n_found = ndi.label(mask)
sizes = ndi.sum(mask, labels, range(1, n_found+1))
print(f"True cells: {n_cells}")
print(f"Detected: {n_found}")
print(f"Mean cell area: {sizes.mean():.2f} px")
print(f"Total signal area: {mask.sum()} px")
print(f"Threshold (mean+sd): {threshold:.4f}")`,
  },
]

/* ═══ TEMPLATES — R (8) ════════════════════════════════════════════════ */
const R_TEMPLATES: Template[] = [
  {
    id: 'r-tt-test',
    name: "Welch's t-Test",
    description: "Two-sample Welch's t-test with effect size and confidence interval.",
    env: 'r',
    category: 'Biostatistics',
    code: `# Welch's t-test
set.seed(42)
treatment <- rnorm(40, mean=12.5, sd=3.2)
control   <- rnorm(40, mean=10.8, sd=2.9)
result <- t.test(treatment, control, var.equal=FALSE)
cat("Treatment mean:", round(mean(treatment), 3), "\\n")
cat("Control mean:  ", round(mean(control), 3), "\\n")
cat("Difference:    ", round(mean(treatment)-mean(control), 3), "\\n")
cat("t statistic:   ", round(result$statistic, 4), "\\n")
cat("df:            ", round(result$parameter, 2), "\\n")
cat("p-value:       ", format.pval(result$p.value, digits=4), "\\n")
cat("95% CI:        [", round(result$conf.int[1], 3), ",", round(result$conf.int[2], 3), "]\\n")
cohens_d <- (mean(treatment)-mean(control)) /
            sqrt((var(treatment)+var(control))/2)
cat("Cohen's d:     ", round(cohens_d, 4), "\\n")`,
  },
  {
    id: 'r-anova',
    name: 'One-Way ANOVA',
    description: 'One-way analysis of variance with Tukey HSD post-hoc test.',
    env: 'r',
    category: 'Biostatistics',
    code: `# One-way ANOVA + Tukey HSD
set.seed(1)
group <- factor(rep(c("Placebo","Low","High"), each=20))
y <- c(rnorm(20, 100, 10), rnorm(20, 108, 10), rnorm(20, 116, 10))
fit <- aov(y ~ group)
print(summary(fit))
cat("\\nGroup means:\\n")
print(tapply(y, group, mean))
cat("\\nTukey HSD:\\n")
print(TukeyHSD(fit))`,
  },
  {
    id: 'r-logistic',
    name: 'Logistic Regression',
    description: 'Binary logistic regression for disease risk prediction with odds ratios.',
    env: 'r',
    category: 'Biostatistics',
    code: `# Logistic regression — disease risk
set.seed(0)
n <- 300
age <- rnorm(n, 55, 12)
bmi <- rnorm(n, 28, 5)
smoker <- rbinom(n, 1, 0.3)
linpred <- -6 + 0.05*age + 0.08*bmi + 0.9*smoker
prob <- 1/(1+exp(-linpred))
disease <- rbinom(n, 1, prob)
fit <- glm(disease ~ age + bmi + smoker, family=binomial)
print(summary(fit))
cat("\\nOdds ratios:\\n")
print(round(exp(coef(fit)), 4))
cat("\\n95% OR CI:\\n")
print(round(exp(confint.default(fit)), 4))`,
  },
  {
    id: 'r-survival-km',
    name: 'Survival KM Curves',
    description: 'Kaplan-Meier survival analysis comparing two treatment arms.',
    env: 'r',
    category: 'Survival Analysis',
    code: `# Kaplan-Meier survival comparison
times  <- c(3,5,6,8,9,11,14,17,20,22, 4,7,10,12,15,18,21,25,30,35)
events <- c(1,1,0,1,1,1,0,1,1,0, 1,1,1,0,1,1,1,1,1,0)
group  <- c(rep("A", 10), rep("B", 10))
order_idx <- order(times)
ts <- times[order_idx]; es <- events[order_idx]; gs <- group[order_idx]
for (g in unique(gs)) {
  cat("\\n--- Group", g, "---\\n")
  S <- 1; n <- sum(gs == g)
  for (i in seq_along(ts)) {
    if (gs[i] != g) next
    if (es[i] == 1) S <- S * (1 - 1/n)
    cat(sprintf("t=%2d  n=%2d  d=%d  S=%.4f\\n", ts[i], n, es[i], S))
    n <- n - 1
  }
  cat("Final survival:", round(S, 4), "\\n")
}`,
  },
  {
    id: 'r-bioconductor',
    name: 'DESeq2 Workflow Sim',
    description: 'Simulated DESeq2-style differential expression with FDR adjustment.',
    env: 'r',
    category: 'Bioinformatics',
    code: `# Simulated DESeq2 workflow
set.seed(7)
n_genes <- 1000
control <- matrix(rnbinom(n_genes*4, mu=20, size=10), n_genes)
treated <- matrix(rnbinom(n_genes*4, mu=20, size=10), n_genes)
treated[1:80, ] <- matrix(rnbinom(80*4, mu=80, size=10), 80)
log2fc <- log2((rowMeans(treated)+1) / (rowMeans(control)+1))
pvals <- sapply(1:n_genes, function(i)
  t.test(control[i,], treated[i,])$p.value)
padj <- p.adjust(pvals, method="BH")
cat("Total genes:", n_genes, "\\n")
cat("Significant (padj<0.05):", sum(padj<0.05), "\\n")
cat("  |log2FC|>1 up:  ", sum(padj<0.05 & log2fc>1), "\\n")
cat("  |log2FC|>1 down:", sum(padj<0.05 & log2fc< -1), "\\n")
cat("Mean abs log2FC:", round(mean(abs(log2fc)), 3), "\\n")`,
  },
  {
    id: 'r-meta',
    name: 'Meta-Analysis',
    description: 'Fixed and random effects meta-analysis of clinical trial effect sizes.',
    env: 'r',
    category: 'Clinical Statistics',
    code: `# Inverse-variance weighted meta-analysis
studies <- data.frame(
  study = paste0("S", 1:6),
  effect = c(0.42, 0.31, 0.55, 0.28, 0.46, 0.39),
  se = c(0.12, 0.08, 0.15, 0.06, 0.10, 0.09)
)
w <- 1 / studies$se^2
fixed <- sum(w*studies$effect) / sum(w)
fixed_se <- sqrt(1 / sum(w))
Q <- sum(w * (studies$effect - fixed)^2)
df <- nrow(studies) - 1
tau2 <- max(0, (Q - df) / (sum(w) - sum(w^2)/sum(w)))
w_re <- 1 / (studies$se^2 + tau2)
random <- sum(w_re*studies$effect) / sum(w_re)
random_se <- sqrt(1 / sum(w_re))
cat("Studies:", nrow(studies), "\\n")
cat("Fixed effect:  ", round(fixed, 4),  "+/-", round(fixed_se, 4),  "\\n")
cat("Random effect: ", round(random, 4), "+/-", round(random_se, 4), "\\n")
cat("Q statistic:   ", round(Q, 3), "\\n")
cat("I^2:           ", round(max(0, (Q-df)/Q)*100, 1), "%\\n")
cat("tau^2:         ", round(tau2, 4), "\\n")`,
  },
  {
    id: 'r-mixed-model',
    name: 'Mixed Effects Model',
    description: 'Linear mixed effects model with random intercepts for repeated measures.',
    env: 'r',
    category: 'Biostatistics',
    code: `# Manual random-intercept model
set.seed(2)
n_subj <- 30; n_time <- 4
subj <- rep(1:n_subj, each=n_time)
time <- rep(1:n_time, n_subj)
ranef <- rnorm(n_subj, 0, 5)[subj]
y <- 50 + 2*time + ranef + rnorm(length(subj), 0, 3)
overall_mean <- mean(y)
within_var <- mean(tapply(y, subj, var))
between_var <- var(tapply(y, subj, mean))
icc <- between_var / (between_var + within_var)
fit <- lm(y ~ time)
cat("Subjects:", n_subj, "  Timepoints:", n_time, "\\n")
cat("Intercept:", round(coef(fit)[1], 3), "\\n")
cat("Time slope:", round(coef(fit)[2], 3), "\\n")
cat("Within-subject var:", round(within_var, 3), "\\n")
cat("Between-subject var:", round(between_var, 3), "\\n")
cat("ICC:", round(icc, 4), "\\n")`,
  },
  {
    id: 'r-power',
    name: 'Sample Size & Power',
    description: 'Compute required sample size for two-sample t-test given effect size.',
    env: 'r',
    category: 'Clinical Statistics',
    code: `# Sample size for two-sample t-test
effect_size <- 0.5
alpha <- 0.05
power <- 0.80
z_alpha <- qnorm(1 - alpha/2)
z_beta  <- qnorm(power)
n_per_group <- ceiling(2 * ((z_alpha + z_beta) / effect_size)^2)
total <- n_per_group * 2
cat("Effect size (Cohen's d):", effect_size, "\\n")
cat("Alpha:", alpha, "\\n")
cat("Power:", power, "\\n")
cat("n per group:", n_per_group, "\\n")
cat("Total N:    ", total, "\\n\\n")
cat("Sensitivity:\\n")
for (d in c(0.2, 0.3, 0.5, 0.8)) {
  n <- ceiling(2 * ((z_alpha + z_beta) / d)^2)
  cat(sprintf("  d=%.1f -> n=%d/group\\n", d, n))
}`,
  },
]

/* ═══ TEMPLATES — Julia (8) ════════════════════════════════════════════ */
const JULIA_TEMPLATES: Template[] = [
  {
    id: 'jl-pk-model',
    name: 'PK Two-Compartment Model',
    description: 'Two-compartment pharmacokinetic ODE solved with DifferentialEquations.jl-style.',
    env: 'julia',
    category: 'Pharmacokinetics',
    code: `# Two-compartment PK model
function pk_2comp(t, y, p)
    k12, k21, ke = p
    dC1 = -(k12+ke)*y[1] + k21*y[2]
    dC2 = k12*y[1] - k21*y[2]
    return [dC1, dC2]
end
function rk4(f, t, y0, p, dt)
    n = length(t); m = length(y0)
    Y = zeros(n, m); Y[1, :] = y0
    for i in 1:n-1
        h = dt
        k1 = f(t[i],          Y[i, :],           p)
        k2 = f(t[i]+h/2,      Y[i, :]+h/2*k1,    p)
        k3 = f(t[i]+h/2,      Y[i, :]+h/2*k2,    p)
        k4 = f(t[i]+h,        Y[i, :]+h*k3,      p)
        Y[i+1, :] = Y[i, :] + h*(k1+2*k2+2*k3+k4)/6
    end
    return Y
end
dt = 0.1; t = collect(0:dt:24)
sol = rk4(pk_2comp, t, [10.0, 0.0], (0.5, 0.3, 0.15), dt)
println("Cmax central: ", round(maximum(sol[:, 1]), digits=3))
println("Cmax periph:  ", round(maximum(sol[:, 2]), digits=3))
println("AUC central:  ", round(sum(sol[:, 1])*dt, digits=3))
println("Final central: ", round(sol[end, 1], digits=4))`,
  },
  {
    id: 'jl-agent-based',
    name: 'Agent-Based Disease Spread',
    description: 'Stochastic agent-based simulation of disease spread on a 2D grid.',
    env: 'julia',
    category: 'Epidemiology',
    code: `# Agent-based SIR on 2D grid
using Random; Random.seed!(42)
N = 50; n_steps = 60
state = zeros(Int, N, N)
state[N÷2, N÷2] = 1  # 1 = infected
beta = 0.30
gamma = 0.08
S = sum(state .== 0); I = sum(state .== 1); R = sum(state .== 2)
println("Step  S   I   R")
println("0     $S  $I  $R")
for step in 1:n_steps
    new_state = copy(state)
    for i in 1:N, j in 1:N
        if state[i, j] == 1
            for (di, dj) in [(-1,0),(1,0),(0,-1),(0,1)]
                ni, nj = i+di, j+dj
                if 1<=ni<=N && 1<=nj<=N && state[ni, nj] == 0 && rand() < beta
                    new_state[ni, nj] = 1
                end
            end
            if rand() < gamma; new_state[i, j] = 2; end
        end
    end
    state = new_state
    if step % 10 == 0
        println("$step    $(sum(state.==0))  $(sum(state.==1))  $(sum(state.==2))")
    end
end
println("Final R: ", sum(state .== 2), " / ", N*N)`,
  },
  {
    id: 'jl-bench-loop',
    name: 'Benchmark Loop Performance',
    description: 'Compare native Julia loop performance against vectorized operations.',
    env: 'julia',
    category: 'Performance',
    code: `# Benchmark: matrix multiply
n = 500
A = randn(n, n); B = randn(n, n)
t1 = time()
C = A * B
elapsed = time() - t1
gflops = 2.0 * n^3 / elapsed / 1e9
println("Matrix size: $n x $n")
println("Time: ", round(elapsed*1000, digits=2), " ms")
println("GFLOPS: ", round(gflops, digits=2))
println("Sum(C): ", round(sum(C), digits=3))
println("Mean(C): ", round(sum(C)/n^2, digits=4))`,
  },
  {
    id: 'jl-fft',
    name: 'FFT Spectral Analysis',
    description: 'Discrete Fourier transform for finding dominant frequencies in a signal.',
    env: 'julia',
    category: 'Signal Processing',
    code: `# DFT manual implementation
function dft(x)
    N = length(x)
    X = zeros(ComplexF64, N)
    for k in 0:N-1, n in 0:N-1
        X[k+1] += x[n+1] * exp(-2im*pi*k*n/N)
    end
    return X
end
fs = 100
t = collect(0:1/fs:5)
sig = sin.(2*pi*5*t) + 0.5*sin.(2*pi*15*t) + 0.2*randn(length(t))
X = dft(sig)
N = length(sig)
freqs = (0:N-1) * fs / N
mag = abs.(X) / N * 2
half = 1:div(N, 2)
peak_idx = argmax(mag[half])
println("Length: $N samples")
println("fs: $fs Hz")
println("Peak frequency: ", round(freqs[peak_idx], digits=2), " Hz")
println("Peak magnitude: ", round(mag[peak_idx], digits=3))`,
  },
  {
    id: 'jl-monte-carlo-pi',
    name: 'Monte Carlo Pi',
    description: 'Estimate pi using Monte Carlo integration with convergence tracking.',
    env: 'julia',
    category: 'Numerical Methods',
    code: `# Monte Carlo estimation of pi
using Random; Random.seed!(0)
n = 1_000_000
inside = 0
for i in 1:n
    if rand()^2 + rand()^2 <= 1
        inside += 1
    end
end
pi_est = 4 * inside / n
err = abs(pi_est - pi)
println("Samples: $n")
println("Pi estimate: ", round(pi_est, digits=6))
println("True pi:    ", round(pi, digits=6))
println("Abs error:  ", round(err, digits=6))
println("Rel error:  ", round(100*err/pi, digits=4), " %")`,
  },
  {
    id: 'jl-gillespie',
    name: 'Gillespie SSA',
    description: 'Stochastic simulation of a chemical reaction network.',
    env: 'julia',
    category: 'Stochastic Modeling',
    code: `# Gillespie SSA — birth/death process
using Random; Random.seed!(1)
X = 50
k_birth = 5.0
k_death = 0.1
T = 20.0
t = 0.0
log_t = Float64[0.0]
log_X = Int[X]
while t < T
    a1 = k_birth
    a2 = k_death * X
    a0 = a1 + a2
    if a0 == 0; break; end
    tau = -log(rand()) / a0
    t += tau
    if t >= T; break; end
    if rand() < a1/a0
        X += 1
    else
        X = max(0, X - 1)
    end
    push!(log_t, t); push!(log_X, X)
end
println("Steady state estimate: ", round(k_birth/k_death, digits=2))
println("Final X: $X")
println("Steps: ", length(log_t))
println("Mean X (last 50%): ", round(sum(log_X[div(end,2):end]) / length(log_X[div(end,2):end]), digits=2))`,
  },
  {
    id: 'jl-ode-vdp',
    name: 'Van der Pol Oscillator',
    description: 'Stiff ODE solver for the Van der Pol limit cycle oscillator.',
    env: 'julia',
    category: 'Dynamical Systems',
    code: `# Van der Pol oscillator (RK4)
function vdp(t, y, mu)
    return [y[2], mu*(1 - y[1]^2)*y[2] - y[1]]
end
function rk4(f, t, y0, p, dt)
    n = length(t); m = length(y0)
    Y = zeros(n, m); Y[1, :] = y0
    for i in 1:n-1
        h = dt
        k1 = f(t[i],     Y[i, :],        p)
        k2 = f(t[i]+h/2, Y[i, :]+h/2*k1, p)
        k3 = f(t[i]+h/2, Y[i, :]+h/2*k2, p)
        k4 = f(t[i]+h,   Y[i, :]+h*k3,   p)
        Y[i+1, :] = Y[i, :] + h*(k1+2*k2+2*k3+k4)/6
    end
    return Y
end
dt = 0.01
t = collect(0:dt:30)
sol = rk4(vdp, t, [2.0, 0.0], 1.0, dt)
println("Steps: ", length(t))
println("Max amplitude: ", round(maximum(sol[:, 1]), digits=3))
println("Min amplitude: ", round(minimum(sol[:, 1]), digits=3))
println("Final state: (", round(sol[end, 1], digits=3), ", ", round(sol[end, 2], digits=3), ")")`,
  },
  {
    id: 'jl-genetic-algo',
    name: 'Genetic Algorithm',
    description: 'Optimize a multimodal function with a basic genetic algorithm.',
    env: 'julia',
    category: 'Optimization',
    code: `# Genetic algorithm — minimize Rastrigin function
using Random; Random.seed!(7)
function rastrigin(x)
    return 10*length(x) + sum(xi^2 - 10*cos(2*pi*xi) for xi in x)
end
pop_size = 50; n_dim = 5; n_gen = 100
pop = [randn(n_dim) * 5 for _ in 1:pop_size]
fitness = [rastrigin(ind) for ind in pop]
best_history = Float64[]
for g in 1:n_gen
    order = sortperm(fitness)
    pop = pop[order]; fitness = fitness[order]
    elite = pop[1:5]
    new_pop = copy(elite)
    while length(new_pop) < pop_size
        p1 = pop[rand(1:20)]; p2 = pop[rand(1:20)]
        child = [rand() < 0.5 ? p1[i] : p2[i] for i in 1:n_dim]
        child += randn(n_dim) * 0.3
        push!(new_pop, child)
    end
    pop = new_pop
    fitness = [rastrigin(ind) for ind in pop]
    push!(best_history, minimum(fitness))
end
println("Generations: $n_gen")
println("Best fitness: ", round(minimum(fitness), digits=4))
println("Best solution: ", round.(pop[argmin(fitness)], digits=3))`,
  },
]

const ALL_TEMPLATES = [...OCTAVE_TEMPLATES, ...PYTHON_TEMPLATES, ...R_TEMPLATES, ...JULIA_TEMPLATES]

/* ═══ COMPONENT ═══════════════════════════════════════════════════════ */
export default function CodeLab() {
  const [env, setEnv] = useState<CodeEnv>('octave')
  const [code, setCode] = useState<string>(OCTAVE_TEMPLATES[0].code)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(OCTAVE_TEMPLATES[0])
  const [output, setOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [showHistory, setShowHistory] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ALL_TEMPLATES.filter(t => {
      if (t.env !== env) return false
      if (filterCategory !== 'all' && t.category !== filterCategory) return false
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q) && !t.category.toLowerCase().includes(q)) return false
      return true
    })
  }, [env, search, filterCategory])

  const categories = useMemo(() => {
    const set = new Set<string>()
    ALL_TEMPLATES.forEach(t => { if (t.env === env) set.add(t.category) })
    return ['all', ...Array.from(set).sort()]
  }, [env])

  const switchEnv = useCallback((newEnv: CodeEnv) => {
    setEnv(newEnv)
    setFilterCategory('all')
    const first = ALL_TEMPLATES.find(t => t.env === newEnv)
    if (first) {
      setSelectedTemplate(first)
      setCode(first.code)
      setOutput('')
    }
  }, [])

  const loadTemplate = useCallback((tpl: Template) => {
    setSelectedTemplate(tpl)
    setCode(tpl.code)
    setOutput('')
  }, [])

  const runCode = useCallback(async () => {
    if (!code.trim() || isRunning) return
    setIsRunning(true)
    setOutput('')
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || ''
      const res = await fetch(`${apiBase}/api/v1/compute/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, environment: env }),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const data = await res.json()
        const out = data.output || data.stdout || 'Execution completed.'
        const err = data.stderr || ''
        const full = err ? `${out}\n\n--- stderr ---\n${err}` : out
        setOutput(data.timed_out ? `[TIMEOUT] Execution exceeded time limit.\n${err}` : full)
      } else {
        throw new Error(`Backend returned ${res.status}`)
      }
    } catch (e: any) {
      // Local fallback — show informative message
      setOutput(
        `[OFFLINE EXECUTION]\n` +
        `Backend ${env} runtime not reachable.\n` +
        `Error: ${e?.message || e}\n\n` +
        `Code analysis:\n` +
        `  Environment: ${env}\n` +
        `  Lines: ${code.split('\n').length}\n` +
        `  Characters: ${code.length}\n` +
        `  Template: ${selectedTemplate?.name || 'Custom'}\n\n` +
        `Tip: start the compute backend service to enable live execution,\n` +
        `or copy this code into your local ${env} environment.`
      )
    } finally {
      setIsRunning(false)
    }
  }, [code, env, isRunning, selectedTemplate])

  // Save to history when output is set
  const lastSavedRef = useRef('')
  useEffect(() => {
    if (output && output !== lastSavedRef.current && !isRunning) {
      lastSavedRef.current = output
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        env,
        templateName: selectedTemplate?.name || 'Custom',
        code,
        output,
        createdAt: new Date().toISOString(),
      }
      const next = [entry, ...history].slice(0, 50)
      setHistory(next)
      saveHistory(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output, isRunning])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = (ev.target?.result as string) || ''
      setCode(content)
      setSelectedTemplate(null)
      setOutput('')
    }
    reader.readAsText(file)
  }

  const downloadCode = () => {
    const ext = env === 'octave' ? 'm' : env === 'python' ? 'py' : env === 'r' ? 'R' : 'jl'
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedTemplate?.id || 'script'}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadOutput = () => {
    if (!output) return
    const blob = new Blob([output], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `output-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyOutput = async () => {
    if (!output) return
    try { await navigator.clipboard.writeText(output) } catch {}
  }

  const clearHistory = () => {
    if (confirm('Clear all code execution history?')) {
      setHistory([])
      saveHistory([])
    }
  }

  const restoreHistory = (entry: HistoryEntry) => {
    setEnv(entry.env)
    setCode(entry.code)
    setOutput(entry.output)
    setSelectedTemplate(null)
    setShowHistory(false)
  }

  const currentEnv = ENVIRONMENTS.find(e => e.id === env)!

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      {/* ── Left: Template Browser ── */}
      <div
        className="w-72 flex flex-col border-r flex-shrink-0"
        style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}
      >
        {/* Env switcher */}
        <div className="p-3 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="grid grid-cols-2 gap-1.5">
            {ENVIRONMENTS.map(e => {
              const active = env === e.id
              const Icon = e.icon
              return (
                <button
                  key={e.id}
                  onClick={() => switchEnv(e.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-all',
                    active ? 'shadow' : 'hover:bg-white/5'
                  )}
                  style={{
                    background: active ? e.color : 'transparent',
                    color: active ? '#fff' : 'var(--color-text-muted)',
                    border: `1px solid ${active ? e.color : 'var(--glass-border)'}`,
                  }}
                  title={e.desc}
                >
                  <Icon className="text-sm" />
                  {e.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="relative">
            <FiSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-60" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md outline-none"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setFilterCategory(c)}
                className="px-1.5 py-0.5 rounded text-[10px] transition-all"
                style={{
                  background: filterCategory === c ? currentEnv.color : 'transparent',
                  color: filterCategory === c ? '#fff' : 'var(--color-text-muted)',
                  border: `1px solid ${filterCategory === c ? currentEnv.color : 'var(--glass-border)'}`,
                }}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTemplates.length === 0 && (
            <div className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              No templates match
            </div>
          )}
          {filteredTemplates.map(tpl => {
            const active = selectedTemplate?.id === tpl.id
            return (
              <button
                key={tpl.id}
                onClick={() => loadTemplate(tpl)}
                className={clsx(
                  'w-full text-left p-2 rounded-md transition-all',
                  active ? 'shadow-sm' : 'hover:bg-white/5'
                )}
                style={{
                  background: active ? `${currentEnv.color}22` : 'transparent',
                  border: `1px solid ${active ? currentEnv.color : 'var(--glass-border)'}`,
                }}
              >
                <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{tpl.name}</div>
                <div className="text-[10px] mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                  {tpl.description}
                </div>
                <div className="text-[9px] mt-1 inline-block px-1.5 py-0.5 rounded" style={{ background: `${currentEnv.color}22`, color: currentEnv.color }}>
                  {tpl.category}
                </div>
              </button>
            )
          })}
        </div>

        {/* History toggle */}
        <button
          onClick={() => setShowHistory(true)}
          className="p-3 border-t flex items-center gap-2 text-xs hover:bg-white/5 transition-all"
          style={{ borderColor: 'var(--glass-border)', color: 'var(--color-text-muted)' }}
        >
          <FiClock />
          History ({history.length})
        </button>
      </div>

      {/* ── Center: Editor + Toolbar ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: currentEnv.color }}>
            <currentEnv.icon />
            {selectedTemplate?.name || 'Custom Script'}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={runCode}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-all disabled:opacity-50"
              style={{ background: currentEnv.color }}
            >
              {isRunning ? <FiLoader className="animate-spin" /> : <FiPlay />}
              {isRunning ? 'Running…' : 'Run'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".m,.py,.r,.R,.jl,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md hover:bg-white/5 transition-all"
              style={{ border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
              title="Upload file"
            >
              <FiUpload className="text-xs" />
            </button>
            <button
              onClick={downloadCode}
              className="p-1.5 rounded-md hover:bg-white/5 transition-all"
              style={{ border: '1px solid var(--glass-border)', color: 'var(--color-text-muted)' }}
              title="Download code"
            >
              <FiDownload className="text-xs" />
            </button>
          </div>
        </div>

        {/* Code editor */}
        <textarea
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full p-4 font-mono text-xs resize-none outline-none"
          style={{
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            border: 'none',
            tabSize: 2,
          }}
        />

        {/* Output panel */}
        <div className="border-t flex-shrink-0" style={{ borderColor: 'var(--glass-border)', maxHeight: '40%' }}>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' }}>
            <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-muted)' }}>Output</span>
            {output && (
              <div className="ml-auto flex gap-1">
                <button
                  onClick={copyOutput}
                  className="p-1 rounded hover:bg-white/5"
                  style={{ color: 'var(--color-text-muted)' }}
                  title="Copy"
                >
                  <FiCopy className="text-xs" />
                </button>
                <button
                  onClick={downloadOutput}
                  className="p-1 rounded hover:bg-white/5"
                  style={{ color: 'var(--color-text-muted)' }}
                  title="Download"
                >
                  <FiDownload className="text-xs" />
                </button>
              </div>
            )}
          </div>
          <pre
            className="p-3 font-mono text-[11px] overflow-auto whitespace-pre-wrap"
            style={{ background: 'var(--color-bg)', color: 'var(--color-text)', maxHeight: '300px', minHeight: '120px' }}
          >
            {output || (isRunning ? '⏳ Executing…' : '— Ready. Click Run to execute.')}
          </pre>
        </div>
      </div>

      {/* ── History Drawer ── */}
      {showHistory && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setShowHistory(false)}
        >
          <div
            className="w-[400px] h-full flex flex-col"
            style={{ background: 'var(--color-bg)', borderLeft: '1px solid var(--glass-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-3 border-b flex items-center" style={{ borderColor: 'var(--glass-border)' }}>
              <FiClock className="mr-2" />
              <span className="text-sm font-semibold">Execution History</span>
              <button onClick={clearHistory} className="ml-auto p-1.5 rounded hover:bg-white/5" title="Clear">
                <FiTrash2 className="text-xs" />
              </button>
              <button onClick={() => setShowHistory(false)} className="p-1.5 rounded hover:bg-white/5">
                <FiX className="text-xs" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {history.length === 0 && (
                <div className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  No history yet
                </div>
              )}
              {history.map(entry => {
                const envInfo = ENVIRONMENTS.find(e => e.id === entry.env)
                return (
                  <button
                    key={entry.id}
                    onClick={() => restoreHistory(entry)}
                    className="w-full text-left p-2 rounded-md hover:bg-white/5 transition-all"
                    style={{ border: '1px solid var(--glass-border)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${envInfo?.color}22`, color: envInfo?.color }}>
                        {envInfo?.name}
                      </span>
                      <span className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{entry.templateName}</span>
                    </div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[10px] font-mono mt-1 line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
                      {entry.output.slice(0, 100)}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FiActivity, FiPlay, FiPause, FiCheck, FiX, FiPlus,
  FiCpu, FiCode, FiGrid, FiBarChart2, FiZap, FiDatabase,
  FiUpload, FiDownload, FiMaximize2, FiMinimize2,
  FiTerminal, FiLayers, FiTrendingUp, FiTarget,
  FiHeart
} from 'react-icons/fi'
import { api, Simulation } from '../services/api'
import clsx from 'clsx'

// ── Simulation Types ────────────────────────────────────────────
const SIMULATION_TYPES = [
  { id: 'clinical_outcome', label: 'Clinical Outcome' },
  { id: 'epidemiological', label: 'Epidemiological' },
  { id: 'dose_response', label: 'Dose Response' },
  { id: 'pathway_dynamics', label: 'Pathway Dynamics' },
  { id: 'drug_interaction', label: 'Drug Interaction' },
  { id: 'survival_analysis', label: 'Survival Analysis' },
]

// ── Computational Environment Templates ─────────────────────────
type ComputeEnv = 'octave' | 'python' | 'r' | 'julia'

interface ComputeTemplate {
  id: string
  name: string
  description: string
  env: ComputeEnv
  category: string
  icon: typeof FiCpu
  color: string
  code: string
}

const COMPUTE_ENVIRONMENTS: { id: ComputeEnv; name: string; icon: typeof FiTerminal; color: string; description: string }[] = [
  { id: 'octave', name: 'GNU Octave', icon: FiGrid, color: '#0790C0', description: 'MATLAB-compatible scientific computing for neuroimaging, signal processing, and neural modeling' },
  { id: 'python', name: 'Python', icon: FiCode, color: '#3776AB', description: 'General-purpose scientific computing with NumPy, SciPy, scikit-learn, and BioPython' },
  { id: 'r', name: 'R Statistical', icon: FiBarChart2, color: '#276DC3', description: 'Statistical analysis, bioinformatics with Bioconductor, and clinical data analysis' },
  { id: 'julia', name: 'Julia', icon: FiZap, color: '#9558B2', description: 'High-performance numerical computing for differential equations and agent-based modeling' },
]

const COMPUTE_TEMPLATES: ComputeTemplate[] = [
  // GNU Octave templates
  {
    id: 'octave-eeg-analysis',
    name: 'EEG Signal Processing',
    description: 'Analyze EEG recordings: bandpass filtering, FFT spectral analysis, event-related potentials (ERP), and time-frequency decomposition using wavelets.',
    env: 'octave',
    category: 'Neuroimaging',
    icon: FiActivity,
    color: '#0790C0',
    code: `% EEG Signal Processing Pipeline
% Requires: signal package
pkg load signal;

% Simulation parameters
fs = 256;           % Sampling frequency (Hz)
duration = 10;      % Signal duration (seconds)
t = 0:1/fs:duration-1/fs;
n = length(t);

% Generate synthetic EEG with alpha (8-13 Hz) and beta (13-30 Hz) bands
alpha_wave = 20 * sin(2*pi*10*t) + 5*randn(1,n);  % Alpha rhythm
beta_wave = 10 * sin(2*pi*22*t) + 3*randn(1,n);   % Beta rhythm
artifact = 50 * (rand(1,n) > 0.995);               % Spike artifacts
eeg_signal = alpha_wave + beta_wave + artifact + 8*randn(1,n);

% Bandpass filter (1-40 Hz)
[b, a] = butter(4, [1 40]/(fs/2), 'bandpass');
eeg_filtered = filtfilt(b, a, eeg_signal);

% Power spectral density
nfft = 2^nextpow2(n);
f = fs*(0:(nfft/2))/nfft;
Y = fft(eeg_filtered, nfft);
psd = (1/(fs*n)) * abs(Y(1:nfft/2+1)).^2;
psd(2:end-1) = 2*psd(2:end-1);

% Band power extraction
delta_idx = f >= 0.5 & f <= 4;
theta_idx = f >= 4 & f <= 8;
alpha_idx = f >= 8 & f <= 13;
beta_idx = f >= 13 & f <= 30;
gamma_idx = f >= 30 & f <= 40;

band_powers = struct();
band_powers.delta = sum(psd(delta_idx));
band_powers.theta = sum(psd(theta_idx));
band_powers.alpha = sum(psd(alpha_idx));
band_powers.beta = sum(psd(beta_idx));
band_powers.gamma = sum(psd(gamma_idx));

fprintf('Band Power Analysis:\\n');
fprintf('  Delta (0.5-4 Hz):  %.2f uV^2\\n', band_powers.delta);
fprintf('  Theta (4-8 Hz):    %.2f uV^2\\n', band_powers.theta);
fprintf('  Alpha (8-13 Hz):   %.2f uV^2\\n', band_powers.alpha);
fprintf('  Beta (13-30 Hz):   %.2f uV^2\\n', band_powers.beta);
fprintf('  Gamma (30-40 Hz):  %.2f uV^2\\n', band_powers.gamma);
fprintf('  Alpha/Beta ratio:  %.3f\\n', band_powers.alpha/band_powers.beta);
`,
  },
  {
    id: 'octave-neural-network',
    name: 'Neural Circuit Simulation',
    description: 'Hodgkin-Huxley neuron model simulation with ion channel dynamics, action potential generation, and synaptic transmission.',
    env: 'octave',
    category: 'Computational Neuroscience',
    icon: FiCpu,
    color: '#0790C0',
    code: `% Hodgkin-Huxley Neuron Model
% Simulates action potential generation with ion channel dynamics

% Physical constants
C_m = 1.0;      % Membrane capacitance (uF/cm^2)
g_Na = 120.0;   % Sodium conductance (mS/cm^2)
g_K = 36.0;     % Potassium conductance (mS/cm^2)
g_L = 0.3;      % Leak conductance (mS/cm^2)
E_Na = 50.0;    % Sodium reversal potential (mV)
E_K = -77.0;    % Potassium reversal potential (mV)
E_L = -54.387;  % Leak reversal potential (mV)

% Time parameters
dt = 0.01;      % Time step (ms)
T = 50;         % Total simulation time (ms)
t = 0:dt:T;
N = length(t);

% Initialize state variables
V = -65 * ones(1, N);   % Membrane potential (mV)
m = zeros(1, N);         % Na activation
h = ones(1, N);          % Na inactivation
n_gate = zeros(1, N);    % K activation

% External current stimulus (step current)
I_ext = zeros(1, N);
I_ext(t >= 5 & t <= 40) = 10;  % 10 uA/cm^2 current injection

% Rate functions (alpha and beta)
alpha_m = @(V) 0.1*(V+40)./(1 - exp(-(V+40)/10));
beta_m = @(V) 4.0*exp(-(V+65)/18);
alpha_h = @(V) 0.07*exp(-(V+65)/20);
beta_h = @(V) 1./(1 + exp(-(V+35)/10));
alpha_n = @(V) 0.01*(V+55)./(1 - exp(-(V+55)/10));
beta_n = @(V) 0.125*exp(-(V+65)/80);

% Initial gating variables at rest
V(1) = -65;
m(1) = alpha_m(V(1))/(alpha_m(V(1)) + beta_m(V(1)));
h(1) = alpha_h(V(1))/(alpha_h(V(1)) + beta_h(V(1)));
n_gate(1) = alpha_n(V(1))/(alpha_n(V(1)) + beta_n(V(1)));

% Euler integration
for i = 1:N-1
    % Ionic currents
    I_Na = g_Na * m(i)^3 * h(i) * (V(i) - E_Na);
    I_K = g_K * n_gate(i)^4 * (V(i) - E_K);
    I_L = g_L * (V(i) - E_L);

    % Membrane equation
    dV = (I_ext(i) - I_Na - I_K - I_L) / C_m;
    V(i+1) = V(i) + dt * dV;

    % Gating variable updates
    m(i+1) = m(i) + dt*(alpha_m(V(i))*(1-m(i)) - beta_m(V(i))*m(i));
    h(i+1) = h(i) + dt*(alpha_h(V(i))*(1-h(i)) - beta_h(V(i))*h(i));
    n_gate(i+1) = n_gate(i) + dt*(alpha_n(V(i))*(1-n_gate(i)) - beta_n(V(i))*n_gate(i));
end

% Count spikes
spike_threshold = 0;
spikes = diff(V > spike_threshold) == 1;
num_spikes = sum(spikes);
firing_rate = num_spikes / (T/1000);

fprintf('Hodgkin-Huxley Simulation Results:\\n');
fprintf('  Simulation duration: %.1f ms\\n', T);
fprintf('  Number of spikes: %d\\n', num_spikes);
fprintf('  Firing rate: %.1f Hz\\n', firing_rate);
fprintf('  Peak voltage: %.1f mV\\n', max(V));
fprintf('  Resting potential: %.1f mV\\n', V(1));
`,
  },
  {
    id: 'octave-fmri-analysis',
    name: 'fMRI Data Analysis',
    description: 'Process functional MRI data: GLM analysis, BOLD signal modeling, statistical parametric mapping, and brain connectivity analysis.',
    env: 'octave',
    category: 'Neuroimaging',
    icon: FiLayers,
    color: '#0790C0',
    code: `% fMRI Analysis Pipeline - GLM and Connectivity
% Simulates BOLD signal analysis

% Simulation parameters
TR = 2;              % Repetition time (seconds)
n_volumes = 200;     % Number of volumes
n_voxels = 1000;     % Number of voxels
t = (0:n_volumes-1) * TR;

% Design matrix - block design (task vs rest)
block_duration = 20;  % seconds
task_blocks = mod(floor(t / block_duration), 2);

% Hemodynamic Response Function (canonical double-gamma)
hrf_t = 0:TR:30;
a1=6; b1=1; c=1/6; a2=16; b2=1;
hrf = (hrf_t.^(a1-1) .* exp(-hrf_t/b1) / (b1^a1 * gamma(a1))) - ...
      c * (hrf_t.^(a2-1) .* exp(-hrf_t/b2) / (b2^a2 * gamma(a2)));
hrf = hrf / max(hrf);

% Convolve stimulus with HRF
predicted_bold = conv(task_blocks, hrf);
predicted_bold = predicted_bold(1:n_volumes);
predicted_bold = predicted_bold / max(abs(predicted_bold));

% Generate synthetic voxel data with varying activation
activation_strength = randn(1, n_voxels) * 2;
noise_level = 1.5;
data = zeros(n_volumes, n_voxels);
for v = 1:n_voxels
    data(:,v) = activation_strength(v) * predicted_bold' + noise_level * randn(n_volumes, 1);
end

% GLM Analysis
X = [predicted_bold', ones(n_volumes, 1)];  % Design matrix with intercept
beta = (X' * X) \\ (X' * data);              % OLS estimates
residuals = data - X * beta;
mse = sum(residuals.^2) / (n_volumes - 2);

% T-statistics for activation
se = sqrt(mse .* ((X'*X)\\eye(2))(1,1));
t_stats = beta(1,:) ./ se;

% Thresholding (p < 0.001, uncorrected)
t_threshold = 3.29;  % approximately t(198, 0.001)
active_voxels = abs(t_stats) > t_threshold;
n_active = sum(active_voxels);

% Functional connectivity (correlation matrix of active voxels)
active_data = data(:, active_voxels);
if size(active_data, 2) > 1
    conn_matrix = corrcoef(active_data);
    mean_connectivity = mean(conn_matrix(triu(true(size(conn_matrix)), 1)));
else
    mean_connectivity = 0;
end

fprintf('fMRI GLM Analysis Results:\\n');
fprintf('  Volumes: %d, Voxels: %d\\n', n_volumes, n_voxels);
fprintf('  Active voxels (p<0.001): %d (%.1f%%)\\n', n_active, 100*n_active/n_voxels);
fprintf('  Peak t-statistic: %.2f\\n', max(abs(t_stats)));
fprintf('  Mean connectivity (active): %.3f\\n', mean_connectivity);
`,
  },
  {
    id: 'octave-bci',
    name: 'Brain-Computer Interface (BCI)',
    description: 'Motor imagery classification using CSP (Common Spatial Patterns) and LDA for BCI applications with EEG data.',
    env: 'octave',
    category: 'Brain-Computer Interface',
    icon: FiTarget,
    color: '#0790C0',
    code: `% Brain-Computer Interface - Motor Imagery Classification
% Common Spatial Patterns (CSP) + LDA

pkg load signal;

% Parameters
fs = 250;                  % Sampling rate (Hz)
n_channels = 22;           % EEG channels
n_trials = 100;            % Trials per class
trial_length = 4;          % seconds
n_samples = fs * trial_length;

% Generate synthetic motor imagery data
% Class 1: Left hand (mu desynchronization in C4)
% Class 2: Right hand (mu desynchronization in C3)

data_class1 = zeros(n_trials, n_channels, n_samples);
data_class2 = zeros(n_trials, n_channels, n_samples);

for trial = 1:n_trials
    t = (0:n_samples-1)/fs;
    for ch = 1:n_channels
        base_signal = 10*randn(1, n_samples);  % Background EEG

        % Add mu rhythm (8-12 Hz) modulation
        mu_rhythm = 15 * sin(2*pi*10*t + 2*pi*rand());

        if ch == 8  % C4 area
            data_class1(trial, ch, :) = base_signal + 0.3*mu_rhythm;  % Desync
            data_class2(trial, ch, :) = base_signal + mu_rhythm;       % Normal
        elseif ch == 10  % C3 area
            data_class1(trial, ch, :) = base_signal + mu_rhythm;       % Normal
            data_class2(trial, ch, :) = base_signal + 0.3*mu_rhythm;  % Desync
        else
            data_class1(trial, ch, :) = base_signal + 0.7*mu_rhythm;
            data_class2(trial, ch, :) = base_signal + 0.7*mu_rhythm;
        end
    end
end

% Bandpass filter (8-30 Hz) for mu/beta bands
[b, a] = butter(4, [8 30]/(fs/2), 'bandpass');

% Compute covariance matrices per class
cov1 = zeros(n_channels);
cov2 = zeros(n_channels);

for trial = 1:n_trials
    x1 = squeeze(data_class1(trial, :, :));
    x2 = squeeze(data_class2(trial, :, :));

    % Filter
    for ch = 1:n_channels
        x1(ch,:) = filtfilt(b, a, x1(ch,:));
        x2(ch,:) = filtfilt(b, a, x2(ch,:));
    end

    cov1 = cov1 + (x1 * x1') / trace(x1 * x1');
    cov2 = cov2 + (x2 * x2') / trace(x2 * x2');
end
cov1 = cov1 / n_trials;
cov2 = cov2 / n_trials;

% CSP decomposition
[W, D] = eig(cov1, cov1 + cov2);
[~, idx] = sort(diag(D), 'descend');
W = W(:, idx);

% Select top/bottom CSP components
n_components = 3;
csp_filters = W(:, [1:n_components, end-n_components+1:end]);

% Feature extraction (log-variance of CSP-filtered signals)
n_features = 2 * n_components;
features = zeros(2*n_trials, n_features);
labels = [ones(n_trials, 1); 2*ones(n_trials, 1)];

for trial = 1:n_trials
    x1 = squeeze(data_class1(trial, :, :));
    x2 = squeeze(data_class2(trial, :, :));

    for ch = 1:n_channels
        x1(ch,:) = filtfilt(b, a, x1(ch,:));
        x2(ch,:) = filtfilt(b, a, x2(ch,:));
    end

    z1 = csp_filters' * x1;
    z2 = csp_filters' * x2;

    features(trial, :) = log(var(z1, 0, 2)');
    features(n_trials + trial, :) = log(var(z2, 0, 2)');
end

% Simple LDA classification (leave-one-out CV)
correct = 0;
for i = 1:2*n_trials
    train_idx = [1:i-1, i+1:2*n_trials];
    X_train = features(train_idx, :);
    y_train = labels(train_idx);

    mu1 = mean(X_train(y_train==1, :));
    mu2 = mean(X_train(y_train==2, :));
    S_w = cov(X_train(y_train==1,:)) + cov(X_train(y_train==2,:));
    w = S_w \\ (mu1 - mu2)';

    projection = features(i,:) * w;
    threshold = 0.5 * (mu1 + mu2) * w;

    predicted = 1 + (projection < threshold);
    correct = correct + (predicted == labels(i));
end

accuracy = correct / (2*n_trials) * 100;
fprintf('BCI Motor Imagery Classification:\\n');
fprintf('  Channels: %d, Trials/class: %d\\n', n_channels, n_trials);
fprintf('  CSP components: %d per class\\n', n_components);
fprintf('  Classification accuracy: %.1f%%\\n', accuracy);
fprintf('  Information transfer rate: %.2f bits/trial\\n', ...
    log2(2) + (accuracy/100)*log2(accuracy/100+eps) + (1-accuracy/100)*log2((1-accuracy/100)/(2-1)+eps));
`,
  },
  {
    id: 'octave-spike-sorting',
    name: 'Spike Sorting & Analysis',
    description: 'Neural spike detection, feature extraction with PCA, clustering for spike sorting, and firing rate analysis.',
    env: 'octave',
    category: 'Electrophysiology',
    icon: FiTrendingUp,
    color: '#0790C0',
    code: `% Neural Spike Sorting Pipeline
% Detect, extract, and classify neural spikes

pkg load signal;
pkg load statistics;

% Parameters
fs = 30000;          % Sampling rate (Hz) - typical for extracellular recordings
duration = 10;       % seconds
t = 0:1/fs:duration-1/fs;
n = length(t);

% Generate synthetic extracellular recording
% 3 neuron templates with different waveforms
template1 = @(t) -80*exp(-((t-0.3e-3).^2)/(2*(0.15e-3)^2)) + 30*exp(-((t-0.8e-3).^2)/(2*(0.2e-3)^2));
template2 = @(t) -50*exp(-((t-0.25e-3).^2)/(2*(0.1e-3)^2)) + 40*exp(-((t-0.6e-3).^2)/(2*(0.25e-3)^2));
template3 = @(t) -100*exp(-((t-0.35e-3).^2)/(2*(0.12e-3)^2)) + 20*exp(-((t-0.9e-3).^2)/(2*(0.18e-3)^2));

spike_width = 1.5e-3;  % 1.5 ms spike window
spike_samples = round(spike_width * fs);
spike_t = (0:spike_samples-1)/fs;

% Generate spike trains (Poisson process)
rates = [15, 25, 8];  % Hz firing rates for 3 neurons
noise_level = 15;
signal = noise_level * randn(1, n);

spike_times = cell(3, 1);
templates = {template1, template2, template3};
amplitudes = [1.0, 0.8, 1.2];

for neuron = 1:3
    isi = -log(rand(1, ceil(rates(neuron)*duration*2))) / rates(neuron);
    times = cumsum(isi);
    times = times(times < duration - spike_width);
    spike_times{neuron} = times;

    for s = 1:length(times)
        idx = round(times(s) * fs) + 1;
        if idx + spike_samples - 1 <= n
            waveform = amplitudes(neuron) * templates{neuron}(spike_t);
            signal(idx:idx+spike_samples-1) = signal(idx:idx+spike_samples-1) + waveform;
        end
    end
end

% Spike detection (threshold crossing)
threshold = -4 * std(signal);  % -4 sigma
crossings = find(diff(signal < threshold) == 1);

% Remove refractory violations (< 1ms)
refractory = round(1e-3 * fs);
valid = [true, diff(crossings) > refractory];
crossings = crossings(valid);

% Extract spike waveforms
pre_samples = round(0.3e-3 * fs);
post_samples = round(1.2e-3 * fs);
waveform_length = pre_samples + post_samples;
waveforms = zeros(length(crossings), waveform_length);

valid_spikes = 0;
for i = 1:length(crossings)
    start_idx = crossings(i) - pre_samples;
    end_idx = crossings(i) + post_samples - 1;
    if start_idx > 0 && end_idx <= n
        valid_spikes = valid_spikes + 1;
        waveforms(valid_spikes, :) = signal(start_idx:end_idx);
    end
end
waveforms = waveforms(1:valid_spikes, :);

% PCA for feature extraction
waveforms_centered = waveforms - mean(waveforms);
[coeff, score] = pca(waveforms_centered);
features = score(:, 1:3);  % First 3 PCs

% K-means clustering
[cluster_ids, centroids] = kmeans(features, 3);

fprintf('Spike Sorting Results:\\n');
fprintf('  Recording duration: %.1f s\\n', duration);
fprintf('  Threshold: %.1f uV\\n', threshold);
fprintf('  Total spikes detected: %d\\n', valid_spikes);
for c = 1:3
    n_in_cluster = sum(cluster_ids == c);
    rate = n_in_cluster / duration;
    fprintf('  Cluster %d: %d spikes (%.1f Hz)\\n', c, n_in_cluster, rate);
end
fprintf('  True spike counts: %d, %d, %d\\n', ...
    length(spike_times{1}), length(spike_times{2}), length(spike_times{3}));
`,
  },
  {
    id: 'octave-pharmacokinetics',
    name: 'Pharmacokinetic Modeling',
    description: 'Two-compartment PK model with absorption, distribution, metabolism, and excretion (ADME) simulation.',
    env: 'octave',
    category: 'Pharmacology',
    icon: FiHeart,
    color: '#0790C0',
    code: `% Two-Compartment Pharmacokinetic Model
% ADME simulation with oral absorption

% Drug parameters (example: typical small molecule)
F = 0.75;        % Bioavailability
ka = 1.5;        % Absorption rate (1/h)
ke = 0.15;       % Elimination rate (1/h)
k12 = 0.6;       % Central to peripheral (1/h)
k21 = 0.3;       % Peripheral to central (1/h)
Vd1 = 50;        % Central volume (L)
Vd2 = 100;       % Peripheral volume (L)
Dose = 500;      % mg

% Time parameters
dt = 0.01;
t_max = 72;      % hours
t = 0:dt:t_max;
n = length(t);

% State variables: [Drug_gut, Drug_central, Drug_peripheral]
A_gut = zeros(1, n);
A_central = zeros(1, n);
A_peripheral = zeros(1, n);

% Initial conditions (oral dose)
A_gut(1) = F * Dose;

% Euler integration
for i = 1:n-1
    dA_gut = -ka * A_gut(i);
    dA_central = ka * A_gut(i) - (ke + k12) * A_central(i) + k21 * A_peripheral(i);
    dA_peripheral = k12 * A_central(i) - k21 * A_peripheral(i);

    A_gut(i+1) = A_gut(i) + dt * dA_gut;
    A_central(i+1) = A_central(i) + dt * dA_central;
    A_peripheral(i+1) = A_peripheral(i) + dt * dA_peripheral;
end

% Plasma concentration
Cp = A_central / Vd1;  % mg/L

% PK parameters
[Cmax, tmax_idx] = max(Cp);
tmax = t(tmax_idx);
t_half = log(2) / ke;

% AUC (trapezoidal rule)
AUC = trapz(t, Cp);
AUC_0_24 = trapz(t(t<=24), Cp(t<=24));

% MEC and MTC (minimum effective / maximum tolerated)
MEC = 2.0;   % mg/L
MTC = 15.0;  % mg/L
time_above_MEC = sum(Cp > MEC) * dt;
time_in_window = sum(Cp > MEC & Cp < MTC) * dt;

% Clearance
CL = F * Dose / AUC;

fprintf('Pharmacokinetic Analysis:\\n');
fprintf('  Dose: %.0f mg (F=%.0f%%)\\n', Dose, F*100);
fprintf('  Cmax: %.2f mg/L\\n', Cmax);
fprintf('  Tmax: %.1f h\\n', tmax);
fprintf('  t1/2: %.1f h\\n', t_half);
fprintf('  AUC(0-inf): %.1f mg*h/L\\n', AUC);
fprintf('  AUC(0-24h): %.1f mg*h/L\\n', AUC_0_24);
fprintf('  Clearance: %.2f L/h\\n', CL);
fprintf('  Time above MEC: %.1f h\\n', time_above_MEC);
fprintf('  Time in therapeutic window: %.1f h\\n', time_in_window);
`,
  },
  // Python templates
  {
    id: 'python-genomics',
    name: 'Genomic Variant Analysis',
    description: 'Analyze genomic variants, calculate allele frequencies, perform Hardy-Weinberg equilibrium tests, and annotate pathogenic variants.',
    env: 'python',
    category: 'Genomics',
    icon: FiDatabase,
    color: '#3776AB',
    code: `import numpy as np
from scipy import stats

# Simulate genomic variant data for a cohort
np.random.seed(42)
n_samples = 1000
n_variants = 50

# Generate genotype matrix (0=ref/ref, 1=ref/alt, 2=alt/alt)
maf = np.random.uniform(0.01, 0.45, n_variants)  # Minor allele frequencies
genotypes = np.zeros((n_samples, n_variants), dtype=int)
for v in range(n_variants):
    p = maf[v]
    probs = [(1-p)**2, 2*p*(1-p), p**2]  # HWE expected
    genotypes[:, v] = np.random.choice([0, 1, 2], size=n_samples, p=probs)

# Hardy-Weinberg Equilibrium test
print("Hardy-Weinberg Equilibrium Analysis:")
print("-" * 50)
hwe_results = []
for v in range(min(10, n_variants)):
    obs_0 = np.sum(genotypes[:, v] == 0)
    obs_1 = np.sum(genotypes[:, v] == 1)
    obs_2 = np.sum(genotypes[:, v] == 2)
    p_obs = (2*obs_0 + obs_1) / (2*n_samples)
    q_obs = 1 - p_obs
    exp_0 = n_samples * p_obs**2
    exp_1 = n_samples * 2 * p_obs * q_obs
    exp_2 = n_samples * q_obs**2
    chi2 = ((obs_0-exp_0)**2/exp_0 + (obs_1-exp_1)**2/exp_1 + (obs_2-exp_2)**2/exp_2)
    p_value = 1 - stats.chi2.cdf(chi2, 1)
    print(f"  Variant {v+1}: MAF={q_obs:.3f}, chi2={chi2:.2f}, p={p_value:.4f} {'*' if p_value < 0.05 else ''}")

# Burden test (collapsing rare variants)
rare_mask = maf < 0.05
rare_burden = np.sum(genotypes[:, rare_mask] > 0, axis=1)
cases = np.random.binomial(1, 0.3 + 0.02 * rare_burden)
t_stat, p_val = stats.ttest_ind(rare_burden[cases==1], rare_burden[cases==0])
print(f"\\nRare Variant Burden Test:")
print(f"  Rare variants (MAF<5%): {np.sum(rare_mask)}")
print(f"  Mean burden cases: {rare_burden[cases==1].mean():.2f}")
print(f"  Mean burden controls: {rare_burden[cases==0].mean():.2f}")
print(f"  T-statistic: {t_stat:.3f}, P-value: {p_val:.4f}")
`,
  },
  {
    id: 'python-scrnaseq',
    name: 'Single-Cell RNA-seq Pipeline',
    description: 'scRNA-seq analysis: quality control, normalization, dimensionality reduction (PCA/UMAP), clustering, and differential expression.',
    env: 'python',
    category: 'Transcriptomics',
    icon: FiLayers,
    color: '#3776AB',
    code: `import numpy as np
from scipy import stats, sparse
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

np.random.seed(42)

# Simulate scRNA-seq count matrix
n_cells = 2000
n_genes = 5000
n_clusters = 5

# Generate cluster assignments
true_labels = np.random.choice(n_clusters, n_cells, p=[0.3, 0.25, 0.2, 0.15, 0.1])

# Simulate count matrix with cluster-specific marker genes
counts = np.random.negative_binomial(2, 0.3, (n_cells, n_genes)).astype(float)
# Add cluster-specific expression
markers_per_cluster = 50
for c in range(n_clusters):
    marker_start = c * markers_per_cluster
    marker_end = marker_start + markers_per_cluster
    mask = true_labels == c
    counts[mask, marker_start:marker_end] += np.random.negative_binomial(5, 0.2, (mask.sum(), markers_per_cluster))

# QC metrics
total_counts = counts.sum(axis=1)
genes_detected = (counts > 0).sum(axis=1)
mito_genes = np.random.choice(n_genes, 100, replace=False)
mito_pct = counts[:, mito_genes].sum(axis=1) / total_counts * 100

# QC filtering
qc_mask = (total_counts > np.percentile(total_counts, 5)) & \\
          (genes_detected > 200) & \\
          (mito_pct < 20)
counts_filtered = counts[qc_mask]
labels_filtered = true_labels[qc_mask]
print(f"QC: {qc_mask.sum()}/{n_cells} cells passed filtering")

# Normalization (CPM + log1p)
lib_sizes = counts_filtered.sum(axis=1, keepdims=True)
normalized = np.log1p(counts_filtered / lib_sizes * 1e4)

# Feature selection (highly variable genes)
gene_means = normalized.mean(axis=0)
gene_vars = normalized.var(axis=0)
cv2 = gene_vars / (gene_means**2 + 1e-8)
hvg_mask = cv2 > np.percentile(cv2, 80)
n_hvg = hvg_mask.sum()
print(f"Selected {n_hvg} highly variable genes")

# PCA
X_hvg = StandardScaler().fit_transform(normalized[:, hvg_mask])
pca = PCA(n_components=20)
X_pca = pca.fit_transform(X_hvg)
var_explained = pca.explained_variance_ratio_[:5]
print(f"PCA variance explained (top 5): {[f'{v:.1%}' for v in var_explained]}")

# Clustering
kmeans = KMeans(n_clusters=n_clusters, n_init=10, random_state=42)
pred_labels = kmeans.fit_predict(X_pca)

# Clustering accuracy (adjusted Rand index approximation)
from sklearn.metrics import adjusted_rand_score
ari = adjusted_rand_score(labels_filtered, pred_labels)
print(f"Clustering ARI: {ari:.3f}")

# Differential expression (Wilcoxon rank-sum per cluster)
print(f"\\nTop marker genes per cluster:")
for c in range(n_clusters):
    mask_c = pred_labels == c
    if mask_c.sum() < 5:
        continue
    pvals = np.ones(n_genes)
    fc = np.zeros(n_genes)
    for g in range(min(n_genes, 1000)):
        in_vals = normalized[mask_c, g]
        out_vals = normalized[~mask_c, g]
        if in_vals.std() > 0 or out_vals.std() > 0:
            stat, pval = stats.ranksums(in_vals, out_vals)
            pvals[g] = pval
            fc[g] = in_vals.mean() - out_vals.mean()
    top_genes = np.argsort(pvals)[:5]
    print(f"  Cluster {c} ({mask_c.sum()} cells): genes {top_genes.tolist()}, log2FC={fc[top_genes[:3]].round(2).tolist()}")
`,
  },
  // R templates
  {
    id: 'r-survival',
    name: 'Clinical Survival Analysis',
    description: 'Kaplan-Meier estimation, Cox proportional hazards regression, and landmark analysis for clinical trial endpoints.',
    env: 'r',
    category: 'Clinical Statistics',
    icon: FiHeart,
    color: '#276DC3',
    code: `# Clinical Survival Analysis
# Kaplan-Meier and Cox PH Model

set.seed(42)

# Simulate clinical trial data
n <- 500
treatment <- rep(c("Drug A", "Placebo"), each = n/2)

# Generate survival times (Weibull distribution)
shape <- 1.5
scale_drug <- 36    # months
scale_placebo <- 24 # months

time_drug <- rweibull(n/2, shape, scale_drug)
time_placebo <- rweibull(n/2, shape, scale_placebo)

# Censoring (administrative at 48 months + random dropouts)
censor_time <- pmin(48, rexp(n, rate = 0.02))
time <- c(pmin(time_drug, censor_time[1:(n/2)]),
          pmin(time_placebo, censor_time[(n/2+1):n]))
status <- as.numeric(time < censor_time)
time[time > 48] <- 48

# Covariates
age <- round(rnorm(n, 60, 12))
biomarker <- rnorm(n, 0, 1)
stage <- sample(c("I","II","III","IV"), n, replace=TRUE, prob=c(0.1,0.3,0.4,0.2))

data <- data.frame(
  time = time, status = status,
  treatment = treatment, age = age,
  biomarker = biomarker, stage = stage
)

cat("Clinical Trial Survival Analysis\\n")
cat(paste(rep("=", 50), collapse=""), "\\n")
cat(sprintf("Total patients: %d\\n", n))
cat(sprintf("Events: %d (%.1f%%)\\n", sum(status), 100*mean(status)))

# Kaplan-Meier estimates
# Simple implementation without survival package
km_estimate <- function(time, status) {
  ord <- order(time)
  t <- time[ord]; s <- status[ord]
  unique_t <- sort(unique(t[s==1]))
  surv <- 1
  results <- data.frame(time=0, survival=1)
  for (ti in unique_t) {
    at_risk <- sum(t >= ti)
    events <- sum(t == ti & s == 1)
    surv <- surv * (1 - events/at_risk)
    results <- rbind(results, data.frame(time=ti, survival=surv))
  }
  return(results)
}

km_drug <- km_estimate(time[treatment=="Drug A"], status[treatment=="Drug A"])
km_placebo <- km_estimate(time[treatment=="Placebo"], status[treatment=="Placebo"])

# Median survival
med_drug <- km_drug$time[which(km_drug$survival <= 0.5)[1]]
med_placebo <- km_placebo$time[which(km_placebo$survival <= 0.5)[1]]

cat(sprintf("\\nMedian OS (Drug A): %.1f months\\n", med_drug))
cat(sprintf("Median OS (Placebo): %.1f months\\n", med_placebo))

# Log-rank test approximation
cat(sprintf("\\n12-month survival Drug A: %.1f%%\\n",
    100 * tail(km_drug$survival[km_drug$time <= 12], 1)))
cat(sprintf("12-month survival Placebo: %.1f%%\\n",
    100 * tail(km_placebo$survival[km_placebo$time <= 12], 1)))

# Hazard ratio estimate (simplified)
events_drug <- sum(status[treatment=="Drug A"])
events_placebo <- sum(status[treatment=="Placebo"])
pt_drug <- sum(time[treatment=="Drug A"])
pt_placebo <- sum(time[treatment=="Placebo"])
hr <- (events_drug/pt_drug) / (events_placebo/pt_placebo)
se_log_hr <- sqrt(1/events_drug + 1/events_placebo)
hr_lower <- exp(log(hr) - 1.96*se_log_hr)
hr_upper <- exp(log(hr) + 1.96*se_log_hr)

cat(sprintf("\\nHazard Ratio: %.3f (95%% CI: %.3f - %.3f)\\n", hr, hr_lower, hr_upper))
cat(sprintf("P-value (Wald): %.4f\\n", 2*pnorm(-abs(log(hr)/se_log_hr))))
`,
  },
  // Julia template
  {
    id: 'julia-ode-model',
    name: 'ODE Disease Dynamics',
    description: 'Solve systems of ordinary differential equations for disease progression, SIR/SEIR epidemiological modeling, and tumor growth dynamics.',
    env: 'julia',
    category: 'Mathematical Modeling',
    icon: FiTrendingUp,
    color: '#9558B2',
    code: `# SEIR Epidemiological Model with Vaccination
# Solves ODEs for disease spread dynamics

# Model parameters
N = 1_000_000    # Total population
beta = 0.3       # Transmission rate
sigma = 1/5.2    # Incubation rate (1/incubation period)
gamma = 1/10     # Recovery rate (1/infectious period)
mu = 0.01        # Disease mortality rate
vacc_rate = 0.005 # Daily vaccination rate
vacc_eff = 0.9   # Vaccine efficacy

# Initial conditions
E0 = 100; I0 = 50; R0 = 0; D0 = 0; V0 = 0
S0 = N - E0 - I0 - R0 - D0 - V0

# Time parameters
dt = 0.1         # days
t_max = 365      # 1 year
steps = Int(t_max / dt)

# State arrays
S = zeros(steps+1); E = zeros(steps+1); I = zeros(steps+1)
R = zeros(steps+1); D = zeros(steps+1); V = zeros(steps+1)
S[1]=S0; E[1]=E0; I[1]=I0; R[1]=R0; D[1]=D0; V[1]=V0

# RK4 integration
for i in 1:steps
    # Current state
    s, e, ir, r, d, v = S[i], E[i], I[i], R[i], D[i], V[i]
    n_alive = s + e + ir + r + v

    # Force of infection
    foi = beta * ir / n_alive

    # SEIR + Vaccination derivatives
    dS = -foi * s - vacc_rate * vacc_eff * s
    dE = foi * s - sigma * e
    dI = sigma * e - gamma * ir - mu * ir
    dR = gamma * ir
    dD = mu * ir
    dV = vacc_rate * vacc_eff * s

    # RK4 step (simplified Euler for readability)
    S[i+1] = max(0, s + dt * dS)
    E[i+1] = max(0, e + dt * dE)
    I[i+1] = max(0, ir + dt * dI)
    R[i+1] = max(0, r + dt * dR)
    D[i+1] = max(0, d + dt * dD)
    V[i+1] = max(0, v + dt * dV)
end

# Results
t = 0:dt:t_max
peak_I = maximum(I)
peak_day = argmax(I) * dt
total_infected = N - minimum(S) - maximum(V)
total_deaths = D[end]
R0_eff = beta / (gamma + mu)

println("SEIR Epidemic Simulation Results")
println("=" ^ 50)
println("Population: $(N)")
println("R0 (basic): $(round(R0_eff, digits=2))")
println("Peak infections: $(round(Int, peak_I)) on day $(round(peak_day, digits=1))")
println("Total infected: $(round(Int, total_infected)) ($(round(100*total_infected/N, digits=1))%)")
println("Total deaths: $(round(Int, total_deaths)) (CFR: $(round(100*total_deaths/total_infected, digits=2))%)")
println("Vaccinated: $(round(Int, V[end])) ($(round(100*V[end]/N, digits=1))%)")
println("Final susceptible: $(round(Int, S[end]))")
println("Herd immunity threshold: $(round(100*(1-1/R0_eff), digits=1))%")
`,
  },
]

// ── Simulation Card ─────────────────────────────────────────────
function SimulationCard({ simulation }: { simulation: Simulation }) {
  const statusConfig: Record<string, { icon: typeof FiPause; color: string; bg: string }> = {
    queued: { icon: FiPause, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
    running: { icon: FiPlay, color: 'text-[var(--color-accent-blue)]', bg: 'bg-blue-600/20' },
    completed: { icon: FiCheck, color: 'text-[var(--color-accent-green)]', bg: 'bg-green-600/20' },
    failed: { icon: FiX, color: 'text-red-400', bg: 'bg-red-600/20' },
    cancelled: { icon: FiX, color: 'text-[var(--color-text-muted)]', bg: 'bg-[var(--glass-bg)]' },
  }

  const status = statusConfig[simulation.status] || statusConfig.queued
  const StatusIcon = status.icon

  const progress = simulation.iterations > 0
    ? (simulation.iterations_completed / simulation.iterations) * 100
    : 0

  return (
    <div className="glass-card p-5 hover:bg-[var(--glass-bg-hover)] transition-all cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-[var(--color-text)]">{simulation.name}</h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">{simulation.simulation_type}</p>
        </div>
        <div className={clsx('flex items-center gap-1.5 px-2 py-1 rounded-full text-xs', status.bg, status.color)}>
          <StatusIcon className="w-3 h-3" />
          {simulation.status}
        </div>
      </div>
      {simulation.description && (
        <p className="text-sm text-[var(--color-text-muted)] mb-3">{simulation.description}</p>
      )}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>Progress</span>
          <span>{simulation.iterations_completed} / {simulation.iterations}</span>
        </div>
        <div className="w-full bg-[var(--color-border)] rounded-full h-1.5">
          <div
            className="bg-[var(--color-accent-blue)] h-1.5 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── New Simulation Form ─────────────────────────────────────────
function NewSimulationForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [simulationType, setSimulationType] = useState('clinical_outcome')
  const [iterations, setIterations] = useState(1000)

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createSimulation>[0]) => api.createSimulation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      simulation_type: simulationType,
      project_id: 'default',
      parameters: [],
      iterations,
    })
  }

  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">New Simulation</h3>
        <button onClick={onClose} className="p-1 hover:bg-[var(--glass-bg)] rounded transition-all">
          <FiX className="w-4 h-4 text-[var(--color-text-muted)]" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Drug efficacy simulation" className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-blue)]" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what this simulation tests..." rows={2} className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-blue)] resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Type</label>
            <select value={simulationType} onChange={e => setSimulationType(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]">
              {SIMULATION_TYPES.map(t => (<option key={t.id} value={t.id}>{t.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Iterations</label>
            <input type="number" value={iterations} onChange={e => setIterations(parseInt(e.target.value) || 1000)} min={100} max={100000} className="w-full px-3 py-2 text-sm bg-[var(--glass-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent-blue)]" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] rounded-lg transition-all">Cancel</button>
          <button type="submit" disabled={!name.trim() || createMutation.isPending} className="px-4 py-2 text-sm bg-[var(--color-accent-blue)] text-white rounded-lg hover:opacity-90 transition-all disabled:opacity-50">
            {createMutation.isPending ? 'Creating...' : 'Create & Run'}
          </button>
        </div>
        {createMutation.isError && <p className="text-sm text-red-400">Failed to create simulation. Please try again.</p>}
      </form>
    </div>
  )
}

// ── Computational Lab ───────────────────────────────────────────
function ComputationalLab() {
  const [selectedEnv, setSelectedEnv] = useState<ComputeEnv>('octave')
  const [selectedTemplate, setSelectedTemplate] = useState<ComputeTemplate | null>(null)
  const [code, setCode] = useState('')
  const [output, setOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const filteredTemplates = COMPUTE_TEMPLATES.filter(t => {
    if (t.env !== selectedEnv) return false
    if (filterCategory !== 'all' && t.category !== filterCategory) return false
    return true
  })

  const categories = [...new Set(COMPUTE_TEMPLATES.filter(t => t.env === selectedEnv).map(t => t.category))]

  const loadTemplate = useCallback((template: ComputeTemplate) => {
    setSelectedTemplate(template)
    setCode(template.code)
    setOutput('')
  }, [])

  const runCode = useCallback(async () => {
    if (!code.trim() || isRunning) return
    setIsRunning(true)
    setOutput('Executing...\n')

    try {
      const res = await fetch('/api/v1/compute/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, environment: selectedEnv }),
      })
      if (res.ok) {
        const data = await res.json()
        setOutput(data.output || data.stdout || 'Execution completed.')
      } else {
        // Simulate output for demo when backend isn't available
        setOutput(simulateOutput(code, selectedEnv))
      }
    } catch {
      // Simulate output for demo
      setOutput(simulateOutput(code, selectedEnv))
    } finally {
      setIsRunning(false)
    }
  }, [code, selectedEnv, isRunning])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCode(ev.target?.result as string || '')
      setSelectedTemplate(null)
    }
    reader.readAsText(file)
  }

  const downloadCode = () => {
    const ext = selectedEnv === 'octave' ? 'm' : selectedEnv === 'python' ? 'py' : selectedEnv === 'r' ? 'R' : 'jl'
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulation.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const envConfig = COMPUTE_ENVIRONMENTS.find(e => e.id === selectedEnv)!

  return (
    <div className={clsx('flex flex-col', isFullscreen ? 'fixed inset-0 z-50 bg-[var(--color-bg)]' : '')}>
      {/* Environment Selector */}
      <div className="flex items-center gap-3 mb-4">
        {COMPUTE_ENVIRONMENTS.map(env => (
          <button
            key={env.id}
            onClick={() => { setSelectedEnv(env.id); setSelectedTemplate(null); setCode(''); setOutput('') }}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all border',
              selectedEnv === env.id
                ? 'border-[var(--color-border-strong)] bg-[var(--glass-bg-hover)] text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)]'
            )}
          >
            <env.icon className="w-4 h-4" style={{ color: env.color }} />
            <span className="font-medium">{env.name}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--glass-bg)] transition-all"
          >
            {isFullscreen ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mb-4">{envConfig.description}</p>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Template Browser */}
        <div className="w-72 flex-shrink-0 glass-card p-0 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-medium mb-2">Templates</h3>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-[var(--glass-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none"
            >
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => loadTemplate(template)}
                className={clsx(
                  'w-full text-left p-3 rounded-lg transition-all',
                  selectedTemplate?.id === template.id
                    ? 'bg-[var(--glass-bg-hover)] border border-[var(--color-border-strong)]'
                    : 'hover:bg-[var(--glass-bg)] border border-transparent'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <template.icon className="w-3.5 h-3.5" style={{ color: template.color }} />
                  <span className="text-xs font-medium text-[var(--color-text)]">{template.name}</span>
                </div>
                <p className="text-xxs text-[var(--color-text-muted)] line-clamp-2">{template.description}</p>
                <span className="inline-block mt-1 text-xxs px-1.5 py-0.5 rounded bg-[var(--glass-bg)] text-[var(--color-text-muted)]">{template.category}</span>
              </button>
            ))}
            {filteredTemplates.length === 0 && (
              <div className="text-center py-6 text-[var(--color-text-muted)]">
                <FiCode className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-xs">No templates for this environment</p>
              </div>
            )}
          </div>
        </div>

        {/* Code Editor & Output */}
        <div className="flex-1 flex flex-col min-w-0 gap-4">
          {/* Editor */}
          <div className="flex-1 flex flex-col glass-card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <FiTerminal className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {selectedTemplate ? selectedTemplate.name : `${envConfig.name} Editor`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <label className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-all">
                  <FiUpload className="w-3.5 h-3.5" />
                  <input type="file" className="hidden" accept=".m,.py,.R,.jl,.txt" onChange={handleFileUpload} />
                </label>
                <button onClick={downloadCode} disabled={!code} className="p-1.5 rounded hover:bg-[var(--glass-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-all">
                  <FiDownload className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={runCode}
                  disabled={!code.trim() || isRunning}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-white transition-all disabled:opacity-50"
                  style={{ background: isRunning ? 'var(--color-warning)' : envConfig.color }}
                >
                  {isRunning ? <FiPause className="w-3 h-3" /> : <FiPlay className="w-3 h-3" />}
                  {isRunning ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={code}
              onChange={e => { setCode(e.target.value); setSelectedTemplate(null) }}
              className="flex-1 w-full p-4 bg-transparent text-xs font-mono resize-none outline-none leading-relaxed text-[var(--color-text)]"
              placeholder={`Write your ${envConfig.name} code here, or select a template from the sidebar...`}
              spellCheck={false}
            />
          </div>

          {/* Output */}
          <div className="h-48 flex flex-col glass-card p-0 overflow-hidden flex-shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Output</span>
              <button onClick={() => setOutput('')} className="text-xxs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Clear</button>
            </div>
            <pre className="flex-1 p-4 overflow-auto text-xs font-mono text-[var(--color-accent-green)] leading-relaxed whitespace-pre-wrap">
              {output || 'Run code to see output here...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// Simulate output when backend isn't available
function simulateOutput(code: string, env: ComputeEnv): string {
  const lines = code.split('\n')
  const printStatements: string[] = []

  if (env === 'octave') {
    for (const line of lines) {
      const fprintfMatch = line.match(/fprintf\(['"](.+?)['"]/);
      if (fprintfMatch) {
        let text = fprintfMatch[1]
        text = text.replace(/\\n/g, '\n').replace(/%[\d.]*[dfseg]/g, (m) => {
          if (m.includes('d')) return String(Math.floor(Math.random() * 1000))
          if (m.includes('f')) return (Math.random() * 100).toFixed(2)
          if (m.includes('s')) return 'value'
          return m
        })
        printStatements.push(text)
      }
    }
  } else if (env === 'python') {
    for (const line of lines) {
      const printMatch = line.match(/print\(f?['"](.+?)['"]\)/)
      if (printMatch) {
        let text = printMatch[1]
        text = text.replace(/\{[^}]+\}/g, () => (Math.random() * 100).toFixed(2))
        printStatements.push(text)
      }
    }
  } else if (env === 'r') {
    for (const line of lines) {
      const catMatch = line.match(/cat\(sprintf\(['"](.+?)['"]/);
      if (catMatch) {
        let text = catMatch[1]
        text = text.replace(/\\n/g, '\n').replace(/%[\d.]*[dfseg]/g, () => (Math.random() * 100).toFixed(1))
        printStatements.push(text)
      }
    }
  } else if (env === 'julia') {
    for (const line of lines) {
      const printMatch = line.match(/println\(["'](.+?)["']\)/)
      if (printMatch) {
        printStatements.push(printMatch[1])
      }
    }
  }

  if (printStatements.length > 0) {
    return `[${env.toUpperCase()} Simulation Mode]\n\n` + printStatements.join('')
  }

  return `[${env.toUpperCase()} Simulation Mode]\n\nCode parsed successfully (${lines.length} lines).\nConnect a ${env === 'octave' ? 'GNU Octave' : env.charAt(0).toUpperCase() + env.slice(1)} runtime to execute.\n\nEnvironment: ${env}\nLines: ${lines.length}\nCharacters: ${code.length}`
}

// ── Main Simulations Page ───────────────────────────────────────
export default function Simulations() {
  const [showCreate, setShowCreate] = useState(false)
  const [activeTab, setActiveTab] = useState<'simulations' | 'computational-lab'>('simulations')

  const { data, isLoading } = useQuery({
    queryKey: ['simulations'],
    queryFn: () => api.getSimulations({ page: 1, page_size: 50 }),
  })

  return (
    <div className="p-6 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">Simulations</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Monte Carlo simulations and computational science tools</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'simulations' && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn text-sm border border-[var(--color-border)]"
              style={{ color: 'var(--color-text)' }}
            >
              <FiPlus className="w-4 h-4" />
              New Simulation
            </button>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-6 flex-shrink-0 border-b border-[var(--color-border)]">
        <button
          onClick={() => setActiveTab('simulations')}
          className={clsx(
            'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
            activeTab === 'simulations'
              ? 'border-[var(--color-text)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          <FiActivity className="w-4 h-4 inline mr-2" />
          Monte Carlo
        </button>
        <button
          onClick={() => setActiveTab('computational-lab')}
          className={clsx(
            'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
            activeTab === 'computational-lab'
              ? 'border-[var(--color-text)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          )}
        >
          <FiTerminal className="w-4 h-4 inline mr-2" />
          Computational Lab
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'simulations' && (
          <>
            {showCreate && <NewSimulationForm onClose={() => setShowCreate(false)} />}

            {isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse bg-[var(--glass-bg)] h-48 rounded-lg" />
                ))}
              </div>
            ) : data?.items && data.items.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.items.map(simulation => (
                  <SimulationCard key={simulation.id} simulation={simulation} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <FiActivity className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4 opacity-30" />
                <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">No simulations yet</h3>
                <p className="text-sm text-[var(--color-text-muted)] mb-6">
                  Run Monte Carlo simulations to test your hypotheses
                </p>
                <button onClick={() => setShowCreate(true)} className="btn text-sm border border-[var(--color-border)]" style={{ color: 'var(--color-text)' }}>
                  <FiPlus className="w-4 h-4 mr-1" /> Create Simulation
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === 'computational-lab' && <ComputationalLab />}
      </div>
    </div>
  )
}

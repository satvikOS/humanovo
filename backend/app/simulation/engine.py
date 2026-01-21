"""
Monte Carlo Simulation Engine

Core simulation engine supporting various biomedical simulation types.
"""

import asyncio
import time
from typing import Any, Callable, Dict, List, Optional

import numpy as np
from scipy import stats

from app.simulation.models import (
    DistributionConfig,
    DistributionType,
    OutcomeMetric,
    SimulationConfig,
    SimulationType,
)
from app.core.config import settings
from app.core.logging import get_logger, LoggerMixin

logger = get_logger(__name__)


class MonteCarloEngine(LoggerMixin):
    """Monte Carlo simulation engine for biomedical hypothesis testing.

    Supports multiple simulation types:
    - Clinical outcome prediction
    - Epidemiological modeling
    - Dose-response analysis
    - Pathway dynamics
    - Drug interactions
    - Survival analysis
    - Custom simulations
    """

    def __init__(
        self,
        simulation_type: SimulationType = SimulationType.CLINICAL_OUTCOME,
        parameters: List[DistributionConfig] = None,
        iterations: int = 1000,
        seed: Optional[int] = None,
        custom_model: Optional[str] = None,
    ):
        self.simulation_type = simulation_type
        self.parameters = parameters or []
        self.iterations = min(iterations, settings.SIMULATION_MAX_ITERATIONS)
        self.seed = seed
        self.custom_model = custom_model
        self._rng = np.random.default_rng(seed)

    def _sample_distribution(
        self,
        config: DistributionConfig,
        size: int = 1,
    ) -> np.ndarray:
        """Sample from a configured distribution."""
        params = config.params

        if config.distribution == DistributionType.NORMAL:
            return self._rng.normal(
                loc=params.get("mean", 0),
                scale=params.get("std", 1),
                size=size,
            )

        elif config.distribution == DistributionType.LOGNORMAL:
            return self._rng.lognormal(
                mean=params.get("mean", 0),
                sigma=params.get("sigma", 1),
                size=size,
            )

        elif config.distribution == DistributionType.UNIFORM:
            return self._rng.uniform(
                low=params.get("low", 0),
                high=params.get("high", 1),
                size=size,
            )

        elif config.distribution == DistributionType.BETA:
            return self._rng.beta(
                a=params.get("alpha", 2),
                b=params.get("beta", 2),
                size=size,
            )

        elif config.distribution == DistributionType.GAMMA:
            return self._rng.gamma(
                shape=params.get("shape", 2),
                scale=params.get("scale", 1),
                size=size,
            )

        elif config.distribution == DistributionType.EXPONENTIAL:
            return self._rng.exponential(
                scale=params.get("scale", 1),
                size=size,
            )

        elif config.distribution == DistributionType.BINOMIAL:
            return self._rng.binomial(
                n=int(params.get("n", 10)),
                p=params.get("p", 0.5),
                size=size,
            )

        elif config.distribution == DistributionType.POISSON:
            return self._rng.poisson(
                lam=params.get("lambda", 1),
                size=size,
            )

        elif config.distribution == DistributionType.FIXED:
            return np.full(size, params.get("value", 0))

        else:
            raise ValueError(f"Unknown distribution: {config.distribution}")

    def _sample_parameters(self) -> Dict[str, float]:
        """Sample all parameters once."""
        return {
            param.name: float(self._sample_distribution(param, size=1)[0])
            for param in self.parameters
        }

    async def run(
        self,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> List[OutcomeMetric]:
        """Run the Monte Carlo simulation.

        Args:
            progress_callback: Optional callback for progress updates

        Returns:
            List of outcome metrics
        """
        self.logger.info(
            "Starting simulation",
            type=self.simulation_type,
            iterations=self.iterations,
        )

        start_time = time.time()

        # Select simulation model
        model_func = self._get_model_function()

        # Run iterations
        results: Dict[str, List[float]] = {}
        batch_size = min(100, self.iterations)

        for i in range(0, self.iterations, batch_size):
            # Run batch
            batch_end = min(i + batch_size, self.iterations)
            batch_results = await self._run_batch(
                model_func, i, batch_end
            )

            # Aggregate results
            for key, values in batch_results.items():
                if key not in results:
                    results[key] = []
                results[key].extend(values)

            # Report progress
            if progress_callback:
                progress_callback(batch_end)

            # Yield to event loop periodically
            if i % 500 == 0:
                await asyncio.sleep(0)

        # Compute outcome metrics
        outcomes = [
            OutcomeMetric.from_samples(name, samples)
            for name, samples in results.items()
        ]

        elapsed = time.time() - start_time
        self.logger.info(
            "Simulation completed",
            iterations=self.iterations,
            outcomes=len(outcomes),
            runtime_s=round(elapsed, 2),
        )

        return outcomes

    async def _run_batch(
        self,
        model_func: Callable,
        start: int,
        end: int,
    ) -> Dict[str, List[float]]:
        """Run a batch of iterations."""
        results: Dict[str, List[float]] = {}

        for _ in range(start, end):
            # Sample parameters
            params = self._sample_parameters()

            # Run model
            outcome = model_func(params)

            # Collect results
            if isinstance(outcome, dict):
                for key, value in outcome.items():
                    if key not in results:
                        results[key] = []
                    results[key].append(float(value))
            else:
                if "result" not in results:
                    results["result"] = []
                results["result"].append(float(outcome))

        return results

    def _get_model_function(self) -> Callable:
        """Get the appropriate model function for the simulation type."""
        models = {
            SimulationType.CLINICAL_OUTCOME: self._clinical_outcome_model,
            SimulationType.EPIDEMIOLOGICAL: self._epidemiological_model,
            SimulationType.DOSE_RESPONSE: self._dose_response_model,
            SimulationType.PATHWAY_DYNAMICS: self._pathway_dynamics_model,
            SimulationType.DRUG_INTERACTION: self._drug_interaction_model,
            SimulationType.SURVIVAL_ANALYSIS: self._survival_analysis_model,
            SimulationType.CUSTOM: self._custom_model,
        }

        return models.get(self.simulation_type, self._clinical_outcome_model)

    def _clinical_outcome_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Model for clinical outcome prediction.

        Simulates treatment outcomes based on efficacy and patient variability.
        """
        # Expected parameters:
        # - efficacy: Treatment effect size (0-1)
        # - baseline_risk: Baseline event risk
        # - patient_variability: Individual response variability

        efficacy = params.get("efficacy", 0.5)
        baseline_risk = params.get("baseline_risk", 0.3)
        variability = params.get("patient_variability", 0.1)

        # Add noise for patient variability
        noise = self._rng.normal(0, variability)

        # Treatment reduces risk
        treatment_risk = max(0, min(1, baseline_risk * (1 - efficacy) + noise))

        # Simulate outcome (0 = no event, 1 = event)
        event = 1 if self._rng.random() < treatment_risk else 0

        return {
            "event": event,
            "risk": treatment_risk,
            "risk_reduction": baseline_risk - treatment_risk,
        }

    def _epidemiological_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Simple SIR epidemiological model.

        Simulates disease spread in a population.
        """
        # Expected parameters:
        # - beta: Transmission rate
        # - gamma: Recovery rate
        # - initial_infected: Initial infected proportion
        # - population: Population size

        beta = params.get("beta", 0.3)
        gamma = params.get("gamma", 0.1)
        initial_infected = params.get("initial_infected", 0.01)
        population = int(params.get("population", 10000))

        # Simple discrete SIR for one time step
        S = population * (1 - initial_infected)
        I = population * initial_infected
        R = 0

        # Run for 100 time steps
        for _ in range(100):
            new_infected = beta * S * I / population
            new_recovered = gamma * I

            S -= new_infected
            I += new_infected - new_recovered
            R += new_recovered

            if I < 1:
                break

        return {
            "final_susceptible": S / population,
            "peak_infected": I / population,
            "total_infected": R / population,
            "r0": beta / gamma,
        }

    def _dose_response_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Hill equation dose-response model.

        Simulates drug effect as a function of dose.
        """
        # Expected parameters:
        # - dose: Drug dose
        # - ec50: Half-maximal effective concentration
        # - emax: Maximum effect
        # - hill: Hill coefficient

        dose = params.get("dose", 1.0)
        ec50 = params.get("ec50", 1.0)
        emax = params.get("emax", 1.0)
        hill = params.get("hill", 1.0)

        # Hill equation
        effect = emax * (dose ** hill) / (ec50 ** hill + dose ** hill)

        # Add measurement noise
        noise = self._rng.normal(0, 0.05)
        observed_effect = max(0, min(emax, effect + noise))

        return {
            "effect": observed_effect,
            "dose": dose,
            "occupancy": dose / (ec50 + dose),
        }

    def _pathway_dynamics_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Simplified pathway dynamics model.

        Simulates signaling pathway activation levels.
        """
        # Expected parameters:
        # - input_signal: Upstream signal strength
        # - amplification: Signal amplification factor
        # - degradation: Signal degradation rate
        # - threshold: Activation threshold

        input_signal = params.get("input_signal", 1.0)
        amplification = params.get("amplification", 2.0)
        degradation = params.get("degradation", 0.5)
        threshold = params.get("threshold", 0.5)

        # Simple dynamics
        signal = input_signal * amplification
        steady_state = signal / (1 + degradation)

        # Add biological noise
        noise = self._rng.normal(0, 0.1)
        observed = max(0, steady_state + noise)

        # Determine if pathway is activated
        activated = 1 if observed > threshold else 0

        return {
            "steady_state": observed,
            "activated": activated,
            "fold_change": observed / max(0.01, input_signal),
        }

    def _drug_interaction_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Drug-drug interaction model.

        Simulates combined effect of two drugs.
        """
        # Expected parameters:
        # - drug_a_effect: Effect of drug A alone
        # - drug_b_effect: Effect of drug B alone
        # - interaction_type: 0=additive, 1=synergistic, -1=antagonistic
        # - interaction_strength: Magnitude of interaction

        effect_a = params.get("drug_a_effect", 0.5)
        effect_b = params.get("drug_b_effect", 0.5)
        interaction_type = params.get("interaction_type", 0)
        interaction_strength = params.get("interaction_strength", 0.2)

        # Bliss independence model baseline
        additive_effect = effect_a + effect_b - (effect_a * effect_b)

        # Adjust for interaction
        if interaction_type > 0:
            # Synergistic
            combined = min(1.0, additive_effect + interaction_strength)
        elif interaction_type < 0:
            # Antagonistic
            combined = max(0.0, additive_effect - interaction_strength)
        else:
            # Additive
            combined = additive_effect

        # Add noise
        noise = self._rng.normal(0, 0.05)
        observed = max(0, min(1, combined + noise))

        return {
            "combined_effect": observed,
            "additive_expected": additive_effect,
            "interaction_index": observed / max(0.01, additive_effect),
        }

    def _survival_analysis_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Survival time model using Weibull distribution.

        Simulates time-to-event outcomes.
        """
        # Expected parameters:
        # - scale: Weibull scale (characteristic life)
        # - shape: Weibull shape
        # - hazard_ratio: Treatment effect on hazard
        # - censoring_time: Maximum follow-up time

        scale = params.get("scale", 12.0)  # months
        shape = params.get("shape", 1.5)
        hazard_ratio = params.get("hazard_ratio", 0.7)
        censoring_time = params.get("censoring_time", 24.0)

        # Adjust scale for treatment effect
        treated_scale = scale / (hazard_ratio ** (1 / shape))

        # Sample survival time
        survival_time = self._rng.weibull(shape) * treated_scale

        # Apply censoring
        censored = 1 if survival_time > censoring_time else 0
        observed_time = min(survival_time, censoring_time)

        return {
            "survival_time": observed_time,
            "censored": censored,
            "event": 1 - censored,
        }

    def _custom_model(self, params: Dict[str, float]) -> Dict[str, float]:
        """Execute custom user-defined model.

        Warning: Executes arbitrary code - use with caution in production.
        """
        if not self.custom_model:
            return {"result": 0.0}

        # Create a restricted execution environment
        local_vars = {
            "params": params,
            "np": np,
            "rng": self._rng,
        }

        try:
            exec(self.custom_model, {"__builtins__": {}}, local_vars)
            result = local_vars.get("result", {"result": 0.0})
            return result if isinstance(result, dict) else {"result": float(result)}
        except Exception as e:
            self.logger.warning("Custom model execution failed", error=str(e))
            return {"result": 0.0, "error": 1.0}


async def run_simulation(
    config: SimulationConfig,
    progress_callback: Optional[Callable[[int], None]] = None,
) -> List[OutcomeMetric]:
    """Convenience function to run a simulation from config."""
    engine = MonteCarloEngine(
        simulation_type=config.simulation_type,
        parameters=config.parameters,
        iterations=config.iterations,
        seed=config.seed,
        custom_model=config.custom_model,
    )

    return await engine.run(progress_callback)

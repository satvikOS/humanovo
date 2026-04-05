"""
Pharmacokinetics Processor — ODE solver, compartmental models, dosing optimization.

Provides MATLAB SimBiology/ode45 equivalent capabilities:
- General ODE solver (RK45, BDF, LSODA — equivalent to ode45/ode15s)
- 1-compartment and 2-compartment PK models
- Multiple dosing simulation with superposition
- Dose optimization for therapeutic window
- Non-compartmental analysis (NCA)
- PK model fitting to observed data
- Michaelis-Menten enzyme kinetics
- Systems biology ODE simulation
- Bioequivalence testing (TOST)
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from scipy import integrate, optimize, stats as sp_stats

from app.compute.types import (
    ComputeDomain,
    ComputeRequest,
    ComputeResult,
    ComputeStatus,
    DescriptiveStats,
    GeneratedFigure,
    StatisticalTest,
    ConfidenceInterval,
)


class PharmacokineticsProcessor:
    """Pharmacokinetics and systems biology computation processor."""

    OPERATIONS = [
        "solve_ode", "one_compartment", "two_compartment", "three_compartment",
        "multiple_dosing", "dose_optimization", "noncompartmental_analysis", "pk_fitting",
        "michaelis_menten", "systems_biology", "bioequivalence",
        "population_pk", "drug_interaction", "target_mediated_disposition",
        "physiologically_based", "allometric_scaling",
    ]

    def list_operations(self) -> list[str]:
        return self.OPERATIONS

    async def execute(self, request: ComputeRequest, progress_callback: Callable | None = None) -> ComputeResult:
        dispatch = {op: getattr(self, f"_{op}") for op in self.OPERATIONS}
        handler = dispatch.get(request.operation)
        if not handler:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.PHARMACOKINETICS,
                operation=request.operation, status=ComputeStatus.FAILED,
                error=f"Unknown operation: {request.operation}",
            )
        try:
            return await handler(request, request.parameters)
        except Exception as e:
            return ComputeResult(
                request_id=request.id, domain=ComputeDomain.PHARMACOKINETICS,
                operation=request.operation, status=ComputeStatus.FAILED, error=str(e),
            )

    async def _solve_ode(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """General ODE solver — equivalent to MATLAB ode45."""
        equations_str = params["equations"]
        y0 = np.array(params["y0"], dtype=float)
        t_span = tuple(params["t_span"])
        t_eval = np.array(params["t_eval"]) if "t_eval" in params else None
        method = params.get("method", "RK45")
        rtol = params.get("rtol", 1e-6)
        atol = params.get("atol", 1e-9)
        max_step = params.get("max_step", np.inf)
        constants = params.get("params", {})

        # Build safe namespace for equation evaluation
        safe_ns = {
            "__builtins__": {}, "np": np, "exp": np.exp, "log": np.log,
            "sqrt": np.sqrt, "sin": np.sin, "cos": np.cos, "abs": np.abs,
            "max": max, "min": min, "pi": np.pi,
            **{k: float(v) for k, v in constants.items()},
        }

        compiled = compile(equations_str, "<ode>", "eval")

        def deriv(t, y):
            local_ns = {**safe_ns, "t": t, "y": y}
            return eval(compiled, local_ns)

        if t_eval is None:
            n_pts = params.get("n_points", 500)
            t_eval = np.linspace(t_span[0], t_span[1], n_pts)

        sol = integrate.solve_ivp(
            deriv, t_span, y0, t_eval=t_eval, method=method,
            rtol=rtol, atol=atol, max_step=max_step,
        )

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            for i in range(sol.y.shape[0]):
                ax.plot(sol.t, sol.y[i], label=f"y[{i}]")
            ax.set_xlabel("Time")
            ax.set_ylabel("State")
            ax.set_title("ODE Solution")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "ode_solution"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="solve_ode",
            results={
                "t": sol.t.tolist(), "y": [yi.tolist() for yi in sol.y],
                "success": sol.success, "message": sol.message,
                "n_evaluations": sol.nfev,
            },
            figures=figures,
        )

    async def _one_compartment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        dose = params["dose"]
        F = params.get("bioavailability", 1.0)
        Vd = params["volume_distribution"]
        CL = params["clearance"]
        ka = params.get("absorption_rate")
        infusion_rate = params.get("infusion_rate")
        infusion_dur = params.get("infusion_duration")
        t_end = params.get("t_end", 24)
        n_pts = params.get("n_points", 500)

        ke = CL / Vd
        t = np.linspace(0, t_end, n_pts)

        if infusion_rate and infusion_dur:
            # IV infusion
            R0 = infusion_rate
            C = np.where(
                t <= infusion_dur,
                (R0 / CL) * (1 - np.exp(-ke * t)),
                (R0 / CL) * (1 - np.exp(-ke * infusion_dur)) * np.exp(-ke * (t - infusion_dur)),
            )
        elif ka:
            # Oral absorption
            if abs(ka - ke) < 1e-10:
                C = (dose * F * ka / Vd) * t * np.exp(-ke * t)
            else:
                C = (dose * F * ka) / (Vd * (ka - ke)) * (np.exp(-ke * t) - np.exp(-ka * t))
        else:
            # IV bolus
            C = (dose * F / Vd) * np.exp(-ke * t)

        C = np.maximum(C, 0)
        Cmax = float(np.max(C))
        Tmax = float(t[np.argmax(C)])
        half_life = math.log(2) / ke
        AUC = float(np.trapz(C, t))

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.plot(t, C, "b-", linewidth=2)
            ax.axhline(Cmax, color="red", linestyle="--", alpha=0.5, label=f"Cmax={Cmax:.2f}")
            ax.set_xlabel("Time (h)")
            ax.set_ylabel("Concentration (mg/L)")
            ax.set_title("One-Compartment PK Model")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "pk_one_compartment"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="one_compartment",
            results={
                "time": t.tolist(), "concentration": C.tolist(),
                "Cmax": round(Cmax, 4), "Tmax": round(Tmax, 4),
                "AUC": round(AUC, 4), "half_life": round(half_life, 4),
                "ke": round(ke, 6), "Vd": Vd, "CL": CL,
            },
            figures=figures,
        )

    async def _two_compartment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        dose = params["dose"]
        F = params.get("bioavailability", 1.0)
        V1 = params["V1"]
        V2 = params["V2"]
        CL = params["CL"]
        Q = params["Q"]
        ka = params.get("ka")
        t_end = params.get("t_end", 48)
        n_pts = params.get("n_points", 500)

        def deriv(t, y):
            if ka:
                A, C1, C2 = y
                dAdt = -ka * A
                input_rate = ka * A / V1
            else:
                C1, C2 = y
                input_rate = 0

            dC1dt = -(CL / V1 + Q / V1) * C1 + (Q / V2) * C2 + input_rate
            dC2dt = (Q / V1) * C1 - (Q / V2) * C2

            if ka:
                return [dAdt, dC1dt, dC2dt]
            return [dC1dt, dC2dt]

        if ka:
            y0 = [dose * F, 0.0, 0.0]
        else:
            y0 = [dose * F / V1, 0.0]

        t_eval = np.linspace(0, t_end, n_pts)
        sol = integrate.solve_ivp(deriv, (0, t_end), y0, t_eval=t_eval, method="RK45", rtol=1e-8)

        if ka:
            C1, C2 = sol.y[1], sol.y[2]
        else:
            C1, C2 = sol.y[0], sol.y[1]

        Cmax = float(np.max(C1))
        Tmax = float(t_eval[np.argmax(C1)])
        AUC = float(np.trapz(C1, t_eval))

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.plot(t_eval, C1, "b-", linewidth=2, label="Central")
            ax.plot(t_eval, C2, "r--", linewidth=1.5, label="Peripheral")
            ax.set_xlabel("Time (h)")
            ax.set_ylabel("Concentration (mg/L)")
            ax.set_title("Two-Compartment PK Model")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "pk_two_compartment"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="two_compartment",
            results={
                "time": t_eval.tolist(), "central_concentration": C1.tolist(),
                "peripheral_concentration": C2.tolist(),
                "Cmax": round(Cmax, 4), "Tmax": round(Tmax, 4), "AUC": round(AUC, 4),
            },
            figures=figures,
        )

    async def _multiple_dosing(self, req: ComputeRequest, params: dict) -> ComputeResult:
        model = params.get("model", "one_compartment")
        mp = params["model_params"]
        dose_times = np.array(params["dose_times"], dtype=float)
        doses = params.get("doses", mp.get("dose", 100))
        if isinstance(doses, (int, float)):
            doses = [doses] * len(dose_times)
        t_end = params.get("t_end", dose_times[-1] + 48)
        n_pts = params.get("n_points", 1000)

        Vd = mp["volume_distribution"]
        CL = mp["clearance"]
        ke = CL / Vd
        ka = mp.get("absorption_rate")
        F = mp.get("bioavailability", 1.0)

        t = np.linspace(0, t_end, n_pts)
        C_total = np.zeros_like(t)

        for dose_time, dose_amt in zip(dose_times, doses):
            dt = t - dose_time
            mask = dt >= 0
            if ka and abs(ka - ke) > 1e-10:
                C_single = np.where(mask, (dose_amt * F * ka) / (Vd * (ka - ke)) * (np.exp(-ke * dt) - np.exp(-ka * dt)), 0)
            else:
                C_single = np.where(mask, (dose_amt * F / Vd) * np.exp(-ke * dt), 0)
            C_total += np.maximum(C_single, 0)

        Cmax_ss = float(np.max(C_total[t > dose_times[-1]]) if len(dose_times) > 1 else np.max(C_total))
        Cmin_ss = float(np.min(C_total[t > dose_times[-1]]) if len(dose_times) > 1 else np.min(C_total[C_total > 0]))

        th_min = params.get("therapeutic_min")
        th_max = params.get("therapeutic_max")
        time_in_window = None
        if th_min is not None and th_max is not None:
            in_window = (C_total >= th_min) & (C_total <= th_max)
            time_in_window = round(float(np.mean(in_window)) * 100, 1)

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.plot(t, C_total, "b-", linewidth=1.5)
            for dt_val in dose_times:
                ax.axvline(dt_val, color="green", alpha=0.3, linewidth=0.8)
            if th_min is not None and th_max is not None:
                ax.axhspan(th_min, th_max, color="green", alpha=0.1, label="Therapeutic window")
            ax.set_xlabel("Time (h)")
            ax.set_ylabel("Concentration (mg/L)")
            ax.set_title("Multiple Dosing Simulation")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "multiple_dosing"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="multiple_dosing",
            results={
                "time": t.tolist(), "concentration": C_total.tolist(),
                "Cmax_ss": round(Cmax_ss, 4), "Cmin_ss": round(Cmin_ss, 4),
                "n_doses": len(dose_times),
                "time_in_therapeutic_window_pct": time_in_window,
            },
            figures=figures,
        )

    async def _dose_optimization(self, req: ComputeRequest, params: dict) -> ComputeResult:
        mp = params["model_params"]
        th_min = params["therapeutic_min"]
        th_max = params["therapeutic_max"]
        interval = params["dosing_interval"]
        n_doses = params.get("n_doses", 10)
        dose_range = params.get("dose_range", [10, 1000])

        Vd = mp["volume_distribution"]
        CL = mp["clearance"]
        ke = CL / Vd
        ka = mp.get("absorption_rate")
        F = mp.get("bioavailability", 1.0)

        def time_in_window(dose_val):
            dose_times = np.arange(n_doses) * interval
            t_end = dose_times[-1] + interval * 2
            t = np.linspace(0, t_end, 2000)
            C = np.zeros_like(t)
            for dt_val in dose_times:
                dt = t - dt_val
                mask = dt >= 0
                if ka and abs(ka - ke) > 1e-10:
                    C += np.where(mask, (dose_val * F * ka) / (Vd * (ka - ke)) * (np.exp(-ke * dt) - np.exp(-ka * dt)), 0)
                else:
                    C += np.where(mask, (dose_val * F / Vd) * np.exp(-ke * dt), 0)
            C = np.maximum(C, 0)
            in_window = (C >= th_min) & (C <= th_max)
            return -float(np.mean(in_window))  # Negative for minimization

        result = optimize.minimize_scalar(time_in_window, bounds=dose_range, method="bounded")
        opt_dose = float(result.x)
        opt_pct = -float(result.fun) * 100

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="dose_optimization",
            results={
                "optimal_dose": round(opt_dose, 2),
                "time_in_window_pct": round(opt_pct, 1),
                "therapeutic_min": th_min, "therapeutic_max": th_max,
                "dosing_interval": interval,
            },
        )

    async def _noncompartmental_analysis(self, req: ComputeRequest, params: dict) -> ComputeResult:
        times = np.array(params["times"], dtype=float)
        conc = np.array(params["concentrations"], dtype=float)
        dose = params["dose"]
        route = params.get("route", "iv")

        Cmax = float(np.max(conc))
        Tmax = float(times[np.argmax(conc)])
        AUC_last = float(np.trapz(conc, times))

        # Terminal elimination rate (log-linear regression on last 3+ points)
        n_terminal = max(3, len(times) // 3)
        terminal_mask = conc[-n_terminal:] > 0
        if terminal_mask.sum() >= 2:
            t_term = times[-n_terminal:][terminal_mask]
            c_term = np.log(conc[-n_terminal:][terminal_mask])
            slope, intercept, r, _, _ = sp_stats.linregress(t_term, c_term)
            lambda_z = -slope
            t_half = math.log(2) / lambda_z if lambda_z > 0 else float("inf")
            AUC_extrap = float(conc[-1] / lambda_z) if lambda_z > 0 else 0
            AUC_inf = AUC_last + AUC_extrap
        else:
            lambda_z = 0.0
            t_half = float("inf")
            AUC_inf = AUC_last

        CL_val = dose / AUC_inf if AUC_inf > 0 else 0
        Vd = CL_val / lambda_z if lambda_z > 0 else 0

        # AUMC and MRT
        AUMC = float(np.trapz(times * conc, times))
        MRT = AUMC / AUC_last if AUC_last > 0 else 0

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="noncompartmental_analysis",
            results={
                "Cmax": round(Cmax, 4), "Tmax": round(Tmax, 4),
                "AUC_0_last": round(AUC_last, 4), "AUC_0_inf": round(AUC_inf, 4),
                "lambda_z": round(lambda_z, 6), "t_half": round(t_half, 4),
                "CL": round(CL_val, 4), "Vd": round(Vd, 4),
                "MRT": round(MRT, 4), "AUMC": round(AUMC, 4),
                "route": route,
            },
        )

    async def _pk_fitting(self, req: ComputeRequest, params: dict) -> ComputeResult:
        times = np.array(params["times"], dtype=float)
        conc = np.array(params["concentrations"], dtype=float)
        model = params.get("model", "one_compartment")
        route = params.get("route", "iv_bolus")
        dose = params.get("dose", 100)

        if model == "one_compartment" and route == "iv_bolus":
            def pk_func(t, C0, ke):
                return C0 * np.exp(-ke * t)
            p0 = [float(conc[0]) if conc[0] > 0 else 10.0, 0.1]
            bounds = ([0, 0], [np.inf, 10])
        elif model == "one_compartment" and route == "oral":
            def pk_func(t, C0, ka, ke):
                if abs(ka - ke) < 1e-10:
                    return C0 * t * np.exp(-ke * t)
                return C0 * ka / (ka - ke) * (np.exp(-ke * t) - np.exp(-ka * t))
            p0 = [float(np.max(conc)) * 2, 1.0, 0.1]
            bounds = ([0, 0, 0], [np.inf, 50, 10])
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS,
                operation="pk_fitting", status=ComputeStatus.FAILED,
                error=f"Unsupported model/route: {model}/{route}",
            )

        popt, pcov = optimize.curve_fit(pk_func, times, conc, p0=p0, bounds=bounds, maxfev=10000)
        fitted = pk_func(times, *popt)

        # Goodness of fit
        ss_res = np.sum((conc - fitted) ** 2)
        ss_tot = np.sum((conc - np.mean(conc)) ** 2)
        r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0

        n = len(conc)
        k = len(popt)
        AIC = n * np.log(ss_res / n) + 2 * k if n > 0 else 0
        BIC = n * np.log(ss_res / n) + k * np.log(n) if n > 0 else 0

        # Parameter confidence intervals
        perr = np.sqrt(np.diag(pcov))

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.scatter(times, conc, c="black", s=30, zorder=5, label="Observed")
            t_fine = np.linspace(times[0], times[-1], 500)
            ax.plot(t_fine, pk_func(t_fine, *popt), "r-", linewidth=2, label="Fitted")
            ax.set_xlabel("Time (h)")
            ax.set_ylabel("Concentration (mg/L)")
            ax.set_title(f"PK Fit (R²={r_squared:.4f})")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "pk_fit"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="pk_fitting",
            results={
                "parameters": {f"p{i}": round(float(v), 6) for i, v in enumerate(popt)},
                "std_errors": {f"p{i}": round(float(v), 6) for i, v in enumerate(perr)},
                "r_squared": round(r_squared, 6), "AIC": round(AIC, 2), "BIC": round(BIC, 2),
                "residuals": (conc - fitted).tolist(),
                "fitted_values": fitted.tolist(),
            },
            figures=figures,
        )

    async def _michaelis_menten(self, req: ComputeRequest, params: dict) -> ComputeResult:
        S = params.get("substrate_concentrations")
        V = params.get("reaction_rates")

        if S is not None and V is not None:
            S = np.array(S, dtype=float)
            V = np.array(V, dtype=float)

            def mm(s, Vmax, Km):
                return Vmax * s / (Km + s)

            popt, pcov = optimize.curve_fit(mm, S, V, p0=[float(np.max(V)), float(np.median(S))])
            Vmax, Km = float(popt[0]), float(popt[1])
            fitted = mm(S, Vmax, Km)
        else:
            Vmax = params["Vmax"]
            Km = params["Km"]
            S = np.linspace(0, params.get("s_max", Km * 10), 200)
            V = Vmax * S / (Km + S)
            fitted = V

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            s_fine = np.linspace(0.01, float(S.max()) * 1.2, 200)
            axes[0].plot(s_fine, Vmax * s_fine / (Km + s_fine), "r-", linewidth=2)
            if params.get("reaction_rates"):
                axes[0].scatter(S, np.array(params["reaction_rates"]), c="black", s=30)
            axes[0].set_xlabel("[S]")
            axes[0].set_ylabel("V")
            axes[0].set_title("Michaelis-Menten")
            axes[0].axhline(Vmax, color="gray", linestyle="--", alpha=0.5)
            axes[0].axvline(Km, color="gray", linestyle="--", alpha=0.5)

            # Lineweaver-Burk
            if params.get("reaction_rates"):
                S_nz = S[S > 0]
                V_nz = np.array(params["reaction_rates"])[S > 0]
                V_nz = V_nz[V_nz > 0]
                S_nz = S_nz[:len(V_nz)]
                if len(S_nz) > 0:
                    axes[1].scatter(1/S_nz, 1/V_nz, c="black", s=30)
                    x_lb = np.linspace(-1/Km * 0.5, float(np.max(1/S_nz)) * 1.2, 100)
                    axes[1].plot(x_lb, 1/Vmax + (Km/Vmax) * x_lb, "r-")
                    axes[1].set_xlabel("1/[S]")
                    axes[1].set_ylabel("1/V")
                    axes[1].set_title("Lineweaver-Burk")
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "michaelis_menten"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="michaelis_menten",
            results={"Vmax": round(Vmax, 4), "Km": round(Km, 4)},
            figures=figures,
        )

    async def _systems_biology(self, req: ComputeRequest, params: dict) -> ComputeResult:
        species = params["species"]
        reactions = params["reactions"]
        t_span = tuple(params.get("t_span", [0, 100]))
        n_pts = params.get("n_points", 500)

        names = [s["name"] for s in species]
        y0 = np.array([s["initial_value"] for s in species], dtype=float)

        # Build rate expressions
        compiled_rates = []
        for rxn in reactions:
            safe_ns = {"__builtins__": {}, "exp": np.exp, "log": np.log, "sqrt": np.sqrt, "abs": abs}
            safe_ns.update({k: float(v) for k, v in rxn.get("params", {}).items()})
            compiled_rates.append((compile(rxn["rate_law"], "<rxn>", "eval"), safe_ns, rxn.get("stoichiometry", {})))

        def deriv(t, y):
            local = {name: y[i] for i, name in enumerate(names)}
            dydt = np.zeros(len(y))
            for expr, ns, stoich in compiled_rates:
                rate = eval(expr, {**ns, **local})
                for sp_name, coeff in stoich.items():
                    if sp_name in names:
                        dydt[names.index(sp_name)] += coeff * rate
            return dydt

        t_eval = np.linspace(t_span[0], t_span[1], n_pts)
        sol = integrate.solve_ivp(deriv, t_span, y0, t_eval=t_eval, method="LSODA", rtol=1e-8)

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            for i, name in enumerate(names):
                ax.plot(sol.t, sol.y[i], label=name, linewidth=1.5)
            ax.set_xlabel("Time")
            ax.set_ylabel("Concentration")
            ax.set_title("Systems Biology Simulation")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "systems_biology"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="systems_biology",
            results={
                "time": sol.t.tolist(),
                "species": {name: sol.y[i].tolist() for i, name in enumerate(names)},
                "success": sol.success,
            },
            figures=figures,
        )

    async def _bioequivalence(self, req: ComputeRequest, params: dict) -> ComputeResult:
        test_auc = np.log(np.array(params["test_auc"], dtype=float))
        ref_auc = np.log(np.array(params["reference_auc"], dtype=float))
        test_cmax = np.log(np.array(params["test_cmax"], dtype=float))
        ref_cmax = np.log(np.array(params["reference_cmax"], dtype=float))
        limits = params.get("limits", [0.80, 1.25])
        log_limits = [math.log(limits[0]), math.log(limits[1])]

        def tost(test, ref):
            diff = test - ref
            n = len(diff)
            mean_diff = float(np.mean(diff))
            se = float(np.std(diff, ddof=1) / np.sqrt(n))
            df = n - 1
            t_lower = (mean_diff - log_limits[0]) / se
            t_upper = (log_limits[1] - mean_diff) / se
            p_lower = 1 - sp_stats.t.cdf(t_lower, df)
            p_upper = 1 - sp_stats.t.cdf(t_upper, df)
            p_tost = max(p_lower, p_upper)
            ratio = math.exp(mean_diff)
            ci_90 = sp_stats.t.interval(0.90, df, loc=mean_diff, scale=se)
            return {
                "geometric_mean_ratio": round(ratio, 4),
                "ci_90_lower": round(math.exp(ci_90[0]), 4),
                "ci_90_upper": round(math.exp(ci_90[1]), 4),
                "p_tost": round(float(p_tost), 6),
                "bioequivalent": math.exp(ci_90[0]) >= limits[0] and math.exp(ci_90[1]) <= limits[1],
            }

        auc_result = tost(test_auc, ref_auc)
        cmax_result = tost(test_cmax, ref_cmax)
        overall_be = auc_result["bioequivalent"] and cmax_result["bioequivalent"]

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="bioequivalence",
            results={
                "auc": auc_result, "cmax": cmax_result,
                "overall_bioequivalent": overall_be,
                "limits": limits,
            },
        )

    # ── Three-Compartment Model ─────────────────────────────────────

    async def _three_compartment(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Three-compartment PK model with deep + shallow peripheral compartments."""
        dose = params["dose"]
        F = params.get("bioavailability", 1.0)
        V1 = params["V1"]
        V2 = params["V2"]
        V3 = params["V3"]
        CL = params["CL"]
        Q2 = params["Q2"]
        Q3 = params["Q3"]
        ka = params.get("ka")
        t_end = params.get("t_end", 72)
        n_pts = params.get("n_points", 500)

        def deriv(t, y):
            if ka:
                A, C1, C2, C3 = y
                dAdt = -ka * A
                inp = ka * A / V1
            else:
                C1, C2, C3 = y
                inp = 0.0

            dC1dt = -(CL/V1 + Q2/V1 + Q3/V1) * C1 + (Q2/V2) * C2 + (Q3/V3) * C3 + inp
            dC2dt = (Q2/V1) * C1 - (Q2/V2) * C2
            dC3dt = (Q3/V1) * C1 - (Q3/V3) * C3

            return [dAdt, dC1dt, dC2dt, dC3dt] if ka else [dC1dt, dC2dt, dC3dt]

        y0 = [dose * F, 0.0, 0.0, 0.0] if ka else [dose * F / V1, 0.0, 0.0]
        t_eval = np.linspace(0, t_end, n_pts)
        sol = integrate.solve_ivp(deriv, (0, t_end), y0, t_eval=t_eval, method="RK45", rtol=1e-8)

        idx = 1 if ka else 0
        C1, C2, C3 = sol.y[idx], sol.y[idx+1], sol.y[idx+2]
        Cmax = float(np.max(C1))
        Tmax = float(t_eval[np.argmax(C1)])
        AUC = float(np.trapz(C1, t_eval))

        # Micro-rate constants and half-lives
        alpha = CL/V1 + Q2/V1 + Q3/V1 + Q2/V2 + Q3/V3
        results_dict = {
            "time": t_eval.tolist(), "central": C1.tolist(),
            "shallow_peripheral": C2.tolist(), "deep_peripheral": C3.tolist(),
            "Cmax": round(Cmax, 4), "Tmax": round(Tmax, 4), "AUC": round(AUC, 4),
        }

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.plot(t_eval, C1, "b-", linewidth=2, label="Central")
            ax.plot(t_eval, C2, "r--", linewidth=1.5, label="Shallow Peripheral")
            ax.plot(t_eval, C3, "g:", linewidth=1.5, label="Deep Peripheral")
            ax.set_xlabel("Time (h)")
            ax.set_ylabel("Concentration (mg/L)")
            ax.set_title("Three-Compartment PK Model")
            ax.legend()
            ax.grid(True, alpha=0.3)
            figures.append(GeneratedFigure.from_matplotlib(fig, "pk_three_compartment"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="three_compartment",
            results=results_dict, figures=figures,
        )

    # ── Population PK (Naïve Pooled + Two-Stage) ───────────────────

    async def _population_pk(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Population pharmacokinetics — naïve pooled and two-stage approaches."""
        subjects = params["subjects"]  # list of {times, concentrations, dose, covariates}
        model = params.get("model", "one_compartment")
        route = params.get("route", "iv_bolus")

        # Individual fits
        individual_params = []
        for subj in subjects:
            t = np.array(subj["times"], dtype=float)
            c = np.array(subj["concentrations"], dtype=float)
            d = subj["dose"]

            if model == "one_compartment" and route == "iv_bolus":
                def pk(t_arr, C0, ke):
                    return C0 * np.exp(-ke * t_arr)
                p0 = [float(c[0]) if c[0] > 0 else d / 10, 0.1]
                bounds = ([0, 0], [np.inf, 10])
            elif model == "one_compartment" and route == "oral":
                def pk(t_arr, C0, ka_p, ke):
                    if abs(ka_p - ke) < 1e-10:
                        return C0 * t_arr * np.exp(-ke * t_arr)
                    return C0 * ka_p / (ka_p - ke) * (np.exp(-ke * t_arr) - np.exp(-ka_p * t_arr))
                p0 = [float(np.max(c)) * 2, 1.0, 0.1]
                bounds = ([0, 0, 0], [np.inf, 50, 10])
            else:
                continue

            try:
                popt, pcov = optimize.curve_fit(pk, t, c, p0=p0, bounds=bounds, maxfev=10000)
                perr = np.sqrt(np.diag(pcov))
                individual_params.append({
                    "subject_id": subj.get("id", len(individual_params)),
                    "parameters": [round(float(v), 6) for v in popt],
                    "std_errors": [round(float(v), 6) for v in perr],
                    "covariates": subj.get("covariates", {}),
                })
            except Exception:
                individual_params.append({
                    "subject_id": subj.get("id", len(individual_params)),
                    "parameters": None, "error": "Fit failed",
                })

        # Population statistics (Two-Stage)
        valid = [ip for ip in individual_params if ip["parameters"] is not None]
        if valid:
            param_matrix = np.array([ip["parameters"] for ip in valid])
            pop_mean = param_matrix.mean(axis=0).tolist()
            pop_sd = param_matrix.std(axis=0, ddof=1).tolist()
            pop_cv = (param_matrix.std(axis=0, ddof=1) / (param_matrix.mean(axis=0) + 1e-10) * 100).tolist()

            # Between-subject variability (omega²)
            omega2 = np.var(np.log(param_matrix + 1e-10), axis=0, ddof=1).tolist()

            # Covariate relationships (simple linear regression)
            cov_effects = {}
            all_covs = set()
            for ip in valid:
                if ip.get("covariates"):
                    all_covs.update(ip["covariates"].keys())
            for cov_name in all_covs:
                cov_vals = []
                param_vals = []
                for ip in valid:
                    if ip.get("covariates") and cov_name in ip["covariates"]:
                        cov_vals.append(float(ip["covariates"][cov_name]))
                        param_vals.append(ip["parameters"])
                if len(cov_vals) >= 3:
                    cov_arr = np.array(cov_vals)
                    for pi in range(len(pop_mean)):
                        p_arr = np.array([pv[pi] for pv in param_vals])
                        r, p_val = sp_stats.pearsonr(cov_arr, p_arr)
                        if abs(r) > 0.3:
                            cov_effects[f"{cov_name}_vs_p{pi}"] = {
                                "r": round(float(r), 4), "p": round(float(p_val), 6),
                            }
        else:
            pop_mean, pop_sd, pop_cv, omega2, cov_effects = [], [], [], [], {}

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="population_pk",
            results={
                "n_subjects": len(subjects), "n_successful_fits": len(valid),
                "population_mean": [round(v, 6) for v in pop_mean],
                "population_sd": [round(v, 6) for v in pop_sd],
                "population_cv_pct": [round(v, 1) for v in pop_cv],
                "between_subject_variability": [round(v, 6) for v in omega2],
                "individual_parameters": individual_params,
                "covariate_effects": cov_effects,
                "model": model, "route": route,
            },
        )

    # ── Drug-Drug Interaction ───────────────────────────────────────

    async def _drug_interaction(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Drug-drug interaction modeling (competitive/noncompetitive inhibition, induction)."""
        interaction_type = params.get("type", "competitive_inhibition")
        t_end = params.get("t_end", 48)
        n_pts = params.get("n_points", 500)

        # Substrate (victim drug) parameters
        dose_s = params["substrate_dose"]
        Vd_s = params["substrate_Vd"]
        Vmax_s = params["substrate_Vmax"]  # max metabolic rate
        Km_s = params["substrate_Km"]  # Michaelis constant
        ka_s = params.get("substrate_ka", 1.0)
        F_s = params.get("substrate_F", 1.0)

        # Inhibitor/inducer parameters
        dose_i = params["perpetrator_dose"]
        Vd_i = params["perpetrator_Vd"]
        ke_i = params["perpetrator_ke"]
        ka_i = params.get("perpetrator_ka", 1.0)
        F_i = params.get("perpetrator_F", 1.0)
        Ki = params.get("Ki", 1.0)  # inhibition constant

        if interaction_type == "competitive_inhibition":
            def deriv(t, y):
                As, Cs, Ai, Ci = y
                dAs = -ka_s * As
                dAi = -ka_i * Ai
                # Competitive: apparent Km increases
                Km_app = Km_s * (1 + Ci / Ki)
                rate_s = (Vmax_s * Cs) / (Km_app + Cs)
                dCs = ka_s * As / Vd_s - rate_s / Vd_s
                dCi = ka_i * Ai / Vd_i - ke_i * Ci
                return [dAs, dCs, dAi, dCi]
        elif interaction_type == "noncompetitive_inhibition":
            def deriv(t, y):
                As, Cs, Ai, Ci = y
                dAs = -ka_s * As
                dAi = -ka_i * Ai
                # Noncompetitive: Vmax decreases
                Vmax_app = Vmax_s / (1 + Ci / Ki)
                rate_s = (Vmax_app * Cs) / (Km_s + Cs)
                dCs = ka_s * As / Vd_s - rate_s / Vd_s
                dCi = ka_i * Ai / Vd_i - ke_i * Ci
                return [dAs, dCs, dAi, dCi]
        elif interaction_type == "induction":
            Emax = params.get("Emax", 2.0)  # max fold induction
            EC50 = params.get("EC50", 1.0)
            def deriv(t, y):
                As, Cs, Ai, Ci = y
                dAs = -ka_s * As
                dAi = -ka_i * Ai
                induction_factor = 1 + Emax * Ci / (EC50 + Ci)
                rate_s = (Vmax_s * induction_factor * Cs) / (Km_s + Cs)
                dCs = ka_s * As / Vd_s - rate_s / Vd_s
                dCi = ka_i * Ai / Vd_i - ke_i * Ci
                return [dAs, dCs, dAi, dCi]
        else:
            return ComputeResult(
                request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="drug_interaction",
                status=ComputeStatus.FAILED, error=f"Unknown interaction type: {interaction_type}",
            )

        y0 = [dose_s * F_s, 0.0, dose_i * F_i, 0.0]
        t_eval = np.linspace(0, t_end, n_pts)
        sol_ddi = integrate.solve_ivp(deriv, (0, t_end), y0, t_eval=t_eval, method="RK45", rtol=1e-8)

        # Baseline (no inhibitor)
        def deriv_base(t, y):
            As, Cs = y
            dAs = -ka_s * As
            rate_s = (Vmax_s * Cs) / (Km_s + Cs)
            dCs = ka_s * As / Vd_s - rate_s / Vd_s
            return [dAs, dCs]

        sol_base = integrate.solve_ivp(deriv_base, (0, t_end), [dose_s * F_s, 0.0], t_eval=t_eval, method="RK45", rtol=1e-8)

        Cs_ddi = sol_ddi.y[1]
        Cs_base = sol_base.y[1]

        AUC_ddi = float(np.trapz(Cs_ddi, t_eval))
        AUC_base = float(np.trapz(Cs_base, t_eval))
        AUC_ratio = AUC_ddi / AUC_base if AUC_base > 0 else float("inf")
        Cmax_ddi = float(np.max(Cs_ddi))
        Cmax_base = float(np.max(Cs_base))
        Cmax_ratio = Cmax_ddi / Cmax_base if Cmax_base > 0 else float("inf")

        # Clinical significance classification
        if AUC_ratio >= 5:
            classification = "Strong interaction"
        elif AUC_ratio >= 2:
            classification = "Moderate interaction"
        elif AUC_ratio >= 1.25:
            classification = "Weak interaction"
        else:
            classification = "No significant interaction"

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            axes[0].plot(t_eval, Cs_base, "b-", linewidth=2, label="Substrate alone")
            axes[0].plot(t_eval, Cs_ddi, "r--", linewidth=2, label=f"+ {interaction_type}")
            axes[0].set_xlabel("Time (h)")
            axes[0].set_ylabel("Substrate Concentration")
            axes[0].set_title("Drug-Drug Interaction")
            axes[0].legend()
            axes[0].grid(True, alpha=0.3)

            axes[1].plot(t_eval, sol_ddi.y[3], "g-", linewidth=2)
            axes[1].set_xlabel("Time (h)")
            axes[1].set_ylabel("Perpetrator Concentration")
            axes[1].set_title("Perpetrator Drug PK")
            axes[1].grid(True, alpha=0.3)
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "drug_interaction"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="drug_interaction",
            results={
                "interaction_type": interaction_type,
                "AUC_ratio": round(AUC_ratio, 4),
                "Cmax_ratio": round(Cmax_ratio, 4),
                "AUC_with_interaction": round(AUC_ddi, 4),
                "AUC_baseline": round(AUC_base, 4),
                "Cmax_with_interaction": round(Cmax_ddi, 4),
                "Cmax_baseline": round(Cmax_base, 4),
                "classification": classification,
                "time": t_eval.tolist(),
                "concentration_baseline": Cs_base.tolist(),
                "concentration_with_interaction": Cs_ddi.tolist(),
            },
            figures=figures,
        )

    # ── Target-Mediated Drug Disposition (TMDD) ─────────────────────

    async def _target_mediated_disposition(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Full TMDD model (Mager & Jusko 2001) for biologics/monoclonal antibodies."""
        dose = params["dose"]
        V = params["V"]
        kel = params["kel"]  # linear elimination rate
        kon = params["kon"]  # binding on-rate
        koff = params["koff"]  # binding off-rate
        kint = params["kint"]  # internalization rate
        R0 = params["R0"]  # baseline receptor concentration
        ksyn = params.get("ksyn", kint * R0)  # receptor synthesis rate (steady-state default)
        kdeg = params.get("kdeg", kint)  # receptor degradation rate
        ka = params.get("ka")
        F = params.get("bioavailability", 1.0)
        t_end = params.get("t_end", 720)  # biologics have long half-lives
        n_pts = params.get("n_points", 1000)

        def deriv(t, y):
            if ka:
                A, L, R, LR = y
                dA = -ka * A
                inp = ka * A / V
            else:
                L, R, LR = y
                inp = 0.0

            dL = inp - kel * L - kon * L * R + koff * LR
            dR = ksyn - kdeg * R - kon * L * R + koff * LR
            dLR = kon * L * R - koff * LR - kint * LR

            if ka:
                return [dA, dL, dR, dLR]
            return [dL, dR, dLR]

        if ka:
            y0 = [dose * F, 0.0, R0, 0.0]
        else:
            y0 = [dose * F / V, R0, 0.0]

        t_eval = np.linspace(0, t_end, n_pts)
        sol = integrate.solve_ivp(deriv, (0, t_end), y0, t_eval=t_eval, method="LSODA", rtol=1e-10, atol=1e-12)

        idx = 1 if ka else 0
        L = sol.y[idx]
        R = sol.y[idx + 1]
        LR = sol.y[idx + 2]
        total_drug = L + LR

        Kd = koff / kon
        AUC = float(np.trapz(total_drug, t_eval))

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(2, 2, figsize=(12, 10))
            axes[0, 0].semilogy(t_eval, np.maximum(L, 1e-15), "b-", linewidth=1.5)
            axes[0, 0].set_title("Free Drug (L)")
            axes[0, 0].set_ylabel("Concentration")
            axes[0, 1].plot(t_eval, R, "g-", linewidth=1.5)
            axes[0, 1].set_title("Free Receptor (R)")
            axes[1, 0].plot(t_eval, LR, "r-", linewidth=1.5)
            axes[1, 0].set_title("Drug-Receptor Complex (LR)")
            axes[1, 0].set_xlabel("Time (h)")
            axes[1, 1].semilogy(t_eval, np.maximum(total_drug, 1e-15), "k-", linewidth=2)
            axes[1, 1].set_title("Total Drug (L + LR)")
            axes[1, 1].set_xlabel("Time (h)")
            for ax in axes.flat:
                ax.grid(True, alpha=0.3)
            fig.suptitle("Target-Mediated Drug Disposition", fontsize=14)
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "tmdd"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="target_mediated_disposition",
            results={
                "time": t_eval.tolist(),
                "free_drug": L.tolist(), "free_receptor": R.tolist(), "complex": LR.tolist(),
                "total_drug": total_drug.tolist(),
                "AUC_total": round(AUC, 4),
                "Kd": round(Kd, 6), "R0": R0,
                "target_occupancy_max": round(float(np.max(LR) / (R0 + 1e-15) * 100), 1),
            },
            figures=figures,
        )

    # ── Physiologically-Based PK (PBPK) Simplified ─────────────────

    async def _physiologically_based(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Simplified whole-body PBPK model (perfusion-limited, 7 tissue compartments)."""
        dose = params["dose"]
        route = params.get("route", "iv")
        ka = params.get("ka", 1.0) if route == "oral" else None
        F = params.get("bioavailability", 1.0)
        BW = params.get("body_weight", 70)  # kg
        CO = params.get("cardiac_output", 6.5)  # L/min -> L/h
        CO_Lh = CO * 60

        # Tissue volumes (fraction of BW, L) and blood flows (fraction of CO)
        tissues = params.get("tissues", {
            "lung":    {"V_frac": 0.0076, "Q_frac": 1.0,   "Kp": 0.5},
            "liver":   {"V_frac": 0.026,  "Q_frac": 0.25,  "Kp": params.get("Kp_liver", 3.0)},
            "kidney":  {"V_frac": 0.0044, "Q_frac": 0.19,  "Kp": 2.0},
            "muscle":  {"V_frac": 0.40,   "Q_frac": 0.17,  "Kp": 1.0},
            "adipose": {"V_frac": 0.21,   "Q_frac": 0.05,  "Kp": params.get("Kp_adipose", 0.5)},
            "brain":   {"V_frac": 0.02,   "Q_frac": 0.12,  "Kp": params.get("Kp_brain", 0.1)},
            "rest":    {"V_frac": 0.10,   "Q_frac": 0.22,  "Kp": 1.5},
        })

        CL_hepatic = params["hepatic_clearance"]  # L/h
        CL_renal = params.get("renal_clearance", 0.0)
        fu = params.get("fraction_unbound", 1.0)

        # Build tissue parameters
        tissue_names = list(tissues.keys())
        n_tissues = len(tissue_names)
        V_t = np.array([tissues[t]["V_frac"] * BW for t in tissue_names])
        Q_t = np.array([tissues[t]["Q_frac"] * CO_Lh for t in tissue_names])
        Kp = np.array([tissues[t]["Kp"] for t in tissue_names])

        V_blood = 0.079 * BW  # ~5.5L for 70kg

        # State: [A_gut (if oral), C_blood, C_tissue_1, ..., C_tissue_n]
        n_states = (1 if ka else 0) + 1 + n_tissues
        liver_idx = tissue_names.index("liver") if "liver" in tissue_names else -1
        kidney_idx = tissue_names.index("kidney") if "kidney" in tissue_names else -1

        def deriv(t, y):
            offset = 1 if ka else 0
            if ka:
                A_gut = y[0]
                C_blood = y[1]
            else:
                C_blood = y[0]
            C_t = y[offset + 1:]

            dydt = np.zeros(n_states)

            if ka:
                dydt[0] = -ka * A_gut  # gut absorption

            # Blood compartment
            blood_in = 0.0
            blood_out = 0.0
            for i in range(n_tissues):
                # Venous blood from tissue
                blood_in += Q_t[i] * C_t[i] / Kp[i]
                # Arterial blood to tissue
                blood_out += Q_t[i] * C_blood
                # Tissue change
                dydt[offset + 1 + i] = (Q_t[i] * C_blood - Q_t[i] * C_t[i] / Kp[i]) / V_t[i]
                # Hepatic elimination
                if i == liver_idx:
                    elim = CL_hepatic * fu * C_t[i] / Kp[i]
                    dydt[offset + 1 + i] -= elim / V_t[i]
                # Renal elimination
                if i == kidney_idx and CL_renal > 0:
                    elim_r = CL_renal * fu * C_t[i] / Kp[i]
                    dydt[offset + 1 + i] -= elim_r / V_t[i]

            dydt[offset] = (blood_in - blood_out) / V_blood
            if ka:
                dydt[offset] += ka * A_gut / V_blood

            return dydt.tolist()

        y0 = np.zeros(n_states)
        if ka:
            y0[0] = dose * F
        else:
            y0[0 if not ka else 1] = dose / V_blood

        t_end = params.get("t_end", 72)
        t_eval = np.linspace(0, t_end, params.get("n_points", 500))
        sol = integrate.solve_ivp(deriv, (0, t_end), y0, t_eval=t_eval, method="LSODA", rtol=1e-8, atol=1e-10)

        offset = 1 if ka else 0
        C_blood = sol.y[offset]
        tissue_concs = {tissue_names[i]: sol.y[offset + 1 + i].tolist() for i in range(n_tissues)}

        AUC = float(np.trapz(C_blood, t_eval))
        Cmax = float(np.max(C_blood))

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            axes[0].semilogy(t_eval, np.maximum(C_blood, 1e-15), "b-", linewidth=2, label="Blood")
            for tn in ["liver", "kidney", "brain"]:
                if tn in tissue_concs:
                    axes[0].semilogy(t_eval, np.maximum(sol.y[offset + 1 + tissue_names.index(tn)], 1e-15), "--", linewidth=1, label=tn.capitalize())
            axes[0].set_xlabel("Time (h)")
            axes[0].set_ylabel("Concentration")
            axes[0].set_title("PBPK — Plasma + Key Tissues")
            axes[0].legend(fontsize=8)
            axes[0].grid(True, alpha=0.3)

            # Bar chart of tissue AUCs
            tissue_aucs = {tn: float(np.trapz(sol.y[offset + 1 + i], t_eval)) for i, tn in enumerate(tissue_names)}
            axes[1].barh(list(tissue_aucs.keys()), list(tissue_aucs.values()), color="steelblue")
            axes[1].set_xlabel("AUC")
            axes[1].set_title("Tissue Exposure (AUC)")
            fig.tight_layout()
            figures.append(GeneratedFigure.from_matplotlib(fig, "pbpk"))
            plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="physiologically_based",
            results={
                "time": t_eval.tolist(), "plasma_concentration": C_blood.tolist(),
                "tissue_concentrations": tissue_concs,
                "AUC_plasma": round(AUC, 4), "Cmax_plasma": round(Cmax, 4),
                "body_weight": BW, "cardiac_output_Lh": CO_Lh,
            },
            figures=figures,
        )

    # ── Allometric Scaling ──────────────────────────────────────────

    async def _allometric_scaling(self, req: ComputeRequest, params: dict) -> ComputeResult:
        """Allometric scaling of PK parameters across species."""
        species_data = params["species"]  # list of {name, body_weight, clearance, volume, half_life}
        target_weight = params["target_body_weight"]
        method = params.get("method", "simple")

        weights = np.array([s["body_weight"] for s in species_data], dtype=float)
        names = [s["name"] for s in species_data]

        predictions = {}
        figures_data = {}

        for pk_param in ["clearance", "volume", "half_life"]:
            values = []
            for s in species_data:
                if pk_param in s and s[pk_param] is not None:
                    values.append(float(s[pk_param]))
                else:
                    values.append(None)

            valid = [(w, v) for w, v in zip(weights, values) if v is not None]
            if len(valid) < 2:
                continue

            w_valid = np.array([v[0] for v in valid])
            v_valid = np.array([v[1] for v in valid])

            # Log-log regression: log(Y) = log(a) + b*log(BW)
            log_w = np.log(w_valid)
            log_v = np.log(v_valid)
            slope, intercept, r, p_val, se = sp_stats.linregress(log_w, log_v)

            a = math.exp(intercept)
            b = slope
            predicted = a * target_weight ** b
            r2 = r ** 2

            # Known allometric exponents
            expected_exp = {"clearance": 0.75, "volume": 1.0, "half_life": 0.25}
            exp_note = f"Expected exponent ~{expected_exp.get(pk_param, '?')}, observed {b:.3f}"

            predictions[pk_param] = {
                "predicted_value": round(predicted, 4),
                "coefficient_a": round(a, 6),
                "exponent_b": round(b, 4),
                "r_squared": round(r2, 4),
                "p_value": round(float(p_val), 6),
                "note": exp_note,
            }
            figures_data[pk_param] = (w_valid, v_valid, a, b)

        figures = []
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            n_plots = len(figures_data)
            if n_plots > 0:
                fig, axes = plt.subplots(1, n_plots, figsize=(5 * n_plots, 4))
                if n_plots == 1:
                    axes = [axes]
                for ax, (param_name, (ws, vs, a, b)) in zip(axes, figures_data.items()):
                    ax.loglog(ws, vs, "ko", markersize=8)
                    w_range = np.logspace(np.log10(ws.min() * 0.1), np.log10(max(target_weight, ws.max()) * 2), 100)
                    ax.loglog(w_range, a * w_range ** b, "r-", linewidth=1.5)
                    ax.loglog(target_weight, a * target_weight ** b, "r*", markersize=15)
                    for i, name in enumerate([n for n, v in zip(names, values) if v is not None]):
                        ax.annotate(name, (ws[i], vs[i]), fontsize=7, xytext=(5, 5), textcoords="offset points")
                    ax.set_xlabel("Body Weight (kg)")
                    ax.set_ylabel(param_name.replace("_", " ").title())
                    ax.set_title(f"Allometric Scaling: {param_name}")
                    ax.grid(True, alpha=0.3, which="both")
                fig.tight_layout()
                figures.append(GeneratedFigure.from_matplotlib(fig, "allometric_scaling"))
                plt.close(fig)
        except ImportError:
            pass

        return ComputeResult(
            request_id=req.id, domain=ComputeDomain.PHARMACOKINETICS, operation="allometric_scaling",
            results={
                "predictions": predictions,
                "target_body_weight": target_weight,
                "n_species": len(species_data),
                "species": names,
            },
            figures=figures,
        )

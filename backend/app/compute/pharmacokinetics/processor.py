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
        "solve_ode", "one_compartment", "two_compartment", "multiple_dosing",
        "dose_optimization", "noncompartmental_analysis", "pk_fitting",
        "michaelis_menten", "systems_biology", "bioequivalence",
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

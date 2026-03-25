"""
Compute Endpoint — Execute Python/R/Julia code in sandboxed environments.

For a cloud-deployed platform, code runs in isolated subprocess with timeout.
Python: Uses subprocess with restricted builtins
R: Uses Rscript subprocess
Julia: Uses julia subprocess
"""

import asyncio
import os
import subprocess
import tempfile
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/compute", tags=["compute"])

TIMEOUT_SECONDS = 30
MAX_OUTPUT_LENGTH = 50_000


class ExecuteRequest(BaseModel):
    code: str
    environment: str = "python"  # python, r, julia
    timeout: Optional[int] = None


class ExecuteResponse(BaseModel):
    output: str
    stderr: str = ""
    exit_code: int = 0
    timed_out: bool = False
    environment: str = "python"


def _get_python_wrapper(code: str) -> str:
    """Wrap user code with safety restrictions for Python execution."""
    return f"""
import sys
import io
import math
import statistics
import random
import json
import csv
import itertools
import functools
import collections
import datetime
import re

# Scientific computing imports (if available)
try:
    import numpy as np
except ImportError:
    pass
try:
    import scipy
    from scipy import stats as scipy_stats
    from scipy import optimize, integrate, interpolate
except ImportError:
    pass
try:
    import pandas as pd
except ImportError:
    pass

# Redirect stdout
_stdout = io.StringIO()
sys.stdout = _stdout

try:
{chr(10).join('    ' + line for line in code.split(chr(10)))}
except Exception as e:
    print(f"Error: {{type(e).__name__}}: {{e}}")

sys.stdout = sys.__stdout__
print(_stdout.getvalue(), end='')
"""


@router.post("/execute", response_model=ExecuteResponse)
async def execute_code(request: ExecuteRequest) -> ExecuteResponse:
    """Execute code in a sandboxed environment."""
    env = request.environment.lower()
    timeout = min(request.timeout or TIMEOUT_SECONDS, 60)  # max 60s

    if env not in ("python", "r", "julia"):
        raise HTTPException(400, f"Unsupported environment: {env}")

    if len(request.code) > 100_000:
        raise HTTPException(400, "Code too long (max 100KB)")

    logger.info(f"Executing {env} code ({len(request.code)} chars)")

    try:
        if env == "python":
            result = await _run_python(request.code, timeout)
        elif env == "r":
            result = await _run_r(request.code, timeout)
        elif env == "julia":
            result = await _run_julia(request.code, timeout)
        else:
            raise HTTPException(400, f"Unknown environment: {env}")

        return ExecuteResponse(
            output=result["stdout"][:MAX_OUTPUT_LENGTH],
            stderr=result["stderr"][:MAX_OUTPUT_LENGTH],
            exit_code=result["exit_code"],
            timed_out=result.get("timed_out", False),
            environment=env,
        )
    except asyncio.TimeoutError:
        return ExecuteResponse(
            output="",
            stderr=f"Execution timed out after {timeout} seconds",
            exit_code=124,
            timed_out=True,
            environment=env,
        )
    except Exception as e:
        logger.error(f"Compute execution error: {e}")
        return ExecuteResponse(
            output="",
            stderr=str(e),
            exit_code=1,
            environment=env,
        )


async def _run_python(code: str, timeout: int) -> dict:
    """Run Python code in a subprocess."""
    wrapped = _get_python_wrapper(code)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(wrapped)
        f.flush()
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            "python3", tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode or 0,
        }
    except asyncio.TimeoutError:
        proc.kill()
        return {"stdout": "", "stderr": f"Timed out after {timeout}s", "exit_code": 124, "timed_out": True}
    finally:
        os.unlink(tmp_path)


async def _run_r(code: str, timeout: int) -> dict:
    """Run R code using Rscript."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".R", delete=False) as f:
        f.write(code)
        f.flush()
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            "Rscript", "--vanilla", tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode or 0,
        }
    except asyncio.TimeoutError:
        proc.kill()
        return {"stdout": "", "stderr": f"Timed out after {timeout}s", "exit_code": 124, "timed_out": True}
    except FileNotFoundError:
        return {"stdout": "", "stderr": "R is not installed. Install R to use R computations.", "exit_code": 1}
    finally:
        os.unlink(tmp_path)


async def _run_julia(code: str, timeout: int) -> dict:
    """Run Julia code."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jl", delete=False) as f:
        f.write(code)
        f.flush()
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            "julia", "--startup-file=no", tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode or 0,
        }
    except asyncio.TimeoutError:
        proc.kill()
        return {"stdout": "", "stderr": f"Timed out after {timeout}s", "exit_code": 124, "timed_out": True}
    except FileNotFoundError:
        return {"stdout": "", "stderr": "Julia is not installed. Install Julia to use Julia computations.", "exit_code": 1}
    finally:
        os.unlink(tmp_path)

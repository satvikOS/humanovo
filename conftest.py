"""
conftest.py for integration tests.

Configures Python path and provides common fixtures.
"""

import os
import sys
from pathlib import Path

import pytest

# Ensure the backend directory is on the Python path
# so that `from app.agents...` imports work.
backend_dir = Path(__file__).resolve().parent.parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Load .env file if it exists
env_file = backend_dir / ".env"
if env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
    except ImportError:
        # python-dotenv not installed; env vars must be set manually
        pass


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "slow: marks tests as slow (deselect with '-m \"not slow\"')",
    )
    config.addinivalue_line(
        "markers",
        "requires_llm: marks tests that require LLM provider credentials",
    )

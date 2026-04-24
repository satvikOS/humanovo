"""
Hypothesis Diversity Enforcement

Per product directive: each hypothesis is supposed to be going in a
different direction, approach, or idea. After hypothesis 1 is generated,
hypothesis 2 must confirm it is NOT similar to hypothesis 1 except for
sharing common science and philosophy.

Enforcement happens at SEED stage via an adversarial diversity check that:
  1. Embeds the seed (in both dual-embedding spaces).
  2. Computes cosine distance to every previously accepted hypothesis's
     seed embedding.
  3. Extracts the mechanism axis (target pathway, modality, intervention type)
     and verifies it differs across axes.
  4. If diversity score is below threshold, the seed is REJECTED and
     regenerated with an explicit anti-similarity prompt injection.
"""

from app.agents.diversity.diversity_enforcer import (
    DiversityEnforcer,
    DiversityReport,
    MechanismAxis,
    get_diversity_enforcer,
)

__all__ = [
    "DiversityEnforcer",
    "DiversityReport",
    "MechanismAxis",
    "get_diversity_enforcer",
]

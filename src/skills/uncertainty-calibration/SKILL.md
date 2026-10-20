---
id: uncertainty-calibration
name: Uncertainty Calibration
agents: A1, A2, A3, A4, A5, A6, A7, A8, A9
version: 1.1.0
purpose: Express confidence honestly and tie it to evidence quality.
---

# Uncertainty Calibration

## Scale

- `0.9–1.0` — direct, current, authoritative evidence; deterministic check passed.
- `0.7–0.89` — strong evidence with a minor inference.
- `0.5–0.69` — partial evidence; a material assumption is required.
- `0.3–0.49` — weak evidence; output is a hypothesis.
- `< 0.3` — insufficient evidence; do not make a consequential recommendation.

## Rules

- Confidence is about the claim, not the fluency of the answer.
- Lower confidence when a source is expired, conflicted, or out of scope.
- Never output 1.0; no claim is certain.
- Do not average confidence across unrelated claims.
- When confidence is below 0.5, the output must include the missing evidence needed to improve it.

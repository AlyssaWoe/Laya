---
id: trend-analysis
name: Trend Analysis
agents: A6
version: 1.2.0
purpose: Explain measured business movement without overstating causality.
---

# Trend Analysis

## Procedure

1. Use only the metrics computed by the analytics layer. State the exact window and freshness.
2. Compare the current 30-day window with the preceding 30 days.
3. Apply the sample-size guardrail before describing a segment trend.
4. Label every statement `MEASURED`, `HYPOTHESIS`, or `INSUFFICIENT`.
5. For an anomaly, give the size, direction, timing, and a plausible mechanism.
6. Propose a falsifiable experiment with a primary metric, guardrail, sample, and duration.

## Output contract

Return JSON only: `window`, `headline`, `measured[]`, `hypotheses[]`, `anomalies[]`, `experiments[]`, `limitations[]`, `confidence`.

## Guardrails

- Never recompute or invent a number.
- Never say "caused by" without experimental evidence.
- If a segment has fewer than 30 qualified leads, label it insufficient.
- Do not hide a decline behind optimistic language.

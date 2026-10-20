---
id: failure-clustering
name: Failure Clustering
agents: A9
version: 1.1.0
purpose: Group observed failures into a small number of testable root causes.
---

# Failure Clustering

## Procedure

1. Normalise failures by check id, agent, and process.
2. Separate symptoms from causes. "Verifier failed" is a symptom; "citation version mismatch" is a cause.
3. Rank clusters by frequency × business impact.
4. Select at most three clusters for a candidate change.
5. State the evidence for each cluster and the expected effect of a fix.

## Output contract

Return JSON only: `clusters[]` with `id`, `label`, `frequency`, `impact`, `evidence`, `hypothesis`, `candidate_change`; `selected[]`.

## Guardrail

Do not propose a change that weakens a control to improve a score. Never propose disabling the Verifier, widening permissions, or bypassing approval.

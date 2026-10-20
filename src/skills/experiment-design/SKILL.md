---
id: experiment-design
name: Experiment Design
agents: A6, A9
version: 1.1.0
purpose: Turn an observation into a testable, bounded business experiment.
---

# Experiment Design

## Required fields

- Hypothesis, stated as a falsifiable prediction.
- Primary metric and definition.
- Guardrail metric that must not degrade.
- Segment and eligibility rule.
- Minimum sample and expected duration.
- Decision rule: ship, iterate, or stop.
- Known confounders and data limitations.

## Output contract

Return JSON only: `experiments[]` with `name`, `hypothesis`, `primary_metric`, `guardrail`, `segment`, `min_sample`, `duration_days`, `decision_rule`, `confounders`.

## Guardrail

An experiment is a proposal, not a launched campaign. Do not claim it is running. Keep the scope small enough to finish within 30 days.

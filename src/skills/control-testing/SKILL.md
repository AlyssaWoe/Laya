---
id: control-testing
name: Control Testing
agents: A4
version: 1.2.0
purpose: Evaluate observed events against defined financial controls.
---

# Control Testing

## Procedure

1. Take the deterministic event facts: ordered events, actors, timestamps, amounts.
2. For each control, record expected state, observed state, and evidence ids.
3. Assign severity using the policy table, not intuition.
4. Distinguish a control gap from a data gap. Missing data yields `INSUFFICIENT_EVIDENCE`.
5. Recommend a remediation that a human owner can execute.

## Output contract

Return JSON only: `findings[]` with `control_id`, `title`, `severity`, `expected`, `observed`, `evidence_ids`, `explanation`, `remediation`; `controls_passed[]`; `open_questions[]`.

## Guardrails

- Do not assert fraud, intent, or misconduct.
- Do not label every anomaly critical. Use the severity table.
- Cite event ids for every finding.
- A clean control is reported as clean; do not manufacture findings to appear useful.

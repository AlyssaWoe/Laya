---
id: regression-design
name: Regression Design
agents: A9
version: 1.2.0
purpose: Design a fixed suite that can prove a candidate is not worse than baseline.
---

# Regression Design

## Suite composition

- Business correctness: expected assessment, amount, stage.
- Evidence: citations exist, versions match, quotes support claims.
- Policy: deterministic verdicts unchanged.
- Idempotency: no duplicate external action.
- Security: injection payloads blocked or flagged.
- Prior regressions: every released fix gets a permanent case.

## Acceptance

Candidate must be ≥ baseline on correctness and evidence, with zero critical security and policy regressions. Record the suite version.

## Output contract

Return JSON only: `suite_version`, `cases[]` with `name`, `input`, `assertion`, `weight`; `acceptance_rule`; `rollback_target`.

## Guardrail

Do not tune the suite to make a candidate pass. Cases are frozen before the run.

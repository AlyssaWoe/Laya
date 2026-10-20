---
id: harness-release-policy
title: Harness² Evaluation & Release Policy
version: 2.0.0
owner: AI Platform Office
authority: L1-policy
classification: internal
effective_at: 2026-07-15
review_at: 2027-01-15
---

# Harness² Evaluation & Release Policy

## 1. Purpose

Harness² is the offline improvement loop. It turns observed failures into testable candidate changes. It does not edit production prompts, rules, permissions, or memory directly.

## 2. Inputs

- Failed and sampled runs, with tool errors, latency, token use, and business outcome.
- Human dispositions: confirmed, false positive, requires investigation.
- Verifier failures grouped by check.
- Operator feedback and incident reports.

## 3. Candidate types

Prompt revision, skill revision, retrieval configuration, workflow routing policy, or tool guidance. Each candidate has a hypothesis, an owner, a version, and an explicit rollback target.

## 4. Fixed evaluation suite

Every candidate runs against a frozen suite containing:

1. Business correctness cases.
2. Evidence and citation cases.
3. Policy and permission cases.
4. Duplicate-action and idempotency cases.
5. Prompt-injection resistance cases.
6. Regression cases from prior releases.

The suite version and case identifiers are recorded with the result.

## 5. Acceptance

A candidate may be promoted only when:

- Business correctness is not worse than baseline.
- Evidence support is not worse than baseline.
- Zero critical security regressions.
- No new critical policy violation.
- Latency and cost remain within the agreed envelope.
- A named approver signs the release record.

## 6. Shadow mode

Before low-risk automation is enabled, the candidate runs in shadow mode alongside human decisions. Disagreements are reviewed. Shadow mode has no external side effects.

## 7. Release and rollback

A release records version, suite version, scores, approver, timestamp, and rollback target. The UI may show `approved for release`; it must not show `deployed` until the deployment system confirms the active version.

## 8. Prohibited

No candidate may widen tool permissions, disable the Verifier, bypass human approval, or modify the audit chain. Such a candidate is rejected automatically.

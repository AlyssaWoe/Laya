---
id: memory-governance
title: Memory Governance Standard
version: 2.0.0
owner: Knowledge Office
authority: L1-policy
classification: internal
effective_at: 2026-05-01
review_at: 2026-11-01
---

# Memory Governance Standard

## 1. Purpose

Memory allows the system to reuse verified experience. It must never become a side channel that silently rewrites policy. Memory is **candidate knowledge** until a named owner approves it.

## 2. Lifecycle

```
observed → candidate → conflict-checked → owner review → approved | rejected | expired
```

- **Observed** — extracted from a completed run, with provenance.
- **Candidate** — deduplicated and scoped, awaiting review.
- **Approved** — retrievable as L2/L3 context with its scope and expiry.
- **Rejected / Expired** — retained for audit but excluded from retrieval.

## 3. Conflict handling

A candidate that contradicts L0–L2 authority is not merged. It is recorded as a conflict showing both statements, their sources and versions, and the affected scope. The knowledge owner decides whether to reject the candidate, update the policy, or narrow the scope.

## 4. Required metadata

Every memory records: title, statement, scope, source run or document, author, creation time, confidence, expiry, review status, and reviewer. A memory without provenance is invalid.

## 5. Expiry

Default expiry for operational memory is 180 days. Policy-linked memory expires with the policy version. Expired memories are excluded from retrieval and flagged in the knowledge view.

## 6. Retrieval precedence

Live business data (L4) outranks memory for facts such as payment status or task progress. Approved policy (L1) outranks memory for rules. Memory is context, not authority.

## 7. Publication

Publication of a memory that changes how a rule is interpreted requires knowledge-owner approval and an audit record. The Memory Agent may propose; it may not publish.

## 8. Quality review

The knowledge owner checks: provenance, scope, specificity, conflict status, expiry, and whether the statement is likely to remain true. Vague lessons ("be more careful") are rejected.

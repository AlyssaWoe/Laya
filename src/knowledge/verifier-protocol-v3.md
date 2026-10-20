---
id: verifier-protocol
title: Verifier Protocol
version: 3.1.0
owner: Assurance Office
authority: L1-policy
classification: internal
effective_at: 2026-06-01
review_at: 2026-12-01
---

# Verifier Protocol

## 1. Independence

The Verifier is an independent control. It does not share the business agent's prompt, does not accept the business agent's claims as facts, and does not rely solely on another language model to judge an answer. Deterministic checks run first.

## 2. Checks

| ID | Check | Method |
|---|---|---|
| V-01 | Schema conformance | deterministic schema validation |
| V-02 | Evidence existence | document lookup by id and version |
| V-03 | Citation support | claim-to-chunk comparison, model-assisted with quotes required |
| V-04 | Policy consistency | independent Policy Engine evaluation |
| V-05 | Data reconciliation | fresh SQL query against the authoritative ledger |
| V-06 | Duplicate-action prevention | idempotency key and window check |
| V-07 | Approval completeness | approval record for required risk class |
| V-08 | Tool conformance | requested tool in agent allowlist |

## 3. Outcomes

- **PASS** — all mandatory checks pass.
- **PASS_WITH_NOTES** — mandatory checks pass; non-blocking observations exist.
- **FAIL** — at least one mandatory check fails, or evidence is insufficient for a consequential claim.

A failure returns a remediation: `request_evidence`, `recompute`, `replan`, `human_review`, or `block`.

## 4. Evidence requirement

A citation is valid only when the quoted text exists in the cited chunk of the cited document version. Paraphrase without a quote is not sufficient for a consequential claim. Cite the chunk identifier.

## 5. Model use

The Verifier may use a model to compare a claim with a quoted passage. It must send the claim and the passage only, must require a `supported | partially_supported | unsupported` label, and must treat `unsupported` as a failure. The model does not see the business agent's confidence or conclusion.

## 6. Re-query rule

Any monetary value, payment status, due date, or approval state is re-queried from the authoritative database immediately before verification. Cached values are not accepted.

## 7. Reporting

Each check reports status, method, evidence reference, and a human-readable explanation. The report is stored with the run and linked from the workflow stage.

## 8. Escalation

Repeated failures of the same check are routed to the Assurance Office and become candidates for Harness² improvement.

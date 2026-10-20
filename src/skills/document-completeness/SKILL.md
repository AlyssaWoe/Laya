---
id: document-completeness
name: Document Completeness
agents: A3
version: 1.2.0
purpose: Detect missing, expired, or unverified application documents.
---

# Document Completeness

## States

- `PRESENT` — supplied and within validity.
- `MISSING` — required and not supplied.
- `EXPIRED` — supplied but outside validity.
- `UNVERIFIED` — supplied but authenticity or signature cannot be confirmed.

## Procedure

1. Compare the supplied document list with the checklist applicable to the grant band.
2. Apply the conservative threshold when two active policies disagree.
3. For each gap, write a specific request: document reference, why it is required, and the affected rule.
4. Do not ask for documents that are not required for this band.

## Output contract

Return JSON only: `documents[]` with `ref`, `name`, `state`, `reason`; `missing[]`; `requests[]`; `completeness_ratio`.

## Guardrail

A missing document is an evidence gap, not a finding of dishonesty. Never characterise the applicant's intent.

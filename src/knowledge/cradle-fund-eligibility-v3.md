---
id: cradle-fund-eligibility
title: Cradle Fund Eligibility & Assessment Standard
version: 3.2.0
owner: Cradle Fund Programme Office
authority: L1-policy
classification: restricted
effective_at: 2026-06-15
review_at: 2027-06-15
---

# Cradle Fund Eligibility & Assessment Standard

## 1. Scope

This standard governs pre-assessment of Cradle Fund grant applications. It supports a qualified reviewer. It does not delegate the funding decision to an AI system.

## 2. Mandatory eligibility conditions

A application is **eligible** only when all mandatory conditions are evidenced:

| ID | Condition | Threshold |
|---|---|---|
| CF-01 | Applicant is incorporated in Malaysia under the Companies Act | SSM registration number present |
| CF-02 | Malaysian equity participation | at least 51% |
| CF-03 | Operating history | at least 12 months since incorporation |
| CF-04 | Grant request within programme band | RM 50,000 to RM 1,000,000 |
| CF-05 | Matching contribution | at least 25% of the requested grant |
| CF-06 | Active grant exposure | no more than 2 active Cradle grants |
| CF-07 | Audited financial statements | required where the requested grant exceeds RM 500,000 |
| CF-08 | Tax clearance | current-year clearance or valid exemption |

## 3. Required documents

1. Completed application form (signed by an authorised director).
2. Business plan covering the funded milestone.
3. 24-month financial projection with assumptions.
4. Certificate of incorporation and company constitution.
5. Shareholder register evidencing equity composition.
6. Audited financial statements where CF-07 applies.
7. Tax clearance or exemption letter.
8. Pitch deck or technical annex.

## 4. Assessment outcomes

- **ELIGIBLE** — every mandatory condition passes and every required document is present and current.
- **INELIGIBLE** — at least one mandatory condition fails on evidenced facts.
- **INSUFFICIENT_EVIDENCE** — no condition is evidenced as failed, but at least one condition or document cannot be verified.

A missing document is not, by itself, proof of ineligibility. It produces `INSUFFICIENT_EVIDENCE` and a targeted request for the missing item.

## 5. Evidence standard

Each condition must reference the document identifier, version, and the specific clause or field used. Calculations (equity percentage, matching ratio, grant band) are performed deterministically by the rules engine. The execution model may explain the result but may not alter the arithmetic.

## 6. Human decision

The programme reviewer reviews the assessment summary, the evidence pack, and any rule conflict. Only an authorised reviewer may record a funding recommendation. The AI output is an **assessment**, never an approval.

## 7. Change control

Threshold changes require policy approval and a new version of this document. Superseded versions remain readable for audit.

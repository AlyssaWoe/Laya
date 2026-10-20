---
id: partnerflow-control-standard
title: PartnerFlow Control & Audit Standard
version: 4.1.0
owner: PartnerFlow Finance Operations
authority: L1-policy
classification: restricted
effective_at: 2026-05-20
review_at: 2027-05-20
---

# PartnerFlow Control & Audit Standard

## 1. Control objective

Every partner claim must move through an authorised, ordered, and evidenced approval chain. No payment may be released without a complete chain. The audit function verifies **facts first** and only then interprets possible causes.

## 2. Canonical event sequence

```
claim.submitted
  → documents.verified
  → manager.approved
  → finance.approved
  → payment.released
```

The sequence is canonical for standard claims. A documented exception path must reference an approved exception record. Missing events are not automatically fraud; they are control gaps requiring explanation.

## 3. Segregation of duties

| Control | Requirement |
|---|---|
| PF-SOD-01 | The submitter cannot be the manager approver |
| PF-SOD-02 | The manager approver cannot be the finance approver |
| PF-SOD-03 | The finance approver cannot release payment |
| PF-SOD-04 | One payment release per claim |

## 4. Duplicate and replay controls

- A claim may have at most one `payment.released` event.
- Event identifiers must be unique per claim.
- A release with an amount greater than the approved amount is a critical exception.
- Idempotency keys are mandatory for any retried release operation.

## 5. Severity

| Severity | Definition | Examples |
|---|---|---|
| Critical | Direct financial loss or confirmed duplicate | duplicate release, release above approval |
| High | Control bypass with financial exposure | missing finance approval, approver equals releaser |
| Medium | Order or documentation defect | out-of-order event, missing timestamp |
| Low | Hygiene issue | missing reviewer note, inconsistent label |

## 6. Evidence standard

Each finding must cite the observed event identifiers, actor identifiers, timestamps, and the control reference. A finding without evidence is not a finding: it is an open question.

## 7. Interpretation boundary

The audit model may propose a probable cause and a recommended control remediation. It may not assert intent, fraud, or misconduct. Those conclusions belong to a human investigation.

## 8. Human review

Critical and high findings are escalated to a human reviewer. The reviewer records a disposition: confirmed, false positive, or requires investigation. The disposition and rationale are appended to the immutable audit trail.

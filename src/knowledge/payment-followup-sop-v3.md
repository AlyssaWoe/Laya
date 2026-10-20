---
id: payment-followup-sop
title: Payment Follow-up SOP
version: 3.0.0
owner: PartnerFlow Finance Operations
authority: L1-policy
classification: restricted
effective_at: 2026-07-01
review_at: 2027-01-01
---

# Payment Follow-up SOP

## 1. Principle

A reminder is a controlled external communication. It must be based on the **current reconciled ledger**, addressed to the correct counterparty, approved where required, and sent at most once per stage per invoice.

## 2. Cadence

| Stage | Trigger | Tone | Approval |
|---|---|---|---|
| P1 | 7 days overdue | courteous check-in | automatic if below threshold |
| P2 | 14 days overdue | clear reminder | automatic if below threshold |
| P3 | 30 days overdue | firm reminder | human review |
| P4 | 45 days overdue | final notice and escalation | human review |

The cadence is measured from the due date, using the tenant's business calendar.

## 3. Pre-send checklist

1. Re-read the invoice from the authoritative ledger, not from cached prompt context.
2. Recompute `outstanding = amount - paid - credits`.
3. Confirm the customer is not marked `disputed` or `on_hold`.
4. Confirm no reminder for the same invoice and stage within the duplicate window (24 hours).
5. Confirm the approval requirement for the amount and stage.
6. Attach a stable idempotency key: `invoiceId:stage:runId`.

If any check fails, do not send. Record the blocked reason.

## 4. Content requirements

A reminder must include: invoice number, outstanding amount and currency, original due date, days overdue, payment instructions, and a named contact. It must not include legal threats, fabricated penalties, or promises the company has not authorised.

## 5. Disputes and partial payments

A customer dispute pauses automated follow-up immediately. Partial payment reduces the outstanding balance but does not reset the cadence unless the balance is zero. A disputed invoice is routed to a human owner.

## 6. Thresholds

- Amount above **RM 25,000**: human approval required before any external send.
- Stage P3 or P4: human approval required regardless of amount.
- Customer marked strategic: human approval required.

## 7. Execution and proof

A draft is not a sent message. The outbox records `queued → sent → reconciled` separately. If delivery fails, the state is `failed` and no duplicate is attempted without a new idempotency check.

## 8. Data authority

The ledger is authoritative for amount, paid amount, due date, and status. Model memory, chat history, and prior drafts are never authoritative.

---
id: payment-idempotency
name: Payment Idempotency
agents: A5, A8
version: 1.1.0
purpose: Prevent duplicate reminders and duplicate external actions.
---

# Payment Idempotency

## Pre-send gate

1. Re-query the ledger for amount, paid amount, due date, and status.
2. If `outstanding <= 0`, stop. The invoice is settled.
3. If status is `disputed`, `on_hold`, or `under_review`, stop and route to a human owner.
4. Check the outbox for the same `invoice_id + stage` inside the duplicate window (24 hours).
5. Build the key `invoiceId:stage:runId` and check it has not been used.
6. Confirm approval requirements: amount > RM 25,000, or stage P3/P4, or strategic customer.

## Output contract

Return JSON only: `allowed` boolean, `blocked_reason`, `idempotency_key`, `requisite_checks[]`, `approval_required`.

## Guardrail

A failed check must block the action. Never downgrade a block to a warning to make progress. Never generate a new key to bypass an existing key.

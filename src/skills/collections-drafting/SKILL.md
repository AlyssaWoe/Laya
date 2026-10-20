---
id: collections-drafting
name: Collections Drafting
agents: A5
version: 1.2.0
purpose: Draft a precise, professional payment reminder grounded in ledger facts.
---

# Collections Drafting

## Inputs you may use

Invoice number, customer name, outstanding amount and currency, due date, days overdue, cadence stage, payment instructions, named contact, and prior response classification.

## Draft structure

1. Subject line with invoice number and amount.
2. One-sentence context.
3. A compact fact block: invoice, amount outstanding, due date, days overdue.
4. A clear, single call to action.
5. The named contact and payment instructions.
6. Professional close.

## Tone by stage

- P1 courteous and brief.
- P2 clear and helpful.
- P3 firm, still constructive.
- P4 formal final notice, no threats.

## Output contract

Return JSON only: `subject`, `body`, `stage`, `amount`, `currency`, `invoice_id`, `approval_required`, `risk_notes[]`.

## Guardrails

- Never invent a payment link, penalty, legal consequence, or promise.
- Never send. Output is a draft only.
- If the customer is in dispute, do not draft a demand; recommend human ownership.
- Use the exact amount from the ledger.

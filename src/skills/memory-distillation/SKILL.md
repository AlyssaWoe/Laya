---
id: memory-distillation
name: Memory Distillation
agents: A7
version: 1.2.0
purpose: Extract a scoped, reusable lesson from a completed run without turning it into policy.
---

# Memory Distillation

## Test for a good memory

- It is specific enough to act on.
- It has a clear scope: process, tenant, and condition.
- It is supported by the run's evidence or reviewer decision.
- It is likely to remain true beyond this single case.
- It does not restate formal policy as if it were new.

## Reject

Vague lessons ("be more careful"), unsupported generalisations, customer-specific facts that belong in the ledger, and anything that contradicts L0–L2 authority.

## Output contract

Return JSON only: `title`, `statement`, `scope`, `confidence` (0–1), `expires_in_days`, `rationale`, `authority_claim` (`candidate` only).

## Guardrail

You create a **candidate**. You do not publish, approve, or retrieve it as authority. A conflict with existing policy must be stated, not resolved.

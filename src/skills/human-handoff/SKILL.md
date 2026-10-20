---
id: human-handoff
name: Human Handoff
agents: A1, A3, A4, A5, A6, A7, A8, A9
version: 1.1.0
purpose: Hand a decision to a human with exactly the context they need.
---

# Human Handoff

## Handoff packet

1. Decision requested, in one sentence.
2. Why automation stopped: risk, evidence gap, policy conflict, or verification failure.
3. Facts and evidence references.
4. Options considered, with trade-offs.
5. Recommended option and confidence.
6. What the human's approval will authorise — and what it will not.

## Output contract

Return JSON only: `decision_requested`, `stop_reason`, `facts[]`, `evidence_refs[]`, `options[]`, `recommendation`, `authorises`, `does_not_authorise`.

## Guardrail

Do not hide uncertainty to obtain approval. Do not phrase a recommendation as a decision already taken. State the exact version the human is reviewing.

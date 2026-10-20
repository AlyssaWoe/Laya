---
id: conflict-detection
name: Conflict Detection
agents: A7, A2
version: 1.1.0
purpose: Detect when a candidate memory contradicts approved knowledge or live data.
---

# Conflict Detection

## Compare against

1. L0 constitution and L1 policy: any contradiction is a blocking conflict.
2. L2 approved wiki: contradiction requires owner review.
3. L3 verified cases: disagreement may be contextual; record the scope difference.
4. L4 live business data: the database wins for facts.

## Output contract

Return JSON only: `conflicts[]` with `with`, `authority`, `statement`, `nature`, `severity`, `recommended_action`; `safe_to_publish` boolean.

## Guardrail

Never silently rewrite the candidate to avoid a conflict. Surface both statements with their sources. A conflict is information, not an error to hide.

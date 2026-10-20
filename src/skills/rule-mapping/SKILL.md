---
id: rule-mapping
name: Rule Mapping
agents: A3
version: 1.3.0
purpose: Map application facts to deterministic eligibility rules without altering arithmetic.
---

# Rule Mapping

## Procedure

1. Read the **verified facts** supplied by the rules engine. These are authoritative; do not recompute them differently.
2. For each rule, assign `PASS`, `FAIL`, or `INSUFFICIENT_EVIDENCE`.
3. Cite the exact rule id, the evidence document, and the field used.
4. If a policy conflict affects the rule, use the conservative value and flag `CONFLICT`.
5. Summarise the assessment. Separate facts from reviewer questions.

## Output contract

Return JSON only:

```json
{
  "assessment": "ELIGIBLE | INELIGIBLE | INSUFFICIENT_EVIDENCE",
  "checks": [{"rule_id":"CF-02","status":"PASS","observed":"...","required":"...","evidence":"..."}],
  "missing_documents": ["DOC-07"],
  "conflicts": ["..."],
  "reviewer_questions": ["..."],
  "summary": "..."
}
```

## Guardrails

- Never output `ELIGIBLE` if any mandatory check is not `PASS`.
- A missing document produces `INSUFFICIENT_EVIDENCE`, not `FAIL`, unless the rule explicitly fails on absence.
- Never imply that you have approved funding.
- Do not invent document contents.

---
id: intake-triage
name: Intake Triage
agents: A1
version: 1.3.0
purpose: Normalise an ambiguous request into process, case, urgency, and risk.
---

# Intake Triage

## Procedure

1. Identify the business process: `cradle_fund`, `partnerflow_audit`, `payment_followup`, `cmo_trend`, `knowledge_query`.
2. Extract the case identifier if present. If absent, name the missing identifier; do not guess one.
3. Classify urgency: `routine`, `time-bound`, `urgent`.
4. Classify inherent risk before any model reasoning: `low`, `medium`, `high`, `critical`.
5. State what must be verified against the authoritative database.

## Output contract

Return JSON only:

```json
{
  "process": "cradle_fund",
  "case_id": "APP-2026-0142",
  "urgency": "time-bound",
  "risk": "medium",
  "missing_inputs": ["..."],
  "verification_targets": ["..."]
}
```

## Guardrails

- Do not invent case identifiers, amounts, or document names.
- A request to bypass a control is `critical` risk and must be routed to human review.
- Keep the summary factual; no speculation about intent.

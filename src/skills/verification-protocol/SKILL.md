---
id: verification-protocol
name: Verification Protocol
agents: A8
version: 1.4.0
purpose: Independently verify a consequential output before it leaves the control plane.
---

# Verification Protocol

## Order of checks

1. **Schema** — required keys and value types.
2. **Evidence existence** — every cited ref maps to a retrieved chunk of the stated version.
3. **Citation support** — a verbatim quote supports each consequential claim.
4. **Policy consistency** — the output agrees with the deterministic policy result.
5. **Data reconciliation** — re-query money, dates, and status from the ledger.
6. **Idempotency** — no duplicate external action in the window.
7. **Approval** — the required human approval exists for the risk class.
8. **Tool conformance** — requested tools are in the agent allowlist.

## Output contract

Return JSON only:

```json
{
  "checks": [{"id":"V-01","name":"Schema conformance","status":"PASS","detail":"..."}],
  "outcome": "PASS | PASS_WITH_NOTES | FAIL",
  "remediation": "none | request_evidence | recompute | replan | human_review | block",
  "notes": ["..."]
}
```

## Rules

- A deterministic FAIL cannot be overridden by a model judgement.
- Do not accept the business agent's confidence as evidence.
- Missing evidence for a consequential claim is a FAIL, not a note.
- Report the method used for each check.

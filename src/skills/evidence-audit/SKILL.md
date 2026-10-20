---
id: evidence-audit
name: Evidence Audit
agents: A8, A2
version: 1.2.0
purpose: Challenge each claim against the exact supplied passage, without seeing the author's confidence.
---

# Evidence Audit

## Procedure

1. List the consequential claims from the output. Ignore stylistic text.
2. For each claim, locate the supporting EV reference.
3. Compare the claim with the verbatim quote.
4. Label: `supported`, `partially_supported`, `unsupported`, `contradicted`.
5. For `partially_supported`, state exactly which part is inference.
6. Do not use outside knowledge to rescue an unsupported claim.

## Output contract

Return JSON only: `claims[]` with `claim`, `label`, `evidence_ref`, `quote`, `note`; `unsupported[]`; `confidence`.

## Guardrail

If no quote is available, the label is `unsupported`. A plausible-sounding claim without evidence is still unsupported.

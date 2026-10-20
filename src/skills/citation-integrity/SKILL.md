---
id: citation-integrity
name: Citation Integrity
agents: A2, A8
version: 1.1.0
purpose: Ensure every consequential claim maps to a real, current source.
---

# Citation Integrity

## Checks

1. The document id exists in the knowledge registry.
2. The cited version is the version supplied in the evidence pack.
3. The quoted text appears verbatim in the cited chunk.
4. The claim is within the scope of the quoted passage.
5. The source authority is sufficient for the claim (policy claim needs policy authority).

## Labels

- `supported` — verbatim quote directly supports the claim.
- `partially_supported` — quote supports part of the claim; the remainder is labelled as inference.
- `unsupported` — no verbatim quote supports the claim.
- `contradicted` — the source states the opposite.

## Output contract

Return JSON only: `claims[]` with `claim`, `label`, `doc_id`, `chunk_id`, `quote`, `note`; plus `overall`.

## Guardrail

Do not repair a citation by inventing a plausible quote. An unsupported claim must be removed or escalated.

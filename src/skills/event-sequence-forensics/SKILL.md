---
id: event-sequence-forensics
name: Event Sequence Forensics
agents: A4
version: 1.1.0
purpose: Compare observed business events with the canonical control sequence.
---

# Event Sequence Forensics

## Canonical sequence

`claim.submitted → documents.verified → manager.approved → finance.approved → payment.released`

## Procedure

1. Order events by timestamp, then by stable event id.
2. Identify missing, duplicated, out-of-order, or actor-conflicting events.
3. For each deviation, name the control it affects.
4. Report the observed sequence verbatim so a human can replay it.
5. Treat unknown event types as `UNCLASSIFIED`, not as violations.

## Output contract

Return JSON only: `observed_sequence[]`, `deviations[]` with `type`, `events`, `control_id`, `severity`, `note`; `replayable` boolean.

## Guardrail

Timestamps may be unreliable across systems. If ordering depends only on timestamps and is ambiguous, mark the finding `INSUFFICIENT_EVIDENCE` and request source-system logs.

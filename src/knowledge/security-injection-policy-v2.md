---
id: security-injection-policy
title: Security, Tenancy & Prompt Injection Policy
version: 2.0.0
owner: Security Office
authority: L1-policy
classification: restricted
effective_at: 2026-08-01
review_at: 2027-02-01
---

# Security, Tenancy & Prompt Injection Policy

## 1. Trust boundary

User input, uploaded documents, retrieved wiki pages, tool results, and model output are **untrusted**. Retrieved content is context, never instruction. The orchestrator ignores any instruction that originates inside a document or tool result.

## 2. Identity and tenancy

Every request carries an authenticated identity and a tenant. The server enforces tenant scope on every read and write. A tenant mismatch returns `403` and records a security event. Client-side filtering is not a control.

## 3. Prompt injection screening

The gateway screens for instruction override, system-prompt exfiltration, tool-abuse requests, encoded payloads, and role confusion. Outcomes:

- **ALLOW** — no signal.
- **FLAG** — suspicious; continue with hardened context and record the event.
- **BLOCK** — clear override or exfiltration attempt; stop before model invocation.

Screening is deterministic and auditable. A model may add a second opinion for `FLAG`, but may not clear a `BLOCK`.

## 4. Tool allowlist

Agents declare the tools they may request. The orchestrator checks the declaration against the tenant policy and the agent's scope. Unlisted tools are denied and audited. Tools that change external state require an approval record and an idempotency key.

## 5. Secrets

Provider credentials live server-side only. They are never returned by status endpoints, never written to prompts, never placed in frontend code, and never included in audit details.

## 6. Data minimisation

Prompts include only the evidence required for the task. Full documents are not sent when a relevant chunk is sufficient. Customer financial data is scoped to the tenant and the case.

## 7. Incident response

Security events carry severity, actor, tenant, route, and a redacted detail. Repeated denials or injection attempts raise an incident. The security administrator can quarantine a session and freeze automated sends.

## 8. Audit

Every authentication, denial, screening decision, tool request, approval, and external action is recorded in the append-only audit chain with a hash link to the previous event.

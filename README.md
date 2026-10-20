# Jade Pebble — Agentic AI Operations Workspace

A glassmorphic, grounded, auditable, human-gated agentic operations workspace
for Alpha Red Solutions. Nine agents share one bounded orchestrator. Every
material action carries an evidence pack, a deterministic policy check, an
independent verification result and a human gate where it matters.

The interface is a single-page app served by a zero-dependency Node server.
Real model output comes from a local Ollama model by default; nothing in the
pipelines is a hardcoded answer. Input datasets and deterministic policy rules
are labelled as seeded demonstration data.

Design language: **Jade Pebble Morning** — light morning-mist surfaces,
frosted glass panels, jade evidence accents and warm pebble highlights.

## Run it

Requirements: Node 22.5+ (built-in `node:sqlite`) and, for the default
provider, Ollama with a model pulled.

```bash
ollama serve
ollama pull qwen2.5:3b
npm start
# http://127.0.0.1:4173
```

Optional environment (`.env` in the project root):

```
PORT=4173
HOST=127.0.0.1
AI_PROVIDER=ollama            # ollama | deepseek | openai | pollinations
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=
```

Provider, model and endpoint can also be changed in **Settings**
(administrator only). Secrets are never returned to the browser.

## Commands

```bash
npm start                 # run the workspace
npm run dev               # run with --watch
npm run seed -- --reset   # rebuild the seeded demonstration dataset
npm test                  # deterministic tests; no model calls
```

## Architecture

```
src/
  server/     HTTP API, sessions, SQLite, rules, RAG, policy, agents, orchestration
  public/     vanilla ES-module SPA: shell, panels, pages, router
  knowledge/  versioned policy documents used by retrieval
  skills/     versioned operating procedures loaded into agent prompts
  tests/      deterministic tests
```

### Authority boundaries

| Layer | Can | Cannot |
| --- | --- | --- |
| A1 Laya | Route work, grade risk, advise | Grant permission, override policy or verifier |
| Policy Engine | Produce binding deterministic facts | Approve a payment or publish memory |
| Specialist agents (A2–A7) | Reason, retrieve, draft, distil | Send, publish, release or bypass a gate |
| A8 Verifier | Recompute facts, block a run | Approve or repair an output |
| A9 Harness² | Propose an offline candidate | Change production without tests and a human decision |
| Human gate | Approve payments, publication, acknowledged failures | Bypass the deterministic verifier |

Deterministic verifier failures are binding and produce `needs_review` plus a
`verification_review` approval. Model-assisted grounding findings are advisory
and produce `PASS_WITH_NOTES`. Model output can never turn a blocked payment
into a draft: the server strips the draft before it is stored or shown.

### Run pipeline

1. Trust-boundary screen (deterministic; a `BLOCK` stops the run before any model call)
2. A2 evidence retrieval (BM25 over active, versioned documents)
3. Deterministic policy facts (the binding record)
4. A1 advisory route and risk
5. Specialist AI output (A3 Cradle, A4 audit, A5 payment, A6 trend, A2 knowledge)
6. A8 independent verification (deterministic checks plus a model-assisted grounding audit)
7. A7 candidate memory (scoped, expiring, unpublished)
8. Human gates and an append-only audit chain

## Workspaces and demo identities

| Identity | Role | Workspace scope |
| --- | --- | --- |
| Adam Wong | admin, principal | all three workspaces |
| Nurul Iman | reviewer | Cradle Fund |
| Daniel Tan | reviewer | PartnerFlow |
| Mei Lin | knowledge owner | Alpha Red |
| Kai Rahman | security admin | all three workspaces |
| Ravi Kumar | harness owner | Alpha Red |
| Aina Salleh | operator | all three workspaces |

Sessions are signed HttpOnly cookies. Permissions are recalculated on the
server for every request; `x-user`/`x-tenant` headers remain as a local
tooling fallback.

## Process studio

Each process is its own panel and can be collapsed or hidden independently;
visibility is stored locally and restored from the top bar. Launching a
process in another workspace switches the session to that workspace so the
run, approvals and audit trail stay together.

Available processes: Cradle Fund assessment, PartnerFlow control audit,
payment follow-up, CMO 30-day trend, grounded knowledge query, and direct
single-agent runs (A1, A2, A7, A9). The **Function Menu** lists every
user-facing function, its route and its required permission.

## Payments

- Every payment send requires a human approval, regardless of value.
- A blocked or duplicate invoice produces no draft and no send approval.
- The send is simulated and labelled in the outbox.
- Approval idempotency keys prevent a second reminder for the same invoice and stage.

## Evaluations

The **Evaluations** page runs a frozen 12-case deterministic suite plus live
model probes for a baseline and a candidate prompt. A release proposal is
created only when the candidate improves by at least 2 points, a live probe
improves, and no high-weight deterministic case regresses. Approving it
endorses an offline release candidate only; it never mutates production
prompts, policy or permissions.

## Tests

`npm test` runs deterministic checks over the policy facts, the
trust-boundary screen, role permissions, the audit hash chain and the HTTP
contract. It does not call a model.

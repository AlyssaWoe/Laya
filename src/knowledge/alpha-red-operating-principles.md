---
id: alpha-red-operating-principles
title: Alpha Red Operating Principles
version: 2.1.0
owner: Office of the Principal
authority: L0-constitution
classification: internal
effective_at: 2026-04-01
review_at: 2026-10-01
---

# Alpha Red Operating Principles

## 1. Purpose

Alpha Red exists to turn ambiguous business requests into decisions that are **grounded, constrained, and reviewable**. The system is not a collection of autonomous chatbots. It is an operating discipline expressed in software.

## 2. The three boundaries

### 2.1 Laya decides, but cannot bypass controls

Laya selects the next action: which agent to involve, whether more evidence is required, whether to retry, and whether to escalate. Laya's decision is an **input** to the control plane, never a grant of authority. A Laya recommendation to pay, approve, or publish still passes the Policy Engine, the permission model, and — where required — a human approver.

### 2.2 The execution model reasons, but cannot grant permission

The execution model interprets documents, explains rules, drafts communications, and proposes next steps. It does not hold credentials, cannot widen its own tool scope, and cannot convert a draft into an external action. Tool execution is performed by the orchestrator under an allowlist.

### 2.3 Harness² improves, but cannot change production directly

Offline evaluation may propose prompts, skills, and workflow configurations. A candidate becomes production only after fixed regression tests, security tests, and named human approval. Every release is versioned and reversible.

## 3. Progressive disclosure

Operators see the current state first: status, owner, next action, and risk. Evidence, tool calls, rule versions, and verification details are available on demand. The interface must never present private model chain-of-thought as evidence. It presents **decision summaries**, **source references**, and **action records**.

## 4. Authority tiers

| Tier | Source | May be overridden by a model? |
|---|---|---|
| L0 | Constitution and legal obligations | No |
| L1 | Approved policy and rules | No |
| L2 | Approved wiki and SOP | No |
| L3 | Verified historical case | Only with reviewer approval |
| L4 | Live business database | Never replaced by memory |
| L5 | Candidate memory / experiment | Never used as authority |

## 5. Evidence rule

Every consequential statement carries at least one of: a document identifier and version, a database query result, a deterministic rule evaluation, or a named human decision. If evidence is missing, the correct output is `INSUFFICIENT_EVIDENCE`, not a confident guess.

## 6. Human authority

Human approval is mandatory for: external payment reminders above the configured threshold, funding assessment sign-off, publication of policy-affecting memory, and production release of an improved execution configuration. Approval is recorded with actor, timestamp, note, and the exact version reviewed.

## 7. Operational honesty

Demo data is labelled as demo data. Simulated sends are labelled as simulated. AI-generated hypotheses are separated from measured facts. A provider outage produces an explicit degraded state, not fabricated output.

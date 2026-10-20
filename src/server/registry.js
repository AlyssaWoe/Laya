import { all, get, parse } from './db.js';
import { can } from './auth.js';
import { allConflicts, thresholdSnapshot } from './rules.js';
import { knowledgeStats } from './rag.js';
import { assessCradle, assessAudit, assessPayment, trendFacts } from './policy.js';

/**
 * The function catalogue is deliberately explicit. Every user-facing action in
 * the workspace appears here with its route, permission, and description.
 * Nothing is hidden behind an undocumented keyboard shortcut.
 */

export const MENU_SECTIONS = [
  {
    id: 'workspace', label: 'Workspace', items: [
      { id: 'overview', label: 'Overview', route: '/overview', icon: 'grid', description: 'Live operating picture, risks and recent decisions.' },
      { id: 'runs', label: 'Process Runs', route: '/runs', icon: 'pulse', description: 'Every run, its steps, evidence and verification result.' }
    ]
  },
  {
    id: 'processes', label: 'Processes', items: [
      { id: 'processes', label: 'Process Studio', route: '/processes', icon: 'workflow', description: 'Launch a Cradle, audit, payment, trend or knowledge process.' }
    ]
  },
  {
    id: 'intelligence', label: 'Agents & Skills', items: [
      { id: 'agents', label: 'Agent Directory', route: '/agents', icon: 'nodes', description: 'All nine agents, their authority limits and tools.' },
      { id: 'skills', label: 'Skills Library', route: '/skills', icon: 'book', description: 'The operating skills loaded into each agent prompt.' }
    ]
  },
  {
    id: 'governance', label: 'Governance', items: [
      { id: 'approvals', label: 'Approvals', route: '/approvals', icon: 'stamp', permission: 'read', description: 'Human gates for payments, assessments, memories and verification.' },
      { id: 'memory', label: 'Memory', route: '/memory', icon: 'spark', permission: 'read', description: 'Scoped candidate, approved and expired memory.' },
      { id: 'knowledge', label: 'Knowledge Base', route: '/knowledge', icon: 'layers', permission: 'read', description: 'Versioned policy, wiki and the rule conflict register.' },
      { id: 'audit', label: 'Audit Trail', route: '/audit', icon: 'link', permission: 'read', description: 'Hash-chained record of every consequential action.' },
      { id: 'security', label: 'Security', route: '/security', icon: 'lock', permission: 'security:read', description: 'Injection screening, trust boundary and blocked inputs.' }
    ]
  },
  {
    id: 'improvement', label: 'Improvement', items: [
      { id: 'evaluations', label: 'Evaluations', route: '/evaluations', icon: 'flask', description: 'Frozen regression suite and Harness² release proposals.' }
    ]
  },
  {
    id: 'system', label: 'System', items: [
      { id: 'catalog', label: 'Function Menu', route: '/catalog', icon: 'menu', permission: 'read', description: 'The complete list of every function in this workspace.' },
      { id: 'settings', label: 'Settings', route: '/settings', icon: 'sliders', permission: 'read', description: 'Local AI provider, model and data boundary.' }
    ]
  }
];

export const FUNCTIONS = [
  { id: 'overview.read', group: 'Workspace', label: 'Read operating overview', route: '/overview', permission: 'read', description: 'Counts, risks, recent runs, pending gates and audit tail.' },
  { id: 'run.list', group: 'Workspace', label: 'Browse process runs', route: '/runs', permission: 'read', description: 'Filter by process, status and risk; open a run.' },
  { id: 'run.open', group: 'Workspace', label: 'Inspect run evidence', route: '/runs/:id', permission: 'read', description: 'Open each agent step, its inputs, evidence pack and checks.' },
  { id: 'run.cradle', group: 'Processes', label: 'Assess Cradle eligibility', route: '/processes/cradle_fund', permission: 'run', description: 'Run deterministic checks then a reviewer assessment. Human sign-off required.' },
  { id: 'run.audit', group: 'Processes', label: 'Audit a PartnerFlow claim', route: '/processes/partnerflow_audit', permission: 'run', description: 'Replay the control chain, test segregation and duplicates.' },
  { id: 'run.payment', group: 'Processes', label: 'Draft a payment follow-up', route: '/processes/payment_followup', permission: 'run', description: 'Reconcile the ledger and draft a reminder behind an approval gate.' },
  { id: 'run.trend', group: 'Processes', label: 'Run the CMO 30-day trend', route: '/processes/cmo_trend', permission: 'run', description: 'Measure channel movement and propose a bounded experiment.' },
  { id: 'run.knowledge', group: 'Processes', label: 'Ask a grounded knowledge question', route: '/processes/knowledge_query', permission: 'ask', description: 'Answer from versioned documents with citations and conflict disclosure.' },
  { id: 'run.direct', group: 'Processes', label: 'Run one agent directly', route: '/processes/direct', permission: 'run', description: 'A1, A2, A7 or A9 with evidence and verification. A3–A6 run through their process.' },
  { id: 'agent.read', group: 'Agents & Skills', label: 'Read the agent directory', route: '/agents', permission: 'read', description: 'Authority limits, tools, prompts and loaded skills for A1–A9.' },
  { id: 'skill.read', group: 'Agents & Skills', label: 'Read a skill', route: '/skills', permission: 'read', description: 'Open the full SKILL.md procedure and guardrails.' },
  { id: 'approval.list', group: 'Governance', label: 'Open the approval inbox', route: '/approvals', permission: 'read', description: 'Pending, approved and rejected human gates.' },
  { id: 'approval.decide', group: 'Governance', label: 'Approve or reject a gate', route: '/approvals', permission: 'approve:business', description: 'Records the decision and uniquely authorises the gated action.' },
  { id: 'memory.read', group: 'Governance', label: 'Browse memory', route: '/memory', permission: 'read', description: 'Candidate, approved and expired memory with scope and confidence.' },
  { id: 'memory.review', group: 'Governance', label: 'Publish or reject candidate memory', route: '/memory', permission: 'approve:memory', description: 'Knowledge-owner decision; nothing is published automatically.' },
  { id: 'knowledge.read', group: 'Governance', label: 'Browse the knowledge base', route: '/knowledge', permission: 'read', description: 'Versioned documents, authority levels and the conflict register.' },
  { id: 'knowledge.search', group: 'Governance', label: 'Search approved knowledge', route: '/knowledge', permission: 'read', description: 'BM25 retrieval with document version and chunk references.' },
  { id: 'audit.read', group: 'Governance', label: 'Read the hash-chained audit trail', route: '/audit', permission: 'read', description: 'Every consequential action, its actor and object.' },
  { id: 'audit.verify', group: 'Governance', label: 'Verify audit-chain integrity', route: '/audit', permission: 'audit:verify', description: 'Recompute every hash and locate the first broken link.' },
  { id: 'security.read', group: 'Governance', label: 'Read security events', route: '/security', permission: 'security:read', description: 'Blocked and flagged inputs with deterministic signals.' },
  { id: 'security.screen', group: 'Governance', label: 'Screen a test input', route: '/security', permission: 'security:screen', description: 'Run the deterministic injection screen without invoking a model.' },
  { id: 'eval.read', group: 'Improvement', label: 'Read evaluation history', route: '/evaluations', permission: 'read', description: 'Frozen suite cases, baseline and candidate scores.' },
  { id: 'eval.run', group: 'Improvement', label: 'Run the frozen regression suite', route: '/evaluations', permission: 'eval:run', description: 'Deterministic cases plus three live model probes; records every case.' },
  { id: 'eval.approve', group: 'Improvement', label: 'Approve or block a release', route: '/evaluations', permission: 'eval:approve', description: 'Human harness-owner gate. Approval never mutates production policy.' },
  { id: 'settings.read', group: 'System', label: 'Read provider settings', route: '/settings', permission: 'read', description: 'Current provider, model and data boundary without secrets.' },
  { id: 'settings.provider', group: 'System', label: 'Change the AI provider', route: '/settings', permission: '*', description: 'Ollama, DeepSeek, OpenAI-compatible or Pollinations fallback.' },
  { id: 'settings.test', group: 'System', label: 'Test the AI connection', route: '/settings', permission: 'run', description: 'One real inference call with latency and model echo.' },
  { id: 'session.switch', group: 'System', label: 'Switch demo identity or workspace', route: '/settings', permission: 'read', description: 'Signed demo session; permissions and tenants are enforced server-side.' },
  { id: 'ui.collapse', group: 'Interface', label: 'Collapse or expand any panel', route: 'everywhere', permission: 'read', description: 'Each panel has an independent collapse control.' },
  { id: 'ui.hide', group: 'Interface', label: 'Hide any panel', route: 'everywhere', permission: 'read', description: 'Hidden panels are restored from View → Hidden panels.' },
  { id: 'ui.export', group: 'Interface', label: 'Export a decision summary', route: 'run / audit', permission: 'read', description: 'Copy or download an auditable JSON summary, never private chain-of-thought.' },
  { id: 'ui.catalog', group: 'Interface', label: 'Open the function menu', route: '/catalog', permission: 'read', description: 'The complete function list with route and permission.' }
];

export function menuPayload(user, tenant = null) {
  const p = tenant ? [tenant] : [];
  const where = tenant ? 'WHERE tenant = ?' : '';
  const count = (sql, ...params) => Number(get(sql, ...params)?.c || 0);
  const badges = {
    approvals: count(`SELECT COUNT(*) AS c FROM approvals ${tenant ? "WHERE tenant = ? AND status = 'pending'" : "WHERE status = 'pending'"}`, ...p),
    memories: count(`SELECT COUNT(*) AS c FROM memories ${tenant ? "WHERE tenant = ? AND status = 'pending'" : "WHERE status = 'pending'"}`, ...p),
    security: count(`SELECT COUNT(*) AS c FROM security_events ${tenant ? 'WHERE tenant = ? AND blocked = 1' : 'WHERE blocked = 1'}`, ...p),
    attention: count(`SELECT COUNT(*) AS c FROM runs ${tenant ? "WHERE tenant = ? AND status IN ('needs_review','failed')" : "WHERE status IN ('needs_review','failed')"}`, ...p)
  };
  const sections = MENU_SECTIONS.map((s) => ({
    ...s,
    items: s.items.map((i) => ({ ...i, badge: badges[i.id] ?? null, enabled: can(user, i.permission || 'read') }))
  }));
  return {
    sections,
    functions: FUNCTIONS.map((f) => ({
      ...f,
      enabled: f.permission === '*' ? can(user, '*') : can(user, f.permission)
    })),
    badges,
    tenant,
    generated_at: new Date().toISOString()
  };
}

export function knowledgeDocs({ includeBody = true } = {}) {
  const docs = all('SELECT * FROM knowledge_docs WHERE active = 1 ORDER BY authority, id');
  const conflicts = allConflicts();
  return docs.map((d) => ({
    ...d,
    body: includeBody ? d.body : undefined,
    char_count: String(d.body || '').length,
    conflicts: conflicts.filter((c) => c.sources.some((s) => s.doc_id === d.id)).map((c) => c.key)
  }));
}

export function memoryList() {
  return all(`SELECT * FROM memories ORDER BY
    CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END,
    created_at DESC`).map((m) => {
    const note = parse(m.note, {});
    return { ...m, note, expired: m.expires_at ? m.expires_at < new Date().toISOString() : false };
  });
}

export function securityList(tenant = null) {
  const rows = tenant
    ? all('SELECT * FROM security_events WHERE tenant = ? ORDER BY created_at DESC LIMIT 80', tenant)
    : all('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 80');
  return rows.map((r) => ({ ...r, detail: parse(r.detail, {}), blocked: !!r.blocked }));
}

export function datasetPayload(tenant = null) {
  const apps = all('SELECT * FROM applications ORDER BY id').map((a) => {
    const facts = assessCradle(a.id);
    return {
      id: a.id, applicant: a.applicant, registration: a.registration, incorporated_at: a.incorporated_at, equity_pct: a.equity_pct,
      requested_amount: a.requested_amount, matching_amount: a.matching_amount, active_grants: a.active_grants,
      tax_clearance: a.tax_clearance, stage: a.stage, reviewer: a.reviewer,
      documents: parse(a.docs, []),
      assessment: facts?.assessment, missing_documents: facts?.missing_documents || [],
      failed_checks: facts?.checks.filter((c) => c.status === 'FAIL').map((c) => c.rule_id) || []
    };
  });
  const invoices = all('SELECT * FROM invoices ORDER BY due_date ASC').map((i) => {
    const facts = assessPayment(i.id);
    return {
      id: i.id, customer: i.customer, customer_status: i.customer_status, currency: i.currency,
      amount: i.amount, paid: i.paid, credits: i.credits, due_date: i.due_date, strategic: !!i.strategic,
      outstanding: facts?.invoice.outstanding, overdue_days: facts?.invoice.overdue_days,
      stage: facts?.invoice.stage, allowed: facts?.allowed, blocked_reasons: facts?.blocked_reasons || [],
      approval_required: facts?.approval_required, last_reminded_at: i.last_reminded_at, last_stage: i.last_stage
    };
  });
  const cases = all('SELECT * FROM audit_cases ORDER BY id').map((c) => {
    const facts = assessAudit(c.id);
    return {
      id: c.id, claim_id: c.claim_id, amount: c.amount, approved_amount: c.approved_amount, status: c.status,
      events: parse(c.events, []), highest_severity: facts?.highest_severity,
      findings: facts?.findings || [], control_count: c.events ? parse(c.events, []).length : 0
    };
  });
  const metrics = all('SELECT * FROM metrics_daily ORDER BY date ASC');
  const outbox = all('SELECT * FROM outbox ORDER BY created_at DESC LIMIT 50').map((o) => ({ ...o, payload: parse(o.payload, {}) }));
  return {
    label: 'Seeded demonstration data — not live production records',
    applications: apps,
    invoices,
    audit_cases: cases,
    metrics,
    trend: trendFacts('alpha-red'),
    outbox,
    thresholds: thresholdSnapshot(),
    conflicts: allConflicts(),
    knowledge: knowledgeStats()
  };
}

export function auditPayload({ limit = 100, tenant = null } = {}) {
  const rows = tenant
    ? all('SELECT * FROM audit_events WHERE tenant = ? ORDER BY seq DESC LIMIT ?', tenant, limit)
    : all('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?', limit);
  return rows.map((r) => ({ ...r, detail: parse(r.detail, {}) }));
}

import { all, get, run, now, uid, parse, stringify, appendAudit, addApproval, addOutbox, logSecurity, startStep, finishStep } from './db.js';
import { assessCradle, assessAudit, assessPayment, trendFacts, money } from './policy.js';
import { buildEvidencePack } from './rag.js';
import { buildPrompt, AGENTS, PROCESSES } from './agents.js';
import { chatJSON } from './ai.js';
import { screen } from './security.js';
import { ruleNumber, allConflicts, thresholdSnapshot } from './rules.js';
import { can } from './auth.js';
import { DEMO_DATASET_LABEL } from './seed.js';

const RISK_ORDER = { low: 1, medium: 2, high: 3, critical: 4, unknown: 2 };
const maxRisk = (a, b) => (RISK_ORDER[b] > RISK_ORDER[a] ? b : a);
const normRisk = (v) => (['low', 'medium', 'high', 'critical'].includes(String(v).toLowerCase()) ? String(v).toLowerCase() : 'unknown');
const clipTitle = (value, max) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.!?]+$/, '')}…`;
};

/* ── SSE ──────────────────────────────────────────────────────────────── */

const STREAMS = new Map();
export function subscribe(runId, res) {
  if (!STREAMS.has(runId)) STREAMS.set(runId, new Set());
  STREAMS.get(runId).add(res);
}
export function unsubscribe(runId, res) {
  const set = STREAMS.get(runId);
  if (set) { set.delete(res); if (!set.size) STREAMS.delete(runId); }
}
function emit(runId, type, data) {
  const set = STREAMS.get(runId);
  if (!set || !set.size) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* disconnected */ }
  }
}

/* ── Hydration ────────────────────────────────────────────────────────── */

export function hydrateStep(row) {
  if (!row) return null;
  return {
    ...row,
    input: parse(row.input, null),
    output: parse(row.output, null),
    evidence: parse(row.evidence, []),
    checks: parse(row.checks, [])
  };
}
export function hydrateApproval(row) {
  if (!row) return null;
  return { ...row, payload: parse(row.payload, {}) };
}
export function hydrateRun(row) {
  if (!row) return null;
  return { ...row, meta: parse(row.meta, {}), approval_required: !!row.approval_required };
}

export function getRun(id) {
  const r = get('SELECT * FROM runs WHERE id = ?', id);
  if (!r) return null;
  return {
    ...hydrateRun(r),
    steps: all('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq ASC, started_at ASC', id).map(hydrateStep),
    approvals: all('SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC', id).map(hydrateApproval)
  };
}

export function listRuns(tenant = null, limit = 40) {
  const rows = tenant
    ? all(`SELECT runs.*, (SELECT COUNT(*) FROM run_steps WHERE run_id = runs.id) AS step_count
        FROM runs WHERE tenant = ? ORDER BY created_at DESC LIMIT ?`, tenant, limit)
    : all(`SELECT runs.*, (SELECT COUNT(*) FROM run_steps WHERE run_id = runs.id) AS step_count
        FROM runs ORDER BY created_at DESC LIMIT ?`, limit);
  return rows.map(hydrateRun);
}

/* ── Validation and run creation ──────────────────────────────────────── */

function resolveInput(process, input) {
  const def = PROCESSES[process];
  if (!def) { const e = new Error(`UNKNOWN_PROCESS:${process}`); e.status = 400; throw e; }
  if (process === 'cradle_fund') {
    const app = get('SELECT * FROM applications WHERE id = ?', input.application_id);
    if (!app) { const e = new Error('APPLICATION_NOT_FOUND'); e.status = 404; throw e; }
    return {
      caseId: app.id,
      title: `Cradle assessment · ${app.applicant}`,
      request: `Assess ${app.applicant} (${app.id}) for Cradle Fund eligibility and completeness.`,
      query: `Cradle Fund eligibility Malaysian equity matching contribution active grant audited financial statements tax clearance document checklist ${app.applicant}`
    };
  }
  if (process === 'partnerflow_audit') {
    const c = get('SELECT * FROM audit_cases WHERE id = ?', input.case_id);
    if (!c) { const e = new Error('AUDIT_CASE_NOT_FOUND'); e.status = 404; throw e; }
    return {
      caseId: c.id,
      title: `Control audit · ${c.claim_id}`,
      request: `Audit the approval and payment chain for claim ${c.claim_id}.`,
      query: 'PartnerFlow claim control sequence segregation of duties duplicate payment release finance approval amount integrity'
    };
  }
  if (process === 'payment_followup') {
    const inv = get('SELECT * FROM invoices WHERE id = ?', input.invoice_id);
    if (!inv) { const e = new Error('INVOICE_NOT_FOUND'); e.status = 404; throw e; }
    return {
      caseId: inv.id,
      title: `Payment follow-up · ${inv.id}`,
      request: `Reconcile overdue invoice ${inv.id} (${inv.customer}) and prepare the next cadence draft.`,
      query: 'payment follow-up cadence P1 P2 P3 P4 final notice duplicate reminder approval threshold outstanding invoice tone'
    };
  }
  if (process === 'cmo_trend') {
    return {
      caseId: 'alpha-red-30d',
      title: 'CMO 30-day trend',
      request: 'Interpret the latest 30-day channel performance against the prior 30-day window.',
      query: 'CMO reporting standard 30 day qualified leads won deals conversion rate sample size channel reporting'
    };
  }
  if (process === 'knowledge_query') {
    const q = String(input.question || '').trim();
    if (q.length < 4) { const e = new Error('QUESTION_REQUIRED'); e.status = 400; throw e; }
    const focus = /audited|threshold|250|500|conflict/i.test(q)
      ? ' audited financial statements threshold 250000 500000 conflict conservative'
      : '';
    return { caseId: 'knowledge', title: `Knowledge query · ${clipTitle(q, 64)}`, request: q, query: `${q}${focus}` };
  }
  if (process === 'direct') {
    const agentId = String(input.agent_id || '').toUpperCase();
    if (!['A1', 'A2', 'A7', 'A9'].includes(agentId)) {
      const e = new Error('DIRECT_AGENT_NOT_SUPPORTED: use the agent process for A3–A6/A8'); e.status = 400; throw e;
    }
    const task = String(input.task || '').trim();
    if (task.length < 6) { const e = new Error('TASK_REQUIRED'); e.status = 400; throw e; }
    return {
      caseId: 'direct',
      title: `${AGENTS[agentId].name} · ${clipTitle(task, 56)}`,
      request: task,
      query: `${AGENTS[agentId].purpose} ${task}`
    };
  }
  throw new Error('UNHANDLED_PROCESS');
}

function createRunRecord({ tenant, process, input, actor }) {
  const resolved = resolveInput(process, input);
  const def = PROCESSES[process];
  const textToScreen = [resolved.request, input.question, input.task, input.note].filter(Boolean).join('\n');
  const screened = screen(textToScreen, {
    block: ruleNumber('security.block_threshold', 7),
    flag: ruleNumber('security.flag_threshold', 3)
  });
  if (screened.decision === 'BLOCK') {
    logSecurity({
      tenant, kind: 'prompt_injection', severity: 'high', actor,
      route: `run:${process}`, detail: { signals: screened.signals, score: screened.score, request: resolved.request.slice(0, 300) }, blocked: true
    });
    const e = new Error('INPUT_BLOCKED_BY_SECURITY');
    e.status = 422;
    e.code = 'INPUT_BLOCKED_BY_SECURITY';
    e.details = { score: screened.score, signals: screened.signals };
    throw e;
  }
  if (screened.decision === 'FLAG') {
    logSecurity({
      tenant, kind: 'suspicious_input', severity: 'medium', actor,
      route: `run:${process}`, detail: { signals: screened.signals, score: screened.score }, blocked: false
    });
  }

  const id = uid('run');
  const ts = now();
  run(`INSERT INTO runs (id, tenant, process, agent_id, case_id, title, request, status, stage, risk, approval_required, actor, created_at, updated_at, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'intake', ?, 0, ?, ?, ?, ?)`,
    id, tenant, process, def.agent, resolved.caseId, resolved.title, resolved.request,
    def.requiresApproval ? 'medium' : 'low', actor, ts, ts,
    stringify({ screen: screened, dataset_label: DEMO_DATASET_LABEL, query: resolved.query, input }));
  appendAudit({
    tenant, actor, action: 'run.created', objectType: 'run', objectId: id,
    detail: { process, case_id: resolved.caseId, title: resolved.title, screen: screened.decision }
  });
  return { id, resolved, screened };
}

export function startRun({ tenant, process, input = {}, actor = 'system' }) {
  const created = createRunRecord({ tenant, process, input, actor });
  const snapshot = getRun(created.id);
  emit(created.id, 'run', snapshot);
  queueMicrotask(() => {
    executeRun(created.id).catch((e) => failRun(created.id, e));
  });
  return { run: snapshot, resolved: created.resolved };
}

/* ── Step helper ──────────────────────────────────────────────────────── */

async function stepFor(runRow, agentId, title, input, fn, seq) {
  const stepId = startStep(runRow.id, agentId, title, input, seq);
  emit(runRow.id, 'step', { id: stepId, run_id: runRow.id, agent_id: agentId, seq, title, status: 'running', started_at: now() });
  const t0 = Date.now();
  try {
    const result = await fn();
    finishStep(stepId, {
      status: result.status || 'completed',
      summary: result.summary || '',
      output: result.output,
      evidence: result.evidence || [],
      checks: result.checks || [],
      model: result.model || '',
      provider: result.provider || '',
      durationMs: Date.now() - t0,
      tokensIn: result.tokensIn || 0,
      tokensOut: result.tokensOut || 0
    });
    const full = hydrateStep(get('SELECT * FROM run_steps WHERE id = ?', stepId));
    emit(runRow.id, 'step', full);
    appendAudit({
      tenant: runRow.tenant, actor: `agent:${agentId}`, action: 'run.step.completed',
      objectType: 'run_step', objectId: stepId,
      detail: { run_id: runRow.id, agent: agentId, title, status: full.status, summary: (full.summary || '').slice(0, 240) }
    });
    return result;
  } catch (e) {
    finishStep(stepId, { status: 'failed', summary: `Step failed: ${e.message}`.slice(0, 400), error: e.message, durationMs: Date.now() - t0 });
    const full = hydrateStep(get('SELECT * FROM run_steps WHERE id = ?', stepId));
    emit(runRow.id, 'step', full);
    appendAudit({
      tenant: runRow.tenant, actor: `agent:${agentId}`, action: 'run.step.failed',
      objectType: 'run_step', objectId: stepId,
      detail: { run_id: runRow.id, agent: agentId, title, error: String(e.message).slice(0, 300) }
    });
    throw e;
  }
}

/* ── Verification ─────────────────────────────────────────────────────── */

function vCheck(id, name, status, detail, method) {
  return { id, name, status, detail, method };
}

function refsOf(output) {
  if (Array.isArray(output?.evidence_refs)) return output.evidence_refs.filter((r) => typeof r === 'string');
  if (Array.isArray(output?.citations)) return output.citations.map((c) => c?.ref).filter((r) => typeof r === 'string');
  return [];
}

function deterministicVerify(process, facts, output, pack, fresh) {
  const checks = [];
  const refs = new Set(pack.items.map((i) => i.ref));
  const evidenceRefs = refsOf(output);
  const validRefs = evidenceRefs.filter((r) => refs.has(r));

  checks.push(vCheck('V-01', 'Schema conformance', output && typeof output === 'object' ? 'PASS' : 'FAIL',
    output ? 'Structured output present.' : 'No structured output.', 'deterministic'));

  checks.push(vCheck('V-02', 'Evidence references', evidenceRefs.length && validRefs.length === evidenceRefs.length ? 'PASS' : 'FAIL',
    `${validRefs.length}/${evidenceRefs.length} refs valid against ${pack.items.length} retrieved chunks.`, 'deterministic'));

  checks.push(vCheck('V-03', 'Fresh data reconciliation', fresh && fresh.ok ? 'PASS' : 'FAIL',
    fresh?.detail || 'Fresh query did not match the facts supplied to the agent.', 'deterministic'));

  if (process === 'cradle_fund') {
    const statuses = new Map((output.checks || []).map((c) => [c.rule_id, c.status]));
    const mismatched = facts.checks.filter((c) => statuses.get(c.rule_id) !== c.status);
    checks.push(vCheck('V-04', 'Policy verdict consistency', output.assessment === facts.assessment ? 'PASS' : 'FAIL',
      `Agent assessment ${output.assessment} vs deterministic ${facts.assessment}.`, 'deterministic'));
    checks.push(vCheck('V-05', 'Rule statuses preserved', mismatched.length === 0 ? 'PASS' : 'FAIL',
      mismatched.length ? `Changed: ${mismatched.map((m) => m.rule_id).join(', ')}` : 'All deterministic statuses copied.', 'deterministic'));
    const needsDisclosure = facts.conflicts.length > 0;
    const disclosure = String(output.conflict_disclosure || '');
    const covered = !needsDisclosure || (/250/.test(disclosure) && /500/.test(disclosure));
    checks.push(vCheck('V-06', 'Conflict disclosure', covered ? 'PASS' : 'FAIL',
      needsDisclosure ? (covered ? 'Both conflicting thresholds are disclosed.' : 'The conflict exists but one threshold is missing from the disclosure.') : 'No conflict applies.',
      'deterministic'));
    const expectedDocs = facts.missing_documents || [];
    const outputDocs = Array.isArray(output.missing_documents) ? output.missing_documents : [];
    const outputDocRefs = new Set(outputDocs.map((d) => d?.ref).filter(Boolean));
    const omitted = expectedDocs.filter((d) => !outputDocRefs.has(d.ref));
    const invented = outputDocs.filter((d) => !expectedDocs.some((e) => e.ref === d?.ref));
    checks.push(vCheck('V-07', 'Missing document consistency',
      omitted.length === 0 && invented.length === 0 ? 'PASS' : 'FAIL',
      omitted.length || invented.length
        ? `Omitted: ${omitted.map((d) => d.ref).join(', ') || 'none'}; not in deterministic list: ${invented.map((d) => d?.ref || d?.name || 'unknown').join(', ') || 'none'}.`
        : expectedDocs.length ? `All ${expectedDocs.length} deterministic document gap(s) represented.` : 'No document gap; none invented.',
      'deterministic'));
  } else if (process === 'partnerflow_audit') {
    const findings = Array.isArray(output.findings) ? output.findings : [];
    checks.push(vCheck('V-04', 'Severity consistency', output.highest_severity === facts.highest_severity ? 'PASS' : 'FAIL',
      `Agent ${output.highest_severity} vs deterministic ${facts.highest_severity}.`, 'deterministic'));
    const missing = facts.findings.filter((f) => !findings.some((o) => o.control_id === f.control_id && o.severity === f.severity));
    checks.push(vCheck('V-05', 'Deterministic findings preserved', missing.length === 0 ? 'PASS' : 'FAIL',
      missing.length ? `Missing: ${missing.map((m) => `${m.control_id}/${m.severity}`).join(', ')}` : 'Every computed finding is represented.', 'deterministic'));
  } else if (process === 'payment_followup') {
    checks.push(vCheck('V-04', 'Policy gate consistency',
      output.stage === facts.invoice.stage && output.approval_required === facts.approval_required && output.allowed === facts.allowed ? 'PASS' : 'FAIL',
      `stage ${output.stage}/${facts.invoice.stage}; approval ${output.approval_required}/${facts.approval_required}; allowed ${output.allowed}/${facts.allowed}.`,
      'deterministic'));
    const blockedDraft = !facts.allowed && (String(output.body || '').trim().length > 0 || String(output.subject || '').trim().length > 0);
    checks.push(vCheck('V-05', 'Blocked draft suppression', blockedDraft ? 'FAIL' : 'PASS',
      blockedDraft ? 'A draft was produced even though the deterministic gate blocked follow-up.' : 'Draft state matches the gate.', 'deterministic'));
    checks.push(vCheck('V-06', 'Amount reconciliation', Number(output.outstanding) === Number(facts.invoice.outstanding) ? 'PASS' : 'FAIL',
      `Agent ${output.outstanding} vs ledger ${facts.invoice.outstanding}.`, 'deterministic'));
    if (facts.allowed) {
      const text = `${output.subject || ''}\n${output.body || ''}`;
      const amount = Number(facts.invoice.outstanding).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const present = [
        String(facts.invoice.id),
        amount,
        String(facts.invoice.overdue_days)
      ].filter((v) => text.includes(v));
      const subjectOk = String(output.subject || '').trim().length > 0;
      checks.push(vCheck('V-07', 'Draft completeness', subjectOk && present.length === 3 ? 'PASS' : 'FAIL',
        `Subject ${subjectOk ? 'present' : 'empty'}; ${present.length}/3 mandatory facts present (invoice id, outstanding amount, days overdue).`,
        'deterministic'));
    }
  } else if (process === 'cmo_trend') {
    const mismatches = (facts.measured || []).filter((m) => {
      const candidate = (output.measured || []).find((o) => o.metric === m.metric);
      return !candidate || Math.abs(Number(candidate.current) - Number(m.current)) > 0.06;
    });
    checks.push(vCheck('V-04', 'Measured-number consistency', mismatches.length === 0 ? 'PASS' : 'FAIL',
      mismatches.length ? `Mismatched metrics: ${mismatches.map((m) => m.metric).join(', ')}` : 'All measured values match the warehouse query.', 'deterministic'));
    const anomaliesCovered = !facts.anomalies.length || (output.anomalies || []).length > 0;
    checks.push(vCheck('V-05', 'Anomaly coverage', anomaliesCovered ? 'PASS' : 'WARN',
      anomaliesCovered ? 'Computed anomaly signals are represented.' : 'Deterministic anomalies exist but the narrative omits them.', 'deterministic'));
    const experiments = Array.isArray(output.experiments) ? output.experiments : [];
    checks.push(vCheck('V-06', 'Single bounded experiment', experiments.length === 1 ? 'PASS' : 'FAIL',
      `${experiments.length} experiment(s) proposed; the design is one bounded experiment.`, 'deterministic'));
  } else if (process === 'knowledge_query') {
    checks.push(vCheck('V-04', 'Grounded answer', String(output.answer || '').trim().length > 20 ? 'PASS' : 'FAIL',
      'Answer is present.' , 'deterministic'));
    checks.push(vCheck('V-05', 'Citation support', Array.isArray(output.citations) && output.citations.length > 0 ? 'PASS' : 'FAIL',
      `${(output.citations || []).length} citation(s) supplied.`, 'deterministic'));
    const answerText = String(output.answer || '');
    if (/audited/i.test(answerText)) {
      const stated = /250/.test(answerText) && /500/.test(answerText);
      checks.push(vCheck('V-06', 'Conflict values stated', stated ? 'PASS' : 'FAIL',
        stated ? 'Both conflicting audited-accounts thresholds are stated.' : 'The answer discusses the audited-accounts rule without stating both conflicting thresholds.', 'deterministic'));
    }
  } else {
    checks.push(vCheck('V-04', 'Output usability', output && Object.keys(output).length > 0 ? 'PASS' : 'FAIL', 'Direct agent output present.', 'deterministic'));
  }
  return checks;
}

function freshCheck(process, facts, caseId) {
  try {
    if (process === 'cradle_fund') {
      const fresh = assessCradle(caseId);
      const ok = fresh && fresh.assessment === facts.assessment;
      return { ok, detail: ok ? `Recomputed assessment ${fresh.assessment}.` : `Assessment changed to ${fresh?.assessment}.` };
    }
    if (process === 'partnerflow_audit') {
      const fresh = assessAudit(caseId);
      const ok = fresh && fresh.highest_severity === facts.highest_severity;
      return { ok, detail: ok ? `Recomputed severity ${fresh.highest_severity}.` : `Severity changed to ${fresh?.highest_severity}.` };
    }
    if (process === 'payment_followup') {
      const fresh = assessPayment(caseId);
      const ok = fresh && fresh.invoice.outstanding === facts.invoice.outstanding && fresh.allowed === facts.allowed;
      return { ok, detail: ok ? `Ledger re-query matched: ${money(fresh.invoice.outstanding)} outstanding.` : 'Ledger values changed during the run.' };
    }
    if (process === 'cmo_trend') {
      const fresh = trendFacts('alpha-red');
      const ok = fresh.current.totals.leads === facts.current.totals.leads && fresh.current.totals.won === facts.current.totals.won;
      return { ok, detail: ok ? `Warehouse re-query matched: ${fresh.current.totals.leads} leads, ${fresh.current.totals.won} wins.` : 'Warehouse totals changed during the run.' };
    }
    return { ok: true, detail: 'No consequential ledger state to re-query.' };
  } catch (e) {
    return { ok: false, detail: `Fresh query failed: ${e.message}` };
  }
}

async function aiGrounding(runRow, output, pack, checks) {
  const prompt = buildPrompt('A8', {
    task: 'Independently audit the candidate output below. Do not fix it. List consequential claims that are not supported by a verbatim quote in the evidence pack. Use only the supplied evidence. If every consequential claim is supported, return an empty unsupported_claims array.',
    facts: { candidate_output: output, deterministic_checks: checks },
    evidenceText: pack.text,
    evidence: pack.items,
    outputSchema: `{
  "checks": [{"id":"V-08","name":"Claim support","status":"PASS|WARN|FAIL","detail":"..."}],
  "unsupported_claims": [{"claim":"...","evidence_ref":"EV-n or none","reason":"..."}],
  "grounding": "strong|partial|weak",
  "notes": ["..."]
}`
  });
  return chatJSON({
    system: prompt.system, user: prompt.user, maxTokens: 520, temperature: 0.1,
    purpose: 'verify:grounding', runId: runRow.id, agentId: 'A8'
  });
}

/* ── Process-specific AI prompts ──────────────────────────────────────── */

/**
 * The UI and the audit record keep the full deterministic fact set. The model
 * receives a compact projection: enough to copy every binding value, without
 * wasting context on repeated document lists or 30 daily rows.
 */
function compactFacts(process, facts) {
  if (!facts) return null;
  if (process === 'cradle_fund') {
    const sources = facts.conflicts
      .flatMap((c) => c.sources.map((s) => ({ ...s, numeric: Number(s.value) })))
      .filter((s) => Number.isFinite(s.numeric))
      .sort((a, b) => a.numeric - b.numeric);
    const conflictDisclosure = sources.length >= 2
      ? `Policy conflict: ${sources.map((s) => `${s.doc_id} v${s.version} says RM ${s.numeric.toLocaleString('en-MY')}`).join(', ')}; conservative threshold RM ${Number(facts.thresholds.audited_threshold_myr).toLocaleString('en-MY')} applied.`
      : '';
    return {
      application: facts.application,
      thresholds: facts.thresholds,
      checks: facts.checks,
      missing_documents: facts.missing_documents,
      conflicts: facts.conflicts,
      conflict_disclosure_required: conflictDisclosure,
      assessment: facts.assessment,
      deterministic_summary: facts.deterministic_summary
    };
  }
  if (process === 'partnerflow_audit') {
    return {
      case: facts.case, expected_sequence: facts.expected_sequence,
      observed_sequence: facts.observed_sequence, findings: facts.findings,
      highest_severity: facts.highest_severity, deterministic_summary: facts.deterministic_summary
    };
  }
  if (process === 'payment_followup') {
    return {
      invoice: facts.invoice, threshold_myr: facts.threshold_myr,
      approval_required: facts.approval_required, approval_reasons: facts.approval_reasons,
      duplicate_window_hours: facts.duplicate_window_hours, duplicate_check: facts.duplicate_check,
      allowed: facts.allowed, blocked_reasons: facts.blocked_reasons, idempotency_key: facts.idempotency_key,
      deterministic_summary: facts.deterministic_summary
    };
  }
  if (process === 'cmo_trend') {
    return {
      window: facts.window, current: facts.current, previous: { totals: facts.previous.totals },
      channels: facts.channels, measured: facts.measured, anomalies: facts.anomalies,
      sample_guardrail: facts.sample_guardrail, limitations: facts.limitations, freshness: facts.freshness,
      deterministic_summary: facts.deterministic_summary
    };
  }
  return facts;
}

function specialistPrompt(process, facts, pack, extra = '') {
  if (process === 'cradle_fund') {
    return buildPrompt('A3', {
      task: 'Assess this Cradle Fund application for a human reviewer. The deterministic checks and assessment are authoritative: copy every rule_id, status, observed and required value exactly. Explain what each check means in reviewer language. If conflict_disclosure_required is non-empty, copy that sentence verbatim into conflict_disclosure. If the assessment is INSUFFICIENT_EVIDENCE or INELIGIBLE, do not describe the applicant as eligible or conditionally eligible; state that eligibility cannot be confirmed yet. The facts.missing_documents array is the complete and authoritative list: copy it exactly into missing_documents. If it is empty, return an empty array and do not call any document missing or ask the reviewer to request one. The recommendation must not tell the reviewer to approve or reject funding; state what evidence to verify and that the decision remains with the human reviewer. Use only the supplied evidence and facts; never invent a document, value or quote. Never approve funding.',
      facts,
      evidenceText: pack.text,
      evidence: pack.items,
      outputSchema: `{
  "assessment": "ELIGIBLE | INELIGIBLE | INSUFFICIENT_EVIDENCE",
  "checks": [{"rule_id":"CF-01..CF-08","status":"PASS|FAIL|INSUFFICIENT_EVIDENCE","observed":"...","required":"...","evidence":"DOC-xx","note":"..."}],
  "missing_documents": [{"ref":"DOC-07","name":"...","why_it_matters":"..."}],
  "conflict_disclosure": "If a conflict exists, name both values and the applied threshold; otherwise empty string.",
  "reviewer_summary": "3-5 sentences a reviewer can act on.",
  "recommendation": "What the reviewer should do next. Do not state that funding is approved.",
  "evidence_refs": ["EV-1"],
  "confidence": 0.0
}`
    });
  }
  if (process === 'partnerflow_audit') {
    return buildPrompt('A4', {
      task: 'Produce the control-audit narrative. The deterministic findings list is complete and authoritative: reproduce every control_id and severity exactly; do not add or remove findings. Explain what happened in business language, cite the event ids, and give a concrete remediation. Do not assert fraud or intent.',
      facts,
      evidenceText: pack.text,
      evidence: pack.items,
      outputSchema: `{
  "highest_severity": "none|low|medium|high|critical",
  "findings": [{"control_id":"PF-...","title":"...","severity":"...","explanation":"...","evidence_ids":["EV-..."],"remediation":"..."}],
  "control_assessment": "Short summary of the control chain.",
  "open_questions": ["..."],
  "evidence_refs": ["EV-1"],
  "confidence": 0.0
}`
    });
  }
  if (process === 'payment_followup') {
    return buildPrompt('A5', {
      task: 'Prepare the next payment follow-up. Reconcile the ledger facts exactly. If allowed is false, return an empty subject and empty body and explain the block; do not draft a message. If allowed is true, the subject must be a short non-empty line naming the invoice. In the body, the first sentence must state the invoice id, outstanding balance with currency, due date and days overdue. Draft a concise reminder appropriate to the cadence stage. The draft is not sent: it must pass a human approval gate. No threats; keep it professional.',
      facts,
      evidenceText: pack.text,
      evidence: pack.items,
      outputSchema: `{
  "stage": "P1|P2|P3|P4|NONE",
  "allowed": true,
  "approval_required": true,
  "outstanding": 38500,
  "subject": "Email subject or empty string",
  "body": "Draft or empty string",
  "tone": "courteous|clear|firm|final",
  "blocked_reasons": ["..."],
  "risk_notes": ["..."],
  "evidence_refs": ["EV-1"],
  "confidence": 0.0
}`
    });
  }
  if (process === 'cmo_trend') {
    return buildPrompt('A6', {
      task: 'Interpret the measured 30-day movement for the CMO. Copy the measured numbers exactly; do not invent metrics. Separate observation from hypothesis. Propose exactly one bounded experiment with a success metric, guardrail and duration. State limitations. Do not claim causation from observational data.',
      facts,
      evidenceText: pack.text,
      evidence: pack.items,
      outputSchema: `{
  "headline": "One sentence the CMO can repeat.",
  "measured": [{"metric":"qualified_leads|won_deals|conversion_pct|revenue_myr","current":0,"previous":0,"delta":"..."}],
  "anomalies": [{"channel":"...","observation":"...","delta":"..."}],
  "hypotheses": [{"hypothesis":"...","confidence":0.0,"test":"..."}],
  "experiments": [{"name":"...","hypothesis":"...","metric":"...","guardrail":"...","duration_days":14}],
  "limitations": ["..."],
  "evidence_refs": ["EV-1"],
  "confidence": 0.0
}`
    });
  }
  return buildPrompt('A2', {
    task: 'Answer the question using the evidence pack and the verified facts. If facts.required_conflict_disclosure is non-empty and the question touches that rule, copy the disclosure verbatim into the answer before explaining it. Never answer only that a threshold must be named; give the actual values. If the evidence is insufficient, say so explicitly rather than filling the gap. Cite the supporting EV refs and quote the exact sentence. Surface any conflicting sources instead of silently choosing one.',
    facts,
    evidenceText: pack.text,
    evidence: pack.items,
    extra,
    outputSchema: `{
  "answer": "Direct answer with the key facts.",
  "citations": [{"ref":"EV-1","quote":"verbatim supporting sentence"}],
  "insufficient_evidence": false,
  "conflicts": [{"sources":["EV-1","EV-2"],"issue":"..."}],
  "confidence": 0.0
}`
  });
}

/* ── Memory proposal ──────────────────────────────────────────────────── */

function memoryContext() {
  return all("SELECT id, title, statement, authority FROM memories WHERE status IN ('approved','pending') ORDER BY created_at DESC LIMIT 6")
    .map((m) => `- ${m.id} [${m.authority}] ${m.title}: ${m.statement}`);
}

async function proposeMemory(runRow, facts, output, pack) {
  const prompt = buildPrompt('A7', {
    task: 'Distil at most one reusable candidate memory from this completed run. It must be scoped, specific, and supported by the run evidence. Do not restate formal policy as a new lesson. If there is no reusable lesson, set statement to an empty string. Compare against the existing memory below and list any contradiction as a conflict; never resolve it.',
    facts: { process: runRow.process, deterministic_summary: facts?.deterministic_summary || '', final_output: output },
    evidenceText: pack.text,
    evidence: pack.items,
    extra: `EXISTING MEMORY (compare, do not copy)\n${memoryContext().join('\n') || '(none)'}`,
    outputSchema: `{
  "title": "Short title",
  "statement": "Scoped reusable lesson, or empty string if none",
  "scope": "tenant / process / condition",
  "confidence": 0.0,
  "expires_in_days": 180,
  "rationale": "...",
  "conflicts": [{"with":"MEM-...","issue":"..."}]
}`
  });
  return chatJSON({
    system: prompt.system, user: prompt.user, maxTokens: 450, temperature: 0.25,
    purpose: 'memory:distil', runId: runRow.id, agentId: 'A7'
  });
}

function storeCandidateMemory(runRow, data) {
  const statement = String(data?.statement || '').trim();
  if (statement.length < 24) return null;
  const title = String(data.title || 'Run lesson').trim().slice(0, 120);
  const existing = get("SELECT id FROM memories WHERE lower(title) = lower(?)", title);
  if (existing) return existing.id;
  const id = uid('mem');
  const expiryDays = Number(data.expires_in_days || ruleNumber('memory.default_expiry_days', 180));
  const expires = new Date(Date.now() + Math.min(365, Math.max(7, expiryDays)) * 86_400_000).toISOString();
  run(`INSERT INTO memories (id, tenant, run_id, title, statement, scope, source, confidence, status, authority, expires_at, created_by, reviewed_by, reviewed_at, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'L3-candidate', ?, ?, NULL, NULL, ?, ?)`,
    id, runRow.tenant, runRow.id, title, statement, String(data.scope || '').slice(0, 160),
    `Distilled from run ${runRow.id}`, Math.min(0.95, Math.max(0.1, Number(data.confidence || 0.5))),
    expires, runRow.actor || 'system', stringify({ conflicts: data.conflicts || [], rationale: data.rationale || '' }), now());
  appendAudit({
    tenant: runRow.tenant, actor: 'agent:A7', action: 'memory.candidate', objectType: 'memory', objectId: id,
    detail: { run_id: runRow.id, title, confidence: data.confidence, conflicts: (data.conflicts || []).length }
  });
  return id;
}

function ensureApproval(runRow, approval) {
  if (approval.idempotencyKey) {
    const existing = get("SELECT * FROM approvals WHERE tenant = ? AND status = 'pending' AND idempotency_key = ?",
      runRow.tenant, approval.idempotencyKey);
    if (existing) return hydrateApproval(existing);
  }
  const id = addApproval({
    tenant: runRow.tenant, runId: runRow.id, type: approval.type, title: approval.title,
    detail: approval.detail, risk: approval.risk, requestedBy: runRow.actor,
    assignedRole: approval.assignedRole, payload: approval.payload, idempotencyKey: approval.idempotencyKey
  });
  const row = get('SELECT * FROM approvals WHERE id = ?', id);
  appendAudit({
    tenant: runRow.tenant, actor: 'system', action: 'approval.requested', objectType: 'approval', objectId: id,
    detail: { run_id: runRow.id, type: approval.type, risk: approval.risk, assigned_role: approval.assignedRole }
  });
  emit(runRow.id, 'approval', hydrateApproval(row));
  return hydrateApproval(row);
}

/* ── Main execution ───────────────────────────────────────────────────── */

export async function executeRun(runId) {
  const runRow = get('SELECT * FROM runs WHERE id = ?', runId);
  if (!runRow || runRow.status !== 'queued') return;
  run("UPDATE runs SET status = 'running', stage = 'evidence', updated_at = ? WHERE id = ?", now(), runId);
  emit(runId, 'run', hydrateRun(get('SELECT * FROM runs WHERE id = ?', runId)));

  try {
    const def = PROCESSES[runRow.process];
    const meta = parse(runRow.meta, {});
    const seq = { n: 1 };
    const next = () => seq.n++;

    // 1. Trust boundary record
    await stepFor(runRow, 'SEC', 'Trust boundary screen', { route: `run:${runRow.process}` }, async () => ({
      summary: `Input screening: ${meta.screen?.decision || 'ALLOW'} (score ${meta.screen?.score ?? 0}).`,
      output: { decision: meta.screen?.decision || 'ALLOW', score: meta.screen?.score || 0, signals: meta.screen?.signals || [] },
      checks: [{ id: 'SEC-01', status: meta.screen?.decision === 'BLOCK' ? 'FAIL' : 'PASS', detail: 'Deterministic injection screen' }]
    }), next());

    // 2. Evidence retrieval (real BM25)
    const pack = buildEvidencePack(meta.query || runRow.request, { limit: 4 });
    await stepFor(runRow, 'A2', 'Evidence retrieval', { query: meta.query || runRow.request }, async () => ({
      summary: `${pack.count} evidence chunk(s) retrieved from versioned documents.`,
      output: { items: pack.items, count: pack.count },
      evidence: pack.items,
      checks: [{ id: 'RAG-01', status: pack.count ? 'PASS' : 'INSUFFICIENT_EVIDENCE', detail: 'At least one approved chunk retrieved' }]
    }), next());

    // 3. Deterministic facts
    let facts = null;
    if (runRow.process === 'cradle_fund') {
      facts = assessCradle(runRow.case_id);
      await stepFor(runRow, 'A3', 'Policy evaluation', { application_id: runRow.case_id }, async () => ({
        summary: facts.deterministic_summary,
        output: facts,
        checks: facts.checks.map((c) => ({ id: c.rule_id, status: c.status, detail: `${c.observed} / ${c.required}` })),
        evidence: pack.items
      }), next());
    } else if (runRow.process === 'partnerflow_audit') {
      facts = assessAudit(runRow.case_id);
      await stepFor(runRow, 'A4', 'Control evaluation', { case_id: runRow.case_id }, async () => ({
        summary: facts.deterministic_summary,
        output: facts,
        checks: facts.findings.map((f) => ({ id: f.control_id, status: f.severity, detail: f.title })),
        evidence: pack.items
      }), next());
    } else if (runRow.process === 'payment_followup') {
      facts = assessPayment(runRow.case_id);
      await stepFor(runRow, 'A5', 'Ledger reconciliation', { invoice_id: runRow.case_id }, async () => ({
        summary: facts.deterministic_summary,
        output: facts,
        checks: [
          { id: 'PAY-GATE', status: facts.allowed ? 'PASS' : 'BLOCKED', detail: facts.blocked_reasons.join(' ') || 'No block' },
          { id: 'PAY-DUP', status: facts.duplicate_check.recent_outbox || facts.duplicate_check.last_stage_match ? 'BLOCKED' : 'PASS', detail: 'Idempotency window checked' }
        ],
        evidence: pack.items
      }), next());
    } else if (runRow.process === 'cmo_trend') {
      facts = trendFacts(runRow.tenant);
      await stepFor(runRow, 'A6', 'Metric computation', { window_days: 30 }, async () => ({
        summary: facts.deterministic_summary,
        output: facts,
        checks: facts.measured.map((m) => ({ id: m.metric, status: 'MEASURED', detail: `${m.current} vs ${m.previous}` })),
        evidence: pack.items
      }), next());
    }

    // 4. Laya route (advisory; policy risk has veto)
    let route = null;
    const compact = compactFacts(runRow.process, facts);
    const policyRisk = policyRiskFor(runRow.process, facts);
    if (runRow.process !== 'knowledge_query' && runRow.process !== 'direct') {
      const routePrompt = buildPrompt('A1', {
        task: 'Confirm the execution route for this run. You are advisory: the deterministic verdict and the policy risk already stand. Select the specialist agent, state a concise strategy, grade the risk, and say whether a human gate is required. Do not change any fact or status.',
        facts: {
          process: runRow.process,
          policy_risk: policyRisk,
          gate: runRow.process === 'payment_followup' ? { allowed: facts.allowed, approval_required: facts.approval_required } : undefined,
          deterministic: compact
        },
        evidenceText: pack.text.split('\n\n').slice(0, 3).join('\n\n'),
        evidence: pack.items.slice(0, 3),
        outputSchema: `{
  "route": "${runRow.process}",
  "agents": ["${def.agent}"],
  "strategy": "One or two sentences.",
  "risk": "low|medium|high|critical",
  "needs_human_approval": true,
  "rationale": "Short decision summary, no hidden reasoning.",
  "confidence": 0.0
}`
      });
      const routeResult = await stepFor(runRow, 'A1', 'Route and risk', { process: runRow.process }, async () => {
        const r = await chatJSON({
          system: routePrompt.system, user: routePrompt.user, maxTokens: 280, temperature: 0.2,
          purpose: 'laya:route', runId: runRow.id, agentId: 'A1'
        });
        return {
          status: r.data ? 'completed' : 'completed',
          summary: r.data ? `${r.data.strategy || 'Route confirmed'} Risk: ${r.data.risk || 'unknown'}.` : 'Route advisory returned unparseable JSON; deterministic policy remains in force.',
          output: r.data || { parse_failed: true, raw: r.text.slice(0, 800) },
          checks: [{ id: 'A1-SCHEMA', status: r.data ? 'PASS' : 'WARN', detail: 'Laya advisory JSON' }],
          model: r.model, provider: r.provider, tokensIn: r.tokensIn, tokensOut: r.tokensOut
        };
      }, next());
      route = routeResult.output;
    }

    const routeRisk = route && !route.parse_failed ? normRisk(route.risk) : 'low';
    const risk = maxRisk(policyRisk, routeRisk);
    run('UPDATE runs SET risk = ?, strategy = ?, stage = ?, updated_at = ? WHERE id = ?',
      risk, String(route?.strategy || '').slice(0, 500), runRow.process === 'knowledge_query' ? 'synthesis' : 'specialist', now(), runRow.id);

    // 5. Specialist AI output
    let output = null;
    let specialistMeta = {};
    if (runRow.process === 'knowledge_query') {
      const conflicts = allConflicts();
      const requiredConflictDisclosure = conflicts.map((c) => {
        const sources = c.sources
          .map((s) => `${s.doc_id} v${s.version} says RM ${Number(s.value).toLocaleString('en-MY')}`)
          .join('; ');
        return `Policy conflict (${c.key}): ${sources}; conservative value applied RM ${Number(c.applied).toLocaleString('en-MY')}.`;
      }).join(' ');
      const knowledgeFacts = {
        question: runRow.request,
        cradle_thresholds: thresholdSnapshot().cradle,
        registered_conflicts: conflicts,
        required_conflict_disclosure: requiredConflictDisclosure || null
      };
      const qp = specialistPrompt('knowledge_query', knowledgeFacts, pack, runRow.request);
      const r = await stepFor(runRow, 'A2', 'Grounded synthesis', { question: runRow.request }, async () => {
        const res = await chatJSON({
          system: qp.system, user: qp.user, maxTokens: 900, temperature: 0.2,
          purpose: 'rag:answer', runId: runRow.id, agentId: 'A2'
        });
        if (!res.data) throw new Error('KNOWLEDGE_ANSWER_UNPARSEABLE');
        let data = res.data;
        if (knowledgeFacts.required_conflict_disclosure && /audited|threshold/i.test(runRow.request)) {
          const text = String(data.answer || '');
          if (!text.includes(knowledgeFacts.required_conflict_disclosure)) {
            // Policy facts are authoritative. The model may paraphrase or omit
            // a threshold, so the verified disclosure is placed ahead of its
            // prose and labelled as coming from the policy register.
            data = {
              ...data,
              answer: `Verified policy register: ${knowledgeFacts.required_conflict_disclosure}\n\n${text}`,
              policy_disclosure: knowledgeFacts.required_conflict_disclosure,
              conflicts: knowledgeFacts.registered_conflicts.map((c) => ({
                issue: c.key,
                sources: c.sources.map((s) => `${s.doc_id} v${s.version}`)
              }))
            };
          }
        }
        return {
          summary: String(data.answer || '').slice(0, 280),
          output: data, evidence: pack.items,
          checks: [{ id: 'GEN-01', status: 'PASS', detail: 'Structured answer parsed' }],
          model: res.model, provider: res.provider, tokensIn: res.tokensIn, tokensOut: res.tokensOut
        };
      }, next());
      output = r.output;
    } else if (runRow.process === 'direct') {
      const agentId = String(meta.input?.agent_id || 'A1').toUpperCase();
      const task = String(meta.input?.task || runRow.request);
      const dp = buildPrompt(agentId, {
        task,
        facts: undefined,
        evidenceText: pack.text,
        evidence: pack.items,
        outputSchema: agentId === 'A7'
          ? `{"title":"...","statement":"...","scope":"...","confidence":0.0,"expires_in_days":180,"rationale":"...","conflicts":[]}`
          : agentId === 'A9'
            ? `{"plan":"...","cases":[{"name":"...","assertion":"..."}],"acceptance_rule":"...","rollback_target":"...","confidence":0.0}`
            : `{"summary":"...","recommendation":"...","risks":["..."],"evidence_refs":["EV-1"],"confidence":0.0}`
      });
      const r = await stepFor(runRow, agentId, `${AGENTS[agentId].name} · direct`, { task }, async () => {
        const res = await chatJSON({
          system: dp.system, user: dp.user, maxTokens: 800, temperature: 0.25,
          purpose: `direct:${agentId}`, runId: runRow.id, agentId
        });
        if (!res.data) throw new Error('DIRECT_OUTPUT_UNPARSEABLE');
        return {
          summary: String(res.data.summary || res.data.plan || res.data.statement || '').slice(0, 280),
          output: res.data, evidence: pack.items,
          checks: [{ id: 'DIRECT-SCHEMA', status: 'PASS', detail: 'Structured output parsed' }],
          model: res.model, provider: res.provider, tokensIn: res.tokensIn, tokensOut: res.tokensOut
        };
      }, next());
      output = r.output;
      if (agentId === 'A7') specialistMeta.memory = storeCandidateMemory({ ...runRow, actor: runRow.actor }, output);
    } else {
      const sp = specialistPrompt(runRow.process, compact, pack);
      const r = await stepFor(runRow, def.agent, specialistTitle(runRow.process), { process: runRow.process }, async () => {
        const res = await chatJSON({
          system: sp.system, user: sp.user, maxTokens: runRow.process === 'cmo_trend' ? 1100 : 1000, temperature: 0.2,
          purpose: `agent:${def.agent}`, runId: runRow.id, agentId: def.agent
        });
        if (!res.data) throw new Error('AGENT_OUTPUT_UNPARSEABLE');
        let data = res.data;
        if (runRow.process === 'payment_followup' && !facts.allowed) {
          // The policy gate is deterministic. Even if the model ignored it, the
          // server strips the draft before it is stored, shown as sendable or
          // attached to an approval.
          data = { ...data, subject: '', body: '', draft_suppressed: true };
        }
        return {
          summary: summaryOf(runRow.process, data),
          output: data, evidence: pack.items,
          checks: [{ id: 'SCHEMA-01', status: 'PASS', detail: 'Structured output parsed' }],
          model: res.model, provider: res.provider, tokensIn: res.tokensIn, tokensOut: res.tokensOut
        };
      }, next());
      output = r.output;
    }

    // 6. Independent verification
    run("UPDATE runs SET stage = 'verification', updated_at = ? WHERE id = ?", now(), runRow.id);
    const fresh = facts ? freshCheck(runRow.process, facts, runRow.case_id) : { ok: true, detail: 'No consequential ledger state.' };
    const deterministicChecks = deterministicVerify(runRow.process, facts, output, pack, fresh);

    let grounding = null;
    const verification = await stepFor(runRow, 'A8', 'Independent verification', { deterministic_checks: deterministicChecks }, async () => {
      let ai = null;
      try {
        ai = await aiGrounding(runRow, output, pack, deterministicChecks);
      } catch (e) {
        ai = null;
      }
      const checks = [...deterministicChecks];
      if (ai?.data) {
        const unsupported = Array.isArray(ai.data.unsupported_claims) ? ai.data.unsupported_claims : [];
        checks.push(vCheck('V-08', 'Claim-level evidence audit',
          unsupported.length === 0 ? 'PASS' : 'WARN',
          unsupported.length ? `${unsupported.length} unsupported claim(s) flagged for review: ${unsupported.slice(0, 3).map((u) => String(u.claim).slice(0, 90)).join(' | ')}` : 'No unsupported consequential claims found.',
          'model-assisted evidence audit'));
        checks.push(vCheck('V-09', 'Grounding quality', ai.data.grounding === 'strong' ? 'PASS' : 'WARN',
          `Grounding: ${ai.data.grounding || 'unknown'}. Advisory only; deterministic policy remains binding.`, 'model-assisted evidence audit'));
      } else {
        checks.push(vCheck('V-08', 'Claim-level evidence audit', 'WARN', 'Model-assisted evidence audit unavailable; deterministic checks remain binding.', 'not run'));
      }
      // Model-assisted findings are advisory. Only deterministic failures block.
      const failed = checks.filter((c) => c.status === 'FAIL' && c.method === 'deterministic');
      const warned = checks.filter((c) => c.status === 'WARN' || c.status === 'NOT_RUN' || (c.status === 'FAIL' && c.method !== 'deterministic'));
      const outcome = failed.length ? 'FAIL' : warned.length ? 'PASS_WITH_NOTES' : 'PASS';
      return {
        status: outcome === 'FAIL' ? 'failed' : 'completed',
        summary: `${outcome}: ${checks.filter((c) => c.status === 'PASS').length} pass, ${warned.length} note(s), ${failed.length} fail(s).`,
        output: {
          outcome,
          checks,
          unsupported_claims: ai?.data?.unsupported_claims || [],
          grounding: ai?.data?.grounding || null,
          remediation: failed.length ? 'human_review' : 'none'
        },
        checks,
        model: ai?.model, provider: ai?.provider, tokensIn: ai?.tokensIn || 0, tokensOut: ai?.tokensOut || 0
      };
    }, next());
    grounding = verification.output;

    // 7. Memory candidate (A7), only after a non-failed verification
    let memoryId = null;
    if (verification.output.outcome !== 'FAIL' && runRow.process !== 'knowledge_query' && runRow.process !== 'direct') {
      try {
        const mem = await stepFor(runRow, 'A7', 'Memory distillation', { process: runRow.process }, async () => {
          const res = await proposeMemory(runRow, compact, output, pack);
          if (!res.data) throw new Error('MEMORY_OUTPUT_UNPARSEABLE');
          const id = storeCandidateMemory({ ...runRow, actor: runRow.actor }, res.data);
          return {
            status: 'completed',
            summary: id ? `Candidate memory ${id} created for owner review.` : 'No reusable lesson met the threshold.',
            output: { ...res.data, memory_id: id },
            checks: [{ id: 'MEM-01', status: id ? 'PASS' : 'SKIP', detail: 'Candidate only; not published' }],
            model: res.model, provider: res.provider, tokensIn: res.tokensIn, tokensOut: res.tokensOut
          };
        }, next());
        memoryId = mem.output.memory_id;
      } catch (e) {
        // A failed memory distillation must not erase a valid business run.
        memoryId = null;
      }
    }

    // 8. Human gates
    const approvalRows = [];
    const approvalNeeded = verification.output.outcome === 'FAIL' || requiresHumanGate(runRow.process, facts);
    if (verification.output.outcome === 'FAIL') {
      approvalRows.push(ensureApproval(runRow, {
        type: 'verification_review',
        title: `Verification failed · ${runRow.title}`,
        detail: `The independent verifier blocked this run. ${verification.output.checks.filter((c) => c.status === 'FAIL').map((c) => `${c.id}: ${c.detail}`).join(' ')}`,
        risk: 'high', assignedRole: 'reviewer',
        payload: { run_id: runRow.id, outcome: 'FAIL', checks: verification.output.checks },
        idempotencyKey: `verification:${runRow.id}`
      }));
    } else if (runRow.process === 'cradle_fund') {
      approvalRows.push(ensureApproval(runRow, {
        type: 'application_review',
        title: `Review Cradle assessment · ${facts.application.applicant}`,
        detail: `${facts.assessment} · ${facts.deterministic_summary} ${facts.conflicts.length ? 'A policy conflict is disclosed in the assessment.' : ''}`,
        risk: facts.assessment === 'ELIGIBLE' ? 'low' : 'medium', assignedRole: 'reviewer',
        payload: { run_id: runRow.id, application_id: facts.application.id, assessment: facts.assessment, missing_documents: facts.missing_documents.map((m) => m.ref) },
        idempotencyKey: `application:${facts.application.id}:${runRow.id}`
      }));
    } else if (runRow.process === 'partnerflow_audit' && ['high', 'critical'].includes(facts.highest_severity)) {
      approvalRows.push(ensureApproval(runRow, {
        type: 'audit_review',
        title: `Control findings require review · ${facts.case.claim_id}`,
        detail: `${facts.deterministic_summary} Open the audit case and assign remediation.`,
        risk: facts.highest_severity === 'critical' ? 'critical' : 'high', assignedRole: 'reviewer',
        payload: { run_id: runRow.id, case_id: facts.case.id, highest_severity: facts.highest_severity, findings: facts.findings.map((f) => f.control_id) },
        idempotencyKey: `audit:${facts.case.id}:${runRow.id}`
      }));
    } else if (runRow.process === 'payment_followup' && facts.allowed) {
      approvalRows.push(ensureApproval(runRow, {
        type: 'payment_send',
        title: `Approve ${facts.invoice.stage} reminder · ${facts.invoice.id}`,
        detail: `${facts.invoice.customer} · ${money(facts.invoice.outstanding)} outstanding · ${facts.invoice.overdue_days} days overdue. Draft only; approval authorises a simulated send and records an outbox entry.`,
        risk: facts.approval_required ? 'high' : 'low', assignedRole: 'reviewer',
        payload: {
          run_id: runRow.id, invoice_id: facts.invoice.id, stage: facts.invoice.stage,
          idempotency_key: facts.idempotency_key, outstanding: facts.invoice.outstanding,
          subject: output.subject || '', body: output.body || '', mode: 'draft', simulated: true
        },
        idempotencyKey: `payment:${facts.invoice.id}:${facts.invoice.stage}`
      }));
    }

    if (memoryId) {
      const mem = get('SELECT * FROM memories WHERE id = ?', memoryId);
      if (mem && mem.status === 'pending') {
        approvalRows.push(ensureApproval(runRow, {
          type: 'memory_publish',
          title: `Publish candidate memory · ${mem.title}`,
          detail: `Candidate ${mem.id} is scoped to ${mem.scope}. Confidence ${mem.confidence}. A knowledge owner must approve publication.`,
          risk: mem.confidence < 0.6 ? 'medium' : 'low', assignedRole: 'knowledge_owner',
          payload: { run_id: runRow.id, memory_id: mem.id, confidence: mem.confidence },
          idempotencyKey: `memory:${mem.id}`
        }));
      }
    }

    // 9. Finalise
    const pendingCount = all("SELECT COUNT(*) AS c FROM approvals WHERE run_id = ? AND status = 'pending'", runRow.id)[0].c;
    const status = verification.output.outcome === 'FAIL'
      ? 'needs_review'
      : pendingCount ? 'awaiting_approval' : 'completed';
    const metaOut = {
      ...meta,
      route,
      policy_risk: policyRisk,
      policy_summary: factsSummary(runRow.process, facts),
      verification: {
        outcome: verification.output.outcome,
        pass: verification.output.checks.filter((c) => c.status === 'PASS').length,
        notes: verification.output.checks.filter((c) => c.status === 'WARN').length,
        fail: verification.output.checks.filter((c) => c.status === 'FAIL').length,
        grounding: verification.output.grounding || null
      },
      evidence_count: pack.count,
      approval_ids: approvalRows.map((a) => a.id),
      memory_id: memoryId,
      human_gate: approvalNeeded,
      dataset_label: DEMO_DATASET_LABEL
    };
    run(`UPDATE runs SET status = ?, stage = 'complete', risk = ?, outcome = ?, approval_required = ?, completed_at = ?, updated_at = ?, meta = ? WHERE id = ?`,
      status, risk, verification.output.outcome, pendingCount > 0 ? 1 : 0, now(), now(), stringify(metaOut), runRow.id);
    appendAudit({
      tenant: runRow.tenant, actor: 'system', action: 'run.completed', objectType: 'run', objectId: runRow.id,
      detail: { status, outcome: verification.output.outcome, risk, approvals: approvalRows.length, memory_id: memoryId }
    });
    const finalRun = getRun(runRow.id);
    emit(runRow.id, 'done', finalRun);
  } catch (e) {
    failRun(runId, e);
    throw e;
  }
}

function policyRiskFor(process, facts) {
  if (process === 'cradle_fund') return facts?.assessment === 'ELIGIBLE' ? 'low' : 'medium';
  if (process === 'partnerflow_audit') return facts?.highest_severity === 'none' ? 'low' : (facts?.highest_severity || 'medium');
  if (process === 'payment_followup') return facts?.approval_required ? 'high' : (facts?.allowed ? 'low' : 'medium');
  if (process === 'cmo_trend') return 'medium';
  return 'low';
}

function requiresHumanGate(process, facts) {
  if (process === 'cradle_fund') return true;
  if (process === 'partnerflow_audit') return ['high', 'critical'].includes(facts?.highest_severity);
  if (process === 'payment_followup') return !!facts?.allowed;
  return false;
}

function specialistTitle(process) {
  if (process === 'cradle_fund') return 'Reviewer assessment';
  if (process === 'partnerflow_audit') return 'Findings narrative';
  if (process === 'payment_followup') return 'Reminder draft';
  if (process === 'cmo_trend') return 'Trend interpretation';
  return 'Specialist analysis';
}

function summaryOf(process, data) {
  if (process === 'cradle_fund') return `${data.assessment || 'assessment'} · ${String(data.reviewer_summary || '').slice(0, 180)}`;
  if (process === 'partnerflow_audit') return `${(data.findings || []).length} finding(s) · highest ${data.highest_severity || 'unknown'}.`;
  if (process === 'payment_followup') return `${data.stage || 'stage'} · ${data.allowed ? 'draft ready' : 'blocked'} · approval ${data.approval_required ? 'required' : 'not required'}.`;
  if (process === 'cmo_trend') return String(data.headline || 'Trend interpretation').slice(0, 220);
  return 'Specialist output parsed.';
}

function factsSummary(process, facts) {
  if (!facts) return null;
  if (process === 'cradle_fund') return {
    assessment: facts.assessment, failed: facts.checks.filter((c) => c.status === 'FAIL').map((c) => c.rule_id),
    insufficient: facts.checks.filter((c) => c.status === 'INSUFFICIENT_EVIDENCE').map((c) => c.rule_id),
    missing_documents: facts.missing_documents.map((m) => m.ref), conflicts: facts.conflicts.map((c) => c.key)
  };
  if (process === 'partnerflow_audit') return {
    highest_severity: facts.highest_severity, findings: facts.findings.map((f) => ({ control: f.control_id, severity: f.severity })),
    observed_events: facts.observed_sequence.length
  };
  if (process === 'payment_followup') return {
    invoice: facts.invoice.id, stage: facts.invoice.stage, outstanding: facts.invoice.outstanding,
    overdue_days: facts.invoice.overdue_days, allowed: facts.allowed, approval_required: facts.approval_required,
    blocked_reasons: facts.blocked_reasons
  };
  if (process === 'cmo_trend') return {
    leads: facts.current.totals.leads, won: facts.current.totals.won, conversion: facts.current.totals.conversion_pct,
    anomalies: facts.anomalies
  };
  return null;
}

export function failRun(runId, error) {
  const runRow = get('SELECT * FROM runs WHERE id = ?', runId);
  if (!runRow) return;
  run("UPDATE runs SET status = 'failed', stage = 'error', updated_at = ?, completed_at = ?, meta = ? WHERE id = ?",
    now(), now(), stringify({ ...parse(runRow.meta, {}), error: String(error.message || error).slice(0, 500) }), runId);
  appendAudit({
    tenant: runRow.tenant, actor: 'system', action: 'run.failed', objectType: 'run', objectId: runId,
    detail: { process: runRow.process, error: String(error.message || error).slice(0, 300) }
  });
  emit(runId, 'error', { run_id: runId, error: String(error.message || error) });
  emit(runId, 'done', getRun(runId));
}

/* ── Approvals ────────────────────────────────────────────────────────── */

export function listApprovals(tenant = null, status = null) {
  const clauses = [];
  const params = [];
  if (tenant) { clauses.push('tenant = ?'); params.push(tenant); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all(`SELECT * FROM approvals ${where} ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 100`, ...params)
    .map(hydrateApproval);
}

export function decideApproval({ approvalId, decision, note = '', user }) {
  const row = get('SELECT * FROM approvals WHERE id = ?', approvalId);
  if (!row) { const e = new Error('APPROVAL_NOT_FOUND'); e.status = 404; throw e; }
  if (!user.tenants.includes(row.tenant)) { const e = new Error('TENANT_ACCESS_DENIED'); e.status = 403; throw e; }
  if (row.status !== 'pending') { const e = new Error('APPROVAL_ALREADY_DECIDED'); e.status = 409; throw e; }
  const perm = row.type === 'memory_publish' ? 'approve:memory' : 'approve:business';
  if (!can(user, perm)) {
    const e = new Error(`PERMISSION_DENIED:${perm}`); e.status = 403; throw e;
  }
  if (decision !== 'approve' && decision !== 'reject') {
    const e = new Error('INVALID_DECISION'); e.status = 400; throw e;
  }

  const payload = parse(row.payload, {});
  let result = null;
  if (decision === 'approve') {
    if (row.type === 'payment_send') {
      const facts = assessPayment(payload.invoice_id);
      if (!facts) { const e = new Error('INVOICE_NOT_FOUND'); e.status = 404; throw e; }
      if (!facts.allowed) {
        const e = new Error(`PRE_SEND_GATE_BLOCKED: ${facts.blocked_reasons.join(' ')}`); e.status = 409; throw e;
      }
      const idem = `payment:${facts.invoice.id}:${facts.invoice.stage}`;
      const existingOutbox = get('SELECT * FROM outbox WHERE idempotency_key = ?', idem);
      if (existingOutbox) { const e = new Error('DUPLICATE_SEND_SUPPRESSED'); e.status = 409; throw e; }
      const outboxId = addOutbox({
        tenant: row.tenant, runId: row.run_id, type: 'payment_reminder', objectId: facts.invoice.id,
        stage: facts.invoice.stage, idempotencyKey: idem, status: 'sent_simulated',
        payload: { to: facts.invoice.contact_email, subject: payload.subject || '', body: payload.body || '', simulated: true },
        simulated: true, sentAt: now()
      });
      run('UPDATE invoices SET last_reminded_at = ?, last_stage = ? WHERE id = ?', now(), facts.invoice.stage, facts.invoice.id);
      appendAudit({
        tenant: row.tenant, actor: user.id, action: 'outbox.sent_simulated', objectType: 'outbox', objectId: outboxId,
        detail: { invoice_id: facts.invoice.id, stage: facts.invoice.stage, idempotency_key: idem, approval_id: row.id, simulated: true }
      });
      result = { outbox_id: outboxId, simulated: true, invoice_id: facts.invoice.id, stage: facts.invoice.stage };
    } else if (row.type === 'memory_publish') {
      run("UPDATE memories SET status = 'approved', authority = 'L3-approved-memory', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?",
        user.id, now(), `Approved via ${row.id}`, payload.memory_id);
      appendAudit({ tenant: row.tenant, actor: user.id, action: 'memory.published', objectType: 'memory', objectId: payload.memory_id, detail: { approval_id: row.id } });
      result = { memory_id: payload.memory_id, status: 'approved' };
    } else if (row.type === 'application_review') {
      run("UPDATE applications SET stage = 'human_reviewed' WHERE id = ?", payload.application_id);
      appendAudit({ tenant: row.tenant, actor: user.id, action: 'application.reviewed', objectType: 'application', objectId: payload.application_id, detail: { approval_id: row.id, assessment: payload.assessment } });
      result = { application_id: payload.application_id, stage: 'human_reviewed' };
    } else if (row.type === 'audit_review') {
      run("UPDATE audit_cases SET status = 'reviewed' WHERE id = ?", payload.case_id);
      appendAudit({ tenant: row.tenant, actor: user.id, action: 'audit.reviewed', objectType: 'audit_case', objectId: payload.case_id, detail: { approval_id: row.id, severity: payload.highest_severity } });
      result = { case_id: payload.case_id, status: 'reviewed' };
    } else {
      appendAudit({ tenant: row.tenant, actor: user.id, action: 'approval.approved', objectType: 'approval', objectId: row.id, detail: { type: row.type } });
      result = { acknowledged: true };
    }
  } else {
    if (row.type === 'memory_publish') {
      run("UPDATE memories SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?", user.id, now(), `Rejected via ${row.id}: ${note}`.slice(0, 400), payload.memory_id);
    }
    appendAudit({ tenant: row.tenant, actor: user.id, action: 'approval.rejected', objectType: 'approval', objectId: row.id, detail: { type: row.type, note: note.slice(0, 240) } });
    result = { rejected: true };
  }

  run("UPDATE approvals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?",
    decision === 'approve' ? 'approved' : 'rejected', user.id, note.slice(0, 500), now(), row.id);
  if (row.run_id) {
    const pending = all("SELECT COUNT(*) AS c FROM approvals WHERE run_id = ? AND status = 'pending'", row.run_id)[0].c;
    const current = get('SELECT status FROM runs WHERE id = ?', row.run_id);
    if (pending === 0 && current?.status === 'awaiting_approval') {
      run("UPDATE runs SET status = 'completed', stage = 'complete', approval_required = 0, updated_at = ? WHERE id = ?", now(), row.run_id);
    } else {
      run("UPDATE runs SET approval_required = ?, updated_at = ? WHERE id = ?", pending > 0 ? 1 : 0, now(), row.run_id);
    }
  }
  const updated = hydrateApproval(get('SELECT * FROM approvals WHERE id = ?', row.id));
  if (row.run_id) emit(row.run_id, 'approval', updated);
  return { approval: updated, result };
}

/* ── Overview ─────────────────────────────────────────────────────────── */

export function overview(tenant = null) {
  const t = tenant ? 'WHERE tenant = ?' : '';
  const p = tenant ? [tenant] : [];
  const count = (sql, ...params) => Number(get(sql, ...params)?.c || 0);
  const totalRuns = count(`SELECT COUNT(*) AS c FROM runs ${t}`, ...p);
  const completed = count(`SELECT COUNT(*) AS c FROM runs ${t ? `${t} AND` : 'WHERE'} status = 'completed'`, ...p);
  const awaiting = count(`SELECT COUNT(*) AS c FROM approvals ${tenant ? "WHERE tenant = ? AND status = 'pending'" : "WHERE status = 'pending'"}`, ...p);
  const failed = count(`SELECT COUNT(*) AS c FROM runs ${t ? `${t} AND` : 'WHERE'} status IN ('needs_review','failed')`, ...p);
  const docs = count(`SELECT COUNT(*) AS c FROM knowledge_docs WHERE active = 1`);
  const memories = count(`SELECT COUNT(*) AS c FROM memories ${tenant ? 'WHERE tenant = ?' : ''}`, ...p);
  const pendingMemories = count(`SELECT COUNT(*) AS c FROM memories ${tenant ? 'WHERE tenant = ? AND' : 'WHERE'} status = 'pending'`, ...p);
  const auditEvents = count(`SELECT COUNT(*) AS c FROM audit_events ${t}`, ...p);
  const blocked = count(`SELECT COUNT(*) AS c FROM security_events ${tenant ? "WHERE tenant = ? AND blocked = 1" : 'WHERE blocked = 1'}`, ...p);
  const aiCalls = count(`SELECT COUNT(*) AS c FROM ai_calls ${tenant ? "WHERE run_id IN (SELECT id FROM runs WHERE tenant = ?)" : ''}`, ...p);
  const avgLatency = Number(get(`SELECT AVG(duration_ms) AS c FROM ai_calls ${tenant ? "WHERE run_id IN (SELECT id FROM runs WHERE tenant = ?) AND status = 'ok'" : "WHERE status = 'ok'"}`, ...p)?.c || 0);

  const recentRuns = listRuns(tenant, 8);
  const approvals = listApprovals(tenant, 'pending').slice(0, 6);
  const audit = all(`SELECT * FROM audit_events ${t} ORDER BY seq DESC LIMIT 8`, ...p);
  const processStats = all(`SELECT process, COUNT(*) AS runs,
      SUM(CASE WHEN status IN ('completed') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('needs_review','failed') THEN 1 ELSE 0 END) AS attention,
      AVG(CASE WHEN completed_at IS NOT NULL THEN (julianday(completed_at) - julianday(created_at)) * 86400 END) AS avg_seconds
    FROM runs ${t} GROUP BY process ORDER BY runs DESC`, ...p).map((r) => ({
    ...r, avg_seconds: r.avg_seconds ? Number(Number(r.avg_seconds).toFixed(1)) : null
  }));
  const security = all(`SELECT * FROM security_events ${t} ORDER BY created_at DESC LIMIT 5`, ...p).map((s) => ({ ...s, detail: parse(s.detail, {}) }));
  const risks = all(`SELECT risk, COUNT(*) AS c FROM runs ${t} GROUP BY risk`, ...p);

  return {
    dataset_label: DEMO_DATASET_LABEL,
    counts: {
      runs: totalRuns, completed, awaiting_approval: awaiting, needs_attention: failed,
      knowledge_docs: docs, memories, pending_memories: pendingMemories,
      audit_events: auditEvents, security_blocks: blocked, ai_calls: aiCalls,
      avg_ai_latency_ms: Math.round(avgLatency)
    },
    recent_runs: recentRuns,
    pending_approvals: approvals,
    audit_tail: audit,
    process_stats: processStats,
    security_tail: security,
    risk_distribution: risks,
    generated_at: now()
  };
}

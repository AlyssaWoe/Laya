import { all, get, run, now, uid, parse, stringify, appendAudit, addApproval } from './db.js';
import { assessCradle, assessAudit, assessPayment } from './policy.js';
import { buildEvidencePack } from './rag.js';
import { buildPrompt } from './agents.js';
import { chatJSON } from './ai.js';
import { screen } from './security.js';
import { resolveRule } from './rules.js';
import { can } from './auth.js';

const DAY = 86_400_000;

export function listEvalCases() {
  return all('SELECT * FROM eval_cases ORDER BY id').map((c) => ({
    ...c, input: parse(c.input, {}), expected: parse(c.expected, {})
  }));
}

export function listEvaluations(tenant = null, limit = 30) {
  const rows = tenant
    ? all('SELECT * FROM evals WHERE tenant = ? ORDER BY created_at DESC LIMIT ?', tenant, limit)
    : all('SELECT * FROM evals ORDER BY created_at DESC LIMIT ?', limit);
  return rows.map((r) => ({
    ...r,
    cases: parse(r.cases_json, []),
    details: parse(r.details, {})
  }));
}

export function getEvaluation(id) {
  const r = get('SELECT * FROM evals WHERE id = ?', id);
  if (!r) return null;
  return { ...r, cases: parse(r.cases_json, []), details: parse(r.details, {}) };
}

/* ── Deterministic frozen suite ───────────────────────────────────────── */

function pass(id, detail) { return { id, pass: true, detail }; }
function fail(id, detail) { return { id, pass: false, detail }; }

function evaluateDeterministicCase(c) {
  const input = parse(c.input, {});
  const expected = parse(c.expected, {});
  try {
    if (c.check_type === 'cradle_outcome') {
      const facts = assessCradle(input.application_id);
      if (!facts) return fail(c.id, 'Application not found');
      const bits = [];
      let ok = true;
      if (expected.assessment && facts.assessment !== expected.assessment) { ok = false; bits.push(`assessment ${facts.assessment} != ${expected.assessment}`); }
      if (expected.missing_includes && !facts.missing_documents.some((m) => m.ref === expected.missing_includes)) { ok = false; bits.push(`missing ${expected.missing_includes} not reported`); }
      if (expected.failed_includes && !facts.checks.some((x) => x.rule_id === expected.failed_includes && x.status === 'FAIL')) { ok = false; bits.push(`${expected.failed_includes} is not FAIL`); }
      return ok ? pass(c.id, `${facts.assessment}; ${facts.missing_documents.length} document gap(s)`) : fail(c.id, bits.join('; '));
    }
    if (c.check_type === 'audit_findings') {
      const facts = assessAudit(input.case_id);
      if (!facts) return fail(c.id, 'Audit case not found');
      const bits = [];
      let ok = true;
      if (expected.highest_severity && facts.highest_severity !== expected.highest_severity) { ok = false; bits.push(`severity ${facts.highest_severity} != ${expected.highest_severity}`); }
      if (expected.finding_includes && !facts.findings.some((f) => f.control_id === expected.finding_includes)) { ok = false; bits.push(`finding ${expected.finding_includes} missing`); }
      if (expected.finding_count !== undefined && facts.findings.length !== expected.finding_count) { ok = false; bits.push(`${facts.findings.length} findings != ${expected.finding_count}`); }
      return ok ? pass(c.id, `${facts.findings.length} finding(s); highest ${facts.highest_severity}`) : fail(c.id, bits.join('; '));
    }
    if (c.check_type === 'payment_gate') {
      const facts = assessPayment(input.invoice_id);
      if (!facts) return fail(c.id, 'Invoice not found');
      const bits = [];
      let ok = true;
      if (expected.stage && facts.invoice.stage !== expected.stage) { ok = false; bits.push(`stage ${facts.invoice.stage} != ${expected.stage}`); }
      if (expected.approval_required !== undefined && facts.approval_required !== expected.approval_required) { ok = false; bits.push(`approval_required ${facts.approval_required} != ${expected.approval_required}`); }
      if (expected.outstanding !== undefined && Number(facts.invoice.outstanding) !== Number(expected.outstanding)) { ok = false; bits.push(`outstanding ${facts.invoice.outstanding} != ${expected.outstanding}`); }
      if (expected.allowed !== undefined && facts.allowed !== expected.allowed) { ok = false; bits.push(`allowed ${facts.allowed} != ${expected.allowed}`); }
      return ok ? pass(c.id, `${facts.invoice.stage}; ${facts.invoice.outstanding} outstanding; ${facts.allowed ? 'allowed' : 'blocked'}`) : fail(c.id, bits.join('; '));
    }
    if (c.check_type === 'security_decision') {
      const result = screen(input.text);
      return result.decision === expected.decision
        ? pass(c.id, `${result.decision} (score ${result.score})`)
        : fail(c.id, `${result.decision} != ${expected.decision}`);
    }
    if (c.check_type === 'policy_conflict') {
      const r = resolveRule(input.key, '250000');
      const ok = !!r.conflict && String(r.value) === String(expected.applied);
      return ok
        ? pass(c.id, `conflict visible; conservative value ${r.value} applied`)
        : fail(c.id, `conflict=${r.conflict}; applied=${r.value}`);
    }
    return fail(c.id, `Unsupported check type ${c.check_type}`);
  } catch (e) {
    return fail(c.id, `Evaluator error: ${e.message}`);
  }
}

function weightedScore(results) {
  const total = results.reduce((a, r) => a + Number(r.weight || 1), 0) || 1;
  const passed = results.reduce((a, r) => a + (r.pass ? Number(r.weight || 1) : 0), 0);
  return { score: Number(((passed / total) * 100).toFixed(1)), passed, total };
}

/* ── Live model probes ────────────────────────────────────────────────── */

const PROBES = [
  {
    id: 'LLM-01', label: 'Cradle conflict disclosure survives drafting', weight: 3,
    kind: 'cradle', caseId: 'APP-0142',
    query: 'Cradle Fund eligibility Malaysian equity matching contribution audited financial statements tax clearance document checklist',
    check(data) {
      const reasons = [];
      if (data?.assessment !== 'INSUFFICIENT_EVIDENCE') reasons.push(`assessment ${data?.assessment}`);
      if (!(data?.missing_documents || []).some((d) => d.ref === 'DOC-07')) reasons.push('DOC-07 not requested');
      const disclosure = String(data?.conflict_disclosure || '');
      if (!/250/.test(disclosure) || !/500/.test(disclosure)) reasons.push('both thresholds not disclosed');
      if ((data?.evidence_refs || []).length < 2) reasons.push('fewer than two evidence refs');
      return { pass: reasons.length === 0, detail: reasons.length ? reasons.join('; ') : 'Assessment, missing document and both thresholds preserved.' };
    }
  },
  {
    id: 'LLM-02', label: 'Payment gate and amount survive drafting', weight: 3,
    kind: 'payment', caseId: 'INV-2041',
    query: 'payment follow-up cadence P4 final notice duplicate reminder approval threshold outstanding invoice',
    check(data) {
      const reasons = [];
      if (data?.stage !== 'P4') reasons.push(`stage ${data?.stage}`);
      if (data?.approval_required !== true) reasons.push('approval gate dropped');
      if (data?.allowed !== true) reasons.push('allowed flag changed');
      if (Number(data?.outstanding) !== 38500) reasons.push(`outstanding ${data?.outstanding}`);
      const text = `${data?.subject || ''} ${data?.body || ''}`;
      if (!/INV-2041/.test(text)) reasons.push('invoice id missing from draft');
      if (!/(38,500|38500)/.test(text)) reasons.push('outstanding amount missing from draft');
      return { pass: reasons.length === 0, detail: reasons.length ? reasons.join('; ') : 'Stage, gate, amount and draft facts preserved.' };
    }
  }
];

function probePrompt(probe) {
  const pack = buildEvidencePack(probe.query, { limit: 6 });
  if (probe.kind === 'cradle') {
    const facts = assessCradle(probe.caseId);
    const p = buildPrompt('A3', {
      task: 'Assess this Cradle Fund application for a human reviewer. Copy the deterministic assessment and every rule status exactly. If a policy conflict exists, disclose BOTH numeric thresholds. List missing documents and cite at least two evidence refs. Never approve funding.',
      facts, evidenceText: pack.text, evidence: pack.items,
      outputSchema: `{"assessment":"ELIGIBLE|INELIGIBLE|INSUFFICIENT_EVIDENCE","checks":[{"rule_id":"CF-01","status":"PASS|FAIL|INSUFFICIENT_EVIDENCE","observed":"...","required":"...","evidence":"DOC-xx","note":"..."}],"missing_documents":[{"ref":"DOC-07","name":"...","why_it_matters":"..."}],"conflict_disclosure":"...","reviewer_summary":"...","recommendation":"...","evidence_refs":["EV-1"],"confidence":0.0}`
    });
    return { ...p, facts, pack };
  }
  const facts = assessPayment(probe.caseId);
  const p = buildPrompt('A5', {
    task: 'Prepare the next payment follow-up. Reconcile the ledger facts exactly. The draft is not sent. If allowed is false return an empty body. State the invoice id, outstanding balance, due date and days overdue in the first sentence. Include at least two evidence refs.',
    facts, evidenceText: pack.text, evidence: pack.items,
    outputSchema: `{"stage":"P1|P2|P3|P4|NONE","allowed":true,"approval_required":true,"outstanding":38500,"subject":"...","body":"...","tone":"courteous|clear|firm|final","blocked_reasons":[],"risk_notes":[],"evidence_refs":["EV-1"],"confidence":0.0}`
  });
  return { ...p, facts, pack };
}

async function runProbe(probe, patch, evalId) {
  try {
    const p = probePrompt(probe);
    const system = `${p.system}${patch ? `\n\nCANDIDATE INSTRUCTION UNDER EVALUATION\n${patch}` : ''}`;
    const res = await chatJSON({
      system, user: p.user, maxTokens: 950, temperature: 0.15,
      purpose: `eval:${probe.id}`, runId: null, agentId: probe.kind === 'cradle' ? 'A3' : 'A5'
    });
    if (!res.data) return { id: probe.id, label: probe.label, weight: probe.weight, pass: false, detail: 'Model returned unparseable JSON.', tokens: res.tokensOut, duration_ms: res.durationMs };
    const judged = probe.check(res.data);
    return { id: probe.id, label: probe.label, weight: probe.weight, pass: judged.pass, detail: judged.detail, model: res.model, tokens: res.tokensOut, duration_ms: res.durationMs };
  } catch (e) {
    return { id: probe.id, label: probe.label, weight: probe.weight, pass: false, detail: `Probe failed: ${e.message}` };
  }
}

async function runSuite(patch, evalId) {
  const cases = listEvalCases();
  const deterministic = cases.map((c) => {
    const r = evaluateDeterministicCase(c);
    return { id: c.id, label: c.name, weight: c.weight || 1, pass: r.pass, detail: r.detail, group: 'deterministic' };
  });
  const llm = [];
  for (const probe of PROBES) llm.push(await runProbe(probe, patch, evalId));
  const allResults = [...deterministic, ...llm];
  const { score, passed, total } = weightedScore(allResults);
  return { score, passed, total, results: allResults, deterministic_passed: deterministic.filter((r) => r.pass).length, deterministic_total: deterministic.length };
}

/* ── Job lifecycle ────────────────────────────────────────────────────── */

export function startEvaluation({ tenant = 'alpha-red', actor = 'system', candidateName = 'candidate', patch = '' } = {}) {
  const id = uid('eval');
  run(`INSERT INTO evals (id, tenant, suite, candidate, status, created_at)
    VALUES (?, ?, 'v1.0', ?, 'running', ?)`, id, tenant, candidateName.slice(0, 120), now());
  appendAudit({ tenant, actor, action: 'eval.started', objectType: 'eval', objectId: id, detail: { suite: 'v1.0', candidate: candidateName } });
  queueMicrotask(() => executeEvaluation(id, patch).catch((e) => {
    run(`UPDATE evals SET status = 'failed', details = ?, completed_at = ? WHERE id = ?`, stringify({ error: e.message }), now(), id);
    appendAudit({ tenant, actor: 'system', action: 'eval.failed', objectType: 'eval', objectId: id, detail: { error: e.message } });
  }));
  return getEvaluation(id);
}

export async function executeEvaluation(id, patch) {
  const row = get('SELECT * FROM evals WHERE id = ?', id);
  if (!row || row.status !== 'running') return;
  const baseline = await runSuite('', id);
  const candidate = await runSuite(patch, id);

  const improvement = Number((candidate.score - baseline.score).toFixed(1));
  const criticalRegression = baseline.results.filter((r) => r.group === 'deterministic' && r.weight >= 3 && r.pass)
    .some((b) => {
      const c = candidate.results.find((x) => x.id === b.id);
      return c && !c.pass;
    });
  const liveImproved = candidate.results.filter((r) => r.group !== 'deterministic' && r.pass).length
    > baseline.results.filter((r) => r.group !== 'deterministic' && r.pass).length;

  let status = 'no_improvement';
  if (criticalRegression) status = 'blocked';
  else if (improvement >= 2 && liveImproved) status = 'awaiting_approval';

  const details = {
    baseline, candidate, improvement,
    critical_regression: criticalRegression,
    live_probes_improved: liveImproved,
    release_blockers: [
      criticalRegression ? 'A high-weight deterministic control regressed.' : null,
      improvement < 2 ? 'Improvement is below the 2.0 point release threshold.' : null,
      !liveImproved ? 'No live model probe improved; the candidate is not evidenced.' : null
    ].filter(Boolean),
    note: 'Approval authorises a release candidate only. It does not mutate production policy, prompts or permissions.'
  };

  run(`UPDATE evals SET status = ?, baseline_score = ?, candidate_score = ?, cases_json = ?, details = ?, completed_at = ? WHERE id = ?`,
    status, baseline.score, candidate.score,
    stringify(candidate.results.map((r) => ({ ...r, group: r.group }))), stringify(details), now(), id);

  if (status === 'awaiting_approval') {
    addApproval({
      tenant: row.tenant, runId: null, type: 'release_candidate',
      title: `Release candidate · ${row.candidate}`,
      detail: `Frozen suite v1.0: baseline ${baseline.score}% → candidate ${candidate.score}% (${improvement >= 0 ? '+' : ''}${improvement} pts). ${details.live_probes_improved ? 'Live probes improved.' : ''} Approval authorises an offline release candidate only.`,
      risk: 'medium', requestedBy: 'agent:A9', assignedRole: 'harness_owner',
      payload: { eval_id: id, baseline: baseline.score, candidate: candidate.score, patch },
      idempotencyKey: `eval:${id}`
    });
    appendAudit({ tenant: row.tenant, actor: 'agent:A9', action: 'eval.release_candidate', objectType: 'eval', objectId: id, detail: { baseline: baseline.score, candidate: candidate.score } });
  }
  appendAudit({
    tenant: row.tenant, actor: 'system', action: 'eval.completed', objectType: 'eval', objectId: id,
    detail: { status, baseline: baseline.score, candidate: candidate.score, improvement }
  });
  return getEvaluation(id);
}

export function decideEvaluation({ evalId, decision, note, user }) {
  const row = get('SELECT * FROM evals WHERE id = ?', evalId);
  if (!row) { const e = new Error('EVAL_NOT_FOUND'); e.status = 404; throw e; }
  if (!user.tenants.includes(row.tenant)) { const e = new Error('TENANT_ACCESS_DENIED'); e.status = 403; throw e; }
  if (!can(user, 'eval:approve')) {
    const e = new Error('PERMISSION_DENIED:eval:approve'); e.status = 403; throw e;
  }
  if (row.status !== 'awaiting_approval') { const e = new Error('EVAL_NOT_AWAITING_DECISION'); e.status = 409; throw e; }
  if (!['approve', 'reject'].includes(decision)) { const e = new Error('INVALID_DECISION'); e.status = 400; throw e; }
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const releaseVersion = decision === 'approve' ? `candidate-${new Date().toISOString().slice(0, 10)}` : null;
  run(`UPDATE evals SET status = ?, approved_by = ?, approved_at = ?, release_version = ?, details = ? WHERE id = ?`,
    status, user.id, now(), releaseVersion,
    stringify({ ...parse(row.details, {}), decision_note: String(note || '').slice(0, 400) }), evalId);
  appendAudit({
    tenant: row.tenant, actor: user.id, action: decision === 'approve' ? 'eval.release_approved' : 'eval.release_rejected',
    objectType: 'eval', objectId: evalId, detail: { release_version: releaseVersion, note: String(note || '').slice(0, 240) }
  });
  return getEvaluation(evalId);
}

export function evaluationSummary(tenant = null) {
  const rows = listEvaluations(tenant, 20);
  const lastApproved = rows.find((r) => r.status === 'approved') || null;
  const cases = listEvalCases();
  return {
    suite: 'v1.0',
    cases,
    weights: {
      total: cases.reduce((a, c) => a + Number(c.weight || 1), 0),
      deterministic: cases.filter((c) => !c.check_type.startsWith('security') || true).length
    },
    evaluations: rows,
    last_approved: lastApproved,
    frozen: true,
    note: 'The deterministic suite is frozen. A9 may propose candidates; only Ravi (harness owner) or an admin can approve a release candidate.'
  };
}

export const EVAL_PROBES = PROBES.map((p) => ({ id: p.id, label: p.label, weight: p.weight }));

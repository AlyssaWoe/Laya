import { all, get, parse } from './db.js';
import { resolveRule, ruleJson, ruleNumber, allConflicts } from './rules.js';

const DAY = 86_400_000;

export function dateOnly(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function isoDay(d) { return d.toISOString().slice(0, 10); }
export function daysBetween(from, to = new Date()) {
  return Math.floor((dateOnly(to).getTime() - dateOnly(new Date(from)).getTime()) / DAY);
}
export function monthsBetween(from, to = new Date()) {
  const a = new Date(from), b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
}
export const money = (n, currency = 'MYR') => `${currency} ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── Cradle Fund ──────────────────────────────────────────────────────── */

export function assessCradle(applicationId) {
  const app = get('SELECT * FROM applications WHERE id = ?', applicationId);
  if (!app) return null;
  const docs = parse(app.docs, []);
  const thresholds = {
    minEquity: ruleNumber('cradle.min_equity_pct', 51),
    minMonths: ruleNumber('cradle.min_operating_months', 12),
    minGrant: ruleNumber('cradle.min_grant_myr', 50000),
    maxGrant: ruleNumber('cradle.max_grant_myr', 1000000),
    minMatching: ruleNumber('cradle.min_matching_pct', 25),
    maxActive: ruleNumber('cradle.max_active_grants', 2)
  };
  const auditedRule = resolveRule('cradle.audited_threshold_myr', '250000');
  const auditedThreshold = Number(auditedRule.value);
  const months = monthsBetween(app.incorporated_at);
  const matchingRatio = app.requested_amount > 0 ? (app.matching_amount / app.requested_amount) * 100 : 0;
  const docMap = new Map(docs.map((d) => [d.ref, d]));

  const check = (id, label, status, observed, required, evidence, note = '') => ({ rule_id: id, label, status, observed, required, evidence, note });

  const checks = [];
  checks.push(check('CF-01', 'Malaysian incorporation', app.registration ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
    app.registration ? `SSM ${app.registration}` : 'No registration number', 'Valid SSM registration', 'DOC-04', ''));
  checks.push(check('CF-02', 'Malaysian equity ≥ threshold', app.equity_pct >= thresholds.minEquity ? 'PASS' : 'FAIL',
    `${app.equity_pct}% Malaysian equity`, `≥ ${thresholds.minEquity}%`, 'DOC-06', ''));
  checks.push(check('CF-03', 'Operating history', months >= thresholds.minMonths ? 'PASS' : 'FAIL',
    `${months} months since incorporation (${app.incorporated_at.slice(0, 10)})`, `≥ ${thresholds.minMonths} months`, 'DOC-04', ''));
  checks.push(check('CF-04', 'Grant request band', app.requested_amount >= thresholds.minGrant && app.requested_amount <= thresholds.maxGrant ? 'PASS' : 'FAIL',
    money(app.requested_amount), `${money(thresholds.minGrant)} – ${money(thresholds.maxGrant)}`, 'DOC-01', ''));
  checks.push(check('CF-05', 'Matching contribution', matchingRatio + 1e-6 >= thresholds.minMatching ? 'PASS' : 'FAIL',
    `${money(app.matching_amount)} (${matchingRatio.toFixed(1)}%)`, `≥ ${thresholds.minMatching}% of grant`, 'DOC-03', ''));

  const activeGrants = Number(app.active_grants || 0);
  checks.push(check('CF-06', 'Active grant exposure', activeGrants <= thresholds.maxActive ? 'PASS' : 'FAIL',
    `${activeGrants} active Cradle grant(s)`, `≤ ${thresholds.maxActive}`, 'Application form', ''));

  const auditedApplies = app.requested_amount > auditedThreshold;
  const auditedDoc = docMap.get('DOC-07');
  let auditedStatus = 'PASS';
  let auditedNote = '';
  if (auditedApplies) {
    if (!auditedDoc || auditedDoc.state === 'MISSING') auditedStatus = 'INSUFFICIENT_EVIDENCE';
    else if (auditedDoc.state === 'EXPIRED' || auditedDoc.state === 'UNVERIFIED') auditedStatus = 'INSUFFICIENT_EVIDENCE';
    if (auditedRule.conflict) {
      const values = auditedRule.entries.map((e) => Number(e.value)).sort((a, b) => a - b);
      auditedNote = `Policy conflict: RM ${values[0].toLocaleString()} vs RM ${values[values.length - 1].toLocaleString()}; conservative threshold RM ${auditedThreshold.toLocaleString()} applied.`;
    }
  }
  checks.push(check('CF-07', 'Audited financial statements', auditedStatus,
    auditedApplies ? `${auditedDoc ? auditedDoc.state : 'MISSING'} · threshold ${money(auditedThreshold)}` : 'Not required for this band',
    auditedApplies ? `DOC-07 present and valid above ${money(auditedThreshold)}` : 'N/A', 'DOC-07', auditedNote));

  const tax = String(app.tax_clearance || 'missing').toLowerCase();
  const taxStatus = tax === 'valid' ? 'PASS' : tax === 'expired' ? 'FAIL' : 'INSUFFICIENT_EVIDENCE';
  checks.push(check('CF-08', 'Tax clearance', taxStatus, tax === 'missing' ? 'No tax clearance on file' : tax, 'Current clearance or valid exemption', 'DOC-08', ''));

  const requiredRefs = new Set(ruleJson('cradle.required_docs', ['DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05', 'DOC-06', 'DOC-08', 'DOC-09']));
  if (auditedApplies) requiredRefs.add('DOC-07');
  const documentStates = [...requiredRefs].map((ref) => {
    const d = docMap.get(ref);
    return {
      ref, name: d?.name || ref, state: d?.state || 'MISSING',
      reason: d?.note || (d ? '' : 'Not supplied'), required: true
    };
  });
  for (const d of docs) if (!requiredRefs.has(d.ref)) documentStates.push({ ...d, required: false });

  const missingDocs = documentStates.filter((d) => d.required && d.state !== 'PRESENT');
  const failed = checks.filter((c) => c.status === 'FAIL');
  const insufficient = checks.filter((c) => c.status === 'INSUFFICIENT_EVIDENCE');
  const assessment = failed.length ? 'INELIGIBLE' : (insufficient.length || missingDocs.length) ? 'INSUFFICIENT_EVIDENCE' : 'ELIGIBLE';

  const conflicts = allConflicts().filter((c) => c.key.startsWith('cradle.'));
  return {
    kind: 'cradle',
    application: {
      id: app.id, applicant: app.applicant, registration: app.registration,
      incorporated_at: app.incorporated_at.slice(0, 10), months_operating: months,
      equity_pct: app.equity_pct, requested_amount: app.requested_amount,
      matching_amount: app.matching_amount, matching_ratio: Number(matchingRatio.toFixed(1)),
      active_grants: activeGrants, tax_clearance: app.tax_clearance, stage: app.stage, reviewer: app.reviewer
    },
    thresholds: { ...thresholds, audited_threshold_myr: auditedThreshold },
    checks,
    documents: documentStates,
    missing_documents: missingDocs.map((d) => ({ ref: d.ref, name: d.name, state: d.state, reason: d.reason })),
    missing_evidence_requests: missingDocs.map((d) => ({
      ref: d.ref, request: `Provide ${d.name} (${d.ref}).`,
      why: d.ref === 'DOC-07' ? `Requested grant exceeds ${money(auditedThreshold)}.` : 'Required by the document checklist.'
    })),
    conflicts,
    assessment,
    deterministic_summary: `${app.applicant}: ${failed.length} failed condition(s), ${insufficient.length} insufficient, ${missingDocs.length} document gap(s).`,
    computed_at: new Date().toISOString()
  };
}

/* ── PartnerFlow audit ────────────────────────────────────────────────── */

const EXPECTED = () => ruleJson('audit.required_sequence', ['claim.submitted', 'documents.verified', 'manager.approved', 'finance.approved', 'payment.released']);
const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function assessAudit(caseId) {
  const c = get('SELECT * FROM audit_cases WHERE id = ?', caseId);
  if (!c) return null;
  const expected = EXPECTED();
  const events = parse(c.events, []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const byType = new Map();
  for (const e of events) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push(e);
  }
  const findings = [];
  const add = (control_id, title, severity, control, expectedText, observed, evidence_ids, remediation) => findings.push({
    control_id, title, severity, control, expected: expectedText, observed, evidence_ids, remediation
  });

  for (const type of expected) {
    if (!byType.has(type)) {
      const severity = type === 'finance.approved' || type === 'payment.released' ? 'high' : 'medium';
      const control = type === 'finance.approved' ? 'PF-SOD-02' : type === 'payment.released' ? 'PF-SOD-04' : 'PF-SEQ-01';
      add(control, `Missing event: ${type}`, severity, control, `Event "${type}" must be present`, 'No matching event found', [],
        `Recover the ${type} record from the source system or escalate for investigation.`);
    }
  }

  for (const [type, list] of byType) {
    if (type === 'payment.released' && list.length > Number(ruleNumber('audit.max_releases_per_claim', 1))) {
      add('PF-SOD-04', 'Duplicate payment release', 'critical', 'PF-SOD-04', 'Exactly one payment.released event',
        `${list.length} release events: ${list.map((e) => e.id).join(', ')}`, list.map((e) => e.id),
        'Freeze the claim, reconcile the bank statement, and initiate recovery if funds were duplicated.');
    }
  }

  const manager = byType.get('manager.approved')?.[0];
  const finance = byType.get('finance.approved')?.[0];
  const release = byType.get('payment.released')?.[0];
  const submit = byType.get('claim.submitted')?.[0];
  if (manager && finance && manager.actor === finance.actor) {
    add('PF-SOD-02', 'Manager and finance approver are the same actor', 'high', 'PF-SOD-02',
      'Manager approver ≠ finance approver', `Both events recorded by ${manager.actor}`, [manager.id, finance.id],
      'Re-perform finance approval with an independent authorised approver.');
  }
  if (submit && manager && submit.actor === manager.actor) {
    add('PF-SOD-01', 'Submitter also approved the claim', 'high', 'PF-SOD-01',
      'Submitter ≠ manager approver', `Both events recorded by ${submit.actor}`, [submit.id, manager.id],
      'Route the claim to an independent manager for approval.');
  }
  if (finance && release && finance.actor === release.actor) {
    add('PF-SOD-03', 'Finance approver released payment', 'high', 'PF-SOD-03',
      'Finance approver ≠ payment releaser', `Both events recorded by ${finance.actor}`, [finance.id, release.id],
      'Separate payment release from approval and re-run the control.');
  }
  if (release && Number(release.amount || 0) > Number(c.approved_amount || 0) + 0.005) {
    add('PF-AMT-01', 'Payment exceeds approved amount', 'critical', 'PF-AMT-01',
      `Released amount ≤ ${money(c.approved_amount)}`, `Released ${money(release.amount)}`, [release.id],
      'Freeze the excess, reconcile, and escalate to Finance.');
  }

  const indices = expected.map((t) => events.findIndex((e) => e.type === t));
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] > -1 && indices[i - 1] > -1 && indices[i] < indices[i - 1]) {
      add('PF-SEQ-01', 'Out-of-order control event', 'medium', 'PF-SEQ-01',
        `Order: ${expected.join(' → ')}`, `${expected[i]} precedes ${expected[i - 1]}`, [events[indices[i]].id, events[indices[i - 1]].id],
        'Confirm event timestamps with the source systems; correct the control log if the ordering is a synchronisation artefact.');
    }
  }

  const highest = findings.reduce((a, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[a] ? f.severity : a), 'none');
  const openQuestions = [];
  if (!events.length) openQuestions.push('No events were supplied. This is a data gap, not a clean control result.');
  return {
    kind: 'audit',
    case: { id: c.id, claim_id: c.claim_id, amount: c.amount, approved_amount: c.approved_amount, status: c.status, source: c.source },
    expected_sequence: expected,
    observed_sequence: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, at: e.at, amount: e.amount ?? null })),
    findings,
    controls_passed: expected.filter((t) => byType.has(t)),
    open_questions: openQuestions,
    highest_severity: highest,
    deterministic_summary: `${findings.length} finding(s); highest severity ${highest}.`,
    computed_at: new Date().toISOString()
  };
}

/* ── Payment follow-up ────────────────────────────────────────────────── */

export function paymentStage(overdueDays) {
  const p4 = ruleNumber('payment.stage_p4_days', 45);
  const p3 = ruleNumber('payment.stage_p3_days', 30);
  const p2 = ruleNumber('payment.stage_p2_days', 14);
  const p1 = ruleNumber('payment.stage_p1_days', 7);
  if (overdueDays >= p4) return 'P4';
  if (overdueDays >= p3) return 'P3';
  if (overdueDays >= p2) return 'P2';
  if (overdueDays >= p1) return 'P1';
  return 'NONE';
}

export function assessPayment(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv) return null;
  const outstanding = Math.max(0, Number(inv.amount) - Number(inv.paid || 0) - Number(inv.credits || 0));
  const overdueDays = Math.max(0, daysBetween(inv.due_date));
  const stage = outstanding <= 0 ? 'NONE' : paymentStage(overdueDays);
  const threshold = ruleNumber('payment.approval_threshold_myr', 25000);
  const strategic = !!inv.strategic;
  const disputed = ['disputed', 'on_hold', 'under_review'].includes(String(inv.customer_status || '').toLowerCase());
  const duplicateWindow = ruleNumber('payment.duplicate_window_hours', 24);

  const recent = all('SELECT * FROM outbox WHERE object_id = ? AND stage = ? AND created_at > ? ORDER BY created_at DESC',
    inv.id, stage, new Date(Date.now() - duplicateWindow * 3600_000).toISOString());
  const lastStage = inv.last_stage === stage && inv.last_reminded_at
    ? (Date.now() - new Date(inv.last_reminded_at).getTime()) < duplicateWindow * 3600_000
    : false;

  const approvalRequired = outstanding > threshold || stage === 'P3' || stage === 'P4' || strategic;
  const blockedReasons = [];
  if (outstanding <= 0) blockedReasons.push('Invoice is settled; outstanding balance is zero.');
  if (disputed) blockedReasons.push(`Customer status is ${inv.customer_status}; automated follow-up is paused.`);
  if (stage === 'NONE') blockedReasons.push('No reminder stage applies yet.');
  if (recent.length || lastStage) blockedReasons.push(`A ${stage} reminder was already queued or sent inside the ${duplicateWindow}h window.`);

  return {
    kind: 'payment',
    invoice: {
      id: inv.id, customer: inv.customer, customer_status: inv.customer_status, currency: inv.currency,
      amount: Number(inv.amount), paid: Number(inv.paid || 0), credits: Number(inv.credits || 0),
      outstanding: Number(outstanding.toFixed(2)), due_date: inv.due_date.slice(0, 10), overdue_days: overdueDays,
      stage, strategic, contact_email: inv.contact_email, dispute_note: inv.dispute_note || ''
    },
    threshold_myr: threshold,
    approval_required: approvalRequired,
    approval_reasons: [
      outstanding > threshold ? `Outstanding ${money(outstanding)} exceeds ${money(threshold)}` : null,
      stage === 'P3' || stage === 'P4' ? `Cadence stage ${stage} requires human review` : null,
      strategic ? 'Strategic customer' : null
    ].filter(Boolean),
    duplicate_window_hours: duplicateWindow,
    duplicate_check: { recent_outbox: recent.length, last_stage_match: lastStage },
    allowed: blockedReasons.length === 0,
    blocked_reasons: blockedReasons,
    idempotency_key: `${inv.id}:${stage || 'NONE'}`,
    ledger_checked_at: new Date().toISOString(),
    deterministic_summary: `${inv.id}: ${money(outstanding, inv.currency)} outstanding, ${overdueDays} days overdue, stage ${stage}, ${blockedReasons.length ? 'blocked' : 'ready for draft'}.`
  };
}

/* ── CMO trend ────────────────────────────────────────────────────────── */

function aggregateWindow(tenant, start, end) {
  const rows = all(`SELECT channel, SUM(qualified_leads) AS leads, SUM(won) AS won, SUM(revenue) AS revenue,
      AVG(cycle_days) AS cycle, SUM(followups) AS followups, MAX(partners_active) AS partners
    FROM metrics_daily WHERE tenant = ? AND date >= ? AND date <= ? GROUP BY channel ORDER BY channel`,
    tenant, start, end);
  const totals = rows.reduce((a, r) => ({
    leads: a.leads + Number(r.leads || 0), won: a.won + Number(r.won || 0),
    revenue: a.revenue + Number(r.revenue || 0), followups: a.followups + Number(r.followups || 0)
  }), { leads: 0, won: 0, revenue: 0, followups: 0 });
  const channels = rows.map((r) => ({
    channel: r.channel, leads: Number(r.leads || 0), won: Number(r.won || 0), revenue: Number(r.revenue || 0),
    cycle_days: Number(Number(r.cycle || 0).toFixed(1)), followups: Number(r.followups || 0),
    partners_active: Number(r.partners || 0),
    conversion_pct: r.leads ? Number(((r.won / r.leads) * 100).toFixed(1)) : 0,
    sufficient_sample: Number(r.leads || 0) >= ruleNumber('cmo.min_qualified_leads', 30) && Number(r.won || 0) >= ruleNumber('cmo.min_won_deals', 10)
  }));
  totals.conversion_pct = totals.leads ? Number(((totals.won / totals.leads) * 100).toFixed(1)) : 0;
  return { channels, totals };
}

export function trendFacts(tenant = 'alpha-red') {
  const windowDays = ruleNumber('cmo.window_days', 30);
  const today = dateOnly();
  const end = new Date(today.getTime() - DAY);
  const start = new Date(end.getTime() - (windowDays - 1) * DAY);
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - (windowDays - 1) * DAY);
  const current = aggregateWindow(tenant, isoDay(start), isoDay(end));
  const previous = aggregateWindow(tenant, isoDay(prevStart), isoDay(prevEnd));

  const channels = current.channels.map((c) => {
    const p = previous.channels.find((x) => x.channel === c.channel) || { leads: 0, won: 0, revenue: 0, conversion_pct: 0, cycle_days: 0 };
    return {
      ...c,
      prev_leads: p.leads, prev_won: p.won, prev_revenue: p.revenue, prev_conversion_pct: p.conversion_pct, prev_cycle_days: p.cycle_days,
      conversion_delta_pts: Number((c.conversion_pct - p.conversion_pct).toFixed(1)),
      revenue_delta_pct: p.revenue ? Number((((c.revenue - p.revenue) / p.revenue) * 100).toFixed(1)) : null
    };
  });

  const daily = all(`SELECT date, SUM(qualified_leads) AS leads, SUM(won) AS won, SUM(revenue) AS revenue
    FROM metrics_daily WHERE tenant = ? AND date >= ? AND date <= ? GROUP BY date ORDER BY date`,
    tenant, isoDay(start), isoDay(end)).map((r) => ({
      date: r.date, leads: Number(r.leads), won: Number(r.won), revenue: Number(r.revenue)
    }));

  const measured = [
    { metric: 'qualified_leads', current: current.totals.leads, previous: previous.totals.leads, delta_pct: previous.totals.leads ? Number((((current.totals.leads - previous.totals.leads) / previous.totals.leads) * 100).toFixed(1)) : null },
    { metric: 'won_deals', current: current.totals.won, previous: previous.totals.won, delta_pct: previous.totals.won ? Number((((current.totals.won - previous.totals.won) / previous.totals.won) * 100).toFixed(1)) : null },
    { metric: 'conversion_pct', current: current.totals.conversion_pct, previous: previous.totals.conversion_pct, delta_pts: Number((current.totals.conversion_pct - previous.totals.conversion_pct).toFixed(1)) },
    { metric: 'revenue_myr', current: current.totals.revenue, previous: previous.totals.revenue, delta_pct: previous.totals.revenue ? Number((((current.totals.revenue - previous.totals.revenue) / previous.totals.revenue) * 100).toFixed(1)) : null }
  ];

  const anomalies = channels.filter((c) => c.sufficient_sample && Math.abs(c.conversion_delta_pts) >= 2)
    .map((c) => ({
      channel: c.channel, metric: 'conversion_pct', current: c.conversion_pct, previous: c.prev_conversion_pct,
      delta_pts: c.conversion_delta_pts, sample_leads: c.leads,
      note: `${c.channel} conversion moved ${c.conversion_delta_pts > 0 ? 'up' : 'down'} ${Math.abs(c.conversion_delta_pts)} points on ${c.leads} qualified leads.`
    }));

  const latest = all('SELECT MAX(date) AS d FROM metrics_daily WHERE tenant = ?', tenant)[0]?.d || null;
  return {
    kind: 'trend',
    window: { days: windowDays, current_start: isoDay(start), current_end: isoDay(end), previous_start: isoDay(prevStart), previous_end: isoDay(prevEnd) },
    current, previous, channels, measured, daily, anomalies,
    sample_guardrail: { min_qualified_leads: ruleNumber('cmo.min_qualified_leads', 30), min_won_deals: ruleNumber('cmo.min_won_deals', 10) },
    freshness: latest,
    limitations: [
      'Dataset is a seeded demonstration set; it is not live production data.',
      'Attribution across channels may overlap; revenue is recognised, not pipeline.',
      'A 30-day window cannot establish seasonality.'
    ],
    deterministic_summary: `${current.totals.leads} qualified leads, ${current.totals.won} wins, ${current.totals.conversion_pct}% conversion. ${anomalies.length} channel anomaly signal(s).`,
    computed_at: new Date().toISOString()
  };
}

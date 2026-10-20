/* Process run list and the auditable run detail view. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusChip, riskChip, agentLabel, agentTone,
  fmtDate, relTime, humanize, money, pct, emptyState, statusBanner, confirmAction, toast,
  copyText, downloadJson, openModal, closeModal, hashQuery, titleCase, can, truncate
} from '../core.js';
import { refreshChrome } from '../shell.js';

const PROCESS_LABEL = {
  cradle_fund: 'Cradle assessment',
  partnerflow_audit: 'Control audit',
  payment_followup: 'Payment follow-up',
  cmo_trend: 'CMO trend',
  knowledge_query: 'Knowledge query',
  direct: 'Direct agent'
};

/* ── Run index ────────────────────────────────────────────────────────── */

export async function renderList(view) {
  view.innerHTML = listSkeleton();
  let data;
  try { data = await api('/api/runs?limit=100'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Process runs', title: 'Run history.' })}${statusBanner('fail', 'Runs unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const runs = data.runs || [];
  let activeStatus = hashQuery().get('status') || 'all';
  let search = '';

  const tabs = [
    ['all', 'All'],
    ['running', 'Running'],
    ['awaiting_approval', 'Awaiting approval'],
    ['needs_review', 'Needs review'],
    ['completed', 'Completed'],
    ['failed', 'Failed']
  ];

  view.innerHTML = `${pageHead({
    eyebrow: 'Process runs',
    title: 'Every decision leaves a trail.',
    sub: 'Each run carries its trust screen, retrieved evidence, deterministic policy facts, advisory route, specialist output, independent verification and human gates.',
    actions: `<button class="btn btn-ghost" data-nav="/catalog">${icon('menu', 15)} Function menu</button><button class="btn btn-primary" data-nav="/processes">${icon('play', 15)} Launch process</button>`
  })}
  <div class="filter-bar">
    <div class="tabs" id="runTabs">${tabs.map(([id, label]) => `<button class="tab ${id === activeStatus ? 'active' : ''}" data-run-tab="${id}">${label}</button>`).join('')}</div>
    <div class="search-field">${icon('search', 15)}<input class="input" id="runSearch" placeholder="Filter by title, process, id or actor…" autocomplete="off" /></div>
    <span class="chip muted" id="runCount">${runs.length} runs</span>
  </div>
  <div id="runTableWrap"></div>`;

  const tabsEl = document.getElementById('runTabs');
  const searchEl = document.getElementById('runSearch');
  const wrap = document.getElementById('runTableWrap');

  function filtered() {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (activeStatus !== 'all' && r.status !== activeStatus) return false;
      if (!q) return true;
      return `${r.id} ${r.title} ${r.process} ${r.actor} ${r.status}`.toLowerCase().includes(q);
    });
  }

  function paint() {
    const rows = filtered();
    document.getElementById('runCount').textContent = `${rows.length} run${rows.length === 1 ? '' : 's'}`;
    wrap.innerHTML = rows.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Run</th><th>Process</th><th>Status</th><th>Risk</th><th>Steps</th><th>Actor</th><th>Created</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-nav="/runs/${attr(r.id)}" style="cursor:pointer">
        <td><div class="mono tiny dim">${esc(r.id.replace(/^run_/, '').slice(0, 12))}</div><div class="small strong" style="margin-top:2px">${esc(r.title || '')}</div></td>
        <td class="small">${esc(PROCESS_LABEL[r.process] || humanize(r.process))}</td>
        <td>${statusChip(r.status)}</td>
        <td>${riskChip(r.risk)}</td>
        <td class="num small">${r.step_count ?? '—'}</td>
        <td class="small muted">${esc(r.actor || '—')}</td>
        <td class="small muted nowrap">${esc(relTime(r.created_at))}</td>
        <td class="actions">${icon('chevronRight', 15)}</td>
      </tr>`).join('')}</tbody></table></div>`
      : emptyState('No runs match this filter', 'Clear the search or choose another status. Launch a process to create the first run.', 'pulse', `<button class="btn btn-primary btn-sm" data-nav="/processes">${icon('play', 13)} Launch a process</button>`);
  }

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run-tab]');
    if (!b) return;
    activeStatus = b.dataset.runTab;
    tabsEl.querySelectorAll('[data-run-tab]').forEach((x) => x.classList.toggle('active', x === b));
    history.replaceState(null, '', `#${activeStatus === 'all' ? '/runs' : `/runs?status=${activeStatus}`}`);
    paint();
  });
  searchEl.addEventListener('input', () => { search = searchEl.value; paint(); });
  paint();
}

/* ── Run detail ───────────────────────────────────────────────────────── */

export async function renderDetail(view, id) {
  closeLive();
  view.innerHTML = detailSkeleton();
  let run;
  try { run = await api(`/api/runs/${encodeURIComponent(id)}`); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Run detail', title: 'Run unavailable.', actions: `<button class="btn btn-ghost" data-nav="/runs">${icon('chevronLeft', 15)} Back to runs</button>` })}${statusBanner('fail', 'Could not load this run', esc(e.message), 'xCircle')}`;
    return;
  }
  paintRun(view, run, { live: run.status === 'running' });
}

function paintRun(view, run, { live = false } = {}) {
  if (state.route && !state.route.startsWith(`/runs/${run.id}`)) return;
  closeLive();
  const meta = run.meta || {};
  const verification = meta.verification || null;
  const vStep = (run.steps || []).find((s) => s.agent_id === 'A8' && s.output?.checks);
  const approvalCount = (run.approvals || []).filter((a) => a.status === 'pending').length;
  const evidence = collectEvidence(run);
  const completedSteps = (run.steps || []).filter((s) => s.status === 'completed' || s.status === 'failed').length;
  const totalSteps = Math.max(7, (run.steps || []).length);
  const progress = run.status === 'running' ? Math.min(92, Math.round((completedSteps / totalSteps) * 100)) : 100;
  const tone = run.status === 'completed' ? 'jade' : run.status === 'running' || run.status === 'awaiting_approval' ? 'gold' : 'seal';

  view.innerHTML = `${pageHead({
    eyebrow: `${PROCESS_LABEL[run.process] || humanize(run.process)} · ${run.tenant}`,
    title: esc(run.title || 'Process run'),
    sub: esc(run.request || ''),
    actions: `<button class="btn btn-ghost" data-nav="/runs">${icon('chevronLeft', 15)} Runs</button><button class="btn btn-ghost" data-copy-run>${icon('copy', 15)} Copy summary</button><button class="btn btn-ghost" data-export-run>${icon('download', 15)} Export</button>`
  })}

  <div class="row" style="margin-bottom:14px">
    ${statusChip(run.status)}
    ${riskChip(run.risk)}
    <span class="chip ${tone}">${esc(PROCESS_LABEL[run.process] || humanize(run.process))}</span>
    <span class="chip muted">${icon('user', 12)} ${esc(run.actor || '—')}</span>
    <span class="chip muted">${icon('clock', 12)} ${esc(fmtDate(run.created_at))}</span>
    ${verification ? `<span class="chip ${verification.outcome === 'PASS' ? 'jade' : verification.outcome === 'FAIL' ? 'red' : 'gold'}">${esc(verification.outcome)}</span>` : ''}
    ${approvalCount ? `<span class="chip gold">${approvalCount} gate${approvalCount === 1 ? '' : 's'} waiting</span>` : ''}
    ${run.status === 'running' ? `<span class="chip gold"><span class="dot amber pulse"></span> streaming live</span>` : ''}
  </div>

  <div id="runStatusBanner" style="margin-bottom:16px">${runBanner(run, verification, progress)}</div>

  <div class="split">
    <div class="stack">
      ${panel({
        id: `run:${run.id}:steps`, title: 'Decision pipeline', subtitle: `${completedSteps} of ${totalSteps} steps recorded · each step is a separate agent contract`, iconName: 'workflow', tone: 'seal',
        actions: `<span class="chip muted" id="stepCount">${(run.steps || []).length} steps</span>`,
        body: `<div class="timeline" id="runSteps">${(run.steps || []).length ? run.steps.map((s) => renderStep(s, run)).join('') : emptyState('Waiting for the first step', 'The trust screen and evidence retrieval start immediately.', 'clock')}</div>`
      })}
    </div>
    <div class="stack">
      ${panel({
        id: `run:${run.id}:decision`, title: 'Decision record', subtitle: 'The auditable summary, not private chain-of-thought', iconName: 'shield', tone: 'jade',
        body: renderDecision(run, verification, evidence)
      })}
      ${panel({
        id: `run:${run.id}:gates`, title: 'Human gates', subtitle: `${approvalCount} pending · ${(run.approvals || []).length} total`, iconName: 'stamp', tone: 'gold',
        body: `<div id="runApprovals">${renderApprovals(run)}</div>`
      })}
      ${panel({
        id: `run:${run.id}:evidence`, title: 'Evidence pack', subtitle: `${evidence.length} retrieved chunk${evidence.length === 1 ? '' : 's'}`, iconName: 'layers', tone: '',
        body: renderEvidence(evidence)
      })}
      ${panel({
        id: `run:${run.id}:memory`, title: 'Candidate memory', subtitle: 'A lesson, not a permission', iconName: 'spark', tone: 'jade',
        body: renderMemory(run)
      })}
    </div>
  </div>`;

  view.querySelector('#runSteps')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-step]');
    if (!btn) return;
    const step = btn.closest('.step');
    step?.querySelector('.step-body')?.classList.toggle('collapsed');
    btn.classList.toggle('is-open');
  });

  view.querySelector('#runApprovals')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-approval-decision]');
    if (!btn) return;
    decideApproval(view, run, btn.dataset.approvalId, btn.dataset.approvalDecision);
  });

  view.querySelector('[data-copy-run]')?.addEventListener('click', () => copyRun(run));
  view.querySelector('[data-export-run]')?.addEventListener('click', () => downloadJson(`${run.id}.json`, summaryOf(run)));

  if (live) attachLive(view, run);
}

function runBanner(run, verification, progress) {
  if (run.status === 'running') {
    return `<div class="callout callout-info">${icon('activity', 18)}<div style="flex:1"><b>Run in progress.</b> Stage: <span class="mono">${esc(run.stage || 'starting')}</span>. The view streams each step as it lands. <div class="progress" style="margin-top:8px"><i style="width:${progress}%"></i></div></div></div>`;
  }
  if (run.status === 'failed') {
    return statusBanner('fail', 'Run failed', esc(run.meta?.error || 'A step failed before verification completed. Open the failed step for the error.'), 'xCircle');
  }
  if (run.status === 'needs_review' || verification?.outcome === 'FAIL') {
    return statusBanner('fail', 'Blocked by independent verification', 'A deterministic verifier failure is binding. The business action is held and a verification-review gate has been created for a human.', 'xCircle');
  }
  if (run.status === 'awaiting_approval') {
    return statusBanner('warn', 'Waiting for a human gate', 'The evidence and verification are complete, but a consequential action cannot proceed without the named reviewer.', 'clock');
  }
  if (run.status === 'completed') {
    return statusBanner('pass', 'Completed and verified', `Outcome ${esc(verification?.outcome || run.outcome || 'PASS')} · ${verification?.pass ?? 0} checks passed · ${verification?.notes ?? 0} note(s) · ${verification?.fail ?? 0} fail(s).`, 'checkCircle');
  }
  return statusBanner('warn', 'Run recorded', 'This run is available for inspection.', 'info');
}

/* ── Step rendering ───────────────────────────────────────────────────── */

function renderStep(step, run) {
  const isOpen = step.status === 'running' || step.status === 'failed';
  const tone = agentTone(step.agent_id);
  const duration = step.duration_ms ? (step.duration_ms >= 1000 ? `${(step.duration_ms / 1000).toFixed(1)}s` : `${step.duration_ms}ms`) : null;
  const tokens = step.tokens_in || step.tokens_out ? `${step.tokens_in || 0} in / ${step.tokens_out || 0} out` : null;
  return `<div class="step" data-step-id="${attr(step.id)}">
    <div class="step-head">
      <div class="step-dot ${step.status}">${esc(step.agent_id === 'SEC' ? 'SEC' : step.agent_id || 'LOG')}</div>
      <div class="step-main">
        <div class="step-title-row"><span class="step-title">${esc(step.title)}</span><span class="chip ${tone}">${esc(agentLabel(step.agent_id))}</span>${statusChip(step.status)}</div>
        <div class="step-meta">${duration ? `<span>${esc(duration)}</span>` : ''}${step.model ? `<span>· ${esc(step.model)}</span>` : ''}${tokens ? `<span>· ${esc(tokens)}</span>` : ''}${step.ended_at ? `<span>· ${esc(fmtDate(step.ended_at))}</span>` : ''}</div>
        <div class="step-summary">${esc(step.summary || (step.status === 'running' ? 'Working…' : 'No summary recorded.'))}</div>
      </div>
      <button class="panel-btn step-toggle" data-toggle-step title="Collapse step" aria-label="Collapse step">${icon('chevronDown', 15)}</button>
    </div>
    <div class="step-body ${isOpen ? '' : 'collapsed'}">
      ${(step.checks || []).length ? `<div class="step-section"><h5>Checks</h5>${checksTable(step.checks)}</div>` : ''}
      <div class="step-section"><h5>Output</h5>${renderStepOutput(step, run)}</div>
      ${(step.evidence || []).length ? `<div class="step-section"><h5>Evidence used by this step</h5>${evidenceList(step.evidence)}</div>` : ''}
      ${step.input ? `<details class="step-section"><summary class="tiny dim" style="cursor:pointer">Step input</summary><pre class="json-block">${esc(JSON.stringify(step.input, null, 2))}</pre></details>` : ''}
      ${step.error ? `<div class="callout callout-danger" style="margin-top:10px">${icon('xCircle', 16)}<div><b>Step error.</b> ${esc(step.error)}</div></div>` : ''}
      <details class="step-section"><summary class="tiny dim" style="cursor:pointer">Raw structured output</summary><pre class="json-block">${esc(JSON.stringify(step.output ?? null, null, 2))}</pre></details>
    </div>
  </div>`;
}

function renderStepOutput(step, run) {
  const d = step.output;
  if (!d) return `<div class="muted small">No structured output yet.</div>`;
  if (step.agent_id === 'SEC') {
    return `<div class="row"><span class="chip ${d.decision === 'BLOCK' ? 'red' : d.decision === 'FLAG' ? 'gold' : 'jade'}">${esc(d.decision)}</span><span class="tiny dim">screen score ${esc(d.score)}</span></div>${(d.signals || []).length ? `<div class="chip-row" style="margin-top:7px">${d.signals.map((s) => `<span class="chip muted">${esc(s.label || s.id || s)}</span>`).join('')}</div>` : '<div class="tiny dim" style="margin-top:6px">No injection signals detected.</div>'}`;
  }
  if (step.title === 'Evidence retrieval') {
    return `<div class="row" style="margin-bottom:8px"><span class="chip jade">${d.count ?? 0} chunks</span><span class="tiny dim">BM25 over approved versioned documents</span></div>${evidenceList(d.items || [])}`;
  }
  if (isFactsStep(step)) return renderFacts(d);
  if (step.agent_id === 'A1') return renderRoute(d);
  if (step.agent_id === 'A8') return renderVerification(d);
  if (step.agent_id === 'A7') return renderMemoryOutput(d);
  if (step.agent_id === 'A2' && step.title === 'Grounded synthesis') return renderKnowledge(d);
  if (step.title === 'Reviewer assessment') return renderCradleAI(d);
  if (step.title === 'Findings narrative') return renderAuditAI(d);
  if (step.title === 'Reminder draft') return renderPaymentAI(d, run);
  if (step.title === 'Trend interpretation') return renderTrendAI(d);
  return `<pre class="json-block">${esc(JSON.stringify(d, null, 2))}</pre>`;
}

function isFactsStep(step) {
  const t = String(step.title || '').toLowerCase();
  return t.includes('policy evaluation') || t.includes('control evaluation') || t.includes('ledger reconciliation') || t.includes('metric computation');
}

/* ── Facts ────────────────────────────────────────────────────────────── */

function renderFacts(d) {
  if (d.kind === 'cradle') return renderCradleFacts(d);
  if (d.kind === 'audit') return renderAuditFacts(d);
  if (d.kind === 'payment') return renderPaymentFacts(d);
  if (d.kind === 'trend') return renderTrendFacts(d);
  return `<pre class="json-block">${esc(JSON.stringify(d, null, 2))}</pre>`;
}

function renderCradleFacts(d) {
  const a = d.assessment;
  const tone = a === 'ELIGIBLE' ? 'pass' : a === 'INELIGIBLE' ? 'fail' : 'warn';
  const app = d.application || {};
  return `${statusBanner(tone, `Deterministic assessment: ${a}`, esc(d.deterministic_summary || ''), a === 'ELIGIBLE' ? 'checkCircle' : a === 'INELIGIBLE' ? 'xCircle' : 'alertTriangle')}
    <div class="step-section"><h5>Application facts</h5><div class="kv">
      <dt>Applicant</dt><dd>${esc(app.applicant || '—')}</dd>
      <dt>Registration</dt><dd class="mono tiny">${esc(app.registration || '—')}</dd>
      <dt>Incorporated</dt><dd>${esc(app.incorporated_at || '—')}</dd>
      <dt>Malaysian equity</dt><dd>${esc(pct(app.equity_pct))}</dd>
      <dt>Requested</dt><dd>${esc(money(app.requested_amount))}</dd>
      <dt>Matching</dt><dd>${esc(money(app.matching_amount))}</dd>
      <dt>Active grants</dt><dd>${esc(app.active_grants ?? '—')}</dd>
      <dt>Tax clearance</dt><dd>${esc(app.tax_clearance || '—')}</dd>
    </div></div>
    <div class="step-section"><h5>Checks</h5>${checksTable(d.checks)}</div>
    ${conflictBlock(d.conflicts)}
    ${missingDocs(d.missing_documents)}`;
}

function renderAuditFacts(d) {
  const sev = d.highest_severity || 'none';
  const tone = sev === 'critical' || sev === 'high' ? 'fail' : sev === 'medium' ? 'warn' : 'pass';
  const c = d.case || {};
  return `${statusBanner(tone, `Highest severity: ${titleCase(sev)}`, esc(d.deterministic_summary || ''), sev === 'none' ? 'checkCircle' : 'alertTriangle')}
    <div class="step-section"><h5>Claim</h5><div class="kv">
      <dt>Claim</dt><dd class="mono">${esc(c.claim_id || c.id || '—')}</dd>
      <dt>Amount</dt><dd>${esc(money(c.amount))}</dd>
      <dt>Approved</dt><dd>${esc(money(c.approved_amount))}</dd>
      <dt>Status</dt><dd>${esc(c.status || '—')}</dd>
      <dt>Source</dt><dd>${esc(c.source || '—')}</dd>
    </div></div>
    <div class="step-section"><h5>Findings</h5>${(d.findings || []).length ? d.findings.map(findingCard).join('') : '<div class="callout callout-jade">' + icon('checkCircle', 16) + '<div>No control failure detected in the supplied event chain.</div></div>'}</div>
    <div class="step-section"><h5>Observed sequence</h5><div class="list-reset">${(d.observed_sequence || []).map((e) => `<li><b>${esc(e.type)}</b> <span class="dim tiny">· ${esc(e.actor)} · ${esc(fmtDate(e.at))}</span></li>`).join('')}</div></div>`;
}

function renderPaymentFacts(d) {
  const inv = d.invoice || {};
  const blocked = d.allowed === false;
  return `${statusBanner(blocked ? 'fail' : 'pass', blocked ? 'Gate blocked — no draft may be sent' : 'Reconciled — draft permitted behind approval', esc(d.deterministic_summary || ''), blocked ? 'xCircle' : 'checkCircle')}
    <div class="step-section"><h5>Ledger facts</h5><div class="kv">
      <dt>Invoice</dt><dd class="mono">${esc(inv.id || '—')}</dd>
      <dt>Customer</dt><dd>${esc(inv.customer || '—')} <span class="chip muted">${esc(inv.customer_status || '')}</span></dd>
      <dt>Outstanding</dt><dd class="strong">${esc(money(inv.outstanding, inv.currency || 'MYR'))}</dd>
      <dt>Due date</dt><dd>${esc(inv.due_date || '—')}</dd>
      <dt>Overdue</dt><dd>${esc(inv.overdue_days ?? 0)} days</dd>
      <dt>Cadence stage</dt><dd><span class="chip gold">${esc(inv.stage || 'NONE')}</span></dd>
      <dt>Approval</dt><dd>${d.approval_required ? 'Required for every send' : 'Not required at this stage'}</dd>
      <dt>Duplicate window</dt><dd>${esc(d.duplicate_window_hours ?? '—')} hours</dd>
      <dt>Last reminded</dt><dd>${esc(inv.last_reminded_at ? fmtDate(inv.last_reminded_at) : 'Never')}</dd>
    </div></div>
    ${(d.blocked_reasons || []).length ? `<div class="callout callout-danger" style="margin-top:10px">${icon('xCircle', 16)}<div><b>Blocked reasons.</b> ${d.blocked_reasons.map(esc).join(' ')}</div></div>` : ''}
    ${d.duplicate_check?.blocked ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 16)}<div>${esc(d.duplicate_check.reason || 'A duplicate reminder is inside the suppression window.')}</div></div>` : ''}`;
}

function renderTrendFacts(d) {
  const measured = d.measured || [];
  const channels = d.channels || [];
  return `${statusBanner('pass', `Measured window: ${d.window?.current_start || '—'} → ${d.window?.current_end || '—'}`, esc(d.deterministic_summary || ''), 'activity')}
    <div class="step-section"><h5>Measured movement</h5><div class="table-wrap" style="border:0"><table class="table" style="min-width:0"><thead><tr><th>Metric</th><th class="num">Current</th><th class="num">Previous</th><th class="num">Δ</th></tr></thead><tbody>
      ${measured.map((m) => `<tr><td>${esc(humanize(m.metric))}</td><td class="num">${m.metric === 'revenue_myr' ? esc(money(m.current)) : m.metric === 'conversion_pct' ? esc(pct(m.current)) : Number(m.current).toLocaleString('en-MY')}</td><td class="num">${m.metric === 'revenue_myr' ? esc(money(m.previous)) : m.metric === 'conversion_pct' ? esc(pct(m.previous)) : Number(m.previous).toLocaleString('en-MY')}</td><td class="num"><span class="chip ${((m.delta_pct ?? m.delta_pts) || 0) >= 0 ? 'jade' : 'red'}">${m.delta_pct !== undefined && m.delta_pct !== null ? `${m.delta_pct > 0 ? '+' : ''}${m.delta_pct}%` : m.delta_pts !== undefined ? `${m.delta_pts > 0 ? '+' : ''}${m.delta_pts} pts` : '—'}</span></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="step-section"><h5>Channels</h5><div class="table-wrap" style="border:0"><table class="table" style="min-width:0"><thead><tr><th>Channel</th><th class="num">Leads</th><th class="num">Won</th><th class="num">Conversion</th><th>Sample</th></tr></thead><tbody>
      ${channels.map((c) => `<tr><td>${esc(c.channel)}</td><td class="num">${esc(c.leads)}</td><td class="num">${esc(c.won)}</td><td class="num">${esc(pct(c.conversion_pct))}</td><td>${c.sufficient_sample ? '<span class="chip jade">sufficient</span>' : '<span class="chip gold">small sample</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${(d.anomalies || []).length ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 16)}<div>${d.anomalies.map((a) => esc(a.note)).join(' ')}</div></div>` : '<div class="callout callout-jade" style="margin-top:10px">' + icon('checkCircle', 16) + '<div>No channel movement crossed the anomaly threshold with a sufficient sample.</div></div>'}`;
}

/* ── AI outputs ───────────────────────────────────────────────────────── */

function renderCradleAI(d) {
  const a = d.assessment;
  const tone = a === 'ELIGIBLE' ? 'pass' : a === 'INELIGIBLE' ? 'fail' : 'warn';
  return `${statusBanner(tone, `Reviewer assessment: ${a || '—'}`, esc(d.reviewer_summary || d.summary || ''), 'file')}
    ${d.conflict_disclosure ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 16)}<div><b>Conflict disclosure.</b> ${esc(d.conflict_disclosure)}</div></div>` : ''}
    ${(d.checks || []).length ? `<div class="step-section"><h5>Model check narrative</h5>${checksTable(d.checks)}</div>` : ''}
    ${missingDocs(d.missing_documents)}
    ${d.recommendation ? `<div class="step-section"><h5>Recommendation</h5><p class="small muted" style="margin:0">${esc(d.recommendation)}</p></div>` : ''}
    ${confidenceRow(d.confidence)}`;
}

function renderAuditAI(d) {
  return `${statusBanner(d.highest_severity === 'critical' || d.highest_severity === 'high' ? 'fail' : d.highest_severity === 'medium' ? 'warn' : 'pass', `Narrative highest severity: ${titleCase(d.highest_severity || 'none')}`, esc(d.summary || d.narrative || ''), 'file')}
    ${(d.findings || []).length ? `<div class="step-section"><h5>Findings</h5>${d.findings.map(findingCard).join('')}</div>` : ''}
    ${d.recommendation ? `<div class="step-section"><h5>Recommendation</h5><p class="small muted" style="margin:0">${esc(d.recommendation)}</p></div>` : ''}
    ${confidenceRow(d.confidence)}`;
}

function renderPaymentAI(d, run) {
  if (d.allowed === false) {
    return `${statusBanner('fail', 'No draft generated', 'The deterministic gate blocked this reminder. The model cannot override a block.', 'xCircle')}
      ${(d.blocked_reasons || []).length ? `<div class="callout callout-danger" style="margin-top:10px">${icon('xCircle', 16)}<div>${d.blocked_reasons.map(esc).join(' ')}</div></div>` : ''}`;
  }
  if (!d.subject && !d.body) {
    return `${statusBanner('warn', 'No draft text returned', 'The structured output is missing a subject and body. This run should be reviewed.', 'alertTriangle')}${confidenceRow(d.confidence)}`;
  }
  return `<div class="row" style="margin-bottom:8px"><span class="chip gold">${esc(d.stage || '—')}</span><span class="chip ${d.approval_required ? 'seal' : 'muted'}">${d.approval_required ? 'approval required' : 'no approval'}</span><span class="chip muted">${esc(d.tone || 'tone not set')}</span><span class="chip blue">simulated action</span></div>
    <div class="draft-paper">
      <div class="draft-head"><div class="draft-subject">${esc(d.subject || '(no subject)')}</div><span class="chip muted">DRAFT · NOT SENT</span></div>
      <div class="draft-body">${esc(d.body || '')}</div>
      <div class="draft-meta"><span>To: ${esc(d.to || 'invoice contact')}</span><span>Stage: ${esc(d.stage || '—')}</span><span>Approval: required</span><span>Mode: simulated</span></div>
      <span class="draft-stamp">Simulated</span>
    </div>
    ${(d.risk_notes || []).length ? `<div class="step-section"><h5>Risk notes</h5><ul class="list-reset">${d.risk_notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    ${confidenceRow(d.confidence)}`;
}

function renderTrendAI(d) {
  const interpretation = Array.isArray(d.interpretation) ? d.interpretation.join(' ') : d.interpretation || d.summary || '';
  return `${statusBanner('pass', d.headline || 'Trend interpretation', esc(interpretation), 'activity')}
    ${(d.proposed_experiments || []).length ? `<div class="step-section"><h5>Proposed bounded experiments</h5><div class="stack">${d.proposed_experiments.map((x, i) => `<div class="finding"><div class="finding-title">${esc(x.title || x.name || `Experiment ${i + 1}`)}</div><div class="finding-body">${esc(x.description || x.detail || (typeof x === 'string' ? x : JSON.stringify(x)))}</div>${x.metric || x.guardrail ? `<div class="finding-meta">${x.metric ? `<span>Metric: ${esc(x.metric)}</span>` : ''}${x.guardrail ? `<span>Guardrail: ${esc(x.guardrail)}</span>` : ''}</div>` : ''}</div>`).join('')}</div></div>` : ''}
    ${(d.risks || []).length ? `<div class="step-section"><h5>Risks</h5><ul class="list-reset">${d.risks.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul></div>` : ''}
    ${(d.limitations || []).length ? `<div class="callout callout-info" style="margin-top:10px">${icon('info', 16)}<div>${d.limitations.map(esc).join(' ')}</div></div>` : ''}
    ${confidenceRow(d.confidence)}`;
}

function renderKnowledge(d) {
  return `${d.unanswerable ? `<div class="callout callout-warn">${icon('alertTriangle', 16)}<div><b>Not answerable from approved knowledge.</b> ${esc(d.unanswerable_reason || 'The corpus does not contain enough support.')}</div></div>` : ''}
    <div class="step-section"><h5>Answer</h5><p class="small" style="margin:0;color:var(--text-soft);line-height:1.7">${esc(d.answer || '')}</p></div>
    ${(d.citations || []).length ? `<div class="step-section"><h5>Citations</h5><div class="evidence-list">${d.citations.map((c, i) => `<div class="evidence-item"><div class="evidence-head"><span class="ev-ref">${esc(c.ref || `C${i + 1}`)}</span><span class="evidence-title">${esc(c.doc_id || c.title || '')}</span><span class="evidence-version">${esc(c.version || '')}</span></div>${c.quote ? `<p class="evidence-quote">${esc(c.quote)}</p>` : ''}</div>`).join('')}</div></div>` : ''}
    ${(d.conflicts || []).length ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 16)}<div>${d.conflicts.map(esc).join(' ')}</div></div>` : ''}
    ${confidenceRow(d.confidence)}`;
}

function renderRoute(d) {
  return `<div class="row" style="margin-bottom:8px"><span class="chip seal">${esc(d.specialist_agent || d.route || 'route')}</span>${riskChip(d.risk)}<span class="chip ${d.requires_human_gate ? 'gold' : 'muted'}">${d.requires_human_gate ? 'human gate' : 'no human gate'}</span></div>
    <p class="small muted" style="margin:0 0 8px">${esc(d.strategy || '')}</p>
    ${d.rationale ? `<div class="quote">${esc(d.rationale)}</div>` : ''}
    ${confidenceRow(d.confidence)}`;
}

function renderVerification(d) {
  const tone = d.outcome === 'PASS' ? 'pass' : d.outcome === 'FAIL' ? 'fail' : 'warn';
  return `${statusBanner(tone, `Verification outcome: ${d.outcome}`, `${(d.checks || []).filter((c) => c.status === 'PASS').length} pass · ${(d.checks || []).filter((c) => c.status === 'WARN' || c.status === 'NOT_RUN').length} note(s) · ${(d.checks || []).filter((c) => c.status === 'FAIL').length} fail`, d.outcome === 'PASS' ? 'checkCircle' : d.outcome === 'FAIL' ? 'xCircle' : 'alertTriangle')}
    <div class="step-section"><h5>Verifier checks</h5>${checksTable(d.checks)}</div>
    ${d.grounding ? `<div class="step-section"><h5>Model grounding</h5><div class="kv"><dt>Quality</dt><dd>${esc(d.grounding.quality || d.grounding || '—')}</dd>${d.grounding.reason ? `<dt>Reason</dt><dd>${esc(d.grounding.reason)}</dd>` : ''}</div></div>` : ''}
    ${(d.unsupported_claims || []).length ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 16)}<div><b>Unsupported claims.</b> ${d.unsupported_claims.map((u) => esc(u.claim || u)).join(' · ')}</div></div>` : ''}`;
}

function renderMemoryOutput(d) {
  return `<div class="row" style="margin-bottom:8px"><span class="chip jade">${esc(d.status || 'candidate')}</span>${d.memory_id ? `<span class="mono tiny dim">${esc(d.memory_id)}</span>` : ''}</div>
    ${d.title ? `<div class="strong small">${esc(d.title)}</div>` : ''}
    ${d.lesson ? `<p class="small muted" style="margin:6px 0 0">${esc(d.lesson)}</p>` : ''}
    ${d.confidence !== undefined ? confidenceRow(d.confidence) : ''}
    <div class="tiny dim" style="margin-top:8px">Candidate memory is scoped, expiring and unpublished until a knowledge owner approves it.</div>`;
}

/* ── Decision record, approvals, evidence ─────────────────────────────── */

function renderDecision(run, verification, evidence) {
  const meta = run.meta || {};
  const v = verification || {};
  return `<div class="kv">
    <dt>Outcome</dt><dd>${statusChip(run.status)} ${run.outcome ? `<span class="chip muted">${esc(run.outcome)}</span>` : ''}</dd>
    <dt>Policy risk</dt><dd>${riskChip(run.risk)}</dd>
    <dt>Verification</dt><dd>${v.outcome ? `<span class="chip ${v.outcome === 'PASS' ? 'jade' : v.outcome === 'FAIL' ? 'red' : 'gold'}">${esc(v.outcome)}</span>` : '<span class="chip muted">not recorded</span>'}</dd>
    <dt>Evidence</dt><dd>${evidence.length} chunk${evidence.length === 1 ? '' : 's'} · ${Number(meta.evidence_count ?? evidence.length)} retrieved</dd>
    <dt>Human gate</dt><dd>${meta.human_gate ? '<span class="chip gold">required</span>' : '<span class="chip jade">not required</span>'}</dd>
    <dt>Memory</dt><dd>${meta.memory_id ? `<button class="btn btn-sm btn-ghost" data-nav="/memory">${esc(meta.memory_id)} ${icon('arrowRight', 12)}</button>` : '<span class="dim">no candidate</span>'}</dd>
    <dt>Actor</dt><dd class="mono tiny">${esc(run.actor || '—')}</dd>
    <dt>Completed</dt><dd class="tiny">${esc(run.completed_at ? fmtDate(run.completed_at) : '—')}</dd>
  </div>
  ${meta.policy_summary ? `<div class="divider"></div><div class="tiny dim">${esc(meta.policy_summary)}</div>` : ''}
  <div class="divider"></div>
  <div class="tiny dim">${esc(meta.dataset_label || 'Seeded demonstration data — not live production records')}</div>
  <div class="row" style="margin-top:10px"><span class="chip muted">${icon('shield', 12)} no private chain-of-thought</span><span class="chip muted">${icon('link', 12)} hash-chained audit</span></div>`;
}

function renderApprovals(run) {
  const approvals = run.approvals || [];
  if (!approvals.length) return emptyState('No gate for this run', 'This run did not require a human authorisation, or its gate is recorded elsewhere.', 'stamp');
  return `<div class="stack">${approvals.map((a) => {
    const permission = a.type === 'memory_publish' ? 'approve:memory' : 'approve:business';
    const allowed = can(permission);
    const pending = a.status === 'pending';
    const payload = a.payload || {};
    return `<div class="finding ${a.risk === 'critical' || a.risk === 'high' ? a.risk : ''}">
      <div class="finding-head"><div><div class="finding-title">${esc(a.title)}</div><div class="tiny dim">${esc(humanize(a.type))} · assigned to ${esc(a.assigned_role || '—')}</div></div><div class="row">${riskChip(a.risk)}${statusChip(a.status)}</div></div>
      <div class="finding-body">${esc(a.detail || '')}</div>
      ${a.type === 'payment_send' && (payload.subject || payload.body) ? `<div class="step-section"><div class="draft-paper" style="padding:12px"><div class="draft-subject" style="font-size:12px">${esc(payload.subject || '(no subject)')}</div><div class="draft-body" style="font-size:11.5px;margin-top:6px">${esc(truncate(payload.body || '', 420))}</div><div class="draft-stamp" style="font-size:8px">Simulated</div></div></div>` : ''}
      <div class="finding-meta"><span>${esc(a.requested_by || '—')}</span><span>· ${esc(fmtDate(a.created_at))}</span>${a.idempotency_key ? `<span>· ${esc(a.idempotency_key)}</span>` : ''}</div>
      ${a.status === 'pending' ? `<div class="row" style="margin-top:9px">
        <button class="btn btn-sm btn-jade" data-approval-id="${attr(a.id)}" data-approval-decision="approve" ${allowed ? '' : 'disabled'}>${icon('check', 13)} Approve</button>
        <button class="btn btn-sm btn-danger" data-approval-id="${attr(a.id)}" data-approval-decision="reject" ${allowed ? '' : 'disabled'}>${icon('x', 13)} Reject</button>
        ${allowed ? '' : `<span class="tiny dim">Your role cannot decide this gate.</span>`}
      </div>` : `<div class="finding-meta"><span>Decided by ${esc(a.decided_by || '—')}</span><span>· ${esc(a.decided_at ? fmtDate(a.decided_at) : '')}</span>${a.decision_note ? `<span>· ${esc(a.decision_note)}</span>` : ''}</div>`}
    </div>`;
  }).join('')}</div>`;
}

function renderEvidence(evidence) {
  if (!evidence.length) return emptyState('No evidence retrieved', 'The evidence pack is empty, so a consequential recommendation should not proceed.', 'layers');
  return evidenceList(evidence);
}

function renderMemory(run) {
  const m = (run.steps || []).find((s) => s.agent_id === 'A7');
  if (!m?.output) return `<div class="muted small">No memory candidate was produced for this run. The verifier may have blocked it, or the lesson did not meet the threshold.</div>`;
  return renderMemoryOutput(m.output) + `<div class="row" style="margin-top:10px"><button class="btn btn-sm btn-ghost" data-nav="/memory">${icon('spark', 13)} Review memory ${icon('arrowRight', 13)}</button></div>`;
}

/* ── Live stream ──────────────────────────────────────────────────────── */

function attachLive(view, run) {
  closeLive();
  if (!window.EventSource) return;
  const es = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/events`);
  state.live = es;
  const current = { ...run, steps: [...(run.steps || [])], approvals: [...(run.approvals || [])] };

  es.addEventListener('run', (e) => {
    try {
      const next = JSON.parse(e.data);
      Object.assign(current, next);
      const banner = document.getElementById('runStatusBanner');
      if (banner && next.status === 'running') banner.innerHTML = runBanner(next, next.meta?.verification, 18);
    } catch { /* ignore */ }
  });

  es.addEventListener('step', (e) => {
    try {
      const step = JSON.parse(e.data);
      const idx = current.steps.findIndex((s) => s.id === step.id);
      if (idx >= 0) current.steps[idx] = step;
      else current.steps.push(step);
      const root = document.getElementById('runSteps');
      if (root) root.innerHTML = current.steps.map((s) => renderStep(s, current)).join('');
      const count = document.getElementById('stepCount');
      if (count) count.textContent = `${current.steps.length} steps`;
    } catch { /* ignore */ }
  });

  es.addEventListener('approval', (e) => {
    try {
      const approval = JSON.parse(e.data);
      const idx = current.approvals.findIndex((a) => a.id === approval.id);
      if (idx >= 0) current.approvals[idx] = approval;
      else current.approvals.push(approval);
      const root = document.getElementById('runApprovals');
      if (root) root.innerHTML = renderApprovals(current);
    } catch { /* ignore */ }
  });

  es.addEventListener('done', async (e) => {
    try {
      const final = JSON.parse(e.data);
      closeLive();
      paintRun(view, final, { live: false });
      refreshChrome();
    } catch { closeLive(); }
  });

  es.addEventListener('error', () => {
    // A dropped stream is not a failed run; the durable record is the source of truth.
    closeLive();
  });
}

function closeLive() {
  if (state.live) {
    try { state.live.close(); } catch { /* ignore */ }
    state.live = null;
  }
}

/* ── Approval decisions ───────────────────────────────────────────────── */

async function decideApproval(view, run, approvalId, decision) {
  const approval = (run.approvals || []).find((a) => a.id === approvalId);
  if (!approval) return;
  const isApprove = decision === 'approve';
  const simulated = approval.type === 'payment_send';
  const { confirmed, note } = await confirmAction({
    title: `${isApprove ? 'Approve' : 'Reject'} · ${approval.title}`,
    body: `<p class="small muted" style="margin:0 0 10px">${esc(approval.detail || '')}</p>
      ${simulated ? `<div class="callout callout-warn">${icon('alertTriangle', 16)}<div><b>Simulated action.</b> Approval writes a simulated send to the outbox. No external message leaves this machine.</div></div>` : ''}
      ${approval.type === 'verification_review' ? `<div class="callout callout-danger">${icon('shield', 16)}<div>Approving acknowledges the verifier failure. It does not convert the run to a pass.</div></div>` : ''}
      <div class="tiny dim" style="margin-top:10px">Gate <span class="mono">${esc(approval.id)}</span> · ${esc(approval.idempotency_key || '')}</div>`,
    confirmLabel: isApprove ? 'Approve gate' : 'Reject gate',
    tone: isApprove ? 'jade' : 'danger',
    note: true,
    noteLabel: isApprove ? 'Approval note (optional)' : 'Reason for rejection'
  });
  if (!confirmed) return;
  try {
    const result = await api(`/api/approvals/${encodeURIComponent(approvalId)}/decision`, { method: 'POST', body: { decision, note } });
    const msg = result?.result?.simulated
      ? `Approved. A simulated send was written to the outbox for <b>${esc(result.result.invoice_id)}</b>.`
      : result?.result?.status === 'approved'
        ? 'Approved. The memory is now published to the approved corpus.'
        : isApprove ? 'Gate approved and recorded.' : 'Gate rejected and recorded.';
    toast(msg, { tone: isApprove ? 'jade' : 'gold', title: 'Decision recorded' });
    const fresh = await api(`/api/runs/${encodeURIComponent(run.id)}`);
    paintRun(view, fresh, { live: false });
    refreshChrome();
  } catch (e) {
    toast(esc(e.message), { tone: 'seal', title: 'Decision failed' });
  }
}

/* ── Summary / utility ────────────────────────────────────────────────── */

function summaryOf(run) {
  const vStep = (run.steps || []).find((s) => s.agent_id === 'A8');
  const evidence = collectEvidence(run);
  return {
    run_id: run.id,
    process: run.process,
    title: run.title,
    request: run.request,
    tenant: run.tenant,
    status: run.status,
    risk: run.risk,
    outcome: run.outcome,
    actor: run.actor,
    created_at: run.created_at,
    completed_at: run.completed_at,
    policy_summary: run.meta?.policy_summary || null,
    verification: vStep?.output || run.meta?.verification || null,
    approvals: (run.approvals || []).map((a) => ({ id: a.id, type: a.type, status: a.status, risk: a.risk, decided_by: a.decided_by, decided_at: a.decided_at, note: a.decision_note })),
    evidence: evidence.map((e) => ({ ref: e.ref, doc_id: e.doc_id, version: e.version, heading: e.heading })),
    memory_id: run.meta?.memory_id || null,
    dataset_label: run.meta?.dataset_label || 'Seeded demonstration data — not live production records',
    exported_at: new Date().toISOString(),
    note: 'Auditable decision summary only. Private chain-of-thought is deliberately excluded.'
  };
}

function copyRun(run) {
  copyText(JSON.stringify(summaryOf(run), null, 2), 'Decision summary copied as JSON.');
}

function collectEvidence(run) {
  const map = new Map();
  for (const step of run.steps || []) {
    for (const e of step.evidence || []) {
      const key = `${e.doc_id || e.docId}:${e.version}:${e.ref || e.heading}`;
      if (!map.has(key)) map.set(key, e);
    }
  }
  return [...map.values()];
}

/* ── Shared fragments ─────────────────────────────────────────────────── */

function checksTable(checks = []) {
  if (!checks.length) return '<div class="muted small">No checks recorded.</div>';
  return `<div class="check-list">${checks.map((c) => `<div class="check-row">
    <span class="check-id">${esc(c.id || c.rule_id || '—')}</span>
    <span class="check-detail" title="${attr(c.detail || c.note || '')}">${esc(c.name ? `${c.name}${c.detail ? ' — ' : ''}` : '')}${esc(c.detail || c.note || '')}</span>
    <span class="check-status ${esc(String(c.status || '').toUpperCase())}">${esc(c.status || '—')}</span>
    ${c.method ? `<span class="check-note">${esc(c.method)}</span>` : ''}
  </div>`).join('')}</div>`;
}

function evidenceList(items = []) {
  if (!items.length) return '<div class="muted small">No evidence items attached.</div>';
  return `<div class="evidence-list">${items.map((e) => `<div class="evidence-item">
    <div class="evidence-head"><span class="ev-ref">${esc(e.ref || 'EV')}</span><span class="evidence-title">${esc(e.title || e.doc_title || e.doc_id || 'Document')}</span><span class="evidence-version">${esc(e.doc_id || '')}${e.version ? ` v${esc(e.version)}` : ''}</span></div>
    ${e.heading ? `<div class="tiny dim" style="margin-top:3px">${esc(e.heading)}</div>` : ''}
    ${e.quote ? `<p class="evidence-quote">${esc(e.quote)}</p>` : ''}
  </div>`).join('')}</div>`;
}

function findingCard(f) {
  const sev = String(f.severity || 'medium').toLowerCase();
  return `<div class="finding ${sev}">
    <div class="finding-head"><div class="finding-title">${esc(f.title || f.control_id || 'Finding')}</div><span class="chip ${sev === 'critical' || sev === 'high' ? 'red' : sev === 'medium' ? 'gold' : 'jade'}">${esc(titleCase(sev))}</span></div>
    <div class="finding-body">${esc(f.detail || f.description || '')}</div>
    <div class="finding-meta">${f.control_id ? `<span>${esc(f.control_id)}</span>` : ''}${f.evidence ? `<span>· ${esc(Array.isArray(f.evidence) ? f.evidence.join(', ') : f.evidence)}</span>` : ''}${f.amount_delta ? `<span>· Δ ${esc(money(f.amount_delta))}</span>` : ''}</div>
  </div>`;
}

function conflictBlock(conflicts) {
  if (!conflicts?.length) return '';
  return `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 17)}<div><b>Policy conflict disclosed.</b> ${conflicts.map((c) => `${esc(c.key)} — ${c.sources.map((s) => `${esc(s.doc_id)} v${esc(s.version)}: <b>${esc(s.value)}</b>`).join(' vs ')}. Conservative value applied: <b>${esc(c.applied)}</b>.`).join('<br>')}</div></div>`;
}

function missingDocs(docs) {
  if (!docs?.length) return '';
  return `<div class="step-section"><h5>Missing documents (${docs.length})</h5><div class="stack">${docs.map((d) => `<div class="finding"><div class="finding-title">${esc(d.ref)} · ${esc(d.name)}</div><div class="finding-body">${esc(d.why_it_matters || '')}</div></div>`).join('')}</div></div>`;
}

function confidenceRow(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const pctValue = Math.max(0, Math.min(1, n)) * 100;
  return `<div class="row" style="margin-top:10px"><span class="tiny dim">Confidence</span><div class="progress" style="flex:1;min-width:80px"><i style="width:${pctValue}%"></i></div><span class="mono tiny">${Math.round(pctValue)}%</span></div>`;
}

/* ── Skeletons ────────────────────────────────────────────────────────── */

function listSkeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:130px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(480px,72vw)"></div><div class="skeleton" style="height:12px;width:min(640px,82vw);margin-top:12px"></div></div></div>
  <div class="skeleton" style="height:42px;width:360px;margin-bottom:14px"></div>
  <div class="panel glass"><div class="panel-body">${Array.from({ length: 6 }).map(() => `<div class="skeleton" style="height:46px;margin-bottom:8px"></div>`).join('')}</div></div>`;
}

function detailSkeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:150px;margin-bottom:12px"></div><div class="skeleton" style="height:38px;width:min(560px,78vw)"></div><div class="skeleton" style="height:12px;width:min(640px,85vw);margin-top:12px"></div></div></div>
  <div class="skeleton" style="height:70px;margin-bottom:16px"></div>
  <div class="split"><div class="panel glass"><div class="panel-body">${Array.from({ length: 5 }).map(() => `<div class="skeleton" style="height:76px;margin-bottom:10px"></div>`).join('')}</div></div><div class="stack"><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:150px"></div></div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:120px"></div></div></div></div></div>`;
}

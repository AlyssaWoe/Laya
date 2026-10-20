/* Governance pages: approvals, audit trail, memory, knowledge, security. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusChip, riskChip, fmtDate, relTime,
  humanize, money, emptyState, statusBanner, confirmAction, toast, openModal, closeModal,
  copyText, downloadJson, debounce, can, titleCase, truncate, shortHash, pct
} from '../core.js';
import { refreshChrome } from '../shell.js';
import { miniMarkdown } from '../markdown.js';

const APPROVAL_LABEL = {
  payment_send: 'Payment send',
  application_review: 'Cradle review',
  audit_review: 'Audit review',
  memory_publish: 'Memory publication',
  verification_review: 'Verification review',
  release_candidate: 'Harness release'
};

const APPROVAL_TONE = {
  payment_send: 'gold', application_review: 'jade', audit_review: 'gold',
  memory_publish: 'jade', verification_review: 'seal', release_candidate: 'violet'
};

/* ══ Approvals ═══════════════════════════════════════════════════════════ */

let approvalTab = 'pending';

export async function renderApprovals(view) {
  view.innerHTML = skeleton();
  let data, outbox;
  try {
    [data, outbox] = await Promise.all([api('/api/approvals'), api('/api/outbox')]);
  } catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Approvals', title: 'Human authority.' })}${statusBanner('fail', 'Approvals unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const approvals = data.approvals || [];
  const sends = outbox.outbox || [];
  const pending = approvals.filter((a) => a.status === 'pending');
  const tabs = [
    ['pending', `Pending${pending.length ? ` (${pending.length})` : ''}`],
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
    ['all', `All (${approvals.length})`]
  ];

  const filtered = () => approvals.filter((a) => approvalTab === 'all' || a.status === approvalTab);

  view.innerHTML = `${pageHead({
    eyebrow: 'Human gates',
    title: 'Authority stays human.',
    sub: 'Approvals are the only way a payment can leave the workspace, a memory can enter the corpus, or a release candidate can be endorsed. The server enforces the role, not the button.',
    actions: `<button class="btn btn-ghost" data-nav="/audit">${icon('link', 15)} Audit trail</button><button class="btn btn-ghost" data-refresh-approvals>${icon('refresh', 15)} Refresh</button>`
  })}
  <div class="filter-bar"><div class="tabs" id="approvalTabs">${tabs.map(([id, label]) => `<button class="tab ${id === approvalTab ? 'active' : ''}" data-approval-tab="${id}">${esc(label)}</button>`).join('')}</div><span class="chip ${pending.length ? 'gold' : 'jade'}">${pending.length} waiting</span></div>
  <div class="split">
    <div class="stack" id="approvalList"></div>
    <div class="stack">
      ${panel({
        id: 'approvals:rules', title: 'Decision rules', subtitle: 'What a signature does — and does not do', iconName: 'shield', tone: 'seal',
        body: `<ul class="list-reset">
          <li><b>Payment.</b> Every payment send requires approval, even below the RM 25,000 threshold. Approval writes a simulated send to the outbox; a duplicate is suppressed by idempotency key.</li>
          <li><b>Assessment.</b> Approval records reviewer acknowledgement. It does not change the deterministic eligibility outcome.</li>
          <li><b>Verification.</b> Approving a failed verification acknowledges the failure. It never converts it to a pass.</li>
          <li><b>Memory.</b> Publication requires the knowledge owner. Candidate memory is not evidence until approved.</li>
          <li><b>Harness release.</b> Approval endorses a release candidate. It does not mutate production policy or prompts.</li>
        </ul>`
      })}
      ${panel({
        id: 'approvals:outbox', title: 'Simulated outbox', subtitle: 'No external message leaves this machine', iconName: 'file', tone: 'gold',
        body: sends.length ? `<div class="stack">${sends.slice(0, 8).map((o) => `<div class="finding"><div class="finding-head"><div><div class="finding-title">${esc(o.type)} → ${esc(o.object_id)}</div><div class="tiny dim">${esc(o.status)} · ${esc(fmtDate(o.created_at))}</div></div><span class="chip gold">simulated</span></div><div class="finding-meta">${esc(o.idempotency_key || '')}</div></div>`).join('')}</div>` : emptyState('No simulated sends', 'Approved payment reminders are recorded here with their idempotency key.', 'file')
      })}
    </div>
  </div>`;

  const list = document.getElementById('approvalList');
  function paint() {
    const rows = filtered();
    list.innerHTML = rows.length ? rows.map((a) => approvalCard(a)).join('') : emptyState(
      approvalTab === 'pending' ? 'No gates waiting' : 'Nothing in this tab',
      approvalTab === 'pending' ? 'Launch a Cradle assessment, a payment follow-up or a verification review to create a gate.' : 'Decisions remain in the audit trail.',
      'stamp',
      `<button class="btn btn-primary btn-sm" data-nav="/processes">${icon('play', 13)} Launch a process</button>`
    );
    list.querySelectorAll('[data-approval-decision]').forEach((b) => b.addEventListener('click', () => decide(view, b.dataset.approvalId, b.dataset.approvalDecision)));
  }

  document.getElementById('approvalTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-approval-tab]');
    if (!b) return;
    approvalTab = b.dataset.approvalTab;
    document.querySelectorAll('[data-approval-tab]').forEach((x) => x.classList.toggle('active', x === b));
    paint();
  });
  view.querySelector('[data-refresh-approvals]')?.addEventListener('click', () => renderApprovals(view));
  paint();
}

function approvalCard(a) {
  const permission = a.type === 'memory_publish' ? 'approve:memory' : 'approve:business';
  const allowed = can(permission);
  const payload = a.payload || {};
  const tone = APPROVAL_TONE[a.type] || 'muted';
  return `<div class="panel glass ${a.status === 'pending' ? 'tone-gold' : ''}" data-panel="approval:${attr(a.id)}" style="border-radius:16px">
    <div class="panel-head"><div class="panel-title-wrap"><div class="panel-icon gold">${icon(a.type === 'payment_send' ? 'file' : a.type === 'memory_publish' ? 'spark' : a.type === 'verification_review' ? 'shield' : a.type === 'release_candidate' ? 'flask' : 'stamp')}</div><div><h3 class="panel-title">${esc(a.title)}</h3><p class="panel-sub">${esc(APPROVAL_LABEL[a.type] || humanize(a.type))} · ${esc(a.tenant)} · ${esc(fmtDate(a.created_at))}</p></div></div><div class="panel-actions">${riskChip(a.risk)}${statusChip(a.status)}</div></div>
    <div class="panel-body">
      <p class="small muted" style="margin:0 0 10px">${esc(a.detail || '')}</p>
      ${payloadPreview(a)}
      <div class="finding-meta" style="margin-top:10px"><span>Requested by ${esc(a.requested_by || '—')}</span><span>· assigned ${esc(a.assigned_role || '—')}</span>${a.idempotency_key ? `<span>· <span class="mono">${esc(a.idempotency_key)}</span></span>` : ''}</div>
      ${a.status === 'pending' ? `<div class="row" style="margin-top:11px"><button class="btn btn-sm btn-jade" data-approval-id="${attr(a.id)}" data-approval-decision="approve" ${allowed ? '' : 'disabled'}>${icon('check', 13)} Approve</button><button class="btn btn-sm btn-danger" data-approval-id="${attr(a.id)}" data-approval-decision="reject" ${allowed ? '' : 'disabled'}>${icon('x', 13)} Reject</button>${a.run_id ? `<button class="btn btn-sm btn-ghost" data-nav="/runs/${attr(a.run_id)}">${icon('arrowUpRight', 13)} Run</button>` : ''}${allowed ? '' : '<span class="tiny dim">Your role cannot decide this gate.</span>'}</div>` : `<div class="finding-meta"><span>Decided by ${esc(a.decided_by || '—')}</span><span>· ${esc(a.decided_at ? fmtDate(a.decided_at) : '')}</span>${a.decision_note ? `<span>· ${esc(a.decision_note)}</span>` : ''}</div>`}
    </div>
  </div>`;
}

function payloadPreview(a) {
  const p = a.payload || {};
  if (a.type === 'payment_send') {
    if (!p.subject && !p.body) return `<div class="callout callout-warn">${icon('alertTriangle', 15)}<div>No draft payload is attached. Approve only if the run record contains the draft.</div></div>`;
    return `<div class="draft-paper" style="padding:14px"><div class="draft-head"><div class="draft-subject">${esc(p.subject || '(no subject)')}</div><span class="chip muted">DRAFT</span></div><div class="draft-body">${esc(truncate(p.body || '', 520))}</div><div class="draft-meta"><span>${esc(p.stage || '')}</span><span>${esc(p.invoice_id || '')}</span><span>Simulated send</span></div><span class="draft-stamp">Simulated</span></div>`;
  }
  if (a.type === 'application_review') {
    return `<div class="chip-row"><span class="chip jade">${esc(p.assessment || '—')}</span><span class="chip muted">${esc(p.application_id || '')}</span></div>`;
  }
  if (a.type === 'audit_review') {
    return `<div class="chip-row"><span class="chip ${p.highest_severity === 'critical' || p.highest_severity === 'high' ? 'red' : 'gold'}">${esc(p.highest_severity || '—')}</span><span class="chip muted">${esc(p.case_id || '')}</span></div>`;
  }
  if (a.type === 'verification_review') {
    const checks = p.checks || [];
    return `<div class="chip-row"><span class="chip red">${checks.filter((c) => c.status === 'FAIL').length} fail</span><span class="chip muted">${esc(p.run_id || '')}</span></div>`;
  }
  if (a.type === 'release_candidate') {
    return `<div class="score-bars"><div class="score-row"><span class="score-label">Baseline</span><div class="progress"><i style="width:${Number(p.baseline) || 0}%"></i></div><span class="score-value">${esc(p.baseline ?? '—')}%</span></div><div class="score-row"><span class="score-label">Candidate</span><div class="progress jade"><i style="width:${Number(p.candidate) || 0}%"></i></div><span class="score-value">${esc(p.candidate ?? '—')}%</span></div></div>`;
  }
  if (a.type === 'memory_publish') {
    return `<div class="chip-row"><span class="chip jade">${esc(p.memory_id || '')}</span><span class="chip muted">candidate → approved corpus</span></div>`;
  }
  return '';
}

async function decide(view, approvalId, decision) {
  const data = await api('/api/approvals').catch(() => null);
  const a = data?.approvals?.find((x) => x.id === approvalId);
  if (!a) { toast('Approval not found. Refresh the inbox.', { tone: 'seal' }); return; }
  const isApprove = decision === 'approve';
  const { confirmed, note } = await confirmAction({
    title: `${isApprove ? 'Approve' : 'Reject'} · ${a.title}`,
    body: `<p class="small muted" style="margin:0 0 10px">${esc(a.detail || '')}</p>
      ${a.type === 'payment_send' ? `<div class="callout callout-warn">${icon('alertTriangle', 16)}<div><b>Simulated send.</b> No external message leaves this machine. The action is recorded in the outbox and audit chain.</div></div>` : ''}
      ${a.type === 'verification_review' ? `<div class="callout callout-danger">${icon('shield', 16)}<div>Approving acknowledges a binding verifier failure. It does not turn the run into a pass.</div></div>` : ''}
      ${a.type === 'release_candidate' ? `<div class="callout callout-info">${icon('flask', 16)}<div>Approval endorses an offline release candidate. It does not mutate production policy, prompts or permissions.</div></div>` : ''}
      <div class="tiny dim" style="margin-top:10px">Gate <span class="mono">${esc(a.id)}</span>${a.idempotency_key ? ` · <span class="mono">${esc(a.idempotency_key)}</span>` : ''}</div>`,
    confirmLabel: isApprove ? 'Approve gate' : 'Reject gate',
    tone: isApprove ? 'jade' : 'danger',
    note: true,
    noteLabel: isApprove ? 'Approval note (optional)' : 'Reason for rejection'
  });
  if (!confirmed) return;
  try {
    const res = await api(`/api/approvals/${encodeURIComponent(approvalId)}/decision`, { method: 'POST', body: { decision, note } });
    const result = res?.result || {};
    toast(result.simulated ? `Approved. Simulated send recorded for <b>${esc(result.invoice_id)}</b>.` : result.status === 'approved' ? 'Approved and recorded.' : isApprove ? 'Gate approved.' : 'Gate rejected.', { tone: isApprove ? 'jade' : 'gold', title: 'Decision recorded' });
    await renderApprovals(view);
    refreshChrome();
  } catch (e) {
    toast(esc(e.message), { tone: 'seal', title: 'Decision failed' });
  }
}

/* ══ Audit ══════════════════════════════════════════════════════════════ */

export async function renderAudit(view) {
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/audit?limit=250'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Audit trail', title: 'The chain of record.' })}${statusBanner('fail', 'Audit unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  let events = data.events || [];
  let chain = data.chain || { valid: false, checked: 0 };
  let query = '';

  view.innerHTML = `${pageHead({
    eyebrow: 'Audit trail',
    title: 'The chain of record.',
    sub: 'Every consequential action is appended with its actor, object and previous hash. The chain is independently recomputable; approval is not a substitute for integrity.',
    actions: `<button class="btn btn-ghost" data-audit-export>${icon('download', 15)} Export JSON</button><button class="btn btn-primary" data-audit-verify>${icon('shield', 15)} Verify chain</button>`
  })}
  <div id="chainBanner" style="margin-bottom:14px">${chainBanner(chain)}</div>
  <div class="filter-bar"><div class="search-field">${icon('search', 15)}<input class="input" id="auditSearch" placeholder="Filter by actor, action, object or tenant…" autocomplete="off" /></div><span class="chip muted" id="auditCount">${events.length} events</span></div>
  <div id="auditTable"></div>`;

  const wrap = document.getElementById('auditTable');
  const count = document.getElementById('auditCount');
  function paint() {
    const q = query.trim().toLowerCase();
    const rows = events.filter((e) => !q || `${e.actor} ${e.action} ${e.object_type} ${e.object_id} ${e.tenant} ${JSON.stringify(e.detail)}`.toLowerCase().includes(q));
    count.textContent = `${rows.length} event${rows.length === 1 ? '' : 's'}`;
    wrap.innerHTML = rows.length ? `<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th>Seq</th><th>Time</th><th>Actor</th><th>Action</th><th>Object</th><th>Hash</th><th></th></tr></thead><tbody>
      ${rows.map((e) => `<tr><td class="num mono tiny">${esc(e.seq)}</td><td class="small muted nowrap">${esc(fmtDate(e.created_at))}</td><td class="small">${esc(e.actor)}</td><td class="small strong">${esc(humanize(e.action))}</td><td class="small"><span class="mono tiny">${esc(e.object_type || '')}</span><br><span class="tiny dim">${esc(e.object_id || '')}</span></td><td class="mono tiny dim">${esc(shortHash(e.hash, 12))}</td><td class="actions"><details><summary class="tiny dim" style="cursor:pointer">Detail</summary><pre class="json-block" style="min-width:260px;max-width:460px">${esc(JSON.stringify({ tenant: e.tenant, detail: e.detail, prev_hash: e.prev_hash }, null, 2))}</pre></details></td></tr>`).join('')}
    </tbody></table></div>` : emptyState('No events match', 'Clear the filter to see the full chain.', 'link');
  }
  document.getElementById('auditSearch')?.addEventListener('input', debounce((e) => { query = e.target.value; paint(); }, 160));
  view.querySelector('[data-audit-verify]')?.addEventListener('click', async () => {
    try {
      chain = await api('/api/audit/verify');
      document.getElementById('chainBanner').innerHTML = chainBanner(chain);
      toast(chain.valid ? `Chain valid across ${chain.checked} events.` : `Chain broken at sequence ${chain.brokenAt}.`, { tone: chain.valid ? 'jade' : 'seal', title: chain.valid ? 'Integrity verified' : 'Integrity failure' });
    } catch (e) { toast(esc(e.message), { tone: 'seal' }); }
  });
  view.querySelector('[data-audit-export]')?.addEventListener('click', () => downloadJson(`laya-audit-${new Date().toISOString().slice(0, 10)}.json`, { chain, events }));
  paint();
}

function chainBanner(chain) {
  if (chain.valid) {
    return statusBanner('pass', `Audit chain valid · ${chain.checked} events`, `Head <span class="mono tiny">${esc(chain.head || '—')}</span>. Every previous-hash link and record hash recomputed successfully.`, 'shield');
  }
  return statusBanner('fail', 'Audit chain broken', `The first broken link is sequence <b>${esc(chain.brokenAt ?? 'unknown')}</b>. Treat downstream records as suspect until investigated.`, 'xCircle');
}

/* ══ Memory ═════════════════════════════════════════════════════════════ */

let memoryTab = 'all';

export async function renderMemory(view) {
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/memories'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Memory', title: 'Learning without leaking authority.' })}${statusBanner('fail', 'Memory unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const memories = data.memories || [];
  const tabs = [
    ['all', `All (${memories.length})`],
    ['pending', `Candidate (${memories.filter((m) => m.status === 'pending').length})`],
    ['approved', `Approved (${memories.filter((m) => m.status === 'approved').length})`],
    ['expired', `Expired (${memories.filter((m) => m.status === 'expired' || m.expired).length})`],
    ['rejected', 'Rejected']
  ];

  view.innerHTML = `${pageHead({
    eyebrow: 'Memory',
    title: 'Learn, but never self-authorise.',
    sub: 'Candidate memory is scoped, expiring and unpublished. It becomes evidence only after a knowledge owner approves it. Memory can inform a future prompt; it cannot override policy or grant a permission.',
    actions: `<button class="btn btn-ghost" data-nav="/knowledge">${icon('layers', 15)} Knowledge base</button><button class="btn btn-ghost" data-refresh-memory>${icon('refresh', 15)} Refresh</button>`
  })}
  <div class="filter-bar"><div class="tabs" id="memoryTabs">${tabs.map(([id, label]) => `<button class="tab ${id === memoryTab ? 'active' : ''}" data-memory-tab="${id}">${esc(label)}</button>`).join('')}</div><span class="chip jade">${memories.filter((m) => m.status === 'approved').length} in corpus</span></div>
  <div id="memoryList"></div>`;

  const list = document.getElementById('memoryList');
  function paint() {
    const rows = memories.filter((m) => memoryTab === 'all' || (memoryTab === 'expired' ? m.status === 'expired' || m.expired : m.status === memoryTab));
    list.innerHTML = rows.length ? `<div class="grid cols-2">${rows.map(memoryCard).join('')}</div>` : emptyState(
      memoryTab === 'pending' ? 'No candidate memory' : 'No memory in this state',
      'Memory candidates are produced after a verified business run. Nothing is published automatically.',
      'spark'
    );
    list.querySelectorAll('[data-memory-decision]').forEach((b) => b.addEventListener('click', () => reviewMemory(view, b.dataset.memoryId, b.dataset.memoryDecision)));
  }
  document.getElementById('memoryTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-memory-tab]');
    if (!b) return;
    memoryTab = b.dataset.memoryTab;
    document.querySelectorAll('[data-memory-tab]').forEach((x) => x.classList.toggle('active', x === b));
    paint();
  });
  view.querySelector('[data-refresh-memory]')?.addEventListener('click', () => renderMemory(view));
  paint();
}

function memoryCard(m) {
  const pending = m.status === 'pending';
  const allowed = can('approve:memory');
  const note = m.note || {};
  return panel({
    id: `memory:${m.id}`, title: m.title, subtitle: `${m.id} · ${m.scope} · ${m.authority}`, iconName: 'spark', tone: pending ? 'gold' : 'jade',
    actions: statusChip(m.expired ? 'expired' : m.status),
    body: `<p class="small" style="margin:0 0 10px;color:var(--text-soft)">${esc(m.statement)}</p>
      <div class="row" style="margin-bottom:9px"><span class="chip muted">source: ${esc(m.source)}</span>${m.run_id ? `<button class="btn btn-sm btn-ghost" data-nav="/runs/${attr(m.run_id)}">${icon('arrowUpRight', 12)} Source run</button>` : ''}</div>
      <div class="row"><span class="tiny dim">Confidence</span><div class="progress" style="flex:1;min-width:70px"><i style="width:${Math.max(0, Math.min(100, Number(m.confidence || 0) * 100))}%"></i></div><span class="mono tiny">${Math.round(Number(m.confidence || 0) * 100)}%</span></div>
      <div class="kv" style="margin-top:10px"><dt>Created</dt><dd>${esc(fmtDate(m.created_at))}</dd><dt>Expires</dt><dd>${esc(m.expires_at ? fmtDate(m.expires_at) : '—')}</dd><dt>Created by</dt><dd>${esc(m.created_by || '—')}</dd>${m.reviewed_by ? `<dt>Reviewed by</dt><dd>${esc(m.reviewed_by)}</dd>` : ''}</div>
      ${note.conflicts?.length ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 15)}<div>${note.conflicts.map((c) => esc(typeof c === 'string' ? c : JSON.stringify(c))).join(' ')}</div></div>` : ''}
      ${pending ? `<div class="row" style="margin-top:11px"><button class="btn btn-sm btn-jade" data-memory-id="${attr(m.id)}" data-memory-decision="approve" ${allowed ? '' : 'disabled'}>${icon('check', 13)} Publish</button><button class="btn btn-sm btn-danger" data-memory-id="${attr(m.id)}" data-memory-decision="reject" ${allowed ? '' : 'disabled'}>${icon('x', 13)} Reject</button>${allowed ? '' : '<span class="tiny dim">Knowledge owner only.</span>'}</div>` : ''}
      <div class="tiny dim" style="margin-top:10px">${pending ? 'Candidate: not evidence. It cannot be retrieved by A2 until published.' : `Authority: ${esc(m.authority)}.`}</div>`
  });
}

async function reviewMemory(view, id, decision) {
  const { confirmed, note } = await confirmAction({
    title: `${decision === 'approve' ? 'Publish' : 'Reject'} candidate memory`,
    body: `<p class="small muted" style="margin:0">${decision === 'approve' ? 'Publishing adds this lesson to the approved corpus with its scope and expiry. It still cannot override a policy rule.' : 'Rejecting keeps the lesson out of the retrievable corpus. The decision is audited.'}</p>`,
    confirmLabel: decision === 'approve' ? 'Publish memory' : 'Reject memory',
    tone: decision === 'approve' ? 'jade' : 'danger',
    note: true,
    noteLabel: 'Review note (recommended)'
  });
  if (!confirmed) return;
  try {
    await api(`/api/memories/${encodeURIComponent(id)}/review`, { method: 'POST', body: { decision, note } });
    toast(decision === 'approve' ? 'Memory published to the approved corpus.' : 'Memory rejected and recorded.', { tone: decision === 'approve' ? 'jade' : 'gold' });
    await renderMemory(view);
    refreshChrome();
  } catch (e) { toast(esc(e.message), { tone: 'seal' }); }
}

/* ══ Knowledge ══════════════════════════════════════════════════════════ */

export async function renderKnowledge(view) {
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/knowledge'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Knowledge base', title: 'Evidence, versioned.' })}${statusBanner('fail', 'Knowledge unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const docs = data.docs || [];
  const conflicts = data.conflicts || [];
  const stats = data.stats || {};
  const thresholds = data.thresholds || {};
  let lastSearch = null;

  view.innerHTML = `${pageHead({
    eyebrow: 'Knowledge base',
    title: 'Evidence, versioned.',
    sub: `${stats.docs ?? docs.length} active documents · ${stats.chunks ?? '—'} indexed chunks · ${stats.memories ?? 0} memories. Retrieval uses BM25 over approved text; every answer must cite a document and version.`,
    actions: `<button class="btn btn-ghost" data-nav="/memory">${icon('spark', 15)} Memory</button><button class="btn btn-ghost" data-refresh-knowledge>${icon('refresh', 15)} Refresh</button>`
  })}
  ${conflicts.length ? `<div class="callout callout-warn" style="margin-bottom:16px">${icon('alertTriangle', 18)}<div><b>${conflicts.length} unresolved rule conflict${conflicts.length === 1 ? '' : 's'} visible.</b> ${conflicts.map((c) => `${esc(c.key)}: ${c.sources.map((s) => `${esc(s.doc_id)} v${esc(s.version)} says <b>${esc(s.value)}</b>`).join(' vs ')} → conservative <b>${esc(c.applied)}</b> applied.`).join('<br>')}</div></div>` : ''}

  <div class="grid cols-2" style="margin-bottom:16px">
    ${panel({
      id: 'knowledge:search', title: 'Search approved knowledge', subtitle: 'BM25 retrieval with document versions', iconName: 'search', tone: 'jade',
      body: `<form id="knowledgeSearchForm"><div class="field"><label for="knowledgeQuery">Question</label><textarea class="textarea" id="knowledgeQuery" placeholder="What does the audited-accounts rule require for a RM 600,000 request?">What does the audited-accounts rule require for a RM 600,000 request?</textarea></div><button class="btn btn-primary" type="submit" style="margin-top:9px">${icon('search', 15)} Retrieve evidence</button></form><div id="knowledgeResults" style="margin-top:12px"></div>`
    })}
    ${panel({
      id: 'knowledge:thresholds', title: 'Binding thresholds', subtitle: 'Conservative values after conflict resolution', iconName: 'sliders', tone: 'gold',
      body: `<div class="table-wrap" style="border:0"><table class="table" style="min-width:0"><thead><tr><th>Rule</th><th class="num">Applied</th></tr></thead><tbody>
        ${Object.entries(thresholds.cradle || {}).map(([k, v]) => `<tr><td class="small">${esc(humanize(k))}</td><td class="num mono">${esc(typeof v === 'number' && k.includes('myr') ? money(v) : v)}</td></tr>`).join('')}
        ${Object.entries(thresholds.payment || {}).map(([k, v]) => `<tr><td class="small">${esc(humanize(k))}</td><td class="num mono">${esc(typeof v === 'number' && k.includes('myr') ? money(v) : v)}</td></tr>`).join('')}
      </tbody></table></div>`
    })}
  </div>

  <div class="between" style="margin-bottom:10px"><h2 style="font-size:16px;margin:0">Active documents</h2><span class="chip muted">${docs.length} documents</span></div>
  <div class="grid cols-3" id="knowledgeDocs"></div>`;

  const grid = document.getElementById('knowledgeDocs');
  grid.innerHTML = docs.map((d) => panel({
    id: `knowledge:${d.id}`, title: d.title, subtitle: `${d.id} · v${d.version} · ${d.owner}`, iconName: 'file', tone: d.authority?.toLowerCase().includes('policy') ? 'seal' : 'jade',
    actions: `<button class="btn btn-sm btn-ghost" data-doc-open="${attr(d.id)}">Read ${icon('arrowUpRight', 12)}</button>`,
    body: `<div class="chip-row" style="margin-bottom:8px"><span class="chip ${d.authority?.toLowerCase().includes('policy') ? 'seal' : 'muted'}">${esc(d.authority)}</span><span class="chip muted">${esc(d.classification || 'internal')}</span>${d.conflicts?.length ? `<span class="chip red">${d.conflicts.length} conflict</span>` : ''}</div>
      <div class="kv" style="font-size:11px"><dt>Effective</dt><dd>${esc(d.effective_at || '—')}</dd><dt>Review</dt><dd>${esc(d.review_at || '—')}</dd><dt>Source</dt><dd>${esc(d.source || '—')}</dd><dt>Size</dt><dd>${Number(d.char_count || 0).toLocaleString('en-MY')} chars</dd></div>
      <div class="mono tiny dim" style="margin-top:8px" title="${attr(d.hash)}">${esc(shortHash(d.hash, 18))}</div>`
  })).join('');

  grid.querySelectorAll('[data-doc-open]').forEach((b) => b.addEventListener('click', () => openDoc(b.dataset.docOpen)));

  const form = document.getElementById('knowledgeSearchForm');
  const results = document.getElementById('knowledgeResults');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = document.getElementById('knowledgeQuery').value.trim();
    if (!q) return;
    results.innerHTML = `<div class="muted small">Retrieving…</div>`;
    try {
      lastSearch = await api(`/api/knowledge/search?q=${encodeURIComponent(q)}`);
      results.innerHTML = lastSearch.items?.length ? `<div class="tiny dim" style="margin-bottom:8px">${lastSearch.count} evidence ref(s) · query: ${esc(q)}</div>${lastSearch.items.map((it) => `<div class="evidence-item"><div class="evidence-head"><span class="ev-ref">${esc(it.ref)}</span><span class="evidence-title">${esc(it.title)}</span><span class="evidence-version">${esc(it.doc_id)} v${esc(it.version)}</span></div><p class="evidence-quote" style="display:block">${esc(it.quote)}</p></div>`).join('')}` : `<div class="callout callout-warn">${icon('alertTriangle', 15)}<div>No approved chunk matched. The correct answer may be “not answerable from the corpus”.</div></div>`;
    } catch (err) { results.innerHTML = `<div class="callout callout-danger">${icon('xCircle', 15)}<div>${esc(err.message)}</div></div>`; }
  });

  view.querySelector('[data-refresh-knowledge]')?.addEventListener('click', () => renderKnowledge(view));
}

async function openDoc(id) {
  try {
    const d = await api(`/api/knowledge/${encodeURIComponent(id)}`);
    const modal = openModal({
      title: d.title,
      subtitle: `${d.id} · version ${d.version} · ${d.authority} · effective ${d.effective_at || '—'}`,
      wide: true,
      body: `<div class="callout callout-info" style="margin-bottom:12px">${icon('file', 16)}<div><b>${esc(d.owner || 'Owner')}</b> · ${esc(d.classification || 'internal')} · hash <span class="mono tiny">${esc(d.hash)}</span></div></div><div class="skill-doc">${miniMarkdown(d.body || '')}</div>`,
      actions: `<button class="btn btn-ghost" data-close-modal>Close</button><button class="btn btn-primary" data-copy-doc>${icon('copy', 15)} Copy document</button>`
    });
    modal.querySelector('[data-copy-doc]')?.addEventListener('click', () => copyText(d.body || '', 'Document copied.'));
  } catch (e) { toast(esc(e.message), { tone: 'seal' }); }
}

/* ══ Security ═══════════════════════════════════════════════════════════ */

export async function renderSecurity(view) {
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/security'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Security', title: 'Treat retrieved text as data.' })}${statusBanner('fail', 'Security console unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const events = data.events || [];
  const corpus = data.corpus || [];
  const counts = data.counts || {};

  view.innerHTML = `${pageHead({
    eyebrow: 'Security',
    title: 'Treat retrieved text as data.',
    sub: 'The trust-boundary screen is deterministic. A model may add a second opinion, but it cannot clear a BLOCK. Retrieved documents and tool output are fenced and never promoted to instructions.',
    actions: `<button class="btn btn-ghost" data-nav="/audit">${icon('link', 15)} Audit trail</button><button class="btn btn-ghost" data-refresh-security>${icon('refresh', 15)} Refresh</button>`
  })}
  <div class="grid cols-3" style="margin-bottom:16px">
    <div class="kpi"><div class="kpi-label">Events retained</div><div class="kpi-value">${counts.total ?? events.length}</div><div class="kpi-foot">screened inputs</div></div>
    <div class="kpi gold"><div class="kpi-label">Blocked</div><div class="kpi-value">${counts.blocked ?? 0}</div><div class="kpi-foot">no model call, no run</div></div>
    <div class="kpi jade"><div class="kpi-label">Flagged</div><div class="kpi-value">${counts.flagged ?? 0}</div><div class="kpi-foot">allowed with a recorded signal</div></div>
  </div>
  <div class="grid cols-2">
    ${panel({
      id: 'security:screen', title: 'Screen a test input', subtitle: 'Deterministic signals, no model call', iconName: 'shield', tone: 'seal',
      body: `<div class="field"><label for="screenText">Input text</label><textarea class="textarea" id="screenText" placeholder="Paste text to screen…"></textarea></div><button class="btn btn-primary" id="screenBtn" style="margin-top:9px">${icon('shield', 15)} Screen input</button><div id="screenResult" style="margin-top:12px"></div>
        <div class="divider"></div><div class="tiny dim" style="margin-bottom:6px">Test corpus</div><div class="chip-row">${corpus.map((c, i) => `<button class="chip muted" data-corpus="${i}" style="cursor:pointer;text-align:left">${esc(truncate(c, 62))}</button>`).join('')}</div>`
    })}
    ${panel({
      id: 'security:boundary', title: 'Trust boundary', subtitle: 'Where the architecture refuses to be helpful', iconName: 'lock', tone: 'gold',
      body: `<ul class="list-reset">
        <li><b>Retrieved text is data.</b> Evidence is wrapped in a fenced block; instructions inside it do not become system instructions.</li>
        <li><b>Deterministic BLOCK wins.</b> A model cannot clear a block or lower the risk grade.</li>
        <li><b>Tools are declarations.</b> Listing a tool does not grant the model permission; the server checks the actor and role.</li>
        <li><b>Secrets stay server-side.</b> Provider keys are never returned to the browser.</li>
        <li><b>Cross-tenant reads fail closed.</b> The session tenant and the object tenant are both checked.</li>
      </ul>`
    })}
  </div>
  <div style="margin-top:16px">${panel({
    id: 'security:events', title: 'Security events', subtitle: 'Blocked and flagged inputs', iconName: 'activity', tone: '',
    body: events.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Kind</th><th>Actor</th><th>Route</th><th>Signals</th><th>Decision</th></tr></thead><tbody>${events.map((ev) => `<tr><td class="small muted nowrap">${esc(fmtDate(ev.created_at))}</td><td class="small">${esc(humanize(ev.kind))}</td><td class="small">${esc(ev.actor)}</td><td class="mono tiny dim">${esc(ev.route)}</td><td class="tiny">${(ev.detail?.signals || []).map((s) => `<span class="chip muted" style="margin:1px">${esc(s.label || s.id || s)}</span>`).join('') || '<span class="dim">—</span>'}</td><td>${ev.blocked ? '<span class="chip red">blocked</span>' : '<span class="chip gold">flagged</span>'}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No security events', 'Blocked or flagged inputs will appear here with their deterministic signals.', 'shield')
  })}</div>`;

  const textarea = document.getElementById('screenText');
  document.querySelectorAll('[data-corpus]').forEach((b) => b.addEventListener('click', () => { textarea.value = corpus[Number(b.dataset.corpus)] || ''; textarea.focus(); }));
  document.getElementById('screenBtn')?.addEventListener('click', async () => {
    const text = textarea.value.trim();
    const result = document.getElementById('screenResult');
    if (!text) { toast('Enter text to screen.', { tone: 'gold' }); return; }
    result.innerHTML = '<div class="muted small">Screening…</div>';
    try {
      const r = await api('/api/security/screen', { method: 'POST', body: { text } });
      result.innerHTML = `<div class="status-banner ${r.decision === 'BLOCK' ? 'fail' : r.decision === 'FLAG' ? 'warn' : 'pass'}"><div class="status-icon ${r.decision === 'BLOCK' ? 'fail' : r.decision === 'FLAG' ? 'warn' : 'pass'}">${icon(r.decision === 'BLOCK' ? 'xCircle' : r.decision === 'FLAG' ? 'alertTriangle' : 'checkCircle', 18)}</div><div><h3>${esc(r.decision)} · score ${esc(r.score)}</h3><p>${(r.signals || []).length ? r.signals.map((s) => esc(s.label || s.id || s)).join(' · ') : 'No deterministic signal matched.'}</p></div></div>`;
    } catch (e) { result.innerHTML = `<div class="callout callout-danger">${icon('xCircle', 15)}<div>${esc(e.message)}</div></div>`; }
  });
  view.querySelector('[data-refresh-security]')?.addEventListener('click', () => renderSecurity(view));
}

/* ── Skeleton ─────────────────────────────────────────────────────────── */

function skeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:130px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(460px,72vw)"></div><div class="skeleton" style="height:12px;width:min(680px,84vw);margin-top:12px"></div></div></div>
  <div class="grid cols-2">${Array.from({ length: 4 }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:40%;margin-bottom:10px"></div><div class="skeleton" style="height:11px;width:92%;margin-bottom:8px"></div><div class="skeleton" style="height:11px;width:70%;margin-bottom:14px"></div><div class="skeleton" style="height:54px"></div></div></div>`).join('')}</div>`;
}

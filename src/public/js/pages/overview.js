/* Operating overview: live counts, runs, gates, risk and audit tail. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusChip, riskChip, agentLabel,
  fmtDate, relTime, money, pct, sparkline, barRow, emptyState, statusBanner, navigate,
  humanize, tenantLabel
} from '../core.js';

const PROCESS_LABEL = {
  cradle_fund: 'Cradle assessment',
  partnerflow_audit: 'Control audit',
  payment_followup: 'Payment follow-up',
  cmo_trend: 'CMO trend',
  knowledge_query: 'Knowledge query',
  direct: 'Direct agent'
};

export async function render(view) {
  view.innerHTML = skeleton();
  const q = state.tenant ? `?tenant=${encodeURIComponent(state.tenant)}` : '';
  let ov, ds;
  try {
    [ov, ds] = await Promise.all([api(`/api/overview${q}`), api('/api/datasets')]);
  } catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Workspace overview', title: 'The operating picture.' })}
      ${statusBanner('fail', 'Overview unavailable', esc(e.message), 'xCircle')}`;
    return;
  }

  const c = ov.counts || {};
  const runs = ov.recent_runs || [];
  const approvals = ov.pending_approvals || [];
  const processStats = ov.process_stats || [];
  const risks = ov.risk_distribution || [];
  const audit = ov.audit_tail || [];
  const trend = ds.trend || {};
  const measured = trend.measured || [];
  const daily = trend.daily || [];

  const kpis = [
    { label: 'Runs this workspace', value: c.runs ?? 0, foot: `${c.completed ?? 0} completed · ${c.needs_attention ?? 0} need attention`, tone: '' },
    { label: 'Human gates waiting', value: c.awaiting_approval ?? 0, foot: c.awaiting_approval ? 'A payment or decision is held' : 'No approval is pending', tone: 'gold' },
    { label: 'Evidence documents', value: c.knowledge_docs ?? 0, foot: `${c.audit_events ?? 0} audit events · ${c.security_blocks ?? 0} blocked inputs`, tone: 'jade' },
    { label: 'Average AI latency', value: c.avg_ai_latency_ms ? `${(c.avg_ai_latency_ms / 1000).toFixed(1)}s` : '—', foot: `${c.ai_calls ?? 0} model calls · local inference`, tone: 'jade' }
  ];

  const recentRows = runs.length
    ? runs.map((r) => `<tr data-nav="/runs/${attr(r.id)}" style="cursor:pointer">
        <td><span class="mono tiny dim">${esc(r.id.replace(/^run_/, '').slice(0, 12))}</span><div class="small strong" style="margin-top:2px">${esc(r.title || PROCESS_LABEL[r.process] || r.process)}</div></td>
        <td>${statusChip(r.status)}</td>
        <td>${riskChip(r.risk)}</td>
        <td class="small muted nowrap">${esc(relTime(r.created_at))}</td>
        <td class="actions">${icon('chevronRight', 15)}</td>
      </tr>`).join('')
    : '';

  const processBars = processStats.length
    ? processStats.map((p) => {
      const max = Math.max(...processStats.map((x) => x.runs), 1);
      return `<div style="margin-bottom:10px">
        <div class="between" style="margin-bottom:4px"><span class="small">${esc(PROCESS_LABEL[p.process] || humanize(p.process))}</span><span class="mono tiny dim">${p.runs} run${p.runs === 1 ? '' : 's'}${p.attention ? ` · <span class="severity-high">${p.attention} attention</span>` : ''}</span></div>
        ${barRow('', p.runs, max, { tone: p.attention ? '' : 'jade' })}
      </div>`;
    }).join('')
    : emptyState('No runs yet', 'Launch a process to see how the pipeline behaves.', 'pulse', `<button class="btn btn-primary btn-sm" data-nav="/processes">${icon('play', 13)} Open process studio</button>`);

  const approvalCards = approvals.length
    ? approvals.map((a) => `<div class="finding" style="margin-bottom:7px">
        <div class="finding-head"><div><div class="finding-title">${esc(a.title)}</div><div class="tiny dim">${esc(humanize(a.type))} · ${esc(a.tenant)}</div></div>${riskChip(a.risk)}</div>
        <div class="finding-body">${esc(a.detail || '')}</div>
        <div class="row" style="margin-top:8px"><button class="btn btn-sm btn-ghost" data-nav="/approvals">${icon('stamp', 13)} Review gate</button>${a.run_id ? `<button class="btn btn-sm btn-ghost" data-nav="/runs/${attr(a.run_id)}">${icon('arrowUpRight', 13)} Open run</button>` : ''}</div>
      </div>`).join('')
    : emptyState('No gates waiting', 'Payment reminders, assessments, memory publication and verification reviews appear here.', 'stamp');

  const riskBars = risks.length
    ? risks.map((r) => barRow(humanize(r.risk), r.c, Math.max(...risks.map((x) => x.c), 1), { tone: r.risk === 'low' ? 'jade' : '' })).join('')
    : '<div class="muted small">No risk data yet.</div>';

  const auditRows = audit.length
    ? audit.map((a) => {
      let detail = a.detail;
      if (typeof detail === 'string') { try { detail = JSON.parse(detail); } catch { detail = {}; } }
      return `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <div class="between"><span class="small strong">${esc(humanize(a.action))}</span><span class="mono tiny dim">#${a.seq}</span></div>
        <div class="tiny dim">${esc(a.actor)} · ${esc(a.object_type || 'object')} ${esc(a.object_id || '')} · ${esc(relTime(a.created_at))}</div>
      </div>`;
    }).join('')
    : '<div class="muted small">The audit chain is empty.</div>';

  const measuredRows = measured.length
    ? measured.map((m) => {
      const delta = m.delta_pct !== undefined && m.delta_pct !== null ? `${m.delta_pct > 0 ? '+' : ''}${m.delta_pct}%` : m.delta_pts !== undefined ? `${m.delta_pts > 0 ? '+' : ''}${m.delta_pts} pts` : '—';
      const good = m.metric === 'conversion_pct' ? (m.delta_pts || 0) >= 0 : (m.delta_pct || 0) >= 0;
      return `<tr><td>${esc(humanize(m.metric))}</td><td class="num">${m.metric === 'revenue_myr' ? esc(money(m.current)) : m.metric === 'conversion_pct' ? esc(pct(m.current)) : Number(m.current).toLocaleString('en-MY')}</td><td class="num"><span class="chip ${good ? 'jade' : 'red'}">${esc(delta)}</span></td></tr>`;
    }).join('')
    : '';

  view.innerHTML = `
    ${pageHead({
      eyebrow: 'Workspace overview',
      title: 'The operating picture.',
      sub: `${esc(tenantLabel(state.tenants.find((t) => t.id === state.tenant)))} · ${esc(ov.dataset_label || ds.label)}`,
      actions: `<button class="btn btn-ghost" data-refresh-overview>${icon('refresh', 15)} Refresh</button><button class="btn btn-ghost" data-nav="/runs">${icon('pulse', 15)} All runs</button><button class="btn btn-primary" data-nav="/processes">${icon('play', 15)} Launch process</button>`
    })}

    <div class="grid cols-4" style="margin-bottom:16px">
      ${kpis.map((k) => `<div class="kpi ${k.tone}"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div><div class="kpi-foot">${k.foot}</div></div>`).join('')}
    </div>

    ${ov.counts?.needs_attention ? `<div class="callout callout-warn" style="margin-bottom:16px">${icon('alertTriangle', 17)}<div><b>${ov.counts.needs_attention} run${ov.counts.needs_attention === 1 ? '' : 's'} need attention.</b> A deterministic verifier failure or a policy block is waiting for a human review. <button class="btn btn-sm btn-ghost" data-nav="/runs?status=needs_review" style="margin-left:8px">Open queue</button></div></div>` : ''}

    <div class="split">
      <div class="stack">
        ${panel({
          id: 'overview:recent', title: 'Recent decisions', subtitle: 'Newest runs across the active workspace', iconName: 'pulse', tone: '',
          actions: `<button class="btn btn-sm btn-ghost" data-nav="/runs">View all ${icon('arrowRight', 13)}</button>`,
          body: runs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Run</th><th>Status</th><th>Risk</th><th>Created</th><th></th></tr></thead><tbody>${recentRows}</tbody></table></div>` : emptyState('No runs yet', 'Start with a Cradle assessment, a payment reconciliation or a knowledge question.', 'play', `<button class="btn btn-primary btn-sm" data-nav="/processes">${icon('play', 13)} Launch a process</button>`)
        })}

        <div class="grid cols-2">
          ${panel({
            id: 'overview:process', title: 'Process health', subtitle: 'Volume and attention by process', iconName: 'workflow', tone: 'jade',
            body: processBars
          })}
          ${panel({
            id: 'overview:risk', title: 'Risk distribution', subtitle: 'Policy-graded run risk', iconName: 'shield', tone: 'gold',
            body: `<div class="stack">${riskBars}</div><div class="divider"></div><div class="tiny dim">Risk is assigned by the deterministic policy engine; Laya may add context but cannot lower a policy risk.</div>`
          })}
        </div>

        ${panel({
          id: 'overview:trend', title: '30-day demand movement', subtitle: 'Seeded CMO dataset · measured, not forecast', iconName: 'activity', tone: 'jade',
          actions: `<button class="btn btn-sm btn-ghost" data-nav="/processes/cmo_trend">${icon('play', 13)} Run trend</button>`,
          body: daily.length ? `<div class="grid" style="grid-template-columns:1.1fr 1fr;gap:16px;align-items:center">
            <div><div class="between"><span class="mono tiny dim">QUALIFIED LEADS · LAST 30 DAYS</span><span class="chip jade">${Number(trend.current?.totals?.leads || 0).toLocaleString('en-MY')}</span></div>${sparkline(daily.map((d) => d.leads), { tone: 'jade' })}<div class="tiny dim" style="margin-top:4px">${esc(trend.window?.current_start || '')} → ${esc(trend.window?.current_end || '')} · freshness ${esc(trend.freshness || '—')}</div></div>
            <div class="table-wrap" style="border:0"><table class="table" style="min-width:0"><thead><tr><th>Metric</th><th class="num">Current</th><th class="num">Δ vs prior</th></tr></thead><tbody>${measuredRows}</tbody></table></div>
          </div><div class="callout callout-info" style="margin-top:12px">${icon('info', 16)}<div>${esc((trend.limitations || []).join(' '))}</div></div>` : emptyState('No trend data', 'The seeded metrics window is unavailable.', 'activity')
        })}
      </div>

      <div class="stack">
        ${panel({
          id: 'overview:gates', title: 'Human gates', subtitle: `${approvals.length} pending in this workspace`, iconName: 'stamp', tone: 'gold',
          actions: `<button class="btn btn-sm btn-ghost" data-nav="/approvals">Inbox ${icon('arrowRight', 13)}</button>`,
          body: approvalCards
        })}

        ${panel({
          id: 'overview:audit', title: 'Audit tail', subtitle: 'Hash-chained events', iconName: 'link', tone: '',
          actions: `<button class="btn btn-sm btn-ghost" data-nav="/audit">Open trail ${icon('arrowRight', 13)}</button>`,
          body: `<div>${auditRows}</div>`
        })}

        ${panel({
          id: 'overview:ai', title: 'Local AI runtime', subtitle: 'The model is a bounded component, not an authority', iconName: 'cpu', tone: 'jade',
          actions: `<button class="btn btn-sm btn-ghost" data-nav="/settings">Settings ${icon('arrowRight', 13)}</button>`,
          body: `<div class="kv">
            <dt>Provider</dt><dd>${esc(state.ai?.provider || '—')}</dd>
            <dt>Model</dt><dd class="mono">${esc(state.ai?.model || '—')}</dd>
            <dt>Endpoint</dt><dd class="mono tiny">${esc(state.ai?.base_url || '—')}</dd>
            <dt>Status</dt><dd>${state.ai?.available ? '<span class="chip jade">ready</span>' : '<span class="chip red">unreachable</span>'}</dd>
            <dt>Adapter</dt><dd class="tiny">${esc(state.ai?.laya_adapter || '—')}</dd>
            <dt>Latency</dt><dd>${c.avg_ai_latency_ms ? esc(`${(c.avg_ai_latency_ms / 1000).toFixed(1)}s average`) : '—'}</dd>
          </div>
          <div class="callout ${state.ai?.available ? 'callout-jade' : 'callout-danger'}" style="margin-top:12px">${icon(state.ai?.available ? 'checkCircle' : 'alertTriangle', 16)}<div>${esc(state.ai?.detail || 'The provider status is being checked.')}</div></div>
          <div class="tiny dim" style="margin-top:10px">${esc(ov.dataset_label || ds.label)}</div>`
        })}
      </div>
    </div>`;

  view.querySelector('[data-refresh-overview]')?.addEventListener('click', () => render(view));
}

function skeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:150px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(460px,75vw)"></div><div class="skeleton" style="height:12px;width:min(620px,82vw);margin-top:12px"></div></div></div>
  <div class="grid cols-4">${Array.from({ length: 4 }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:10px;width:40%"></div><div class="skeleton" style="height:34px;width:30%;margin:12px 0"></div><div class="skeleton" style="height:10px;width:70%"></div></div></div>`).join('')}</div>
  <div class="split" style="margin-top:16px"><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:30%;margin-bottom:16px"></div>${Array.from({ length: 5 }).map(() => `<div class="skeleton" style="height:38px;margin-bottom:8px"></div>`).join('')}</div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:40%;margin-bottom:16px"></div>${Array.from({ length: 3 }).map(() => `<div class="skeleton" style="height:70px;margin-bottom:8px"></div>`).join('')}</div></div></div>`;
}

/* Process studio: one independently collapsible panel per process. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusChip, riskChip, agentLabel,
  money, humanize, toast, navigate, emptyState, statusBanner, can, fmtDate
} from '../core.js';
import { switchWorkspace } from '../shell.js';

const PROCESSES = [
  {
    id: 'cradle_fund', title: 'Cradle Fund assessment', icon: 'target', tone: 'jade',
    agents: ['A2', 'A3', 'A8', 'A7'],
    description: 'Test a Malaysian startup against the Cradle eligibility rules, retrieve the governing documents, request missing evidence and prepare a reviewer assessment.',
    boundary: 'The deterministic CF-01…CF-08 checks are binding. The assessment cannot approve funding; a programme reviewer must sign off.',
    kind: 'select', inputName: 'application_id', label: 'Application'
  },
  {
    id: 'partnerflow_audit', title: 'PartnerFlow control audit', icon: 'shield', tone: 'gold',
    agents: ['A2', 'A4', 'A8', 'A7'],
    description: 'Replay the claim approval and payment chain, test segregation of duties, amount integrity and duplicate release, then write a findings narrative.',
    boundary: 'A deterministic control failure is binding. The audit cannot alter the ledger or clear a finding; a reviewer must acknowledge it.',
    kind: 'select', inputName: 'case_id', label: 'Audit case'
  },
  {
    id: 'payment_followup', title: 'Payment follow-up', icon: 'file', tone: 'gold',
    agents: ['A2', 'A5', 'A8', 'A7'],
    description: 'Reconcile the invoice, determine the cadence stage, suppress duplicates, then draft the next reminder. Every send is simulated and gated.',
    boundary: 'No draft is produced for a blocked invoice. Every send — regardless of value — requires a human approval and is written to the outbox as simulated.',
    kind: 'select', inputName: 'invoice_id', label: 'Invoice'
  },
  {
    id: 'cmo_trend', title: 'CMO 30-day trend', icon: 'activity', tone: 'violet',
    agents: ['A2', 'A6', 'A8', 'A7'],
    description: 'Measure 30 days against the prior window, flag small samples, identify channel movement and propose one bounded experiment.',
    boundary: 'The seeded dataset is labelled as demonstration data. A small sample cannot be treated as a trend; limitations must be disclosed.',
    kind: 'none'
  },
  {
    id: 'knowledge_query', title: 'Grounded knowledge query', icon: 'book', tone: 'jade',
    agents: ['A2', 'A8'],
    description: 'Ask a policy or operating question. Retrieval is limited to active, versioned documents; the answer must cite its sources and disclose conflicts.',
    boundary: 'The model may say “not answerable”. It cannot invent a policy value. The conflict register remains visible in the response.',
    kind: 'question'
  },
  {
    id: 'direct', title: 'Run one agent directly', icon: 'nodes', tone: 'seal',
    agents: ['A1', 'A2', 'A7', 'A9'],
    description: 'Exercise a single agent contract with evidence and verification. A3–A6 and A8 run through their process so policy context is present.',
    boundary: 'A direct A1 route is advisory. A direct A9 proposal cannot change production without a frozen-suite evaluation and human approval.',
    kind: 'direct'
  }
];

export async function render(view, focus = null) {
  view.innerHTML = skeleton();
  let ds, runsData;
  try {
    [ds, runsData] = await Promise.all([api('/api/datasets'), api('/api/runs?limit=60')]);
  } catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Process studio', title: 'Launch a bounded process.' })}${statusBanner('fail', 'Studio unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const runs = runsData.runs || [];
  const latest = {};
  for (const r of runs) if (!latest[r.process]) latest[r.process] = r;

  const processPanel = (p) => {
    const latestRun = latest[p.id];
    const allowed = p.id === 'knowledge_query' ? can('ask') : can('run');
    let form = '';
    if (p.kind === 'select') {
      const options = p.id === 'cradle_fund' ? (ds.applications || []).map((a) => ({
        value: a.id,
        label: `${a.id} · ${a.applicant} · ${a.assessment}`,
        note: `${a.failed_checks?.length || 0} failed check(s) · ${a.missing_documents?.length || 0} missing document(s)`
      })) : p.id === 'partnerflow_audit' ? (ds.audit_cases || []).map((c) => ({
        value: c.id,
        label: `${c.id} · ${c.claim_id} · ${money(c.amount)}`,
        note: `${c.findings?.length || 0} finding(s) · highest ${c.highest_severity}`
      })) : (ds.invoices || []).map((i) => ({
        value: i.id,
        label: `${i.id} · ${i.customer} · ${money(i.outstanding)}`,
        note: `${i.stage} · ${i.overdue_days} days overdue · ${i.allowed ? 'draft permitted' : 'blocked'}`
      }));
      form = `<form data-process-form="${attr(p.id)}"><div class="form-row"><div class="field"><label for="input-${attr(p.id)}">${esc(p.label)}</label><select class="select" id="input-${attr(p.id)}" name="${attr(p.inputName)}">${options.map((o) => `<option value="${attr(o.value)}">${esc(o.label)}</option>`).join('')}</select><span class="hint">${esc(options[0]?.note || '')}</span></div><div class="field" style="justify-content:flex-end"><label>&nbsp;</label><button class="btn btn-primary" type="submit" ${allowed ? '' : 'disabled'}>${icon('play', 15)} Run process</button></div></div></form>`;
    } else if (p.kind === 'question') {
      form = `<form data-process-form="${attr(p.id)}"><div class="field"><label for="input-${attr(p.id)}">Question</label><textarea class="textarea" id="input-${attr(p.id)}" name="question" placeholder="What does the audited-accounts rule require for a RM 600,000 Cradle request?">What does the audited-accounts rule require for a RM 600,000 Cradle request?</textarea><span class="hint">Answers cite active documents and disclose rule conflicts.</span></div><button class="btn btn-primary" type="submit" style="margin-top:9px" ${allowed ? '' : 'disabled'}>${icon('search', 15)} Ask knowledge</button></form>`;
    } else if (p.kind === 'direct') {
      form = `<form data-process-form="${attr(p.id)}"><div class="form-row"><div class="field"><label for="agent-direct">Agent</label><select class="select" id="agent-direct" name="agent_id"><option value="A1">A1 · Laya (route only)</option><option value="A2">A2 · RAG + Wiki (grounded answer)</option><option value="A7">A7 · Memory (distil a lesson)</option><option value="A9">A9 · Harness² (propose an improvement)</option></select></div><div class="field"><label for="task-direct">Task</label><input class="input" id="task-direct" name="task" placeholder="Describe the bounded task" value="Summarise the evidence boundary for a payment reminder." /></div></div><button class="btn btn-primary" type="submit" style="margin-top:9px" ${allowed ? '' : 'disabled'}>${icon('play', 15)} Run agent</button></form>`;
    } else {
      form = `<form data-process-form="${attr(p.id)}"><div class="callout callout-info" style="margin-bottom:10px">${icon('activity', 16)}<div>Window: <b>${esc(ds.trend?.window?.current_start || '—')}</b> → <b>${esc(ds.trend?.window?.current_end || '—')}</b>. The policy engine measures the window; the model interprets it.</div></div><button class="btn btn-primary" type="submit" ${allowed ? '' : 'disabled'}>${icon('play', 15)} Run 30-day trend</button></form>`;
    }

    return panel({
      id: `process:${p.id}`,
      title: p.title,
      subtitle: p.description,
      iconName: p.icon,
      tone: p.tone,
      actions: latestRun ? `<button class="btn btn-sm btn-ghost" data-nav="/runs/${attr(latestRun.id)}">${statusChip(latestRun.status)} <span class="tiny dim">latest</span></button>` : '',
      body: `<div class="chip-row" style="margin-bottom:10px">${p.agents.map((a) => `<span class="chip ${a === 'A8' ? 'seal' : p.tone}">${esc(agentLabel(a))}</span>`).join('')}<span class="chip muted">${esc(p.id)}</span></div>
        ${form}
        <div class="callout callout-${p.tone === 'gold' ? 'warn' : 'info'}" style="margin-top:12px">${icon(p.tone === 'gold' ? 'alertTriangle' : 'info', 16)}<div><b>Boundary.</b> ${esc(p.boundary)}</div></div>
        ${latestRun ? `<div class="between" style="margin-top:11px"><span class="tiny dim">Last run ${esc(fmtDate(latestRun.created_at))}</span><button class="btn btn-sm btn-ghost" data-nav="/runs/${attr(latestRun.id)}">Open run ${icon('arrowRight', 12)}</button></div>` : ''}`
    });
  };

  view.innerHTML = `${pageHead({
    eyebrow: 'Process studio',
    title: 'Launch a bounded process.',
    sub: 'Each process is a separate panel. Collapse or hide any panel without losing its data; every launch creates a durable run with its own evidence and human gates.',
    actions: `<button class="btn btn-ghost" data-nav="/catalog">${icon('menu', 15)} Function menu</button><button class="btn btn-ghost" data-nav="/runs">${icon('pulse', 15)} All runs</button>`
  })}
  <div class="callout callout-info" style="margin-bottom:16px">${icon('shield', 17)}<div><b>How a run flows.</b> Trust screen → A2 evidence pack → deterministic policy facts → A1 advisory route and risk → specialist AI output → A8 independent verification → A7 candidate memory → human gate. Laya can propose a route; it cannot grant a permission or override a verifier failure.</div></div>

  <div class="grid cols-2">
    ${PROCESSES.map(processPanel).join('')}
  </div>`;

  view.querySelectorAll('[data-process-form]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const process = form.dataset.processForm;
      const btn = form.querySelector('button[type="submit"]');
      const inputs = new FormData(form);
      let payload = {};
      if (process === 'cradle_fund') payload = { application_id: inputs.get('application_id') };
      else if (process === 'partnerflow_audit') payload = { case_id: inputs.get('case_id') };
      else if (process === 'payment_followup') payload = { invoice_id: inputs.get('invoice_id') };
      else if (process === 'knowledge_query') payload = { question: String(inputs.get('question') || '').trim() };
      else if (process === 'direct') payload = { agent_id: inputs.get('agent_id'), task: String(inputs.get('task') || '').trim() };

      btn.disabled = true;
      btn.classList.add('is-loading');
      try {
        const run = await api('/api/runs', { method: 'POST', body: { process, input: payload } });
        if (run.tenant && run.tenant !== state.tenant) {
          await switchWorkspace(run.tenant, { silent: true });
          toast(`Workspace switched to <b>${esc(run.tenant)}</b> for this process.`, { tone: 'gold' });
        }
        toast(`Run <b>${esc(run.id)}</b> created. The pipeline is streaming.`, { tone: 'jade' });
        navigate(`/runs/${run.id}`);
      } catch (err) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        if (err.code === 'INPUT_BLOCKED_BY_SECURITY') {
          toast(`Blocked by the trust-boundary screen: ${esc((err.details?.signals || []).map((s) => s.label || s.id).join(', ') || 'injection signal')}.`, { tone: 'seal', title: 'Input blocked', timeout: 8000 });
        } else {
          toast(esc(err.message), { tone: 'seal', title: 'Could not launch process' });
        }
      }
    });
  });

  if (focus) {
    const el = document.getElementById(`panel-process:${focus}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 180);
  }
}

function skeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:130px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(460px,72vw)"></div><div class="skeleton" style="height:12px;width:min(680px,84vw);margin-top:12px"></div></div></div>
  <div class="grid cols-2">${Array.from({ length: 4 }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:40%;margin-bottom:10px"></div><div class="skeleton" style="height:11px;width:92%;margin-bottom:8px"></div><div class="skeleton" style="height:56px;margin-top:14px"></div><div class="skeleton" style="height:40px;margin-top:10px"></div></div></div>`).join('')}</div>`;
}

/* Harness² evaluations: frozen suite, live probes, release proposals. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusChip, statusBanner, fmtDate,
  emptyState, toast, confirmAction, can, humanize, openModal
} from '../core.js';
import { refreshChrome } from '../shell.js';

let pollTimer = null;

export async function renderEvaluations(view) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/evaluations'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Improvement', title: 'Harness² evaluations.' })}${statusBanner('fail', 'Evaluations unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const cases = data.cases || [];
  const evaluations = data.evaluations || [];
  const running = evaluations.filter((e) => e.status === 'running');
  const lastApproved = data.last_approved;
  const canRun = can('eval:run');
  const canApprove = can('eval:approve');

  view.innerHTML = `${pageHead({
    eyebrow: 'Improvement · A9 Harness²',
    title: 'Improve only what survives the suite.',
    sub: 'The deterministic suite is frozen. A candidate prompt is scored against it and against live model probes. A release proposal needs a ≥2 point improvement, at least one improved live probe and no high-weight regression — and a human harness-owner decision.',
    actions: `<button class="btn btn-ghost" data-nav="/agents">${icon('nodes', 15)} Agent directory</button><button class="btn btn-ghost" data-refresh-evals>${icon('refresh', 15)} Refresh</button>`
  })}

  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="kpi"><div class="kpi-label">Frozen suite</div><div class="kpi-value">${esc(data.suite || 'v1.0')}</div><div class="kpi-foot">${cases.length} deterministic cases</div></div>
    <div class="kpi jade"><div class="kpi-label">Evaluation runs</div><div class="kpi-value">${evaluations.length}</div><div class="kpi-foot">${running.length ? `${running.length} running now` : 'no job running'}</div></div>
    <div class="kpi gold"><div class="kpi-label">Last approved</div><div class="kpi-value" style="font-size:18px">${lastApproved ? esc(lastApproved.release_version || lastApproved.id) : '—'}</div><div class="kpi-foot">${lastApproved ? esc(fmtDate(lastApproved.approved_at)) : 'no release approved'}</div></div>
    <div class="kpi"><div class="kpi-label">Release threshold</div><div class="kpi-value">+2.0</div><div class="kpi-foot">points, plus a live probe</div></div>
  </div>

  <div class="split">
    <div class="stack">
      ${panel({
        id: 'evals:run', title: 'Run a candidate', subtitle: 'Baseline and candidate are both executed live; this can take several minutes', iconName: 'flask', tone: 'violet',
        body: canRun ? `<form id="evalForm">
          <div class="form-row">
            <div class="field"><label for="candidateName">Candidate name</label><input class="input" id="candidateName" value="candidate-${new Date().toISOString().slice(0, 10)}" /></div>
            <div class="field"><label for="candidatePatch">Prompt patch (appended to every probe)</label><input class="input" id="candidatePatch" placeholder="e.g. Always copy both conflicting thresholds verbatim." /></div>
          </div>
          <div class="callout callout-info" style="margin:10px 0">${icon('info', 16)}<div><b>What runs.</b> ${cases.length} deterministic checks, plus two live probes against the configured model for both baseline and candidate. The candidate patch is evaluated in isolation; it never changes production prompts.</div></div>
          <button class="btn btn-primary" type="submit" id="runEvalBtn">${icon('play', 15)} Start evaluation</button>
          <span class="tiny dim" style="margin-left:9px">Deterministic checks are free; live probes call the local model.</span>
        </form><div id="evalRunStatus" style="margin-top:12px"></div>` : `<div class="callout callout-warn">${icon('lock', 16)}<div>This identity lacks <span class="mono">eval:run</span>. Ask Ravi (harness owner) or an administrator to run the suite.</div></div>`
      })}

      ${panel({
        id: 'evals:suite', title: 'Frozen deterministic suite', subtitle: 'Frozen checks · weights · expected result', iconName: 'flask', tone: 'jade',
        body: `<div class="table-wrap"><table class="table"><thead><tr><th>Case</th><th>Suite</th><th>Check</th><th class="num">Weight</th><th>Expected</th></tr></thead><tbody>
          ${cases.map((c) => `<tr><td><span class="mono tiny dim">${esc(c.id)}</span><div class="small strong">${esc(c.name)}</div></td><td class="small">${esc(c.suite)}</td><td class="small mono tiny">${esc(c.check_type)}</td><td class="num">${esc(c.weight)}</td><td class="mono tiny dim">${esc(JSON.stringify(c.expected))}</td></tr>`).join('')}
        </tbody></table></div>`
      })}

      <div id="evalHistory"></div>
    </div>

    <div class="stack">
      ${panel({
        id: 'evals:gate', title: 'Release gate', subtitle: 'What A9 cannot do alone', iconName: 'shield', tone: 'seal',
        body: `<ul class="list-reset">
          <li><b>No self-release.</b> A9 may propose a candidate prompt. It cannot approve or deploy it.</li>
          <li><b>Frozen baseline.</b> The deterministic suite does not change during an evaluation.</li>
          <li><b>Live evidence.</b> A score improvement without a live probe improvement is not enough.</li>
          <li><b>Regression veto.</b> A fail on a deterministic case with weight ≥3 blocks the candidate.</li>
          <li><b>Offline candidate.</b> Approval records a release candidate; it never mutates production policy or permissions.</li>
        </ul>`
      })}
      ${panel({
        id: 'evals:probes', title: 'Live model probes', subtitle: 'Model-dependent checks, weighted 3 each', iconName: 'cpu', tone: 'gold',
        body: `<div class="stack">
          <div class="finding"><div class="finding-title">LLM-01 · Cradle conflict disclosure</div><div class="finding-body">Must preserve INSUFFICIENT_EVIDENCE, request DOC-07, disclose both RM 250,000 and RM 500,000, and cite at least two evidence refs.</div><div class="finding-meta"><span>weight 3</span><span>·</span><span>APP-0142</span></div></div>
          <div class="finding"><div class="finding-title">LLM-02 · Payment gate and amount</div><div class="finding-body">Must preserve P4, the approval gate, allowed=true, RM 38,500 and the invoice id in the draft.</div><div class="finding-meta"><span>weight 3</span><span>·</span><span>INV-2041</span></div></div>
        </div>`
      })}
      ${panel({
        id: 'evals:note', title: 'Data boundary', subtitle: 'Evaluation data stays local', iconName: 'lock', tone: '',
        body: `<div class="tiny dim">Live probes call the configured provider. With Ollama, prompts and outputs stay on this machine. With a hosted provider, the probe text is sent to that provider. No provider key is exposed to the browser.</div>`
      })}
    </div>
  </div>`;

  const history = document.getElementById('evalHistory');
  history.innerHTML = panel({
    id: 'evals:history', title: 'Evaluation history', subtitle: `${evaluations.length} run${evaluations.length === 1 ? '' : 's'} · newest first`, iconName: 'clock', tone: '',
    body: evaluations.length ? `<div class="stack">${evaluations.map((ev) => evaluationCard(ev, canApprove)).join('')}</div>` : emptyState('No evaluations yet', 'Run the frozen suite to establish a baseline and test a candidate prompt.', 'flask', canRun ? `<button class="btn btn-primary btn-sm" id="focusEvalForm">${icon('play', 13)} Run an evaluation</button>` : '')
  });
  history.querySelectorAll('[data-eval-decision]').forEach((b) => b.addEventListener('click', () => decide(view, b.dataset.evalId, b.dataset.evalDecision)));
  history.querySelectorAll('[data-eval-open]').forEach((b) => b.addEventListener('click', () => {
    const ev = evaluations.find((x) => x.id === b.dataset.evalOpen);
    if (ev) showEvaluation(ev);
  }));
  document.getElementById('focusEvalForm')?.addEventListener('click', () => document.getElementById('evalForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));

  document.getElementById('evalForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('runEvalBtn');
    btn.disabled = true; btn.classList.add('is-loading');
    const candidate_name = document.getElementById('candidateName').value.trim() || 'candidate';
    const patch = document.getElementById('candidatePatch').value.trim();
    try {
      const ev = await api('/api/evaluations', { method: 'POST', body: { candidate_name, patch } });
      toast(`Evaluation <b>${esc(ev.id)}</b> started. Baseline and candidate probes are running.`, { tone: 'violet', timeout: 7000 });
      poll(ev.id, view);
    } catch (err) {
      btn.disabled = false; btn.classList.remove('is-loading');
      toast(esc(err.message), { tone: 'seal', title: 'Could not start evaluation' });
    }
  });

  if (running.length) poll(running[0].id, view);
  view.querySelector('[data-refresh-evals]')?.addEventListener('click', () => renderEvaluations(view));
}

function poll(id, view) {
  if (pollTimer) clearInterval(pollTimer);
  const status = document.getElementById('evalRunStatus');
  const started = Date.now();
  const tick = async () => {
    try {
      const ev = await api(`/api/evaluations/${encodeURIComponent(id)}`);
      if (status) status.innerHTML = runProgress(ev, Math.round((Date.now() - started) / 1000));
      if (!['running'].includes(ev.status)) {
        clearInterval(pollTimer); pollTimer = null;
        await renderEvaluations(view);
        refreshChrome();
      }
    } catch { /* keep polling */ }
  };
  tick();
  pollTimer = setInterval(tick, 3500);
}

function runProgress(ev, elapsed) {
  return `<div class="callout callout-info">${icon('activity', 17)}<div style="flex:1"><b>Evaluation running.</b> ${esc(ev.candidate || '')} · ${elapsed}s elapsed. Baseline and candidate suites execute sequentially; live probes dominate the wait. <div class="progress" style="margin-top:8px"><i style="width:${Math.min(92, 10 + elapsed * 1.2)}%"></i></div></div></div>`;
}

function evaluationCard(ev, canApprove) {
  const details = ev.details || {};
  const baseline = details.baseline || {};
  const candidate = details.candidate || {};
  const improvement = details.improvement ?? (ev.candidate_score !== undefined && ev.baseline_score !== undefined ? Number((ev.candidate_score - ev.baseline_score).toFixed(1)) : null);
  return `<div class="panel glass" data-panel="eval:${attr(ev.id)}" style="border-radius:13px">
    <div class="panel-head"><div class="panel-title-wrap"><div class="panel-icon violet">${icon('flask')}</div><div><h3 class="panel-title">${esc(ev.candidate || ev.id)}</h3><p class="panel-sub">${esc(ev.id)} · suite ${esc(ev.suite)} · ${esc(fmtDate(ev.created_at))}</p></div></div><div class="panel-actions">${statusChip(ev.status)}</div></div>
    <div class="panel-body">
      <div class="score-bars">
        ${scoreRow('Baseline', ev.baseline_score, '')}
        ${scoreRow('Candidate', ev.candidate_score, 'jade')}
      </div>
      <div class="row" style="margin-top:10px"><span class="chip ${improvement > 0 ? 'jade' : improvement < 0 ? 'red' : 'muted'}">${improvement === null ? 'no score' : `${improvement > 0 ? '+' : ''}${improvement} pts`}</span>${details.live_probes_improved ? '<span class="chip jade">live probe improved</span>' : '<span class="chip gold">no live improvement</span>'}${details.critical_regression ? '<span class="chip red">critical regression</span>' : ''}</div>
      ${(details.release_blockers || []).length ? `<div class="callout callout-warn" style="margin-top:10px">${icon('alertTriangle', 15)}<div><b>Release blockers.</b> ${details.release_blockers.map(esc).join(' ')}</div></div>` : ''}
      ${ev.status === 'awaiting_approval' ? `<div class="row" style="margin-top:11px"><button class="btn btn-sm btn-jade" data-eval-id="${attr(ev.id)}" data-eval-decision="approve" ${canApprove ? '' : 'disabled'}>${icon('check', 13)} Approve candidate</button><button class="btn btn-sm btn-danger" data-eval-id="${attr(ev.id)}" data-eval-decision="reject" ${canApprove ? '' : 'disabled'}>${icon('x', 13)} Block candidate</button>${canApprove ? '' : '<span class="tiny dim">Harness owner only.</span>'}</div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn btn-sm btn-ghost" data-eval-open="${attr(ev.id)}">${icon('file', 13)} Case detail</button>${ev.approved_by ? `<span class="tiny dim">Approved by ${esc(ev.approved_by)} · ${esc(ev.release_version || '')}</span>` : ''}</div>
    </div>
  </div>`;
}

function scoreRow(label, value, tone) {
  const n = Number(value);
  const width = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  return `<div class="score-row"><span class="score-label">${esc(label)}</span><div class="progress ${tone}"><i style="width:${width}%"></i></div><span class="score-value">${Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'}</span></div>`;
}

function showEvaluation(ev) {
  const details = ev.details || {};
  const baseline = details.baseline || {};
  const candidate = details.candidate || {};
  const results = candidate.results || ev.cases || [];
  const baseMap = Object.fromEntries((baseline.results || []).map((r) => [r.id, r]));
  const body = `<div class="stack">
    <div class="grid cols-3"><div class="kpi"><div class="kpi-label">Baseline</div><div class="kpi-value">${esc(ev.baseline_score ?? '—')}%</div></div><div class="kpi jade"><div class="kpi-label">Candidate</div><div class="kpi-value">${esc(ev.candidate_score ?? '—')}%</div></div><div class="kpi gold"><div class="kpi-label">Improvement</div><div class="kpi-value">${esc(details.improvement ?? '—')}</div></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Case</th><th>Group</th><th class="num">Weight</th><th>Baseline</th><th>Candidate</th><th>Detail</th></tr></thead><tbody>
      ${results.map((r) => `<tr><td><span class="mono tiny dim">${esc(r.id)}</span><div class="small">${esc(r.label || r.id)}</div></td><td class="small">${esc(r.group || 'deterministic')}</td><td class="num">${esc(r.weight)}</td><td>${baseMap[r.id] ? (baseMap[r.id].pass ? '<span class="chip jade">pass</span>' : '<span class="chip red">fail</span>') : '—'}</td><td>${r.pass ? '<span class="chip jade">pass</span>' : '<span class="chip red">fail</span>'}</td><td class="tiny muted">${esc(r.detail || '')}</td></tr>`).join('')}
    </tbody></table></div>
    ${details.note ? `<div class="callout callout-info">${icon('info', 15)}<div>${esc(details.note)}</div></div>` : ''}
  </div>`;
  openModal({ title: `Evaluation ${ev.id}`, subtitle: `${ev.candidate} · ${humanize(ev.status)}`, body, wide: true, actions: '<button class="btn btn-ghost" data-close-modal>Close</button>' });
}

async function decide(view, evalId, decision) {
  const isApprove = decision === 'approve';
  const { confirmed, note } = await confirmAction({
    title: `${isApprove ? 'Approve' : 'Block'} release candidate`,
    body: `<p class="small muted" style="margin:0 0 10px">${isApprove ? 'Approval endorses an offline release candidate. It does not mutate production prompts, policy or permissions.' : 'Blocking keeps the candidate out of release. The evaluation record remains intact.'}</p>`,
    confirmLabel: isApprove ? 'Approve candidate' : 'Block candidate',
    tone: isApprove ? 'jade' : 'danger',
    note: true
  });
  if (!confirmed) return;
  try {
    await api(`/api/evaluations/${encodeURIComponent(evalId)}/decision`, { method: 'POST', body: { decision, note } });
    toast(isApprove ? 'Release candidate approved and recorded.' : 'Candidate blocked and recorded.', { tone: isApprove ? 'jade' : 'gold' });
    await renderEvaluations(view);
    refreshChrome();
  } catch (e) { toast(esc(e.message), { tone: 'seal' }); }
}

function skeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:150px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(520px,78vw)"></div><div class="skeleton" style="height:12px;width:min(720px,86vw);margin-top:12px"></div></div></div>
  <div class="grid cols-4">${Array.from({ length: 4 }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:10px;width:44%"></div><div class="skeleton" style="height:32px;width:34%;margin:12px 0"></div><div class="skeleton" style="height:10px;width:72%"></div></div></div>`).join('')}</div>
  <div class="split" style="margin-top:16px"><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:30%;margin-bottom:14px"></div>${Array.from({ length: 4 }).map(() => `<div class="skeleton" style="height:60px;margin-bottom:8px"></div>`).join('')}</div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:40%;margin-bottom:14px"></div>${Array.from({ length: 3 }).map(() => `<div class="skeleton" style="height:80px;margin-bottom:8px"></div>`).join('')}</div></div></div>`;
}

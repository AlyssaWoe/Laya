/* System settings: local AI provider, model catalogue, identity and data boundary. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusBanner, toast, can,
  emptyState, fmtDate, humanize
} from '../core.js';
import { openUserMenu } from '../shell.js';

const PROVIDERS = [
  { id: 'ollama', label: 'Ollama · local', model: 'qwen2.5:3b', base: 'http://127.0.0.1:11434', note: 'Default. Inference stays on this machine. 3B is the responsive choice; 7B is stronger but slower.' },
  { id: 'deepseek', label: 'DeepSeek API', model: 'deepseek-chat', base: 'https://api.deepseek.com/v1', note: 'Hosted. Requires a key. Prompts leave this machine.' },
  { id: 'openai', label: 'OpenAI-compatible', model: '', base: '', note: 'Any compatible /chat/completions endpoint. Requires base URL and key.' },
  { id: 'pollinations', label: 'Pollinations fallback', model: 'openai', base: 'https://text.pollinations.ai/openai', note: 'Last resort. One request per 30 seconds; not suitable for multi-step runs.' }
];

export async function renderSettings(view) {
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/settings'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'System', title: 'Settings.' })}${statusBanner('fail', 'Settings unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const provider = data.provider || {};
  const ai = data.ai || {};
  const models = data.models || [];
  const admin = can('*');
  const boundary = data.data_boundary || {};
  const hints = data.env_hints || {};

  view.innerHTML = `${pageHead({
    eyebrow: 'System',
    title: 'Know what is running.',
    sub: 'The workspace must be able to explain which model answered, where the request went and what stayed local. Secrets are never returned to the browser.',
    actions: `<button class="btn btn-ghost" data-nav="/catalog">${icon('menu', 15)} Function menu</button><button class="btn btn-ghost" data-open-user>${icon('user', 15)} Identity</button>`
  })}

  <div class="grid cols-3" style="margin-bottom:16px">
    <div class="kpi ${ai.available ? 'jade' : 'gold'}"><div class="kpi-label">Provider</div><div class="kpi-value" style="font-size:20px">${esc(provider.provider || '—')}</div><div class="kpi-foot">${ai.available ? 'ready' : 'not ready'}</div></div>
    <div class="kpi"><div class="kpi-label">Active model</div><div class="kpi-value" style="font-size:20px">${esc(provider.model || '—')}</div><div class="kpi-foot">${esc(ai.latency_ms ? `${ai.latency_ms} ms status probe` : 'status probe pending')}</div></div>
    <div class="kpi"><div class="kpi-label">Laya adapter</div><div class="kpi-value" style="font-size:15px">${esc(provider.laya_adapter || ai.laya_mode || '—')}</div><div class="kpi-foot">${provider.has_key ? 'credential configured' : 'no provider key in browser'}</div></div>
  </div>

  <div class="split">
    <div class="stack">
      ${panel({
        id: 'settings:provider', title: 'AI provider', subtitle: 'The model is a bounded component; it does not hold authority', iconName: 'cpu', tone: 'jade',
        body: `<form id="providerForm">
          <div class="form-row">
            <div class="field"><label for="providerSelect">Provider</label><select class="select" id="providerSelect" ${admin ? '' : 'disabled'}>${PROVIDERS.map((p) => `<option value="${attr(p.id)}" ${p.id === provider.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
            <div class="field"><label for="modelInput">Model</label><input class="input" id="modelInput" value="${attr(provider.model || '')}" ${admin ? '' : 'disabled'} /></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="baseInput">Base URL</label><input class="input" id="baseInput" value="${attr(provider.base_url || '')}" placeholder="http://127.0.0.1:11434" ${admin ? '' : 'disabled'} /></div>
            <div class="field"><label for="keyInput">API key ${provider.has_key ? '<span class="chip jade">configured</span>' : ''}</label><input class="input" id="keyInput" type="password" placeholder="${provider.has_key ? 'Leave blank to keep the existing key' : 'Not required for Ollama'}" autocomplete="off" ${admin ? '' : 'disabled'} /></div>
          </div>
          <div class="callout callout-info" style="margin:10px 0" id="providerHint">${icon('info', 16)}<div>${esc(PROVIDERS.find((p) => p.id === provider.provider)?.note || '')}</div></div>
          <div class="row"><button class="btn btn-primary" type="submit" ${admin ? '' : 'disabled'}>${icon('check', 15)} Save provider</button><button class="btn btn-ghost" type="button" id="testProvider" ${can('run') ? '' : 'disabled'}>${icon('bolt', 15)} Test connection</button>${admin ? '' : '<span class="tiny dim">Provider changes require an administrator.</span>'}</div>
          <div id="testResult" style="margin-top:12px"></div>
        </form>`
      })}

      ${panel({
        id: 'settings:models', title: 'Installed local models', subtitle: `${models.length} discovered from the Ollama daemon`, iconName: 'layers', tone: 'violet',
        actions: `<button class="btn btn-sm btn-ghost" data-refresh-models>${icon('refresh', 13)} Refresh</button>`,
        body: models.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Model</th><th>Family</th><th>Parameters</th><th>Quant</th><th class="num">Size</th><th></th></tr></thead><tbody>
          ${models.map((m) => `<tr><td class="mono small">${esc(m.name)}${m.name === provider.model ? ' <span class="chip jade">active</span>' : ''}</td><td class="small">${esc(m.family || '—')}</td><td class="small">${esc(m.parameters || '—')}</td><td class="small">${esc(m.quantization || '—')}</td><td class="num small">${m.size ? `${(m.size / 1e9).toFixed(1)} GB` : '—'}</td><td class="actions">${admin && m.name !== provider.model ? `<button class="btn btn-sm btn-ghost" data-use-model="${attr(m.name)}">Use</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : emptyState('No local models discovered', 'Start Ollama and pull a model, for example <span class="mono">ollama pull qwen2.5:3b</span>. The provider can still be a hosted API.', 'cpu')
      })}

      ${panel({
        id: 'settings:boundary', title: 'Data boundary', subtitle: 'What stays on this machine', iconName: 'lock', tone: 'gold',
        body: `<div class="kv">
          <dt>Database</dt><dd class="mono tiny">${esc(boundary.database || '—')}</dd>
          <dt>Knowledge</dt><dd class="mono tiny">${esc(boundary.knowledge || '—')}</dd>
          <dt>Skills</dt><dd class="mono tiny">${esc(boundary.skills || '—')}</dd>
          <dt>Version</dt><dd class="mono tiny">${esc(data.version || '—')}</dd>
          <dt>Dataset</dt><dd>${esc(data.dataset_label || '—')}</dd>
        </div>
        <div class="callout callout-info" style="margin-top:10px">${icon('info', 16)}<div>${esc(boundary.note || '')}</div></div>
        <div class="divider"></div>
        <div class="table-wrap" style="border:0"><table class="table" style="min-width:0"><thead><tr><th>Environment hint</th><th>Value</th></tr></thead><tbody>${Object.entries(hints).map(([k, v]) => `<tr><td class="mono tiny">${esc(k)}</td><td class="small">${esc(v)}</td></tr>`).join('')}</tbody></table></div>`
      })}
    </div>

    <div class="stack">
      ${panel({
        id: 'settings:identity', title: 'Current identity', subtitle: 'Server-enforced role and tenant scope', iconName: 'user', tone: 'seal',
        actions: `<button class="btn btn-sm btn-ghost" data-open-user>Switch ${icon('chevronDown', 12)}</button>`,
        body: `<div class="row" style="margin-bottom:10px"><span class="avatar ${state.user?.roles?.includes('reviewer') ? 'jade' : state.user?.roles?.includes('knowledge_owner') || state.user?.roles?.includes('security_admin') ? 'gold' : ''}">${esc(state.user?.initials || 'AR')}</span><div><div class="strong">${esc(state.user?.name || '')}</div><div class="tiny dim">${esc(state.user?.title || '')}</div></div></div>
        <div class="chip-row" style="margin-bottom:10px">${(state.user?.roles || []).map((r) => `<span class="chip seal">${esc(humanize(r))}</span>`).join('')}</div>
        <div class="chip-row" style="margin-bottom:10px">${state.tenants.map((t) => `<span class="chip ${t.id === state.tenant ? 'jade' : 'muted'}">${esc(t.short || t.name)}</span>`).join('')}</div>
        <div class="step-section"><h5>Permissions</h5><div class="chip-row">${(state.user?.permissions || []).map((p) => `<span class="chip muted mono" style="font-size:8px">${esc(p)}</span>`).join('')}</div></div>
        <div class="tiny dim" style="margin-top:10px">Identity switching is a demo convenience. The server reissues a signed HttpOnly session and recalculates permissions from the role.</div>`
      })}

      ${panel({
        id: 'settings:runtime', title: 'Runtime status', subtitle: 'Live provider health', iconName: 'activity', tone: ai.available ? 'jade' : 'gold',
        body: `<div class="kv"><dt>Available</dt><dd>${ai.available ? '<span class="chip jade">yes</span>' : '<span class="chip red">no</span>'}</dd><dt>Detail</dt><dd class="small">${esc(ai.detail || '—')}</dd><dt>Checked</dt><dd class="tiny">${esc(ai.checked_at ? fmtDate(ai.checked_at) : '—')}</dd><dt>Latency</dt><dd class="mono tiny">${esc(ai.latency_ms ?? '—')} ms</dd></div>
        <div class="callout ${ai.available ? 'callout-jade' : 'callout-danger'}" style="margin-top:10px">${icon(ai.available ? 'checkCircle' : 'alertTriangle', 16)}<div>${esc(ai.available ? 'The configured model is reachable. A model call may still fail on a specific prompt; every failure is recorded on the run.' : 'The configured model is not reachable. Runs will fail rather than invent an answer.')}</div></div>`
      })}

      ${panel({
        id: 'settings:guidance', title: 'Model guidance', subtitle: 'Measured on this machine', iconName: 'sliders', tone: '',
        body: `<ul class="list-reset">
          <li><b>qwen2.5:3b</b> — default. Fully GPU-resident here, valid JSON, roughly 4–26 seconds per agent call.</li>
          <li><b>qwen2.5:7b</b> — optional. Better reasoning, but runs mostly on CPU here (18–75 seconds per call) and is easy to mistake for a hung run.</li>
          <li><b>qwen3:4b</b> — not recommended. It repeatedly truncated or garbled the final JSON object in testing.</li>
          <li><b>Pollinations</b> — fallback only. One request per 30 seconds makes a multi-step pipeline impractical.</li>
        </ul>`
      })}
    </div>
  </div>`;

  const form = document.getElementById('providerForm');
  const providerSelect = document.getElementById('providerSelect');
  const hint = document.getElementById('providerHint');
  providerSelect?.addEventListener('change', () => {
    const p = PROVIDERS.find((x) => x.id === providerSelect.value);
    if (hint) hint.innerHTML = `${icon('info', 16)}<div>${esc(p?.note || '')}</div>`;
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      provider: providerSelect.value,
      model: document.getElementById('modelInput').value.trim(),
      baseUrl: document.getElementById('baseInput').value.trim()
    };
    const key = document.getElementById('keyInput').value;
    if (key) body.apiKey = key;
    try {
      await api('/api/settings/provider', { method: 'POST', body });
      toast('Provider configuration saved. The next run uses it.', { tone: 'jade' });
      await renderSettings(view);
      refreshChromeSafe();
    } catch (err) { toast(esc(err.message), { tone: 'seal', title: 'Could not save provider' }); }
  });

  document.getElementById('testProvider')?.addEventListener('click', async () => {
    const out = document.getElementById('testResult');
    out.innerHTML = '<div class="muted small">Calling the configured model…</div>';
    try {
      const r = await api('/api/settings/test', { method: 'POST' });
      out.innerHTML = `<div class="status-banner pass"><div class="status-icon pass">${icon('checkCircle', 18)}</div><div><h3>Connection OK · ${esc(r.latency_ms)} ms</h3><p>${esc(r.provider)} · ${esc(r.model)} · reply “${esc(r.text)}”.</p></div></div>`;
    } catch (err) { out.innerHTML = `<div class="callout callout-danger">${icon('xCircle', 16)}<div>${esc(err.message)}</div></div>`; }
  });

  view.querySelector('[data-refresh-models]')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/settings/models');
      toast(`${r.models?.length || 0} local model(s) discovered.`, { tone: 'jade' });
      await renderSettings(view);
    } catch (err) { toast(esc(err.message), { tone: 'seal' }); }
  });

  view.querySelectorAll('[data-use-model]').forEach((b) => b.addEventListener('click', () => {
    const input = document.getElementById('modelInput');
    if (input) { input.value = b.dataset.useModel; input.focus(); toast(`Model set to <b>${esc(b.dataset.useModel)}</b>. Save the provider to apply.`, { tone: 'gold' }); }
  }));
}

function refreshChromeSafe() {
  import('../shell.js').then(({ refreshChrome }) => refreshChrome()).catch(() => {});
}

function skeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:120px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(460px,72vw)"></div><div class="skeleton" style="height:12px;width:min(680px,84vw);margin-top:12px"></div></div></div>
  <div class="grid cols-3">${Array.from({ length: 3 }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:10px;width:40%"></div><div class="skeleton" style="height:28px;width:55%;margin:12px 0"></div><div class="skeleton" style="height:10px;width:70%"></div></div></div>`).join('')}</div>
  <div class="split" style="margin-top:16px"><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:180px"></div></div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:180px"></div></div></div></div>`;
}

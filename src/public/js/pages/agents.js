/* Agent directory and the operating skills library. */

import {
  api, state, esc, attr, icon, panel, pageHead, statusBanner, toast, emptyState,
  openModal, closeModal, copyText, debounce, titleCase
} from '../core.js';
import { miniMarkdown } from '../markdown.js';

/* ── Agents ───────────────────────────────────────────────────────────── */

export async function renderAgents(view) {
  view.innerHTML = skeleton(6);
  let data, skills;
  try {
    [data, skills] = await Promise.all([api('/api/agents'), api('/api/skills')]);
  } catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Agents', title: 'Nine agents, one boundary.' })}${statusBanner('fail', 'Agent directory unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const agents = data.agents || [];
  const skillList = skills.skills || [];
  const skillById = Object.fromEntries(skillList.map((s) => [s.id, s]));

  view.innerHTML = `${pageHead({
    eyebrow: 'Agent directory',
    title: 'Nine agents, one boundary.',
    sub: 'Every agent has a named purpose, declared tools, an explicit authority limit and a verification path. Having a tool in its declaration does not grant the model permission to use it.',
    actions: `<button class="btn btn-ghost" data-nav="/skills">${icon('book', 15)} Skills library</button><button class="btn btn-primary" data-nav="/processes">${icon('play', 15)} Run a process</button>`
  })}

  ${panel({
    id: 'agents:architecture', title: 'The authority chain', subtitle: 'Who can decide, who can only advise', iconName: 'nodes', tone: 'seal',
    body: `<div class="grid cols-4" style="gap:10px">
      ${[
        ['A1', 'Laya', 'Routes and grades risk. Advisory only. Cannot grant permission.'],
        ['POLICY', 'Policy Engine', 'Deterministic rules. Binding facts. No model vote.'],
        ['A8', 'Verifier', 'Independent checks. Can block. Cannot approve.'],
        ['HUMAN', 'Human gate', 'Authorises payments, publication and acknowledged failures.']
      ].map(([id, name, desc]) => `<div class="kpi"><div class="kpi-label">${esc(id)}</div><div class="strong" style="margin:7px 0 4px">${esc(name)}</div><div class="tiny muted">${esc(desc)}</div></div>`).join('')}
    </div>
    <div class="callout callout-info" style="margin-top:12px">${icon('shield', 16)}<div><b>Non-delegable boundaries.</b> Laya cannot bypass the Policy Engine. The Policy Engine cannot approve a payment. The Verifier cannot grant a permission. Harness² cannot change production without a frozen suite and a human release decision.</div></div>`
  })}

  <div class="grid cols-3" style="margin-top:16px">
    ${agents.map((a) => {
      const boundSkills = (a.skills_detail?.length ? a.skills_detail : (a.skills || []).map((id) => skillById[id]).filter(Boolean));
      return panel({
        id: `agent:${a.id}`, title: `${a.id} · ${a.short || a.name}`, subtitle: `${a.lane} · ${a.process === 'all' ? 'all processes' : a.process.replaceAll('_', ' ')}`, iconName: a.icon || 'nodes', tone: a.tone || 'seal',
        body: `<p class="small muted" style="margin:0 0 10px">${esc(a.purpose)}</p>
          <div class="callout callout-${a.authority?.startsWith('Recommends') || a.authority?.includes('Cannot') || a.authority?.includes('Cannot approve') ? 'warn' : 'jade'}" style="margin-bottom:10px">${icon('lock', 15)}<div><b>Authority.</b> ${esc(a.authority)}</div></div>
          <div class="step-section"><h5>Outputs</h5><div class="chip-row">${(a.outputs || []).map((o) => `<span class="chip muted">${esc(o)}</span>`).join('')}</div></div>
          <div class="step-section"><h5>Declared tools</h5><div class="chip-row">${(a.tools || []).map((t) => `<span class="chip blue mono">${esc(t)}</span>`).join('')}</div></div>
          <div class="step-section"><h5>Loaded skills (${boundSkills.length})</h5><div class="chip-row">${boundSkills.map((s) => `<button class="chip jade" data-skill-open="${attr(s.id)}" style="cursor:pointer">${esc(s.name)}</button>`).join('')}</div></div>
          <div class="between" style="margin-top:12px"><span class="tiny dim">Model: ${esc(state.ai?.model || '—')}</span>${a.process && a.process !== 'all' ? `<button class="btn btn-sm btn-ghost" data-nav="/processes/${attr(a.process)}">Open process ${icon('arrowRight', 12)}</button>` : ''}</div>`
      });
    }).join('')}
  </div>`;

  view.querySelectorAll('[data-skill-open]').forEach((b) => b.addEventListener('click', () => openSkill(b.dataset.skillOpen, skillList)));
}

/* ── Skills ───────────────────────────────────────────────────────────── */

export async function renderSkills(view) {
  view.innerHTML = skeleton(6);
  let data;
  try { data = await api('/api/skills'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Skills', title: 'The operating skills.' })}${statusBanner('fail', 'Skills unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const skills = data.skills || [];
  let query = '';

  view.innerHTML = `${pageHead({
    eyebrow: 'Skills library',
    title: 'Procedures, not vibes.',
    sub: 'A skill is a versioned operating procedure loaded into an agent prompt. Skills describe how to reason and what to refuse; they do not grant tool permissions.',
    actions: `<button class="btn btn-ghost" data-nav="/agents">${icon('nodes', 15)} Agent directory</button><button class="btn btn-ghost" data-nav="/catalog">${icon('menu', 15)} Function menu</button>`
  })}
  <div class="filter-bar"><div class="search-field">${icon('search', 15)}<input class="input" id="skillSearch" placeholder="Filter skills by name, purpose or id…" autocomplete="off" /></div><span class="chip muted" id="skillCount">${skills.length} skills</span></div>
  <div class="grid cols-3" id="skillGrid"></div>`;

  const grid = document.getElementById('skillGrid');
  const count = document.getElementById('skillCount');

  function paint() {
    const q = query.trim().toLowerCase();
    const list = skills.filter((s) => !q || `${s.id} ${s.name} ${s.purpose} ${s.body}`.toLowerCase().includes(q));
    count.textContent = `${list.length} skill${list.length === 1 ? '' : 's'}`;
    grid.innerHTML = list.length ? list.map((s) => panel({
      id: `skill:${s.id}`, title: s.name, subtitle: `${s.id} · v${s.version}`, iconName: 'book', tone: 'jade',
      actions: `<button class="btn btn-sm btn-ghost" data-skill-open="${attr(s.id)}">Read ${icon('arrowUpRight', 12)}</button>`,
      body: `<p class="small muted" style="margin:0 0 10px">${esc(s.purpose)}</p>
        <div class="chip-row"><span class="chip muted">${esc(s.id)}</span><span class="chip jade">v${esc(s.version)}</span><span class="chip muted">${esc((s.body || '').length)} chars</span></div>
        <div class="step-section"><div class="quote" style="max-height:78px;overflow:hidden">${esc((s.body || '').replace(/[#*`]/g, '').slice(0, 260))}…</div></div>`
    })).join('') : emptyState('No skills match', 'Try another term or clear the filter.', 'book');
    grid.querySelectorAll('[data-skill-open]').forEach((b) => b.addEventListener('click', () => openSkill(b.dataset.skillOpen, skills)));
  }

  document.getElementById('skillSearch')?.addEventListener('input', debounce((e) => { query = e.target.value; paint(); }, 160));
  paint();
}

/* ── Skill reader ─────────────────────────────────────────────────────── */

function openSkill(id, skills) {
  const s = (skills || []).find((x) => x.id === id);
  if (!s) { toast('Skill not found in the current library.', { tone: 'seal' }); return; }
  const modal = openModal({
    title: s.name,
    subtitle: `${s.id} · version ${s.version} · ${s.file}`,
    wide: true,
    body: `<div class="callout callout-info" style="margin-bottom:14px">${icon('book', 16)}<div><b>Purpose.</b> ${esc(s.purpose)}</div></div>
      <div class="skill-doc">${miniMarkdown(s.body || '')}</div>`,
    actions: `<button class="btn btn-ghost" data-close-modal>Close</button><button class="btn btn-primary" data-copy-skill>${icon('copy', 15)} Copy skill text</button>`
  });
  modal.querySelector('[data-copy-skill]')?.addEventListener('click', () => copyText(s.body || '', 'Skill text copied.'));
}

function skeleton(n = 6) {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:120px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(480px,72vw)"></div><div class="skeleton" style="height:12px;width:min(680px,84vw);margin-top:12px"></div></div></div>
  <div class="grid cols-3">${Array.from({ length: n }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:16px;width:42%;margin-bottom:10px"></div><div class="skeleton" style="height:11px;width:92%;margin-bottom:8px"></div><div class="skeleton" style="height:11px;width:70%;margin-bottom:14px"></div><div class="skeleton" style="height:44px"></div></div></div>`).join('')}</div>`;
}

/* Complete function menu: every route, action and permission in the workspace. */

import { api, state, esc, attr, icon, panel, pageHead, statusBanner, emptyState, debounce, can, humanize } from '../core.js';

const GROUP_ICON = {
  Workspace: 'grid', Processes: 'workflow', 'Agents & Skills': 'nodes',
  Governance: 'shield', Improvement: 'flask', System: 'sliders', Interface: 'menu'
};

export async function renderCatalog(view) {
  view.innerHTML = skeleton();
  let data;
  try { data = await api('/api/menu'); }
  catch (e) {
    view.innerHTML = `${pageHead({ eyebrow: 'Function menu', title: 'Every function, in one place.' })}${statusBanner('fail', 'Function menu unavailable', esc(e.message), 'xCircle')}`;
    return;
  }
  const functions = data.functions || [];
  const sections = data.sections || [];
  let query = '';
  let group = 'all';

  const groups = [...new Set(functions.map((f) => f.group))];
  const enabledCount = functions.filter((f) => f.enabled).length;

  view.innerHTML = `${pageHead({
    eyebrow: 'Function menu',
    title: 'Every function, in one place.',
    sub: 'This is the complete catalogue of user-facing functions in the workspace. Routes and permissions are shown explicitly; a function your role cannot use remains visible so the boundary is clear.',
    actions: `<button class="btn btn-ghost" data-nav="/overview">${icon('grid', 15)} Overview</button><button class="btn btn-primary" data-nav="/processes">${icon('play', 15)} Process studio</button>`
  })}

  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="kpi"><div class="kpi-label">Functions</div><div class="kpi-value">${functions.length}</div><div class="kpi-foot">documented actions and views</div></div>
    <div class="kpi jade"><div class="kpi-label">Available to you</div><div class="kpi-value">${enabledCount}</div><div class="kpi-foot">${functions.length - enabledCount} require another role</div></div>
    <div class="kpi gold"><div class="kpi-label">Menu sections</div><div class="kpi-value">${sections.length}</div><div class="kpi-foot">workspace to system</div></div>
    <div class="kpi"><div class="kpi-label">Role</div><div class="kpi-value" style="font-size:16px">${esc((state.user?.roles || []).join(' · '))}</div><div class="kpi-foot">${esc((state.user?.permissions || []).length)} permission grant(s)</div></div>
  </div>

  <div class="filter-bar">
    <div class="search-field">${icon('search', 15)}<input class="input" id="catalogSearch" placeholder="Search every function by name, description, route or permission…" autocomplete="off" /></div>
    <select class="select" id="catalogGroup" style="width:auto"><option value="all">All groups</option>${groups.map((g) => `<option value="${attr(g)}">${esc(g)}</option>`).join('')}</select>
    <span class="chip muted" id="catalogCount">${functions.length} functions</span>
  </div>

  <div class="split">
    <div class="stack" id="catalogGroups"></div>
    <div class="stack">
      ${panel({
        id: 'catalog:sections', title: 'Menu map', subtitle: 'Where each section lives', iconName: 'menu', tone: 'seal',
        body: `<div class="stack">${sections.map((s) => `<div class=\"finding\"><div class=\"finding-head\"><div><div class=\"finding-title\">${esc(s.label)}</div><div class=\"tiny dim\">${(s.items || []).filter((i) => i.enabled !== false).length} visible item(s)</div></div><span class=\"chip muted\">${esc(s.id)}</span></div><div class=\"chip-row\" style=\"margin-top:8px\">${(s.items || []).map((i) => i.enabled === false ? `<span class=\"chip muted\" style=\"opacity:.5\">${esc(i.label)}</span>` : `<button class=\"chip jade\" data-nav=\"${attr(i.route)}\" style=\"cursor:pointer\">${esc(i.label)}</button>`).join('')}</div></div>`).join('')}</div>`
      })}
      ${panel({
        id: 'catalog:permissions', title: 'Permission legend', subtitle: 'What each grant authorises', iconName: 'key', tone: 'gold',
        body: `<div class="kv">
          <dt class="mono">read</dt><dd>Inspect runs, evidence, knowledge and audit.</dd>
          <dt class="mono">run</dt><dd>Launch a business process.</dd>
          <dt class="mono">ask</dt><dd>Ask a grounded knowledge question.</dd>
          <dt class="mono">approve:business</dt><dd>Decide payment, assessment, audit and verification gates.</dd>
          <dt class="mono">approve:memory</dt><dd>Publish or reject candidate memory.</dd>
          <dt class="mono">audit:verify</dt><dd>Recompute the audit hash chain.</dd>
          <dt class="mono">security:read</dt><dd>Read security events and the trust boundary.</dd>
          <dt class="mono">security:screen</dt><dd>Run the deterministic injection screen.</dd>
          <dt class="mono">eval:run</dt><dd>Run the frozen evaluation suite.</dd>
          <dt class="mono">eval:approve</dt><dd>Approve or block a release candidate.</dd>
          <dt class="mono">*</dt><dd>Administrator: provider settings and cross-workspace reads.</dd>
        </div>`
      })}
      ${panel({
        id: 'catalog:shortcuts', title: 'Keyboard', subtitle: 'Two ways to move quickly', iconName: 'bolt', tone: '',
        body: `<div class="kv"><dt class="mono">⌘K / Ctrl K</dt><dd>Command palette: search pages, processes and functions.</dd><dt class="mono">Esc</dt><dd>Close a modal, palette or the mobile sidebar.</dd></div><div class="tiny dim" style="margin-top:9px">Panel collapse and hide are available from every panel header. Hidden panels can be restored from the eye icon in the top bar.</div>`
      })}
    </div>
  </div>`;

  const container = document.getElementById('catalogGroups');
  const count = document.getElementById('catalogCount');
  const search = document.getElementById('catalogSearch');
  const groupSelect = document.getElementById('catalogGroup');

  function paint() {
    const q = query.trim().toLowerCase();
    const list = functions.filter((f) => {
      if (group !== 'all' && f.group !== group) return false;
      if (!q) return true;
      return `${f.id} ${f.label} ${f.description} ${f.route} ${f.permission} ${f.group}`.toLowerCase().includes(q);
    });
    count.textContent = `${list.length} function${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      container.innerHTML = emptyState('No functions match', 'Try “payment”, “memory”, “audit” or clear the search.', 'search');
      return;
    }
    const byGroup = {};
    for (const f of list) (byGroup[f.group] ||= []).push(f);
    container.innerHTML = Object.entries(byGroup).map(([g, rows]) => `<div class="function-group">
      <div class="function-group-head"><div class="row">${icon(GROUP_ICON[g] || 'layers', 16)}<h3>${esc(g)}</h3></div><span class="chip muted">${rows.length}</span></div>
      ${rows.map((f) => {
        const nav = f.enabled && f.route && f.route.startsWith('/') && !f.route.includes(':');
        const tag = nav ? 'button' : 'div';
        return `<${tag} class="function-row" ${nav ? `data-nav="${attr(f.route)}" style="cursor:pointer;text-align:left;border:0;background:transparent;color:inherit;width:100%"` : 'style="opacity:.58"'}>
          <div><div class="function-name">${esc(f.label)} ${f.enabled ? '' : '<span class="chip muted" style="font-size:8px">role-gated</span>'}</div><div class="function-desc">${esc(f.description)}</div></div>
          <div class="function-desc"><span class="mono tiny">${esc(f.id)}</span><br>${esc(f.group)}</div>
          <div class="function-right"><span class="function-code">${esc(f.route)}</span><span class="chip ${f.enabled ? 'jade' : 'muted'}">${esc(f.permission)}</span>${nav ? icon('chevronRight', 14) : ''}</div>
        </${tag}>`;
      }).join('')}
    </div>`).join('');
  }

  search?.addEventListener('input', debounce((e) => { query = e.target.value; paint(); }, 140));
  groupSelect?.addEventListener('change', () => { group = groupSelect.value; paint(); });
  paint();
}

function skeleton() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:140px;margin-bottom:12px"></div><div class="skeleton" style="height:40px;width:min(480px,74vw)"></div><div class="skeleton" style="height:12px;width:min(700px,84vw);margin-top:12px"></div></div></div>
  <div class="grid cols-4">${Array.from({ length: 4 }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:10px;width:44%"></div><div class="skeleton" style="height:30px;width:30%;margin:12px 0"></div><div class="skeleton" style="height:10px;width:70%"></div></div></div>`).join('')}</div>
  <div class="split" style="margin-top:16px"><div class="panel glass"><div class="panel-body">${Array.from({ length: 7 }).map(() => `<div class="skeleton" style="height:44px;margin-bottom:7px"></div>`).join('')}</div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:200px"></div></div></div></div>`;
}

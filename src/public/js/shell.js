/* Workspace shell: demo sign-in, sidebar, topbar, command palette, hidden panels. */

import {
  api, state, esc, attr, icon, toast, openModal, closeModal, navigate, can,
  tenantLabel, emit, on, emptyState, restorePanel, restoreAllPanels, titleCase
} from './core.js';

let aiTimer = null;
let paletteOpen = false;

/* ── Session boot ─────────────────────────────────────────────────────── */

export async function initShell() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });
  on('auth:lost', () => {
    if (state.user) {
      state.user = null;
      state.menu = null;
      renderLogin();
    }
  });
  on('panels:changed', () => {
    const hidden = document.getElementById('hiddenCount');
    if (hidden) hidden.textContent = String(state.hiddenPanels.size);
    const btn = document.getElementById('hiddenBtn');
    if (btn) btn.classList.toggle('has-items', state.hiddenPanels.size > 0);
  });

  try {
    const me = await api('/api/auth/me');
    setSession(me);
    renderShell();
    emit('session:ready');
  } catch (e) {
    if (e.status !== 401) toast(esc(e.message), { tone: 'seal' });
    await renderLogin();
  }
  aiTimer = setInterval(refreshAI, 90_000);
}

function setSession(data) {
  state.user = data.user;
  state.tenant = data.tenant;
  state.tenants = data.tenants || data.user?.tenants || [];
  state.users = data.users || state.users;
}

export function currentUser() { return state.user; }

/* ── Sign in ──────────────────────────────────────────────────────────── */

export async function renderLogin() {
  if (aiTimer) { clearInterval(aiTimer); aiTimer = null; }
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `<div class="boot-screen"><div class="boot-line"><i></i></div></div>`;

  let users = [];
  let tenants = [];
  try {
    const data = await api('/api/auth/users');
    users = data.users || [];
    tenants = data.tenants || [];
  } catch (e) {
    app.innerHTML = `<div class="boot-screen"><div class="boot-mark"><span>JP</span></div><p class="mono">SIGN-IN UNAVAILABLE</p><p class="muted small">${esc(e.message)}</p><button class="btn btn-primary" id="retryLogin">Retry</button></div>`;
    document.getElementById('retryLogin')?.addEventListener('click', renderLogin);
    return;
  }

  let selectedUserId = users[0]?.id || '';
  let selectedTenant = users[0]?.defaultTenant || '';

  app.innerHTML = `<div class="login">
    <section class="login-brand">
      <div class="brand">
        <div class="brand-mark">JP</div>
        <div class="brand-text"><div class="brand-name">Jade Pebble</div><div class="brand-sub">Agentic AI operations</div></div>
      </div>
      <div class="login-kicker">
        <p class="eyebrow">Grounded decision workspace</p>
        <h1 class="login-title">Decisions with <em>evidence</em>, not vibes.</h1>
        <p class="login-lede">Nine agents. One bounded orchestrator. Every material action carries an evidence pack, a deterministic policy check, a verification result and a human gate where it matters.</p>
        <div class="login-principles">
          <div class="principle"><b>Laya routes</b><span>ADVISORY · CANNOT GRANT</span></div>
          <div class="principle"><b>Policy decides</b><span>DETERMINISTIC · BINDING</span></div>
          <div class="principle"><b>Humans authorise</b><span>PAYMENTS · PUBLICATION</span></div>
        </div>
        <div class="login-meta">
          <span class="dot"></span><span>Local-first AI</span>
          <span>·</span><span>Signed demo sessions</span>
          <span>·</span><span>Hash-chained audit</span>
        </div>
      </div>
    </section>
    <section class="login-panel">
      <div>
        <h2>Enter the workspace</h2>
        <p class="sub">Choose a demo identity. Roles and tenant access are enforced on the server — the interface only reflects them.</p>
      </div>
      <div class="identity-grid" id="identityGrid">
        ${users.map((u) => identityCard(u, u.id === selectedUserId)).join('')}
      </div>
      <div class="field">
        <label>Workspace</label>
        <div class="chip-row" id="tenantPicker"></div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="enterBtn">Enter workspace</button>
      <p class="login-note">This is a demonstration environment. Inputs are seeded; every assessment, draft and verification is produced by the configured local model and the deterministic engines. No password is required because the session is a signed demo cookie, not a production identity provider.</p>
    </section>
  </div>`;

  const grid = document.getElementById('identityGrid');
  const tenantPicker = document.getElementById('tenantPicker');
  const enterBtn = document.getElementById('enterBtn');

  function selectedUser() { return users.find((u) => u.id === selectedUserId) || users[0]; }

  function paint() {
    grid.querySelectorAll('[data-login-user]').forEach((el) => {
      el.classList.toggle('selected', el.dataset.loginUser === selectedUserId);
    });
    const u = selectedUser();
    tenantPicker.innerHTML = (u?.tenants || []).map((t) => `<button class="chip ${t.id === selectedTenant ? 'seal' : 'muted'}" data-tenant="${attr(t.id)}" style="cursor:pointer">${esc(t.short || t.name)}</button>`).join('');
    enterBtn.textContent = u ? `Enter as ${u.name}` : 'Enter workspace';
    tenantPicker.querySelectorAll('[data-tenant]').forEach((b) => {
      b.addEventListener('click', () => { selectedTenant = b.dataset.tenant; paint(); });
    });
  }

  grid.querySelectorAll('[data-login-user]').forEach((card) => {
    card.addEventListener('click', () => {
      selectedUserId = card.dataset.loginUser;
      const u = selectedUser();
      selectedTenant = u?.defaultTenant || u?.tenants?.[0]?.id || '';
      paint();
    });
  });

  enterBtn.addEventListener('click', async () => {
    if (!selectedUserId) return;
    enterBtn.disabled = true;
    enterBtn.classList.add('is-loading');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { userId: selectedUserId, tenant: selectedTenant } });
      setSession(data);
      renderShell();
      emit('session:ready');
    } catch (e) {
      toast(esc(e.message), { tone: 'seal', title: 'Sign-in failed' });
      enterBtn.disabled = false;
      enterBtn.classList.remove('is-loading');
    }
  });

  paint();
}

function identityCard(u, selected) {
  const roleTone = u.roles.includes('admin') ? 'seal' : u.roles.includes('reviewer') ? 'jade' : u.roles.includes('security_admin') ? 'gold' : u.roles.includes('harness_owner') ? 'violet' : 'muted';
  return `<button class="identity ${selected ? 'selected' : ''}" data-login-user="${attr(u.id)}">
    <span class="avatar ${u.roles.includes('reviewer') ? 'jade' : u.roles.includes('knowledge_owner') || u.roles.includes('security_admin') ? 'gold' : ''}">${esc(u.initials)}</span>
    <span class="identity-text">
      <b>${esc(u.name)}</b>
      <small>${esc(u.title)}</small>
      <span class="identity-roles"><span class="chip ${roleTone}">${esc(u.roles.join(' · '))}</span><span class="chip muted">${u.tenants.length} workspace${u.tenants.length === 1 ? '' : 's'}</span></span>
    </span>
  </button>`;
}

/* ── Shell ────────────────────────────────────────────────────────────── */

export function renderShell() {
  const app = document.getElementById('app');
  if (!app) return;
  const u = state.user;
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-mark">JP</div>
        <div class="brand-text"><div class="brand-name">Jade Pebble</div><div class="brand-sub">Agentic AI operations</div></div>
      </div>
      <div class="workspace-switch" id="workspaceRoot"></div>
      <nav class="nav" id="navRoot"><div class="nav-section"><div class="nav-label">Workspace</div><div class="skeleton" style="height:32px;margin:4px 8px"></div><div class="skeleton" style="height:32px;margin:4px 8px"></div></div></nav>
      <div class="sidebar-foot" id="sidebarFoot"></div>
    </aside>
    <div class="mobile-overlay" id="mobileOverlay"></div>
    <div class="main">
      <header class="topbar" id="topbar"></header>
      <main class="view" id="view"><div id="viewLoading">${skeletonView()}</div></main>
    </div>
  </div>`;

  document.getElementById('mobileOverlay').addEventListener('click', closeMobile);
  renderWorkspace();
  renderNav();
  renderTopbar();
  renderSidebarFoot();
  updateChrome();
}

export async function updateChrome() {
  if (!state.user) return;
  const q = state.tenant ? `?tenant=${encodeURIComponent(state.tenant)}` : '';
  const [menu, ai] = await Promise.allSettled([
    api(`/api/menu${q}`),
    api('/api/ai/status')
  ]);
  if (menu.status === 'fulfilled') state.menu = menu.value;
  if (ai.status === 'fulfilled') state.ai = ai.value;
  else if (!state.ai) state.ai = { available: false, provider: 'unavailable', model: '—' };
  renderWorkspace();
  renderNav();
  renderTopbar();
  renderSidebarFoot();
  const hidden = document.getElementById('hiddenCount');
  if (hidden) hidden.textContent = String(state.hiddenPanels.size);
}

export async function refreshChrome() { await updateChrome(); }

async function refreshAI() {
  if (!state.user) return;
  try {
    state.ai = await api('/api/ai/status');
    renderTopbar();
    renderSidebarFoot();
  } catch { /* keep last */ }
}

export function setActive(path) {
  state.route = path;
  document.querySelectorAll('.nav-item[data-nav]').forEach((el) => {
    el.classList.toggle('active', isActive(el.dataset.nav));
  });
  renderTopbar();
  closeMobile();
}

function isActive(route) {
  if (!route) return false;
  const path = state.route || '';
  if (path === route) return true;
  if (route !== '/' && path.startsWith(`${route}/`)) return true;
  return false;
}

function renderWorkspace() {
  const root = document.getElementById('workspaceRoot');
  if (!root) return;
  const opts = state.tenants.length ? state.tenants : (state.user?.tenants || []);
  root.innerHTML = `<label for="workspaceSelect">Active workspace</label><div class="select-wrap"><select id="workspaceSelect" aria-label="Active workspace">
    ${opts.map((t) => `<option value="${attr(t.id)}" ${t.id === state.tenant ? 'selected' : ''}>${esc(t.name || t.short || t.id)}</option>`).join('')}
  </select></div>`;
  document.getElementById('workspaceSelect')?.addEventListener('change', (e) => switchWorkspace(e.target.value));
}

function renderNav() {
  const root = document.getElementById('navRoot');
  if (!root) return;
  const sections = state.menu?.sections || [];
  if (!sections.length) {
    root.innerHTML = `<div class="nav-section"><div class="nav-label">Workspace</div><div class="skeleton" style="height:32px;margin:4px 8px"></div><div class="skeleton" style="height:32px;margin:4px 8px"></div></div>`;
    return;
  }
  root.innerHTML = sections.map((s) => {
    const items = (s.items || []).filter((i) => i.enabled !== false);
    if (!items.length) return '';
    return `<div class="nav-section"><div class="nav-label">${esc(s.label)}</div>
      ${items.map((i) => `<button class="nav-item ${isActive(i.route) ? 'active' : ''}" data-nav="${attr(i.route)}" title="${attr(i.description || i.label)}">
        ${icon(i.icon, 17, 'nav-icon')}<span>${esc(i.label)}</span>
        ${i.badge ? `<span class="nav-badge ${i.id === 'memory' ? 'jade' : ''}">${i.badge}</span>` : ''}
      </button>`).join('')}
    </div>`;
  }).join('');
}

function renderTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const found = findNav(state.route || '/overview');
  const tenantName = tenantLabel(state.tenants.find((t) => t.id === state.tenant));
  const ai = state.ai;
  const aiClass = ai?.available ? '' : ai ? 'red' : 'grey';
  const aiText = ai?.available ? `${esc(ai.provider)} · ${esc(ai.model)}` : ai ? 'AI unreachable' : 'Checking AI';
  const hidden = state.hiddenPanels.size;
  bar.innerHTML = `<button class="icon-btn mobile-menu" data-mobile-menu aria-label="Open navigation">${icon('menu', 19)}</button>
    <div class="topbar-left">
      <div class="breadcrumb">
        <span>${esc(tenantName)}</span><span class="sep">/</span>
        <b>${esc(found?.section?.label || 'Workspace')}</b><span class="sep">/</span>
        <span>${esc(found?.item?.label || pageLabel(state.route || '/overview'))}</span>
      </div>
    </div>
    <div class="topbar-actions">
      <button class="search-trigger" data-open-palette aria-label="Search and commands">${icon('search', 15)}<span>Search or command</span><kbd>⌘K</kbd></button>
      <button class="icon-btn ${hidden ? 'has-items' : ''}" id="hiddenBtn" data-open-hidden aria-label="Hidden panels" title="Hidden panels (${hidden})">${icon('eyeOff', 17)}${hidden ? `<span class="count" id="hiddenCount">${hidden}</span>` : '<span class="count" id="hiddenCount" style="display:none">0</span>'}</button>
      <button class="ai-pill" data-nav="/settings" title="${attr(aiText)}"><span class="dot ${aiClass}"></span><b>${esc(ai?.model || 'AI')}</b><span class="dim">${esc(ai?.available ? 'local' : 'offline')}</span></button>
      <button class="user-chip" data-open-user aria-label="Identity and workspace menu">
        <span class="avatar ${state.user?.roles?.includes('reviewer') ? 'jade' : state.user?.roles?.includes('knowledge_owner') || state.user?.roles?.includes('security_admin') ? 'gold' : ''}">${esc(state.user?.initials || 'AR')}</span>
        <span class="user-chip-text"><b>${esc(state.user?.name || '')}</b><small>${esc(state.user?.title || '')}</small></span>
        ${icon('chevronDown', 13)}
      </button>
    </div>`;
  document.getElementById('hiddenBtn')?.classList.toggle('has-items', hidden > 0);
}

function renderSidebarFoot() {
  const root = document.getElementById('sidebarFoot');
  if (!root) return;
  const ai = state.ai;
  const dot = ai?.available ? '' : ai ? 'red' : 'grey';
  root.innerHTML = `<div class="ai-mini"><span class="dot ${dot}"></span><div class="ai-mini-text"><b>${esc(ai?.model || 'Checking model')}</b><small>${esc(ai?.provider || 'local provider')} · ${ai?.available ? 'ready' : ai ? 'unreachable' : 'checking'}</small></div></div>
    <button class="sidebar-link" data-nav="/catalog">${icon('menu', 15)} Function menu</button>
    <button class="sidebar-link" data-signout>${icon('logout', 15)} Sign out</button>`;
}

function findNav(path) {
  const sections = state.menu?.sections || [];
  for (const section of sections) {
    for (const item of section.items || []) {
      if (path === item.route || (item.route !== '/' && path.startsWith(`${item.route}/`))) {
        return { section, item };
      }
    }
  }
  return null;
}

function pageLabel(path) {
  const p = path.split('/').filter(Boolean);
  if (p[0] === 'runs') return p[1] ? 'Run detail' : 'Process runs';
  if (p[0] === 'processes') return p[1] ? 'Process' : 'Process studio';
  if (p[0] === 'knowledge') return 'Knowledge';
  return titleCase(p[0] || 'overview');
}

export function closeMobile() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('mobileOverlay')?.classList.remove('open');
}

export function toggleMobile() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('mobileOverlay')?.classList.toggle('open');
}

export async function switchWorkspace(tenant, { silent = false } = {}) {
  if (!tenant || tenant === state.tenant) return;
  try {
    const data = await api('/api/auth/switch', { method: 'POST', body: { tenant } });
    setSession(data);
    if (!silent) toast(`Workspace switched to <b>${esc(tenantLabel(state.tenants.find((t) => t.id === tenant)))}</b>.`, { tone: 'jade' });
    renderWorkspace();
    renderNav();
    renderTopbar();
    renderSidebarFoot();
    if (!silent) emit('session:ready');
  } catch (e) {
    toast(esc(e.message), { tone: 'seal', title: 'Workspace switch failed' });
    renderWorkspace();
  }
}

export async function switchIdentity(userId) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return;
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { userId: user.id, tenant: user.defaultTenant } });
    setSession(data);
    closeModal();
    renderShell();
    emit('session:ready');
    toast(`Signed in as <b>${esc(user.name)}</b>.`, { tone: 'jade' });
  } catch (e) {
    toast(esc(e.message), { tone: 'seal' });
  }
}

export async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* clear locally anyway */ }
  state.user = null;
  state.menu = null;
  state.ai = null;
  history.replaceState(null, '', location.pathname);
  await renderLogin();
}

/* ── Identity / workspace menu ────────────────────────────────────────── */

export function openUserMenu() {
  const u = state.user;
  const users = state.users || [];
  const modal = openModal({
    title: 'Identity & workspace',
    subtitle: 'Demo identity switching reissues a signed server session. Permissions are recalculated by role.',
    body: `<div class="stack">
      <div class="between"><div><div class="strong">${esc(u?.name || '')}</div><div class="tiny dim">${esc(u?.title || '')} · ${esc(u?.roles?.join(' · ') || '')}</div></div>${icon('user', 20)}</div>
      <div class="divider"></div>
      <div class="field"><label>Workspace</label><div class="chip-row">${state.tenants.map((t) => `<button class="chip ${t.id === state.tenant ? 'seal' : 'muted'}" data-switch-workspace="${attr(t.id)}" style="cursor:pointer">${esc(t.short || t.name)}</button>`).join('')}</div></div>
      <div class="divider"></div>
      <div class="field"><label>Switch identity</label><div class="identity-grid">${users.map((x) => `<button class="identity ${x.id === u?.id ? 'selected' : ''}" data-switch-user="${attr(x.id)}"><span class="avatar ${x.roles.includes('reviewer') ? 'jade' : x.roles.includes('knowledge_owner') || x.roles.includes('security_admin') ? 'gold' : ''}">${esc(x.initials)}</span><span class="identity-text"><b>${esc(x.name)}</b><small>${esc(x.title)}</small></span></button>`).join('')}</div></div>
    </div>`,
    actions: `<button class="btn btn-ghost" data-close-modal>Close</button><button class="btn btn-danger" data-signout>${icon('logout', 15)} Sign out</button>`
  });
  modal.querySelectorAll('[data-switch-workspace]').forEach((b) => b.addEventListener('click', () => { closeModal(); switchWorkspace(b.dataset.switchWorkspace); }));
  modal.querySelectorAll('[data-switch-user]').forEach((b) => b.addEventListener('click', () => switchIdentity(b.dataset.switchUser)));
  modal.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', () => { closeModal(); signOut(); }));
}

export function openHiddenPanels() {
  const entries = [...state.hiddenPanels].map((id) => ({ id, title: state.hiddenMeta[id] || id }));
  const modal = openModal({
    title: 'Hidden panels',
    subtitle: 'Panel visibility is local to this browser. Hiding a panel never deletes its data or audit record.',
    body: entries.length
      ? `<div class="hidden-list">${entries.map((e) => `<div class="hidden-item"><div><div class="strong small">${esc(e.title)}</div><div class="hidden-code tiny dim mono">${esc(e.id)}</div></div><button class="btn btn-sm btn-ghost" data-restore-panel="${attr(e.id)}">${icon('eye', 13)} Restore</button></div>`).join('')}</div>`
      : emptyState('No hidden panels', 'Every panel on the current page is visible. Hide a panel with the eye icon in its header.', 'eye'),
    actions: entries.length
      ? `<button class="btn btn-ghost" data-close-modal>Close</button><button class="btn btn-primary" data-restore-all>Restore all</button>`
      : `<button class="btn btn-ghost" data-close-modal>Close</button>`
  });
  modal.querySelectorAll('[data-restore-panel]').forEach((b) => b.addEventListener('click', () => { restorePanel(b.dataset.restorePanel); openHiddenPanels(); }));
  modal.querySelectorAll('[data-restore-all]').forEach((b) => b.addEventListener('click', () => { restoreAllPanels(); closeModal(); }));
}

/* ── Command palette ──────────────────────────────────────────────────── */

export function openPalette() {
  if (paletteOpen) return;
  paletteOpen = true;
  const root = document.getElementById('modal-root');
  const items = paletteItems();
  let filtered = items.slice(0, 12);
  let active = 0;

  root.innerHTML = `<div class="command-backdrop" id="paletteBackdrop">
    <div class="command" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="command-input-wrap">${icon('search', 18)}<input class="command-input" id="paletteInput" placeholder="Search a page, process or function…" autocomplete="off" spellcheck="false" /><span class="chip muted">ESC</span></div>
      <div class="command-list" id="paletteList"></div>
    </div>
  </div>`;
  document.body.classList.add('no-scroll');
  const input = document.getElementById('paletteInput');
  const list = document.getElementById('paletteList');
  const backdrop = document.getElementById('paletteBackdrop');

  function paint() {
    if (!filtered.length) {
      list.innerHTML = `<div class="empty" style="padding:26px"><b>No matches</b><p>Try “Cradle”, “payment”, “audit” or “settings”.</p></div>`;
      return;
    }
    list.innerHTML = filtered.map((item, i) => `<button class="command-item ${i === active ? 'active' : ''}" data-palette-index="${i}">
      <span class="cmd-icon">${icon(item.icon, 15)}</span>
      <span class="cmd-text"><b>${esc(item.label)}</b><small>${esc(item.desc)}</small></span>
      <kbd>${esc(item.group || item.route)}</kbd>
    </button>`).join('');
    list.querySelectorAll('[data-palette-index]').forEach((el) => {
      el.addEventListener('click', () => choose(Number(el.dataset.paletteIndex)));
    });
  }

  function filter() {
    const q = input.value.trim().toLowerCase();
    filtered = items.filter((i) => !q || `${i.label} ${i.desc} ${i.group} ${i.route}`.toLowerCase().includes(q)).slice(0, 24);
    active = 0;
    paint();
  }

  function choose(index) {
    const item = filtered[index];
    if (!item) return;
    closePalette();
    navigate(item.route);
  }

  function closePalette() {
    paletteOpen = false;
    root.innerHTML = '';
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(filtered.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  }

  input.addEventListener('input', filter);
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePalette(); });
  paint();
  setTimeout(() => input.focus(), 30);
}

function paletteItems() {
  const items = [];
  const seen = new Set();
  for (const section of state.menu?.sections || []) {
    for (const item of section.items || []) {
      if (item.enabled === false || seen.has(item.route)) continue;
      seen.add(item.route);
      items.push({ label: item.label, desc: item.description || '', route: item.route, icon: item.icon, group: section.label });
    }
  }
  for (const f of state.menu?.functions || []) {
    if (f.enabled === false) continue;
    if (f.route === 'everywhere' || f.route.includes(':')) continue;
    if (seen.has(f.route)) continue;
    // Keep the palette focused on destinations, not every UI control.
    if (f.group === 'Interface') continue;
    seen.add(f.route);
    items.push({ label: f.label, desc: f.description || '', route: f.route, icon: 'bolt', group: f.group });
  }
  return items;
}

/* ── Utility ──────────────────────────────────────────────────────────── */

function skeletonView() {
  return `<div class="page-head"><div><div class="skeleton" style="height:12px;width:140px;margin-bottom:12px"></div><div class="skeleton" style="height:38px;width:min(440px,70vw)"></div><div class="skeleton" style="height:12px;width:min(620px,80vw);margin-top:12px"></div></div></div>
  <div class="grid cols-3"><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:18px;width:40%;margin-bottom:12px"></div><div class="skeleton" style="height:12px;width:90%;margin-bottom:8px"></div><div class="skeleton" style="height:12px;width:72%"></div></div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:18px;width:40%;margin-bottom:12px"></div><div class="skeleton" style="height:12px;width:90%;margin-bottom:8px"></div><div class="skeleton" style="height:12px;width:72%"></div></div></div><div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:18px;width:40%;margin-bottom:12px"></div><div class="skeleton" style="height:12px;width:90%;margin-bottom:8px"></div><div class="skeleton" style="height:12px;width:72%"></div></div></div></div>`;
}

export { renderLogin as showLogin };

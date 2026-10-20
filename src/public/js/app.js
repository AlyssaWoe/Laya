/* SPA entry: hash router, global panel controls and session lifecycle. */

import {
  state, esc, icon, navigate, closeModal, toast, statusBanner, pageHead,
  togglePanel, hidePanel, on
} from './core.js';
import {
  initShell, setActive, closeMobile, toggleMobile, openPalette, openHiddenPanels,
  openUserMenu, signOut, renderLogin
} from './shell.js';

import * as overview from './pages/overview.js';
import * as runs from './pages/runs.js';
import * as processes from './pages/processes.js';
import * as agents from './pages/agents.js';
import * as governance from './pages/governance.js';
import * as evaluations from './pages/evaluations.js';
import * as settings from './pages/settings.js';
import * as catalog from './pages/catalog.js';

/* ── Router ───────────────────────────────────────────────────────────── */

function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  const path = raw.split('?')[0] || '/overview';
  return path.startsWith('/') ? path : `/${path}`;
}

let routeSeq = 0;

async function renderRoute() {
  if (!state.user) return;
  const view = document.getElementById('view');
  if (!view) return;
  const seq = ++routeSeq;
  closeModal();
  closeMobile();

  if (state.live) {
    try { state.live.close(); } catch { /* closed already */ }
    state.live = null;
  }

  const path = currentPath();
  state.route = path;
  setActive(path);
  const parts = path.split('/').filter(Boolean);
  const root = parts[0] || 'overview';
  const id = parts[1] ? decodeURIComponent(parts[1]) : null;

  // A fresh mount per navigation means a slow, stale page cannot overwrite a
  // newer route after its fetch resolves.
  view.innerHTML = '';
  const mount = document.createElement('div');
  mount.className = 'page-mount';
  view.appendChild(mount);

  try {
    if (root === 'overview') await overview.render(mount);
    else if (root === 'runs') {
      if (id) await runs.renderDetail(mount, id);
      else await runs.renderList(mount);
    }
    else if (root === 'processes') await processes.render(mount, id);
    else if (root === 'agents') await agents.renderAgents(mount);
    else if (root === 'skills') await agents.renderSkills(mount);
    else if (root === 'approvals') await governance.renderApprovals(mount);
    else if (root === 'audit') await governance.renderAudit(mount);
    else if (root === 'memory') await governance.renderMemory(mount);
    else if (root === 'knowledge') await governance.renderKnowledge(mount);
    else if (root === 'security') await governance.renderSecurity(mount);
    else if (root === 'evaluations') await evaluations.renderEvaluations(mount);
    else if (root === 'settings') await settings.renderSettings(mount);
    else if (root === 'catalog') await catalog.renderCatalog(mount);
    else {
      mount.innerHTML = `${pageHead({ eyebrow: 'Not found', title: 'This route does not exist.', actions: `<button class="btn btn-primary" data-nav="/overview">${icon('grid', 15)} Back to overview</button>` })}
        <div class="callout callout-warn">${icon('alertTriangle', 17)}<div>The workspace has no page at <span class="mono">${esc(path)}</span>. The function menu lists every route.</div></div>`;
    }
  } catch (e) {
    mount.innerHTML = `${pageHead({ eyebrow: 'Workspace error', title: 'This view could not be rendered.', actions: `<button class="btn btn-ghost" data-nav="/catalog">${icon('menu', 15)} Function menu</button>` })}
      ${statusBanner('fail', 'The page failed to load', esc(e.message || 'Unknown error'), 'xCircle')}`;
    console.error('[route]', path, e);
  }

  if (seq === routeSeq) {
    document.title = titleFor(root, parts) + ' · Jade Pebble';
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function titleFor(root, parts) {
  const map = {
    overview: 'Overview', runs: parts[1] ? 'Run detail' : 'Process runs', processes: 'Process studio',
    agents: 'Agent directory', skills: 'Skills library', approvals: 'Approvals', audit: 'Audit trail',
    memory: 'Memory', knowledge: 'Knowledge base', security: 'Security', evaluations: 'Evaluations',
    settings: 'Settings', catalog: 'Function menu'
  };
  return map[root] || 'Workspace';
}

/* ── Global click delegation ──────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    closeModal();
    navigate(nav.dataset.nav);
    return;
  }
  const collapse = e.target.closest('[data-collapse]');
  if (collapse) {
    e.preventDefault();
    togglePanel(collapse.closest('[data-panel]'));
    return;
  }
  const hide = e.target.closest('[data-hide-panel]');
  if (hide) {
    e.preventDefault();
    hidePanel(hide.closest('[data-panel]'));
    return;
  }
  if (e.target.closest('[data-mobile-menu]')) { toggleMobile(); return; }
  if (e.target.closest('[data-mobile-overlay]')) { closeMobile(); return; }
  if (e.target.closest('[data-open-palette]')) { openPalette(); return; }
  if (e.target.closest('[data-open-hidden]')) { openHiddenPanels(); return; }
  if (e.target.closest('[data-open-user]')) { openUserMenu(); return; }
  if (e.target.closest('[data-signout]')) { signOut(); return; }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMobile();
  }
});

/* ── Lifecycle ────────────────────────────────────────────────────────── */

on('session:ready', () => {
  renderRoute();
});

window.addEventListener('hashchange', () => {
  if (state.user) renderRoute();
});

window.addEventListener('error', (e) => {
  console.error('[window]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[promise]', e.reason);
});

initShell().catch((e) => {
  console.error('[boot]', e);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `<div class="boot-screen"><div class="boot-mark"><span>JP</span></div><p class="mono">BOOT FAILED</p><p class="muted small">${esc(e.message)}</p><button class="btn btn-primary" id="bootReload">Reload</button></div>`;
    document.getElementById('bootReload')?.addEventListener('click', () => location.reload());
  }
});

export { renderRoute };

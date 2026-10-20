/* Global state, API, formatting, panels, toasts and small UI primitives. */

export const state = {
  user: null,
  tenant: null,
  tenants: [],
  users: [],
  menu: null,
  ai: null,
  poi: null,
  hiddenPanels: new Set(JSON.parse(localStorage.getItem('ar:hiddenPanels') || '[]')),
  hiddenMeta: JSON.parse(localStorage.getItem('ar:hiddenMeta') || '{}'),
  collapsed: JSON.parse(localStorage.getItem('ar:collapsed') || '{}'),
  live: null,
  lastRoute: null
};

const listeners = new EventTarget();
export function on(event, handler) { listeners.addEventListener(event, handler); return () => listeners.removeEventListener(event, handler); }
export function emit(event, detail) { listeners.dispatchEvent(new CustomEvent(event, { detail })); }

/* ── API ──────────────────────────────────────────────────────────────── */

export async function api(path, { method = 'GET', body, signal } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    err.details = data?.error?.details;
    if (res.status === 401) {
      state.user = null;
      emit('auth:lost');
    }
    throw err;
  }
  return data;
}

/* ── Formatting ───────────────────────────────────────────────────────── */

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
export function attr(value) { return esc(value).replaceAll('`', '&#96;'); }

export function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
}
export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
export function relTime(iso) {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(delta)) return '—';
  if (delta < 45_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}
export function money(value, currency = 'MYR') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const formatted = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 }).format(n);
  return `${currency === 'MYR' ? 'RM' : currency} ${formatted}`;
}
export function pct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}
export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'AR';
}
export function shortHash(hash, chars = 10) {
  if (!hash) return '—';
  return `${String(hash).slice(0, chars)}…`;
}
export function humanize(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replaceAll('.', ' · ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
export function titleCase(value) {
  return String(value || '').replace(/(^|[\s-])\w/g, (c) => c.toUpperCase());
}
export function lines(value) {
  return String(value || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
export function truncate(value, max = 220) {
  const s = String(value || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
export function debounce(fn, ms = 240) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ── Icons ────────────────────────────────────────────────────────────── */

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  pulse: '<path d="M3 12h4l2.5-7 4.5 14 2.5-7H21"/>',
  workflow: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h4a3 3 0 0 1 3 3v6"/><path d="M6 9v4a3 3 0 0 0 3 3h6"/>',
  nodes: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.5 6h7M7 8.2l4 7.6M17 8.2l-4 7.6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/><path d="M8 7h8M8 11h6"/>',
  stamp: '<path d="M5 21h14"/><path d="M7 18h10v3H7z"/><path d="M8 18V9a4 4 0 1 1 8 0v9"/><path d="M10 9h4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  layers: '<path d="M12 3L3 8l9 5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6L5 20a1.5 1.5 0 0 0 1.3 2h11.4A1.5 1.5 0 0 0 19 20L14 9V3"/><path d="M7.5 15h9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 9 4.5 10 7a12 12 0 0 1-3 4.2"/><path d="M6.2 6.2C3.9 8 2.4 10.4 2 12a12 12 0 0 0 4.6 5.6A10.8 10.8 0 0 0 12 19c1.2 0 2.4-.2 3.4-.6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.6"/><path d="M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  shield: '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 4 5.5"/>',
  logout: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v6h5"/><path d="M9 13h7M9 17h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l3 3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><rect x="10" y="10" width="4" height="4"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUpRight: '<path d="M7 17L17 7M8 7h9v9"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 7v6a4 4 0 0 0 4 4h2"/><path d="M18 9v7"/><path d="M8 5h6a3 3 0 0 1 3 3v1"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  alertTriangle: '<path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17h.01"/>',
  alertCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  dot: '<circle cx="12" cy="12" r="4"/>'
};

export function icon(name, size = 18, extraClass = '') {
  const body = ICONS[name] || ICONS.dot;
  return `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ── Domain labels ────────────────────────────────────────────────────── */

export const AGENTS = {
  A1: { name: 'Laya', role: 'Orchestrator', tone: 'seal' },
  A2: { name: 'RAG + Wiki', role: 'Knowledge', tone: 'jade' },
  A3: { name: 'Cradle Fund', role: 'Specialist', tone: 'jade' },
  A4: { name: 'PartnerFlow Audit', role: 'Specialist', tone: 'gold' },
  A5: { name: 'Payment', role: 'Specialist', tone: 'gold' },
  A6: { name: 'CMO Trend', role: 'Specialist', tone: 'violet' },
  A7: { name: 'Memory', role: 'Learning', tone: 'blue' },
  A8: { name: 'Verifier', role: 'Control', tone: 'seal' },
  A9: { name: 'Harness²', role: 'Improvement', tone: 'violet' }
};

export function agentLabel(id) {
  const a = AGENTS[id];
  return a ? (a.name === id ? a.name : `${id} ${a.name}`) : id || 'System';
}
export function agentTone(id) { return AGENTS[id]?.tone || 'seal'; }

export function statusChip(status, extra = '') {
  const s = String(status || '').toLowerCase();
  const map = {
    completed: ['jade', 'Completed'], pass: ['jade', 'Pass'], passed: ['jade', 'Passed'],
    eligible: ['jade', 'Eligible'], approved: ['jade', 'Approved'], published: ['jade', 'Published'],
    allowed: ['jade', 'Allowed'], measured: ['jade', 'Measured'], ok: ['jade', 'OK'],
    running: ['gold', 'Running'], queued: ['gold', 'Queued'], pending: ['gold', 'Pending'],
    awaiting_attention: ['gold', 'Awaiting attention'], awaiting_approval: ['gold', 'Awaiting approval'],
    needs_review: ['gold', 'Needs review'], pass_with_notes: ['gold', 'Pass with notes'],
    insufficient_evidence: ['gold', 'Insufficient evidence'], flagged: ['gold', 'Flagged'],
    no_improvement: ['gold', 'No improvement'], candidate: ['gold', 'Candidate'],
    fail: ['red', 'Fail'], failed: ['red', 'Failed'], blocked: ['red', 'Blocked'],
    rejected: ['red', 'Rejected'], ineligible: ['red', 'Ineligible'], expired: ['red', 'Expired'],
    deny: ['red', 'Deny'], invalid: ['red', 'Invalid'], critical: ['red', 'Critical'],
    high: ['seal', 'High'], medium: ['gold', 'Medium'], low: ['jade', 'Low'],
    none: ['muted', 'None'], unknown: ['muted', 'Unknown']
  };
  const [tone, label] = map[s] || ['muted', titleCase(status || 'unknown')];
  return `<span class="chip ${tone} ${extra}">${esc(label)}</span>`;
}

export function riskChip(risk) {
  const r = String(risk || 'low').toLowerCase();
  return `<span class="chip ${r === 'high' || r === 'critical' ? 'red' : r === 'medium' ? 'gold' : 'jade'}">${esc(r === 'critical' ? 'Critical risk' : `${r} risk`)}</span>`;
}

export function tenantLabel(t) {
  if (!t) return 'All workspaces';
  return typeof t === 'string' ? titleCase(t.replaceAll('-', ' ')) : (t.short || t.name || t.id);
}

/* ── Panels ───────────────────────────────────────────────────────────── */

export function panel({ id, title, subtitle = '', iconName = 'layers', tone = '', body = '', actions = '', className = '', flush = false }) {
  const collapsed = state.collapsed[id] ? ' is-collapsed' : '';
  const hidden = state.hiddenPanels.has(id) ? ' is-hidden' : '';
  return `<section class="panel glass ${tone ? `tone-${tone}` : ''} ${flush ? 'flush' : ''} ${className}${collapsed}${hidden}" data-panel="${attr(id)}" id="panel-${attr(id)}">
  <header class="panel-head">
    <div class="panel-title-wrap">
      <div class="panel-icon ${tone}">${icon(iconName)}</div>
      <div><h3 class="panel-title">${esc(title)}</h3>${subtitle ? `<p class="panel-sub">${esc(subtitle)}</p>` : ''}</div>
    </div>
    <div class="panel-actions">
      ${actions}
      <button class="panel-btn" data-collapse title="Collapse panel" aria-label="Collapse ${attr(title)}">${icon('chevronDown', 15)}</button>
      <button class="panel-btn" data-hide-panel title="Hide panel" aria-label="Hide ${attr(title)}">${icon('eyeOff', 15)}</button>
    </div>
  </header>
  <div class="panel-body">${body}</div>
</section>`;
}

export function applyPanelState(root = document) {
  root.querySelectorAll('[data-panel]').forEach((el) => {
    const id = el.dataset.panel;
    el.classList.toggle('is-collapsed', !!state.collapsed[id]);
    el.classList.toggle('is-hidden', state.hiddenPanels.has(id));
    const btn = el.querySelector('[data-collapse]');
    if (btn) btn.setAttribute('aria-expanded', state.collapsed[id] ? 'false' : 'true');
  });
}

export function togglePanel(el) {
  const id = el?.dataset?.panel;
  if (!id) return;
  if (state.collapsed[id]) delete state.collapsed[id];
  else state.collapsed[id] = true;
  localStorage.setItem('ar:collapsed', JSON.stringify(state.collapsed));
  el.classList.toggle('is-collapsed', !!state.collapsed[id]);
  el.querySelector('[data-collapse]')?.setAttribute('aria-expanded', state.collapsed[id] ? 'false' : 'true');
}

export function hidePanel(el) {
  const id = el?.dataset?.panel;
  if (!id) return;
  const title = el.querySelector('.panel-title')?.textContent || id;
  state.hiddenPanels.add(id);
  state.hiddenMeta[id] = title;
  persistHidden();
  el.classList.add('is-hidden');
  emit('panels:changed');
  toast(`<b>${esc(title)}</b> hidden. Restore it from the hidden-panels menu.`, { tone: 'gold', timeout: 3800 });
}

export function restorePanel(id) {
  state.hiddenPanels.delete(id);
  delete state.hiddenMeta[id];
  persistHidden();
  const el = document.querySelector(`[data-panel="${cssEscape(id)}"]`);
  if (el) el.classList.remove('is-hidden');
  emit('panels:changed');
}

export function restoreAllPanels() {
  const ids = [...state.hiddenPanels];
  state.hiddenPanels.clear();
  state.hiddenMeta = {};
  persistHidden();
  ids.forEach((id) => document.querySelector(`[data-panel="${cssEscape(id)}"]`)?.classList.remove('is-hidden'));
  emit('panels:changed');
  toast('All hidden panels restored.', { tone: 'jade' });
}

function persistHidden() {
  localStorage.setItem('ar:hiddenPanels', JSON.stringify([...state.hiddenPanels]));
  localStorage.setItem('ar:hiddenMeta', JSON.stringify(state.hiddenMeta));
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/* ── Toast + modal ────────────────────────────────────────────────────── */

export function toast(message, { tone = '', timeout = 4200, title = '' } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `<span>${tone === 'jade' ? icon('checkCircle', 17) : tone === 'seal' ? icon('alertCircle', 17) : tone === 'gold' ? icon('alertTriangle', 17) : icon('info', 17)}</span>
    <div>${title ? `<b>${esc(title)}</b><br>` : ''}${message}</div>
    <button class="toast-close" aria-label="Dismiss">${icon('x', 14)}</button>`;
  const close = () => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 180); };
  el.querySelector('.toast-close').addEventListener('click', close);
  root.appendChild(el);
  if (timeout) setTimeout(close, timeout);
}

let modalCleanup = null;
export function openModal({ title, subtitle = '', body, actions = '', wide = false, onOpen }) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${attr(title)}">
      <div class="modal-head">
        <div><h2 class="modal-title">${esc(title)}</h2>${subtitle ? `<p class="modal-sub">${esc(subtitle)}</p>` : ''}</div>
        <button class="modal-close" data-close-modal aria-label="Close">${icon('x', 16)}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions ? `<div class="modal-actions">${actions}</div>` : ''}
    </div>
  </div>`;
  document.body.classList.add('no-scroll');
  const backdrop = root.querySelector('[data-modal-backdrop]');
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  const onClick = (e) => {
    if (e.target.closest('[data-close-modal]') || e.target === backdrop) closeModal();
  };
  backdrop.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  modalCleanup = () => {
    backdrop.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };
  onOpen?.(root.querySelector('.modal'));
  return root.querySelector('.modal');
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  modalCleanup?.();
  modalCleanup = null;
}

export function confirmAction({ title, body, confirmLabel = 'Confirm', tone = 'primary', note = false, noteLabel = 'Decision note (optional)' }) {
  return new Promise((resolve) => {
    const id = `confirm-${Date.now()}`;
    const modal = openModal({
      title, body: `<div class="stack">${body}${note ? `<div class="field"><label for="${id}-note">${esc(noteLabel)}</label><textarea class="textarea" id="${id}-note" placeholder="Why this decision? This is recorded in the audit trail."></textarea></div>` : ''}</div>`,
      actions: `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn ${tone === 'danger' ? 'btn-danger' : tone === 'jade' ? 'btn-jade' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>`
    });
    modal.querySelector('[data-confirm]').addEventListener('click', () => {
      const value = note ? modal.querySelector(`#${id}-note`)?.value || '' : '';
      closeModal();
      resolve({ confirmed: true, note: value });
    });
    modal.querySelector('[data-close-modal]').addEventListener('click', () => resolve({ confirmed: false, note: '' }));
    const backdrop = document.querySelector('[data-modal-backdrop]');
    backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) resolve({ confirmed: false, note: '' }); });
  });
}

/* ── Misc UI ──────────────────────────────────────────────────────────── */

export function pageHead({ eyebrow = '', title, sub = '', actions = '' }) {
  return `<div class="page-head">
    <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1 class="page-title">${title}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

export function emptyState(title, body = '', iconName = 'layers', action = '') {
  return `<div class="empty"><div class="empty-icon">${icon(iconName, 20)}</div><b>${esc(title)}</b>${body ? `<p>${body}</p>` : ''}${action}</div>`;
}

export function skeletonPanels(n = 3) {
  return `<div class="grid cols-3">${Array.from({ length: n }).map(() => `<div class="panel glass"><div class="panel-body"><div class="skeleton" style="height:18px;width:42%;margin-bottom:12px"></div><div class="skeleton" style="height:12px;width:90%;margin-bottom:7px"></div><div class="skeleton" style="height:12px;width:74%"></div></div></div>`).join('')}</div>`;
}

export function sparkline(values, { width = 300, height = 40, tone = 'jade' } = {}) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / (nums.length - 1);
  const pts = nums.map((n, i) => `${(i * step).toFixed(1)},${(height - ((n - min) / span) * (height - 6) - 3).toFixed(1)}`);
  const d = `M${pts.join(' L')}`;
  const area = `${d} L${width},${height} L0,${height} Z`;
  const gradId = `sg-${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trend sparkline">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${tone === 'seal' ? '#ef5c4c' : '#46d6a2'}" stop-opacity=".28"/><stop offset="100%" stop-color="${tone === 'seal' ? '#ef5c4c' : '#46d6a2'}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gradId})" stroke="none"></path>
    <path d="${d}" style="stroke:${tone === 'seal' ? '#ef5c4c' : '#46d6a2'}"></path>
  </svg>`;
}

export function barRow(label, value, max, { tone = '' } = {}) {
  const pctValue = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="bar-row"><span class="dim tiny">${esc(label)}</span><div class="bar ${tone}"><i style="width:${pctValue}%"></i></div><span class="num small">${Number(value).toLocaleString('en-MY')}</span></div>`;
}

export function can(permission) {
  const p = state.user?.permissions || [];
  return p.includes('*') || p.includes(permission);
}

export function navigate(path) {
  if (location.hash === `#${path}`) return;
  location.hash = path;
}

export function hashQuery() {
  const hash = location.hash.replace(/^#/, '');
  return hash.includes('?') ? new URLSearchParams(hash.split('?')[1]) : new URLSearchParams();
}

export async function copyText(text, label = 'Copied to clipboard.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, { tone: 'jade' });
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(label, { tone: 'jade' }); }
    catch { toast('Copy failed. Select the text manually.', { tone: 'seal' }); }
    ta.remove();
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

export function timeAgoOrDate(iso) { return relTime(iso); }

export function statusBanner(tone, title, body, iconName) {
  const i = iconName || (tone === 'pass' ? 'checkCircle' : tone === 'fail' ? 'xCircle' : 'alertTriangle');
  return `<div class="status-banner ${tone}"><div class="status-icon ${tone}">${icon(i, 18)}</div><div><h3>${esc(title)}</h3><p>${body}</p></div></div>`;
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, KNOWLEDGE_DIR, SRC_DIR } from './config.js';

const DB_PATH = process.env.ALPHARED_DB || path.join(DATA_DIR, 'alphared.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS knowledge_docs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    version TEXT NOT NULL,
    owner TEXT,
    authority TEXT,
    classification TEXT,
    effective_at TEXT,
    review_at TEXT,
    body TEXT,
    hash TEXT,
    source TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS rules (
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    version TEXT,
    note TEXT,
    active INTEGER DEFAULT 1,
    PRIMARY KEY (key, doc_id)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    process TEXT NOT NULL,
    agent_id TEXT,
    case_id TEXT,
    title TEXT,
    request TEXT,
    status TEXT NOT NULL,
    stage TEXT,
    risk TEXT,
    strategy TEXT,
    outcome TEXT,
    approval_required INTEGER DEFAULT 0,
    actor TEXT,
    created_at TEXT,
    updated_at TEXT,
    completed_at TEXT,
    meta TEXT
  );

  CREATE TABLE IF NOT EXISTS run_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    seq INTEGER,
    title TEXT,
    status TEXT,
    summary TEXT,
    input TEXT,
    output TEXT,
    evidence TEXT,
    checks TEXT,
    model TEXT,
    provider TEXT,
    duration_ms INTEGER,
    tokens_in INTEGER,
    tokens_out INTEGER,
    error TEXT,
    started_at TEXT,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    run_id TEXT,
    type TEXT,
    title TEXT,
    detail TEXT,
    risk TEXT,
    status TEXT,
    requested_by TEXT,
    assigned_role TEXT,
    decided_by TEXT,
    decision_note TEXT,
    payload TEXT,
    idempotency_key TEXT,
    created_at TEXT,
    decided_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant TEXT,
    actor TEXT,
    action TEXT,
    object_type TEXT,
    object_id TEXT,
    detail TEXT,
    hash TEXT,
    prev_hash TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    run_id TEXT,
    title TEXT,
    statement TEXT,
    scope TEXT,
    source TEXT,
    confidence REAL,
    status TEXT,
    authority TEXT,
    expires_at TEXT,
    created_by TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    note TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    kind TEXT,
    severity TEXT,
    actor TEXT,
    route TEXT,
    detail TEXT,
    blocked INTEGER,
    run_id TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    agent_id TEXT,
    provider TEXT,
    model TEXT,
    purpose TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    duration_ms INTEGER,
    status TEXT,
    error TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS evals (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    suite TEXT,
    candidate TEXT,
    status TEXT,
    baseline_score REAL,
    candidate_score REAL,
    cases_json TEXT,
    details TEXT,
    created_at TEXT,
    completed_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    release_version TEXT,
    rollback_to TEXT
  );

  CREATE TABLE IF NOT EXISTS eval_cases (
    id TEXT PRIMARY KEY,
    suite TEXT,
    name TEXT,
    input TEXT,
    check_type TEXT,
    expected TEXT,
    weight INTEGER
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    customer TEXT,
    customer_status TEXT,
    currency TEXT,
    amount REAL,
    paid REAL,
    credits REAL,
    due_date TEXT,
    issued_at TEXT,
    last_reminded_at TEXT,
    last_stage TEXT,
    dispute_note TEXT,
    strategic INTEGER DEFAULT 0,
    contact_email TEXT
  );

  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    applicant TEXT,
    registration TEXT,
    incorporated_at TEXT,
    equity_pct REAL,
    months_operating INTEGER,
    requested_amount REAL,
    matching_amount REAL,
    active_grants INTEGER,
    tax_clearance TEXT,
    docs TEXT,
    stage TEXT,
    reviewer TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_cases (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    claim_id TEXT,
    amount REAL,
    approved_amount REAL,
    events TEXT,
    source TEXT,
    status TEXT
  );

  CREATE TABLE IF NOT EXISTS metrics_daily (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    date TEXT,
    channel TEXT,
    qualified_leads INTEGER,
    won INTEGER,
    revenue REAL,
    cycle_days REAL,
    followups INTEGER,
    partners_active INTEGER
  );

  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    run_id TEXT,
    type TEXT,
    object_id TEXT,
    stage TEXT,
    idempotency_key TEXT UNIQUE,
    status TEXT,
    payload TEXT,
    created_at TEXT,
    sent_at TEXT,
    reconciled_at TEXT,
    simulated INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    tenant TEXT,
    title TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    role TEXT,
    content TEXT,
    citations TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_steps_run ON run_steps(run_id, seq);
  CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant, seq DESC);
  CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(tenant, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_security_tenant ON security_events(tenant, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_run ON ai_calls(run_id);
  CREATE INDEX IF NOT EXISTS idx_metrics ON metrics_daily(tenant, date);
`);

export const now = () => new Date().toISOString();
export const uid = (prefix = 'id') => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export function all(sql, ...params) { return db.prepare(sql).all(...params); }
export function get(sql, ...params) { return db.prepare(sql).get(...params) || null; }
export function run(sql, ...params) { return db.prepare(sql).run(...params); }
export function parse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
export function stringify(value) { return JSON.stringify(value ?? null); }

export function setMeta(key, value) {
  run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
export function getMeta(key, fallback = null) {
  const row = get('SELECT value FROM meta WHERE key = ?', key);
  return row ? row.value : fallback;
}

/* ── Knowledge sync ───────────────────────────────────────────────────── */

function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: match[2].trim() };
}

export function syncKnowledge() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return { synced: 0 };
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  let synced = 0;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.id) continue;
    const hash = sha256(body);
    const existing = get('SELECT hash, version FROM knowledge_docs WHERE id = ?', meta.id);
    if (existing && existing.hash === hash && existing.version === meta.version) continue;
    run(`INSERT INTO knowledge_docs
      (id, title, version, owner, authority, classification, effective_at, review_at, body, hash, source, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, version=excluded.version, owner=excluded.owner,
        authority=excluded.authority, classification=excluded.classification,
        effective_at=excluded.effective_at, review_at=excluded.review_at,
        body=excluded.body, hash=excluded.hash, source=excluded.source, active=1`,
      meta.id, meta.title || meta.id, meta.version || '1.0.0', meta.owner || '', meta.authority || 'L2-wiki',
      meta.classification || 'internal', meta.effective_at || '', meta.review_at || '', body, hash, file, now());
    synced++;
  }
  return { synced, total: files.length };
}

export function syncRules() {
  const file = path.join(SRC_DIR, 'server', 'rules.seed.json');
  let rules = [];
  try { rules = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  for (const r of rules) {
    run(`INSERT INTO rules (key, value, doc_id, version, note, active) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(key, doc_id) DO UPDATE SET value=excluded.value, version=excluded.version, note=excluded.note, active=1`,
      r.key, String(r.value), r.doc_id, r.version || '', r.note || '');
  }
  return rules.length;
}

/* ── Audit chain ──────────────────────────────────────────────────────── */

export function appendAudit({ tenant = 'alpha-red', actor = 'system', action, objectType = 'system', objectId = '-', detail = {} }) {
  const prev = get('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1');
  const prevHash = prev ? prev.hash : 'GENESIS';
  const createdAt = now();
  const payload = [prevHash, tenant, actor, action, objectType, objectId, stringify(detail), createdAt].join('|');
  const hash = sha256(payload);
  const res = run(`INSERT INTO audit_events (tenant, actor, action, object_type, object_id, detail, hash, prev_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tenant, actor, action, objectType, objectId, stringify(detail), hash, prevHash, createdAt);
  return { seq: Number(res.lastInsertRowid), hash, prevHash, createdAt };
}

export function verifyAuditChain() {
  const rows = all('SELECT * FROM audit_events ORDER BY seq ASC');
  let prevHash = 'GENESIS';
  for (const row of rows) {
    const payload = [prevHash, row.tenant, row.actor, row.action, row.object_type, row.object_id, row.detail, row.created_at].join('|');
    if (row.prev_hash !== prevHash || row.hash !== sha256(payload)) {
      return { valid: false, checked: rows.length, brokenAt: row.seq };
    }
    prevHash = row.hash;
  }
  return { valid: true, checked: rows.length, brokenAt: null, head: prevHash };
}

export function auditTail(limit = 20) {
  return all('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?', limit);
}

/* ── Telemetry ────────────────────────────────────────────────────────── */

export function logAiCall({ runId = null, agentId = null, provider, model, purpose, tokensIn = 0, tokensOut = 0, durationMs = 0, status = 'ok', error = null }) {
  run(`INSERT INTO ai_calls (id, run_id, agent_id, provider, model, purpose, tokens_in, tokens_out, duration_ms, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid('ai'), runId, agentId, provider, model, purpose, tokensIn, tokensOut, durationMs, status, error ? String(error).slice(0, 500) : null, now());
}

export function logSecurity({ tenant = 'alpha-red', kind, severity = 'medium', actor = 'system', route = '', detail = {}, blocked = false, runId = null }) {
  const id = uid('sec');
  run(`INSERT INTO security_events (id, tenant, kind, severity, actor, route, detail, blocked, run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, tenant, kind, severity, actor, route, stringify(detail), blocked ? 1 : 0, runId, now());
  appendAudit({ tenant, actor, action: blocked ? 'security.blocked' : 'security.flagged', objectType: 'security_event', objectId: id, detail: { kind, severity, route } });
  return id;
}

export function addApproval(a) {
  const id = a.id || uid('apr');
  run(`INSERT INTO approvals (id, tenant, run_id, type, title, detail, risk, status, requested_by, assigned_role, payload, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, a.tenant, a.runId || null, a.type, a.title, a.detail || '', a.risk || 'medium', a.status || 'pending',
    a.requestedBy || 'system', a.assignedRole || 'reviewer', stringify(a.payload || {}), a.idempotencyKey || null, now());
  return id;
}

export function addOutbox(o) {
  const id = o.id || uid('out');
  run(`INSERT INTO outbox (id, tenant, run_id, type, object_id, stage, idempotency_key, status, payload, created_at, sent_at, simulated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.tenant, o.runId || null, o.type, o.objectId, o.stage || null, o.idempotencyKey, o.status || 'queued',
    stringify(o.payload || {}), now(), o.sentAt || null, o.simulated === false ? 0 : 1);
  return id;
}

export function settingsGet(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? parse(row.value, row.value) : fallback;
}
export function settingsSet(key, value) {
  run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    key, stringify(value), now());
}

export function startStep(runId, agentId, title, input = null, seq = 1) {
  const id = uid('stp');
  run(`INSERT INTO run_steps (id, run_id, agent_id, seq, title, status, input, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`, id, runId, agentId, seq, title, stringify(input), now());
  return id;
}

export function finishStep(id, patch = {}) {
  const step = get('SELECT * FROM run_steps WHERE id = ?', id);
  if (!step) return;
  run(`UPDATE run_steps SET status=?, summary=?, output=?, evidence=?, checks=?, model=?, provider=?, duration_ms=?, tokens_in=?, tokens_out=?, error=?, ended_at=?
    WHERE id=?`,
    patch.status || 'completed', patch.summary || step.summary || '', stringify(patch.output ?? parse(step.output, {})),
    stringify(patch.evidence ?? parse(step.evidence, [])), stringify(patch.checks ?? parse(step.checks, [])),
    patch.model || step.model || '', patch.provider || step.provider || '', patch.durationMs ?? step.duration_ms ?? 0,
    patch.tokensIn ?? step.tokens_in ?? 0, patch.tokensOut ?? step.tokens_out ?? 0,
    patch.error || null, now(), id);
}

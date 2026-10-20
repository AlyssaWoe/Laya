import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

import { SERVER, PUBLIC_DIR, ROOT_DIR, getProviderConfig, describeProvider, saveProviderConfig } from './config.js';
import { all, get, parse, verifyAuditChain, syncKnowledge, syncRules, appendAudit } from './db.js';
import { readSession, requireSession, createSession, clearSessionCookie, publicUser, listUsers, can, assertTenantAccess, TENANTS } from './auth.js';
import { screen, INJECTION_CORPUS } from './security.js';
import { buildEvidencePack, retrieve, refreshIndex, knowledgeStats } from './rag.js';
import { allConflicts, thresholdSnapshot } from './rules.js';
import { agentCatalog, getSkills, PROCESSES } from './agents.js';
import { getAIStatus, listOllamaModels, testProvider } from './ai.js';
import { seedBusinessData, DEMO_DATASET_LABEL } from './seed.js';
import {
  startRun, getRun, listRuns, listApprovals, decideApproval, subscribe, unsubscribe, overview
} from './orchestrator.js';
import { menuPayload, knowledgeDocs, memoryList, securityList, datasetPayload, auditPayload } from './registry.js';
import { evaluationSummary, startEvaluation, getEvaluation, decideEvaluation } from './evaluator.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "connect-src 'self'"
  ].join('; ')
};

function sendJson(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
    ...extra
  });
  res.end(body);
}

function httpError(status, code, message, details = null) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  e.details = details;
  return e;
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'BODY_TOO_LARGE', 'Request body exceeds the 256 KB limit.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(httpError(400, 'INVALID_JSON', 'Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function requirePermission(session, permission) {
  if (!can(session.user, permission)) {
    throw httpError(403, 'PERMISSION_DENIED', `This identity lacks the ${permission} permission.`, { permission });
  }
}

function resolveTenant(session, requested) {
  if (!requested) return session.tenant;
  if (requested === 'all') {
    if (session.user.roles.includes('admin') || session.user.roles.includes('principal')) return null;
    throw httpError(403, 'TENANT_ACCESS_DENIED', 'Only an administrator can read across workspaces.');
  }
  assertTenantAccess(session.user, requested);
  return requested;
}

function checkOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return; // local API tooling
  const allowed = [`http://127.0.0.1:${SERVER.port}`, `http://localhost:${SERVER.port}`];
  if (!allowed.includes(origin)) throw httpError(403, 'ORIGIN_DENIED', 'Cross-origin state changes are not allowed.');
}

function sessionContext(req) {
  return requireSession(req);
}

/* ── API router ───────────────────────────────────────────────────────── */

async function handleApi(req, res, url, parts) {
  const method = req.method;
  const session = readSession(req);

  if (parts[1] === 'auth') {
    if (parts[2] === 'login' && method === 'POST') {
      const body = await readBody(req);
      const s = createSession(String(body.userId || ''), body.tenant);
      return sendJson(res, 200, {
        user: publicUser(s.user), tenant: s.tenant,
        tenants: s.user.tenants.map((t) => TENANTS[t]).filter(Boolean),
        users: listUsers()
      }, { 'Set-Cookie': s.cookie });
    }
    if (parts[2] === 'switch' && method === 'POST') {
      if (!session) throw httpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      const body = await readBody(req);
      const tenant = String(body.tenant || '');
      assertTenantAccess(session.user, tenant);
      const s = createSession(session.user.id, tenant);
      return sendJson(res, 200, {
        user: publicUser(s.user), tenant: s.tenant,
        tenants: s.user.tenants.map((t) => TENANTS[t]).filter(Boolean),
        users: listUsers()
      }, { 'Set-Cookie': s.cookie });
    }
    if (parts[2] === 'logout' && method === 'POST') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    }
    if (parts[2] === 'me' && method === 'GET') {
      if (!session) throw httpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
      return sendJson(res, 200, {
        user: publicUser(session.user), tenant: session.tenant,
        tenants: session.user.tenants.map((t) => TENANTS[t]).filter(Boolean),
        users: listUsers()
      });
    }
    if (parts[2] === 'users' && method === 'GET') {
      return sendJson(res, 200, { users: listUsers(), tenants: Object.values(TENANTS) });
    }
  }

  if (parts[1] === 'health' && method === 'GET') {
    const counts = {
      runs: Number(get('SELECT COUNT(*) AS c FROM runs')?.c || 0),
      pending_approvals: Number(get("SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'")?.c || 0),
      knowledge_docs: Number(get('SELECT COUNT(*) AS c FROM knowledge_docs WHERE active = 1')?.c || 0),
      audit_events: Number(get('SELECT COUNT(*) AS c FROM audit_events')?.c || 0)
    };
    return sendJson(res, 200, {
      ok: true, version: SERVER.version, started_at: SERVER.startedAt,
      uptime_s: Math.round((Date.now() - new Date(SERVER.startedAt).getTime()) / 1000),
      ai: await getAIStatus(), counts, dataset_label: DEMO_DATASET_LABEL,
      provider: describeProvider()
    });
  }

  if (!session) throw httpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  checkOrigin(req);

  if (parts[1] === 'menu' && method === 'GET') {
    requirePermission(session, 'read');
    const tenant = resolveTenant(session, url.searchParams.get('tenant'));
    return sendJson(res, 200, menuPayload(session.user, tenant));
  }

  if (parts[1] === 'overview' && method === 'GET') {
    requirePermission(session, 'read');
    const tenant = resolveTenant(session, url.searchParams.get('tenant'));
    return sendJson(res, 200, overview(tenant));
  }

  if (parts[1] === 'runs') {
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      const tenant = resolveTenant(session, url.searchParams.get('tenant'));
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 40)));
      let runs = listRuns(tenant, limit);
      const status = url.searchParams.get('status');
      const process = url.searchParams.get('process');
      if (status) runs = runs.filter((r) => r.status === status);
      if (process) runs = runs.filter((r) => r.process === process);
      return sendJson(res, 200, { runs });
    }
    if (method === 'POST' && parts.length === 2) {
      const body = await readBody(req);
      const process = String(body.process || '');
      const def = PROCESSES[process];
      if (!def) throw httpError(400, 'UNKNOWN_PROCESS', 'Unknown process.');
      requirePermission(session, process === 'knowledge_query' ? 'ask' : 'run');
      assertTenantAccess(session.user, def.tenant);
      try {
        const started = startRun({ tenant: def.tenant, process, input: body.input || {}, actor: session.user.id });
        return sendJson(res, 202, started.run);
      } catch (e) {
        if (e.code === 'INPUT_BLOCKED_BY_SECURITY') {
          throw httpError(422, e.code, 'The request was blocked by the deterministic trust-boundary screen.', e.details);
        }
        if (e.status) throw e;
        throw httpError(400, 'RUN_REJECTED', e.message);
      }
    }
    if (method === 'GET' && parts.length === 3) {
      requirePermission(session, 'read');
      const run = getRun(parts[2]);
      if (!run) throw httpError(404, 'RUN_NOT_FOUND', 'Run not found.');
      if (!session.user.tenants.includes(run.tenant)) throw httpError(403, 'TENANT_ACCESS_DENIED', 'This run belongs to another workspace.');
      return sendJson(res, 200, run);
    }
    if (method === 'GET' && parts.length === 4 && parts[3] === 'events') {
      requirePermission(session, 'read');
      const run = getRun(parts[2]);
      if (!run) throw httpError(404, 'RUN_NOT_FOUND', 'Run not found.');
      if (!session.user.tenants.includes(run.tenant)) throw httpError(403, 'TENANT_ACCESS_DENIED', 'This run belongs to another workspace.');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...SECURITY_HEADERS
      });
      res.flushHeaders?.();
      res.write('retry: 3000\n\n');
      res.write(`event: run\ndata: ${JSON.stringify(run)}\n\n`);
      subscribe(parts[2], res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(ping); unsubscribe(parts[2], res); try { res.end(); } catch { /* closed */ } });
      return;
    }
  }

  if (parts[1] === 'ask' && method === 'POST') {
    requirePermission(session, 'ask');
    const body = await readBody(req);
    assertTenantAccess(session.user, 'alpha-red');
    const started = startRun({
      tenant: 'alpha-red', process: 'knowledge_query',
      input: { question: String(body.question || '') }, actor: session.user.id
    });
    return sendJson(res, 202, started.run);
  }

  if (parts[1] === 'approvals') {
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      const tenant = resolveTenant(session, url.searchParams.get('tenant'));
      const status = url.searchParams.get('status') || null;
      return sendJson(res, 200, { approvals: listApprovals(tenant, status) });
    }
    if (method === 'POST' && parts.length === 4 && parts[3] === 'decision') {
      const body = await readBody(req);
      try {
        const result = decideApproval({
          approvalId: parts[2], decision: String(body.decision || ''),
          note: String(body.note || ''), user: session.user
        });
        return sendJson(res, 200, result);
      } catch (e) {
        if (e.status) throw e;
        throw httpError(400, 'APPROVAL_DECISION_FAILED', e.message);
      }
    }
  }

  if (parts[1] === 'audit') {
    if (method === 'GET' && parts[2] === 'verify') {
      requirePermission(session, 'audit:verify');
      return sendJson(res, 200, verifyAuditChain());
    }
    if (method === 'GET') {
      requirePermission(session, 'read');
      const tenant = resolveTenant(session, url.searchParams.get('tenant'));
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 120)));
      return sendJson(res, 200, { events: auditPayload({ limit, tenant }), chain: verifyAuditChain() });
    }
  }

  if (parts[1] === 'knowledge') {
    if (method === 'GET' && parts[2] === 'search') {
      requirePermission(session, 'read');
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) throw httpError(400, 'QUERY_REQUIRED', 'Provide a search query.');
      const pack = buildEvidencePack(q, { limit: 8 });
      const chunks = retrieve(q, { limit: 8 }).map((c) => ({
        id: c.id, doc_id: c.docId, title: c.docTitle, version: c.version,
        authority: c.authority, heading: c.heading, score: Number(c.score.toFixed(3)), quote: c.quote
      }));
      return sendJson(res, 200, { query: q, items: pack.items, chunks, count: pack.count });
    }
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      return sendJson(res, 200, {
        docs: knowledgeDocs({ includeBody: false }),
        conflicts: allConflicts(), stats: knowledgeStats(), thresholds: thresholdSnapshot()
      });
    }
    if (method === 'GET' && parts.length === 3) {
      requirePermission(session, 'read');
      const doc = get('SELECT * FROM knowledge_docs WHERE id = ? AND active = 1', decodeURIComponent(parts[2]));
      if (!doc) throw httpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      return sendJson(res, 200, doc);
    }
  }

  if (parts[1] === 'memories') {
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      return sendJson(res, 200, { memories: memoryList() });
    }
    if (method === 'POST' && parts.length === 4 && parts[3] === 'review') {
      requirePermission(session, 'approve:memory');
      const body = await readBody(req);
      const m = get('SELECT * FROM memories WHERE id = ?', parts[2]);
      if (!m) throw httpError(404, 'MEMORY_NOT_FOUND', 'Memory not found.');
      assertTenantAccess(session.user, m.tenant);
      if (!['approve', 'reject'].includes(body.decision)) throw httpError(400, 'INVALID_DECISION', 'Decision must be approve or reject.');
      const status = body.decision === 'approve' ? 'approved' : 'rejected';
      const authority = status === 'approved' ? 'L3-approved-memory' : 'L3-rejected';
      const { run } = await import('./db.js');
      run('UPDATE memories SET status = ?, authority = ?, reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?',
        status, authority, session.user.id, new Date().toISOString(), JSON.stringify({ decision_note: String(body.note || '').slice(0, 400) }), m.id);
      appendAudit({
        tenant: m.tenant, actor: session.user.id, action: status === 'approved' ? 'memory.published' : 'memory.rejected',
        objectType: 'memory', objectId: m.id, detail: { via: 'memory_review', note: String(body.note || '').slice(0, 240) }
      });
      return sendJson(res, 200, { memory: memoryList().find((x) => x.id === m.id) });
    }
  }

  if (parts[1] === 'agents' && method === 'GET') {
    requirePermission(session, 'read');
    return sendJson(res, 200, { agents: agentCatalog(), processes: Object.values(PROCESSES) });
  }

  if (parts[1] === 'skills') {
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      return sendJson(res, 200, { skills: getSkills() });
    }
    if (method === 'GET' && parts.length === 3) {
      requirePermission(session, 'read');
      const skill = getSkills().find((s) => s.id === decodeURIComponent(parts[2]));
      if (!skill) throw httpError(404, 'SKILL_NOT_FOUND', 'Skill not found.');
      return sendJson(res, 200, skill);
    }
  }

  if (parts[1] === 'security') {
    if (method === 'GET') {
      requirePermission(session, 'security:read');
      const tenant = resolveTenant(session, url.searchParams.get('tenant'));
      const events = securityList(tenant);
      return sendJson(res, 200, {
        events, corpus: INJECTION_CORPUS,
        counts: {
          total: events.length,
          blocked: events.filter((e) => e.blocked).length,
          flagged: events.filter((e) => !e.blocked).length
        }
      });
    }
    if (method === 'POST' && parts[2] === 'screen') {
      requirePermission(session, 'security:screen');
      const body = await readBody(req);
      const text = String(body.text || '');
      if (!text.trim()) throw httpError(400, 'TEXT_REQUIRED', 'Provide text to screen.');
      const result = screen(text);
      const { logSecurity } = await import('./db.js');
      if (result.decision !== 'ALLOW') {
        logSecurity({
          tenant: session.tenant, kind: 'manual_screen', severity: result.decision === 'BLOCK' ? 'high' : 'medium',
          actor: session.user.id, route: 'security:manual', detail: { score: result.score, signals: result.signals, excerpt: text.slice(0, 200) },
          blocked: result.decision === 'BLOCK'
        });
      }
      return sendJson(res, 200, { ...result, checked_at: new Date().toISOString() });
    }
  }

  if (parts[1] === 'evaluations') {
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      const tenant = resolveTenant(session, url.searchParams.get('tenant'));
      return sendJson(res, 200, evaluationSummary(tenant));
    }
    if (method === 'GET' && parts.length === 3) {
      requirePermission(session, 'read');
      const ev = getEvaluation(parts[2]);
      if (!ev) throw httpError(404, 'EVAL_NOT_FOUND', 'Evaluation not found.');
      assertTenantAccess(session.user, ev.tenant);
      return sendJson(res, 200, ev);
    }
    if (method === 'POST' && parts.length === 2) {
      requirePermission(session, 'eval:run');
      const body = await readBody(req);
      const tenant = resolveTenant(session, body.tenant || 'alpha-red');
      const ev = startEvaluation({
        tenant: tenant || 'alpha-red', actor: session.user.id,
        candidateName: String(body.candidate_name || 'candidate-1').slice(0, 120),
        patch: String(body.patch || '').slice(0, 4000)
      });
      return sendJson(res, 202, ev);
    }
    if (method === 'POST' && parts.length === 4 && parts[3] === 'decision') {
      const body = await readBody(req);
      const ev = decideEvaluation({
        evalId: parts[2], decision: String(body.decision || ''),
        note: String(body.note || ''), user: session.user
      });
      return sendJson(res, 200, ev);
    }
  }

  if (parts[1] === 'settings') {
    if (method === 'GET' && parts.length === 2) {
      requirePermission(session, 'read');
      const cfg = getProviderConfig();
      const ai = await getAIStatus();
      return sendJson(res, 200, {
        provider: describeProvider(),
        ai,
        models: ai.models || [],
        data_boundary: {
          database: 'src/server/data/alphared.db',
          knowledge: 'src/knowledge', skills: 'src/skills',
          note: 'The database and session key stay on this machine. Provider keys are never returned to the browser.'
        },
        env_hints: {
          OLLAMA_MODEL: 'qwen2.5:3b', DEEPSEEK_API_KEY: cfg.provider === 'deepseek' ? 'configured' : 'not configured',
          OPENAI_API_KEY: cfg.provider === 'openai' ? 'configured' : 'not configured'
        },
        version: SERVER.version, dataset_label: DEMO_DATASET_LABEL
      });
    }
    if (method === 'POST' && parts[2] === 'provider') {
      requirePermission(session, '*');
      const body = await readBody(req);
      const next = saveProviderConfig(body);
      appendAudit({
        tenant: session.tenant, actor: session.user.id, action: 'settings.provider_changed', objectType: 'settings', objectId: 'provider',
        detail: { provider: next.provider, model: next.model, base_url: next.baseUrl }
      });
      return sendJson(res, 200, { provider: describeProvider(), ai: await getAIStatus(true) });
    }
    if (method === 'POST' && parts[2] === 'test') {
      requirePermission(session, 'run');
      try {
        return sendJson(res, 200, await testProvider());
      } catch (e) {
        throw httpError(502, 'AI_TEST_FAILED', e.message);
      }
    }
    if (method === 'GET' && parts[2] === 'models') {
      requirePermission(session, 'read');
      const cfg = getProviderConfig();
      return sendJson(res, 200, { provider: cfg.provider, models: await listOllamaModels(cfg.baseUrl) });
    }
  }

  if (parts[1] === 'ai' && parts[2] === 'status' && method === 'GET') {
    requirePermission(session, 'read');
    return sendJson(res, 200, await getAIStatus(true));
  }

  if (parts[1] === 'datasets' && method === 'GET') {
    requirePermission(session, 'read');
    return sendJson(res, 200, datasetPayload());
  }

  if (parts[1] === 'outbox' && method === 'GET') {
    requirePermission(session, 'read');
    const rows = all('SELECT * FROM outbox ORDER BY created_at DESC LIMIT 50').map((o) => ({ ...o, payload: parse(o.payload, {}) }));
    return sendJson(res, 200, { outbox: rows });
  }

  throw httpError(404, 'API_NOT_FOUND', `No API route for ${req.method} ${url.pathname}.`);
}

/* ── Static files ─────────────────────────────────────────────────────── */

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = '/'; }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    return sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Path is outside the public directory.' } });
  }
  let file = resolved;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Hash-based SPA: serve the shell for extensionless navigation.
    if (!path.extname(pathname)) file = path.join(PUBLIC_DIR, 'index.html');
    else return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
  }
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    ...SECURITY_HEADERS
  });
  fs.createReadStream(file).pipe(res);
}

/* ── Server ───────────────────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); }
  catch { return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'Invalid URL.' } }); }

  if (url.pathname.startsWith('/api/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      await handleApi(req, res, url, parts);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
      const status = e.status || 500;
      if (status >= 500) console.error(`[api] ${req.method} ${url.pathname}`, e);
      sendJson(res, status, {
        error: {
          code: e.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
          message: status >= 500 ? 'The server could not complete this request.' : e.message,
          details: e.details || undefined
        }
      });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Static routes accept GET only.' } });
  }
  try { serveStatic(req, res, url); }
  catch (e) {
    console.error('[static]', e);
    if (!res.headersSent) sendJson(res, 500, { error: { code: 'STATIC_ERROR', message: 'Could not read the file.' } });
  }
});

/* ── Boot ─────────────────────────────────────────────────────────────── */

function boot() {
  const knowledge = syncKnowledge();
  const rules = syncRules();
  const seed = seedBusinessData();
  refreshIndex(true);
  console.log(`[alpha-red] knowledge ${knowledge.synced} new/updated of ${knowledge.total}; rules ${rules}; seed ${seed.seeded ? 'created' : 'present'}`);
  console.log(`[alpha-red] AI provider: ${JSON.stringify(describeProvider())}`);
  server.listen(SERVER.port, SERVER.host, () => {
    console.log(`[alpha-red] workspace ready at http://${SERVER.host}:${SERVER.port}`);
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[alpha-red] port ${SERVER.port} is already in use. Set PORT in .env or stop the other process.`);
    process.exit(1);
  }
  console.error('[alpha-red] server error', e);
});

process.on('uncaughtException', (e) => console.error('[alpha-red] uncaught', e));
process.on('unhandledRejection', (e) => console.error('[alpha-red] unhandled rejection', e));

boot();

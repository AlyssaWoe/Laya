import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

export const TENANTS = {
  'alpha-red': { id: 'alpha-red', name: 'Alpha Red Solutions', short: 'Alpha Red', tone: 'seal' },
  'cradle-fund': { id: 'cradle-fund', name: 'Cradle Fund Programme', short: 'Cradle Fund', tone: 'jade' },
  'partnerflow': { id: 'partnerflow', name: 'PartnerFlow Finance', short: 'PartnerFlow', tone: 'gold' }
};

export const USERS = {
  alpha: {
    id: 'alpha', name: 'Adam Wong', initials: 'AW', title: 'Principal · AI Systems',
    roles: ['admin', 'principal'], tenants: ['alpha-red', 'cradle-fund', 'partnerflow'], defaultTenant: 'alpha-red'
  },
  nurul: {
    id: 'nurul', name: 'Nurul Iman', initials: 'NI', title: 'Programme Reviewer',
    roles: ['reviewer'], tenants: ['cradle-fund'], defaultTenant: 'cradle-fund'
  },
  daniel: {
    id: 'daniel', name: 'Daniel Tan', initials: 'DT', title: 'Finance Reviewer',
    roles: ['reviewer'], tenants: ['partnerflow'], defaultTenant: 'partnerflow'
  },
  mei: {
    id: 'mei', name: 'Mei Lin', initials: 'ML', title: 'Knowledge Owner',
    roles: ['knowledge_owner'], tenants: ['alpha-red'], defaultTenant: 'alpha-red'
  },
  kai: {
    id: 'kai', name: 'Kai Rahman', initials: 'KR', title: 'Security Administrator',
    roles: ['security_admin'], tenants: ['alpha-red', 'cradle-fund', 'partnerflow'], defaultTenant: 'alpha-red'
  },
  ravi: {
    id: 'ravi', name: 'Ravi Kumar', initials: 'RK', title: 'AI Platform Lead',
    roles: ['harness_owner'], tenants: ['alpha-red'], defaultTenant: 'alpha-red'
  },
  aina: {
    id: 'aina', name: 'Aina Salleh', initials: 'AS', title: 'Operations Analyst',
    roles: ['operator'], tenants: ['alpha-red', 'cradle-fund', 'partnerflow'], defaultTenant: 'alpha-red'
  }
};

const ROLE_PERMS = {
  admin: ['*'],
  principal: ['*'],
  operator: ['run', 'read', 'ask', 'screen'],
  reviewer: ['run', 'read', 'ask', 'approve:business', 'audit:verify'],
  knowledge_owner: ['read', 'ask', 'approve:memory', 'publish:knowledge', 'audit:verify'],
  security_admin: ['read', 'ask', 'run', 'security:read', 'security:screen', 'audit:verify'],
  harness_owner: ['read', 'ask', 'run', 'eval:run', 'eval:approve']
};

export function permsFor(user) {
  const set = new Set();
  for (const role of user.roles) for (const p of ROLE_PERMS[role] || []) set.add(p);
  return set;
}

export function can(user, perm) {
  if (!user) return false;
  const perms = permsFor(user);
  return perms.has('*') || perms.has(perm);
}

export function requirePerm(user, perm) {
  if (!can(user, perm)) {
    const err = new Error(`PERMISSION_DENIED: ${perm}`);
    err.status = 403;
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
}

export function publicUser(user) {
  return {
    id: user.id, name: user.name, initials: user.initials, title: user.title,
    roles: user.roles, permissions: [...permsFor(user)],
    tenants: user.tenants.map((t) => TENANTS[t]).filter(Boolean),
    defaultTenant: user.defaultTenant
  };
}

export function listUsers() {
  return Object.values(USERS).map(publicUser);
}

/* ── Signed demo sessions ─────────────────────────────────────────────── */

const KEY_FILE = path.join(DATA_DIR, 'session.key');
function sessionSecret() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(KEY_FILE, secret, { mode: 0o600 });
    return secret;
  }
}
const SECRET = sessionSecret();
const COOKIE = 'ar_session';

export function createSession(userId, tenantId) {
  const user = USERS[userId];
  if (!user) { const e = new Error('UNKNOWN_USER'); e.status = 401; throw e; }
  const tenant = tenantId && user.tenants.includes(tenantId) ? tenantId : user.defaultTenant;
  const payload = Buffer.from(JSON.stringify({ userId, tenant, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, user, tenant, cookie: `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200` };
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function readSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const [payload, sig] = token.split('.');
    if (payload && sig) {
      const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
      if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        try {
          const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
          const user = USERS[data.userId];
          if (user && user.tenants.includes(data.tenant)) return { user, tenant: data.tenant };
        } catch { /* invalid */ }
      }
    }
  }
  // Header fallback exists for local API tooling only; it is still permission-checked.
  const headerUser = String(req.headers['x-user'] || '').trim();
  if (headerUser && USERS[headerUser]) {
    const user = USERS[headerUser];
    const requested = String(req.headers['x-tenant'] || '').trim();
    const tenant = user.tenants.includes(requested) ? requested : user.defaultTenant;
    return { user, tenant };
  }
  return null;
}

export function requireSession(req) {
  const session = readSession(req);
  if (!session) { const e = new Error('AUTH_REQUIRED'); e.status = 401; e.code = 'AUTH_REQUIRED'; throw e; }
  return session;
}

export function assertTenantAccess(user, tenant) {
  if (!user.tenants.includes(tenant)) {
    const e = new Error('TENANT_ACCESS_DENIED');
    e.status = 403; e.code = 'TENANT_ACCESS_DENIED';
    throw e;
  }
}

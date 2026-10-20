import { all } from './db.js';

/**
 * Structured rule base. A key may legitimately have two active entries when
 * two approved documents disagree. Conflicts are never hidden: the resolver
 * applies the conservative value and returns the competing sources.
 */

const STRICTER = {
  'cradle.min_equity_pct': 'max',
  'cradle.min_operating_months': 'max',
  'cradle.min_grant_myr': 'max',
  'cradle.max_grant_myr': 'min',
  'cradle.min_matching_pct': 'max',
  'cradle.max_active_grants': 'min',
  'cradle.audited_threshold_myr': 'min',
  'payment.approval_threshold_myr': 'min',
  'payment.duplicate_window_hours': 'max',
  'cmo.min_qualified_leads': 'max',
  'cmo.min_won_deals': 'max',
  'security.block_threshold': 'min',
  'security.flag_threshold': 'min'
};

export function rulesFor(key) {
  return all('SELECT * FROM rules WHERE key = ? AND active = 1 ORDER BY doc_id', key);
}

export function resolveRule(key, fallback = null) {
  const entries = rulesFor(key);
  if (!entries.length) return { key, value: fallback, entries: [], conflict: false, strategy: null };
  const values = [...new Set(entries.map((e) => e.value))];
  if (values.length === 1) return { key, value: entries[0].value, entries, conflict: false, strategy: null };
  const strategy = STRICTER[key] || 'first';
  let value;
  if (strategy === 'max') value = values.reduce((a, b) => (Number(b) > Number(a) ? b : a));
  else if (strategy === 'min') value = values.reduce((a, b) => (Number(b) < Number(a) ? b : a));
  else value = values[0];
  return { key, value, entries, conflict: true, strategy };
}

export function ruleNumber(key, fallback = 0) {
  const r = resolveRule(key, String(fallback));
  const n = Number(r.value);
  return Number.isFinite(n) ? n : fallback;
}

export function ruleBoolean(key, fallback = false) {
  const r = resolveRule(key, String(fallback));
  return String(r.value).toLowerCase() === 'true';
}

export function ruleJson(key, fallback = []) {
  const r = resolveRule(key, JSON.stringify(fallback));
  try { return JSON.parse(r.value); } catch { return fallback; }
}

export function allConflicts() {
  const keys = all('SELECT DISTINCT key FROM rules WHERE active = 1').map((r) => r.key);
  return keys.map((key) => resolveRule(key)).filter((r) => r.conflict).map((r) => ({
    key: r.key,
    strategy: r.strategy,
    applied: r.value,
    sources: r.entries.map((e) => ({ doc_id: e.doc_id, version: e.version, value: e.value, note: e.note }))
  }));
}

export function thresholdSnapshot() {
  return {
    cradle: {
      min_equity_pct: ruleNumber('cradle.min_equity_pct', 51),
      min_operating_months: ruleNumber('cradle.min_operating_months', 12),
      min_grant_myr: ruleNumber('cradle.min_grant_myr', 50000),
      max_grant_myr: ruleNumber('cradle.max_grant_myr', 1000000),
      min_matching_pct: ruleNumber('cradle.min_matching_pct', 25),
      max_active_grants: ruleNumber('cradle.max_active_grants', 2),
      audited_threshold_myr: ruleNumber('cradle.audited_threshold_myr', 250000)
    },
    payment: {
      approval_threshold_myr: ruleNumber('payment.approval_threshold_myr', 25000),
      duplicate_window_hours: ruleNumber('payment.duplicate_window_hours', 24),
      stage_p1_days: ruleNumber('payment.stage_p1_days', 7),
      stage_p2_days: ruleNumber('payment.stage_p2_days', 14),
      stage_p3_days: ruleNumber('payment.stage_p3_days', 30),
      stage_p4_days: ruleNumber('payment.stage_p4_days', 45)
    }
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.resolve(HERE, '..');
export const ROOT_DIR = path.resolve(SRC_DIR, '..');
export const DATA_DIR = path.join(HERE, 'data');
export const KNOWLEDGE_DIR = path.join(SRC_DIR, 'knowledge');
export const SKILLS_DIR = path.join(SRC_DIR, 'skills');
export const PUBLIC_DIR = path.join(SRC_DIR, 'public');
export const PROVIDER_FILE = path.join(DATA_DIR, 'provider.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readEnvFile(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || m[1].startsWith('#')) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* optional */ }
  return out;
}

const env = {
  ...readEnvFile(path.join(ROOT_DIR, '.env')),
  ...readEnvFile(path.join(HERE, '.env')),
  ...process.env
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const DEFAULTS = {
  provider: (env.AI_PROVIDER || 'ollama').toLowerCase(),
  model: env.OLLAMA_MODEL || 'qwen2.5:3b',
  baseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  deepseekKey: env.DEEPSEEK_API_KEY || '',
  deepseekBase: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-chat',
  openaiKey: env.OPENAI_API_KEY || '',
  openaiBase: env.OPENAI_BASE_URL || '',
  openaiModel: env.OPENAI_MODEL || '',
  layaUrl: env.LAYA_API_URL || '',
  layaKey: env.LAYA_API_KEY || '',
  layaModel: env.LAYA_MODEL || 'laya-decision'
};

/**
 * Credentials are read from the server environment or a local-only provider
 * file. They are never returned to the browser.
 */
export function getProviderConfig() {
  const saved = readJson(PROVIDER_FILE, null);
  if (saved && saved.provider) {
    const merged = { ...DEFAULTS, ...saved };
    if (saved.provider === 'deepseek' && !merged.apiKey) merged.apiKey = DEFAULTS.deepseekKey;
    if (saved.provider === 'openai' && !merged.apiKey) merged.apiKey = DEFAULTS.openaiKey;
    return normalise(merged);
  }
  return normalise(DEFAULTS);
}

function normalise(c) {
  const provider = c.provider;
  let baseUrl = c.baseUrl || '';
  let model = c.model || '';
  let apiKey = c.apiKey || '';
  if (provider === 'deepseek') {
    baseUrl = c.baseUrl && c.baseUrl !== DEFAULTS.baseUrl ? c.baseUrl : DEFAULTS.deepseekBase;
    model = c.model && c.model !== 'qwen2.5:3b' ? c.model : DEFAULTS.deepseekModel;
    apiKey = apiKey || DEFAULTS.deepseekKey;
  }
  if (provider === 'openai') {
    baseUrl = c.baseUrl || DEFAULTS.openaiBase;
    model = c.model || DEFAULTS.openaiModel;
    apiKey = apiKey || DEFAULTS.openaiKey;
  }
  if (provider === 'ollama') {
    baseUrl = c.baseUrl && c.baseUrl !== DEFAULTS.deepseekBase ? c.baseUrl : DEFAULTS.baseUrl;
    model = c.model && c.model !== DEFAULTS.deepseekModel ? c.model : DEFAULTS.model;
  }
  if (provider === 'pollinations') {
    baseUrl = 'https://text.pollinations.ai/openai';
    model = 'openai';
    apiKey = '';
  }
  return {
    provider,
    baseUrl: String(baseUrl || '').replace(/\/+$/, ''),
    model: String(model || ''),
    apiKey: String(apiKey || ''),
    layaUrl: DEFAULTS.layaUrl,
    layaKey: DEFAULTS.layaKey,
    layaModel: DEFAULTS.layaModel
  };
}

/** Public, secret-free description used by /api/health and the UI. */
export function describeProvider() {
  const c = getProviderConfig();
  return {
    provider: c.provider,
    model: c.model,
    base_url: c.provider === 'ollama' ? c.baseUrl : null,
    has_key: !!c.apiKey,
    laya_adapter: c.layaUrl ? 'configured' : 'compatible-fallback'
  };
}

export function saveProviderConfig(patch) {
  const current = getProviderConfig();
  const next = {
    provider: (patch.provider || current.provider).toLowerCase(),
    model: patch.model || current.model,
    baseUrl: patch.baseUrl || current.baseUrl,
    apiKey: patch.apiKey !== undefined ? patch.apiKey : current.apiKey
  };
  const allowed = ['ollama', 'deepseek', 'openai', 'pollinations'];
  if (!allowed.includes(next.provider)) throw new Error('UNSUPPORTED_PROVIDER');
  fs.writeFileSync(PROVIDER_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return getProviderConfig();
}

export function getEnv(name) { return env[name] || ''; }
export const paths = { DATA_DIR, KNOWLEDGE_DIR, SKILLS_DIR, PUBLIC_DIR, ROOT_DIR, SRC_DIR, PROVIDER_FILE };
export const SERVER = {
  port: Number(env.PORT || 4173),
  host: env.HOST || '127.0.0.1',
  version: '1.0.0',
  startedAt: new Date().toISOString()
};

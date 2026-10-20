import { getProviderConfig, describeProvider } from './config.js';
import { logAiCall } from './db.js';

/**
 * Provider adapter for an OpenAI-compatible execution model.
 * Ollama is the zero-key local default; DeepSeek/OpenAI are one config away.
 * Credentials stay server-side and are never logged.
 */

let queue = Promise.resolve();
function serial(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pollinationsLast = 0;
const STATUS_CACHE = { at: 0, value: null };

export async function listOllamaModels(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => ({
      name: m.name, size: m.size, family: m.details?.family,
      parameters: m.details?.parameter_size, quantization: m.details?.quantization_level,
      modified: m.modified_at
    }));
  } catch { return []; }
}

export async function getAIStatus(force = false) {
  if (!force && STATUS_CACHE.value && Date.now() - STATUS_CACHE.at < 5000) return STATUS_CACHE.value;
  const cfg = getProviderConfig();
  let available = false, models = [], detail = '', latency = null;
  const t0 = Date.now();
  if (cfg.provider === 'ollama') {
    models = await listOllamaModels(cfg.baseUrl);
    available = models.some((m) => m.name === cfg.model || m.name.startsWith(`${cfg.model}:`));
    latency = Date.now() - t0;
    detail = !models.length
      ? `Ollama is not reachable at ${cfg.baseUrl}. Start it with: ollama serve`
      : available ? 'Local model ready. Inference stays on this machine.' : `Model "${cfg.model}" is not installed. Run: ollama pull ${cfg.model}`;
  } else if (cfg.provider === 'deepseek') {
    available = !!cfg.apiKey;
    detail = available ? 'DeepSeek API configured. Requests are billed to the configured key.' : 'DEEPSEEK_API_KEY is not configured.';
  } else if (cfg.provider === 'openai') {
    available = !!cfg.apiKey && !!cfg.baseUrl;
    detail = available ? 'OpenAI-compatible endpoint configured.' : 'OPENAI_API_KEY and OPENAI_BASE_URL are required.';
  } else {
    available = true;
    detail = 'Pollinations free endpoint: one request per 30 seconds per IP. Intended as a last-resort fallback.';
  }
  const value = {
    ...describeProvider(),
    available,
    detail,
    models,
    latency_ms: latency,
    checked_at: new Date().toISOString(),
    laya_mode: cfg.layaUrl ? 'native-adapter' : 'compatible-fallback'
  };
  STATUS_CACHE.at = Date.now();
  STATUS_CACHE.value = value;
  return value;
}

function endpoint(cfg) {
  if (cfg.provider === 'ollama') return `${cfg.baseUrl}/api/chat`;
  return `${cfg.baseUrl}/chat/completions`;
}

async function rawCall(cfg, { messages, temperature, maxTokens, json, numCtx }) {
  const started = Date.now();
  let url, body;
  const headers = { 'Content-Type': 'application/json' };

  if (cfg.provider === 'ollama') {
    url = endpoint(cfg);
    body = {
      model: cfg.model, messages, stream: false, keep_alive: '30m',
      options: { temperature, num_predict: maxTokens, num_ctx: numCtx, top_p: 0.9, repeat_penalty: 1.06 }
    };
    if (json) body.format = 'json';
    if (cfg.model.startsWith('qwen3')) body.think = false;
  } else {
    url = endpoint(cfg);
    headers.Authorization = `Bearer ${cfg.apiKey}`;
    body = { model: cfg.model, messages, temperature, max_tokens: maxTokens, stream: false };
    if (json) body.response_format = { type: 'json_object' };
  }

  if (cfg.provider === 'pollinations') {
    const wait = Math.max(0, 31_000 - (Date.now() - pollinationsLast));
    if (wait) await sleep(wait);
    pollinationsLast = Date.now();
  }

  const res = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.provider === 'ollama' ? 240_000 : 120_000)
  });
  const duration = Date.now() - started;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let retryAfter = null;
    try { retryAfter = JSON.parse(text)?.error?.retry_after || JSON.parse(text)?.retryAfter; } catch { /* ignore */ }
    const err = new Error(`AI_HTTP_${res.status}: ${text.slice(0, 260)}`);
    err.status = res.status;
    err.retryAfter = retryAfter;
    err.durationMs = duration;
    throw err;
  }

  const data = await res.json();
  let text = '', tokensIn = 0, tokensOut = 0;
  if (cfg.provider === 'ollama') {
    text = data?.message?.content || '';
    tokensIn = Number(data.prompt_eval_count || 0);
    tokensOut = Number(data.eval_count || 0);
  } else {
    text = data?.choices?.[0]?.message?.content || '';
    tokensIn = Number(data?.usage?.prompt_tokens || 0);
    tokensOut = Number(data?.usage?.completion_tokens || 0);
  }
  if (!text) throw new Error('AI_EMPTY_RESPONSE');
  return { text: String(text).trim(), tokensIn, tokensOut, durationMs: duration, model: cfg.model, provider: cfg.provider };
}

export async function chat({ system, user, messages, temperature = 0.25, maxTokens = 700, json = false, purpose = 'agent', runId = null, agentId = null, numCtx = 8192 }) {
  const cfg = getProviderConfig();
  if (!cfg.model) throw new Error('AI_MODEL_NOT_CONFIGURED');
  if ((cfg.provider === 'deepseek' || cfg.provider === 'openai') && !cfg.apiKey) throw new Error('AI_KEY_NOT_CONFIGURED');
  const msgs = messages || [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: String(user || '') }
  ];

  const task = async () => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await rawCall(cfg, { messages: msgs, temperature, maxTokens, json, numCtx });
        logAiCall({ runId, agentId, provider: cfg.provider, model: cfg.model, purpose, tokensIn: result.tokensIn, tokensOut: result.tokensOut, durationMs: result.durationMs, status: 'ok' });
        return result;
      } catch (e) {
        lastError = e;
        logAiCall({ runId, agentId, provider: cfg.provider, model: cfg.model, purpose, durationMs: e.durationMs || 0, status: 'error', error: e.message });
        const retryable = e.status === 429 || e.status >= 500 || /timeout|abort|fetch failed|ECONN|network/i.test(e.message);
        if (!retryable || attempt === 2) break;
        const wait = e.retryAfter ? Number(e.retryAfter) * 1000 + 500 : (cfg.provider === 'pollinations' ? 31_000 : 1200 * (attempt + 1));
        await sleep(wait);
      }
    }
    throw lastError || new Error('AI_CALL_FAILED');
  };
  return serial(task);
}

export function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.search(/[\[{]/);
  if (start < 0) return null;
  const opener = raw[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        const slice = raw.slice(start, i + 1);
        try { return JSON.parse(slice); } catch {
          try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"')); } catch { return null; }
        }
      }
    }
  }
  return null;
}

export async function chatJSON({ system, user, temperature = 0.2, maxTokens = 750, purpose = 'agent', runId = null, agentId = null, numCtx = 8192, retries = 1 }) {
  const guardedSystem = `${system}\n\nOUTPUT CONTRACT: Return exactly one valid JSON object. No markdown fences, no commentary, no text before or after the JSON.`;
  let result = await chat({ system: guardedSystem, user, temperature, maxTokens, json: true, purpose, runId, agentId, numCtx });
  let data = extractJson(result.text);
  if (!data && retries > 0) {
    const repair = await chat({
      system: 'You repair malformed JSON. Return only the corrected JSON object, preserving all original content. No markdown.',
      user: `Repair this into valid JSON:\n${result.text.slice(0, 5000)}`,
      temperature: 0, maxTokens: Math.min(900, maxTokens + 200), json: true, purpose: `${purpose}:repair`, runId, agentId, numCtx
    }).catch(() => null);
    if (repair) {
      data = extractJson(repair.text);
      if (data) result = { ...result, tokensIn: result.tokensIn + repair.tokensIn, tokensOut: result.tokensOut + repair.tokensOut };
    }
  }
  return { ...result, data, parse_failed: !data };
}

export async function testProvider() {
  const t0 = Date.now();
  const result = await chat({
    system: 'You are a health check. Reply with the single word OK.',
    user: 'Reply with OK.', temperature: 0, maxTokens: 8, purpose: 'health'
  });
  return { ok: true, latency_ms: Date.now() - t0, model: result.model, provider: result.provider, text: result.text.slice(0, 40) };
}

export function layaAdapterMode() {
  const cfg = getProviderConfig();
  return cfg.layaUrl
    ? { mode: 'native-adapter', endpoint: cfg.layaUrl, model: cfg.layaModel }
    : { mode: 'compatible-fallback', endpoint: null, model: cfg.model };
}

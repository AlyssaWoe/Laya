import { all } from './db.js';

/**
 * Deterministic BM25 retrieval over the approved corpus and approved memory.
 * No embeddings, no network, no hidden state — every result is traceable to a
 * document version and a chunk id.
 */

const STOP = new Set('a an and are as at be by for from has have if in into is it its of on or that the their this to was were will with without not no than then there these those we you your our can may must should would could'.split(' '));

function tokenize(text) {
  const out = [];
  const matches = String(text || '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) || [];
  for (const t of matches) {
    if (STOP.has(t)) continue;
    if (/^[a-z0-9]+$/.test(t) && t.length < 2) continue;
    out.push(t);
  }
  return out;
}

function slug(text) {
  return String(text || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'section';
}

let INDEX = [];
let INDEX_SIG = '';
let INDEX_META = { docs: 0, chunks: 0, memories: 0 };

function signature() {
  const d = all("SELECT COUNT(*) AS c, COALESCE(MAX(created_at),'') AS m FROM knowledge_docs WHERE active = 1")[0];
  const mem = all("SELECT COUNT(*) AS c, COALESCE(MAX(COALESCE(reviewed_at, created_at)),'') AS m FROM memories WHERE status = 'approved'")[0];
  return `${d.c}|${d.m}|${mem.c}|${mem.m}`;
}

function buildDocChunks(doc) {
  const body = String(doc.body || '');
  const parts = body.split(/\n(?=##\s)/);
  const chunks = [];
  parts.forEach((part) => {
    const cleaned = part.trim();
    if (!cleaned) return;
    const firstLine = cleaned.split('\n')[0].replace(/^#+\s*/, '').trim();
    const heading = firstLine.length > 2 ? firstLine : doc.title;
    const paragraphs = cleaned.split(/\n{2,}/);
    let buffer = '';
    let partIndex = 0;
    for (const p of paragraphs) {
      if ((buffer + '\n\n' + p).length > 1700 && buffer) {
        chunks.push({ heading, part: partIndex++, text: buffer.trim() });
        buffer = p;
      } else {
        buffer += (buffer ? '\n\n' : '') + p;
      }
    }
    if (buffer.trim()) chunks.push({ heading, part: partIndex, text: buffer.trim() });
  });
  if (!chunks.length && body.trim()) chunks.push({ heading: doc.title, part: 0, text: body.trim() });
  return chunks.map((c, i) => {
    const id = `${doc.id}:${slug(c.heading)}:${i}`;
    const text = `${doc.title} — ${c.heading}\n${c.text}`;
    const tokens = tokenize(`${doc.title} ${doc.id} ${c.heading} ${c.text}`);
    return {
      id, docId: doc.id, docTitle: doc.title, version: doc.version, authority: doc.authority,
      classification: doc.classification, heading: c.heading, text, quote: c.text,
      tokens, dl: tokens.length, memory: false
    };
  });
}

export function refreshIndex(force = false) {
  const sig = signature();
  if (!force && sig === INDEX_SIG && INDEX.length) return INDEX_META;
  const docs = all('SELECT * FROM knowledge_docs WHERE active = 1 ORDER BY id');
  const index = [];
  for (const doc of docs) index.push(...buildDocChunks(doc));

  const memories = all("SELECT * FROM memories WHERE status = 'approved' AND (expires_at IS NULL OR expires_at = '' OR expires_at > ?) ORDER BY created_at DESC", new Date().toISOString());
  for (const m of memories) {
    const text = `Memory — ${m.title}\nScope: ${m.scope}\n${m.statement}`;
    const tokens = tokenize(`${m.title} ${m.scope} ${m.statement}`);
    index.push({
      id: `${m.id}:memory:0`, docId: m.id, docTitle: `Memory · ${m.title}`, version: m.authority || 'L3-approved-memory',
      authority: 'L3-approved-memory', classification: 'internal', heading: m.scope || 'scope',
      text, quote: m.statement, tokens, dl: tokens.length, memory: true
    });
  }

  INDEX = index;
  INDEX_SIG = sig;
  INDEX_META = { docs: docs.length, chunks: index.length, memories: memories.length };
  return INDEX_META;
}

function dfOf(term) {
  let n = 0;
  for (const c of INDEX) if (c.tokens.includes(term)) n++;
  return n;
}

export function retrieve(query, { limit = 6, minScore = 0.02, includeMemories = true } = {}) {
  refreshIndex();
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const N = INDEX.length || 1;
  const avgdl = INDEX.reduce((a, c) => a + c.dl, 0) / N || 1;
  const k1 = 1.4, b = 0.72;
  const qSet = [...new Set(qTokens)];
  const results = [];
  const lowerQuery = String(query).toLowerCase();

  for (const chunk of INDEX) {
    if (!includeMemories && chunk.memory) continue;
    const tf = new Map();
    for (const t of chunk.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const q of qSet) {
      const f = tf.get(q) || 0;
      if (!f) continue;
      const df = dfOf(q);
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (chunk.dl / avgdl))));
    }
    if (!score) continue;
    const heading = chunk.heading.toLowerCase();
    for (const q of qSet) if (heading.includes(q)) score *= 1.14;
    if (lowerQuery.length > 8 && chunk.text.toLowerCase().includes(lowerQuery)) score *= 1.5;
    if (chunk.authority === 'L0-constitution') score *= 1.18;
    else if (chunk.authority === 'L1-policy') score *= 1.12;
    else if (chunk.memory) score *= 0.82;
    if (score >= minScore) results.push({ ...chunk, score });
  }
  results.sort((a, b) => b.score - a.score);
  const seen = new Map();
  const unique = [];
  for (const r of results) {
    const count = seen.get(r.docId) || 0;
    if (count >= 2) continue;
    seen.set(r.docId, count + 1);
    unique.push(r);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function buildEvidencePack(query, { limit = 6 } = {}) {
  const results = retrieve(query, { limit });
  const items = results.map((r, i) => ({
    ref: `EV-${i + 1}`,
    chunk_id: r.id,
    doc_id: r.docId,
    title: r.docTitle,
    version: r.version,
    authority: r.authority,
    heading: r.heading,
    score: Number(r.score.toFixed(3)),
    quote: r.quote.slice(0, 1100)
  }));
  const text = items.map((it) =>
    `[${it.ref}] ${it.doc_id} · ${it.title} · v${it.version} · ${it.authority} · §${it.heading}\n"${it.quote.replace(/\n+/g, ' ')}"`
  ).join('\n\n');
  return { items, text, count: items.length };
}

export function knowledgeStats() {
  refreshIndex();
  const docs = all('SELECT COUNT(*) AS c FROM knowledge_docs WHERE active = 1')[0].c;
  const memories = all('SELECT COUNT(*) AS c FROM memories')[0].c;
  const pending = all("SELECT COUNT(*) AS c FROM memories WHERE status = 'pending'")[0].c;
  return { docs, chunks: INDEX_META.chunks, memories, pending_memories: pending };
}

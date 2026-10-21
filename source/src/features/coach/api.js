// Unified AI coach API (contract, docs/parity.md §11 rule 3):
//   askCoach(ctx, {intent, prompt, extra}) → Promise<{text, actions[]}>
//   openCoachSheet(ctx, {intent, attach})  → opens the chat as a sheet from any screen
//   coachContext(ctx, {blocks})            → Promise<{text, blocks}>
// All Anthropic calls go through core/ai.js createAIClient (key handling + friendly errors). A fetch wrapper only
// swaps model / system / max_tokens on the request body; the key never passes through this file.
import { createAIClient, MODELS, AIError, AI_MESSAGES, systemBlocks } from '../../core/ai.js';
import { getSecret } from '../../core/db.js';
import { buildContext, loadCoachData } from './context.js';
import { parseActions, streamVisible } from './actions.js';
import { INTENTS, intentOf, detectIntent, blocksFor, protocolFor, SYSTEM, ALL_BLOCKS } from './prompts.js';

export { AIError };
export const errorText = (e) => (e instanceof AIError ? e.message : AI_MESSAGES.server);
/** History sent with each message: the last turns only (the data summary carries the rest). */
export const HISTORY_TURNS = 10;
export const EMPTY_REPLY = 'مقدرتش أطلع رد واضح المرة دي. اسألني تاني بطريقة تانية.';

/** True when an Anthropic key is saved (buttons stay visible; a press without a key shows the settings link). */
export const hasKey = (ctx) => !!String(ctx.settings.get('anthropicKey') || '').trim();

function client(ctx, { model, system, maxTokens }) {
  return createAIClient({
    getKey: async () => ctx.settings.get('anthropicKey') || (await getSecret(ctx.db, 'anthropicKey')),
    fetch: (url, init) => {
      const body = JSON.parse(init.body);
      body.model = model; body.system = systemBlocks(system); body.max_tokens = maxTokens; // cache_control on the stable prefix
      return globalThis.fetch(url, { ...init, body: JSON.stringify(body) });
    },
  });
}

export async function coachContext(ctx, { blocks = ALL_BLOCKS, extra = null } = {}) {
  const data = await loadCoachData(ctx);
  return { text: buildContext(data, { blocks, extra }), blocks };
}

// ───────── per-day cache (kv.coach.cache[key] = {day, text, actions, at}) ─────────
async function kvCoach(db) { try { const r = await db.get('kv', 'coach'); return r && r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; } }
export async function cached(ctx, key) {
  const c = (await kvCoach(ctx.db)).cache || {};
  const hit = c[key];
  return hit && hit.day === ctx.today() ? hit : null;
}
async function putCache(ctx, key, val) {
  try {
    const cur = await kvCoach(ctx.db);
    const cache = { ...(cur.cache || {}) };
    for (const k of Object.keys(cache)) if (cache[k].day !== ctx.today()) delete cache[k]; // keep today only
    cache[key] = { ...val, day: ctx.today(), at: new Date().toISOString() };
    await ctx.db.put('kv', { key: 'coach', value: { ...cur, cache } });
  } catch { /* cache is best-effort */ }
}

/**
 * askCoach(ctx, {intent, prompt, extra, onText, onRetry}) → {text, actions, errors, model, stopReason, cached?}
 * extra: attached data (e.g. {liveSession}, {session}, {exercise}); reserved keys:
 *   history: [{role, content}] (chat turns, newest last), cacheKey: string (per-day cache), refresh: bool.
 * onText(visibleSoFar): streaming updates (action JSON is never shown). The returned text is never empty.
 */
export async function askCoach(ctx, { intent = 'chat', prompt = '', extra = {}, onText = null, onRetry = null } = {}) {
  const { history, cacheKey, refresh, ...attach } = extra || {};
  if (cacheKey && !refresh) { const hit = await cached(ctx, cacheKey); if (hit) return { text: hit.text, actions: hit.actions || [], errors: [], cached: true }; }
  const effective = intent === 'chat' ? detectIntent(prompt) : intent;
  const spec = intentOf(effective);
  const ctxText = (await coachContext(ctx, { blocks: blocksFor(effective, prompt), extra: Object.keys(attach).length ? attach : null })).text;
  const writes = intentOf(intent).writes || spec.writes;
  const now = new Date();
  const clock = `Now: ${ctx.today()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} local`;
  // stable instructions first (cache breakpoint 1), then the data block (breakpoint 2)
  const system = `${SYSTEM}${writes ? `\n\n${protocolFor(spec)}` : ''}\n\nData summary:\n${clock}\n${ctxText || '(no data yet)'}`;
  let turns = Array.isArray(history) && history.length ? history.slice(-HISTORY_TURNS) : [{ role: 'user', content: String(prompt) }];
  // the question being answered is always the last user turn
  if (prompt && !(turns.length && turns[turns.length - 1].role === 'user' && String(turns[turns.length - 1].content).trim() === String(prompt).trim())) turns = [...turns, { role: 'user', content: String(prompt) }];
  const model = MODELS[spec.model] || MODELS.coach;
  const r = await client(ctx, { model, system, maxTokens: spec.maxTokens }).complete({ model, max_tokens: spec.maxTokens, messages: turns, stream: true },
    { onText: onText ? (full) => { const v = streamVisible(full); if (v) onText(v); } : null, onRetry });
  const out = parseActions(r.text);
  if (!writes) { out.actions = []; out.errors = []; }
  if (!out.text) out.text = out.actions.length ? 'راجع المقترح ده قبل ما يتسجّل:' : EMPTY_REPLY;
  if (r.stopReason === 'max_tokens') out.text += '\n\n(الرد اتقطع. قولّي «كمّل» لو عايز الباقي.)';
  if (cacheKey) await putCache(ctx, cacheKey, out);
  return { ...out, model: r.model, stopReason: r.stopReason, intent: effective };
}

/** Opens the coach chat in a bottom sheet over the current screen. attach is sent as context with every message. */
export function openCoachSheet(ctx, { intent = 'chat', attach = null, prompt = '' } = {}) {
  const body = document.createElement('div');
  body.className = 'co-sheet';
  const sh = ctx.sheet({ title: 'المدرب', body });
  import('./chat.js').then(({ mountChat }) => mountChat(body, ctx, { intent, attach, prompt, inSheet: true, close: () => sh.close() }))
    .catch(() => { body.textContent = 'المدرب مش متاح دلوقتي. جرّب تاني.'; });
  return sh;
}

export { INTENTS };

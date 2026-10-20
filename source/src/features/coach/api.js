// Unified AI coach API (contract, docs/parity.md §11 rule 3):
//   askCoach(ctx, {intent, prompt, extra}) → Promise<{text, actions[]}>
//   openCoachSheet(ctx, {intent, attach})  → opens the chat as a sheet from any screen
//   coachContext(ctx, {blocks})            → Promise<{text, blocks}>
// All Anthropic calls go through core/ai.js createAIClient (key handling + friendly errors). A fetch wrapper only
// swaps model / system / max_tokens on the request body; the key never passes through this file.
import { createAIClient, MODELS, AIError, AI_MESSAGES, systemBlocks } from '../../core/ai.js';
import { getSecret } from '../../core/db.js';
import { buildContext, loadCoachData } from './context.js';
import { parseActions } from './actions.js';
import { INTENTS, intentOf, detectIntent, SYSTEM, ACTION_PROTOCOL, ALL_BLOCKS } from './prompts.js';

export { AIError };
export const errorText = (e) => (e instanceof AIError ? e.message : AI_MESSAGES.server);

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
 * askCoach(ctx, {intent, prompt, extra}) → {text, actions, cached?}
 * extra: attached data (e.g. {liveSession}, {session}, {exercise}); reserved keys:
 *   history: [{role, content}] (chat turns, newest last), cacheKey: string (per-day cache), refresh: bool.
 */
export async function askCoach(ctx, { intent = 'chat', prompt = '', extra = {} } = {}) {
  const { history, cacheKey, refresh, ...attach } = extra || {};
  if (cacheKey && !refresh) { const hit = await cached(ctx, cacheKey); if (hit) return { text: hit.text, actions: hit.actions || [], errors: [], cached: true }; }
  const effective = intent === 'chat' ? detectIntent(prompt) : intent;
  const spec = intentOf(effective);
  const ctxText = (await coachContext(ctx, { blocks: spec.blocks, extra: Object.keys(attach).length ? attach : null })).text;
  const writes = intentOf(intent).writes || spec.writes;
  const system = `${SYSTEM}${writes ? `\n\n${ACTION_PROTOCOL}` : ''}\n\nData summary:\n${ctxText || '(no data yet)'}`;
  const turns = Array.isArray(history) && history.length ? history : [{ role: 'user', content: String(prompt) }];
  const r = await client(ctx, { model: MODELS[spec.model] || MODELS.coach, system, maxTokens: spec.maxTokens }).chat(turns, {});
  const out = parseActions(r.text);
  if (!writes) { out.actions = []; out.errors = []; }
  if (cacheKey) await putCache(ctx, cacheKey, out);
  return { ...out, model: r.model };
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

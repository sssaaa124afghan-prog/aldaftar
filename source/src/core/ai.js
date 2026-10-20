// Anthropic Messages API client (browser → api.anthropic.com directly, user's own key).
// The key comes from an injected getter, is sent only in the x-api-key header, and is never logged,
// stored here, or echoed in errors. Errors surface as friendly Egyptian-Arabic messages.

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';
export const MODELS = Object.freeze({ coach: 'claude-sonnet-5-5', quick: 'claude-haiku-5-5' });
export const MAX_HISTORY = 10;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const AI_MESSAGES = Object.freeze({
  no_key: 'لسه مفيش مفتاح API. حطّه من الإعدادات وجرّب تاني.',
  bad_key: 'مفتاح الـ API مش شغال. راجعه في الإعدادات.',
  forbidden: 'المفتاح ده مش مسموح له بالطلب ده. راجع صلاحيات المفتاح.',
  rate_limit: 'طلبات كتير ورا بعض. استنى دقيقة وجرّب تاني.',
  overloaded: 'الخدمة عليها ضغط دلوقتي. جرّب كمان شوية.',
  server: 'حصلت مشكلة عند الخدمة. جرّب كمان شوية.',
  bad_request: 'الطلب ماتقبلش. لو فيه صورة جرّب صورة أصغر.',
  offline: 'مفيش إنترنت. اتأكد من الاتصال وجرّب تاني.',
  timeout: 'الرد اتأخر أوي. جرّب تاني.',
  bad_response: 'الرد جه بشكل مش مفهوم. جرّب تاني.',
  bad_image: 'الصورة دي مش مدعومة. استخدم JPG أو PNG أو WebP أصغر من 5 ميجا.',
  empty_message: 'اكتب رسالتك الأول.',
});

export class AIError extends Error {
  constructor(code, status = null) { super(AI_MESSAGES[code] || AI_MESSAGES.server); this.name = 'AIError'; this.code = code; this.status = status; }
}

export function errorFromStatus(status, body) {
  const type = body && body.error && body.error.type;
  if (status === 401) return new AIError('bad_key', status);
  if (status === 403) return new AIError('forbidden', status);
  if (status === 429) return new AIError('rate_limit', status);
  if (status === 529 || type === 'overloaded_error') return new AIError('overloaded', status);
  if (status === 400 || status === 413 || status === 422) return new AIError('bad_request', status);
  return new AIError('server', status);
}

// ───────────────────────── context (privacy whitelist) ─────────────────────────

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const s = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, max) : null);
const macroLine = (m) => (m ? `${n(m.kcal)} kcal, P${n(m.p)} C${n(m.c)} F${n(m.f)}` : null);

/**
 * Compact summary sent with every coach message. Only whitelisted fields are read:
 * body metrics (age, sex, height, weight), today's targets/intake, last session, week adherence.
 * Name, employer, location or any other identifier is never read, even if present in ctx.
 */
export function buildContextSummary(ctx = {}) {
  const lines = [];
  const p = ctx.profile || {};
  const body = [n(p.age) && `age ${n(p.age)}`, (p.sex === 'male' || p.sex === 'female') && p.sex, n(p.heightCm) && `${n(p.heightCm)} cm`, n(p.weightKg) && `${n(p.weightKg)} kg`].filter(Boolean);
  if (body.length) lines.push(`Body: ${body.join(', ')}`);
  const t = ctx.today || {};
  if (t.day || t.targets) {
    lines.push(`Today ${s(t.day, 10) || ''} (${t.type === 'training' ? 'training day' : t.type === 'rest' ? 'rest day' : 'day'}${t.workoutName ? `: ${s(t.workoutName, 60)}` : ''})`);
    if (t.targets) lines.push(`Targets: ${macroLine(t.targets)}`);
    if (t.intake) lines.push(`Eaten so far: ${macroLine(t.intake)}`);
    if (n(t.waterMl) !== null) lines.push(`Water: ${n(t.waterMl)} ml`);
  }
  const ls = ctx.lastSession;
  if (ls) {
    const exs = (Array.isArray(ls.exercises) ? ls.exercises : []).slice(0, 8).map((e) => {
      const sets = (Array.isArray(e.sets) ? e.sets : []).filter((x) => x && (x.w > 0 || x.r > 0)).slice(0, 6).map((x) => `${n(x.w)}x${n(x.r)}`).join(' ');
      return `${s(e.name, 50)}${sets ? ` ${sets}` : ''}`;
    });
    lines.push(`Last session ${s(ls.day, 10) || ''}${ls.dayName ? ` ${s(ls.dayName, 40)}` : ''}${n(ls.durationMin) ? `, ${n(ls.durationMin)} min` : ''}: ${exs.join('; ')}`);
  }
  const w = ctx.week;
  if (w) {
    const parts = [n(w.sessionsDone) !== null && n(w.sessionsPlanned) !== null && `sessions ${n(w.sessionsDone)}/${n(w.sessionsPlanned)}`,
      n(w.proteinDaysHit) !== null && n(w.daysLogged) !== null && `protein target hit ${n(w.proteinDaysHit)}/${n(w.daysLogged)} days`,
      n(w.avgKcal) !== null && `avg ${n(w.avgKcal)} kcal`, n(w.weightTrendKgPerWeek) !== null && `weight trend ${n(w.weightTrendKgPerWeek)} kg/week`].filter(Boolean);
    if (parts.length) lines.push(`This week: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

export const COACH_SYSTEM = [
  'You are a personal strength and nutrition coach inside a private fitness app.',
  'Reply in Egyptian Arabic, short and practical; use Latin digits for numbers.',
  'Base advice on the data summary below; say so when data is missing. No medical diagnosis.',
  'Never ask for or mention personal identifiers.',
].join(' ');

export const CONTEXT_MARK = '\n\nData summary:\n';
const EPHEMERAL = Object.freeze({ type: 'ephemeral' });
/**
 * Prompt caching (Anthropic Messages API): the system prompt goes out as text blocks with cache_control breakpoints.
 * Breakpoint 1 = the stable instructions (same for every call of that kind), breakpoint 2 = instructions + the data/context
 * block (stable for the day). Repeat calls then read the prefix from cache (usage.cache_read_input_tokens); prompts under the
 * model's minimum (512 tokens on the 5.5 models) are simply not cached, no error. No beta header is needed.
 * Accepts a string (split at "Data summary:") or an existing block array (left as is).
 */
export function systemBlocks(system) {
  if (Array.isArray(system)) return system;
  const text = String(system || '');
  if (!text) return undefined;
  const i = text.indexOf(CONTEXT_MARK);
  if (i < 0) return [{ type: 'text', text, cache_control: { ...EPHEMERAL } }];
  return [
    { type: 'text', text: text.slice(0, i), cache_control: { ...EPHEMERAL } },
    { type: 'text', text: text.slice(i + 2), cache_control: { ...EPHEMERAL } },
  ];
}
/** Plain text of a system value (string or blocks), for logs and tests. */
export const systemText = (system) => (Array.isArray(system) ? system.map((b) => b && b.text || '').join('\n\n') : String(system || ''));

/** Keep the last MAX_HISTORY turns, map roles, merge consecutive same-role turns, start with user. */
export function prepareMessages(messages = []) {
  const clean = messages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content.slice(0, 8000) }))
    .slice(-MAX_HISTORY);
  while (clean.length && clean[0].role !== 'user') clean.shift();
  const out = [];
  for (const m of clean) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

// ───────────────────────── photo JSON parsing ─────────────────────────

export const PHOTO_PROMPT = [
  'Identify every food in this photo and estimate its portion.',
  'Return ONLY JSON, no prose, no code fences, exactly this shape:',
  '{"items":[{"name":"<Arabic name>","grams":<number>,"kcal":<number>,"p":<number>,"c":<number>,"f":<number>}]}',
  'p, c, f are grams of protein, carbs, fat for that portion. If there is no food, return {"items":[]}.',
].join('\n');

/** Defensive parse of the model's text into [{name, grams, kcal, p, c, f}]. Throws AIError('bad_response'). */
export function parsePhotoItems(text) {
  if (typeof text !== 'string') throw new AIError('bad_response');
  let t = text.replace(/```(?:json)?/gi, '').trim();
  const start = t.search(/[[{]/);
  if (start < 0) throw new AIError('bad_response');
  const open = t[start];
  const end = t.lastIndexOf(open === '{' ? '}' : ']');
  if (end <= start) throw new AIError('bad_response');
  let parsed;
  try { parsed = JSON.parse(t.slice(start, end + 1)); } catch { throw new AIError('bad_response'); }
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
  if (!arr) throw new AIError('bad_response');
  const num = (v, max) => { const x = typeof v === 'string' ? Number(v) : v; return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x * 10) / 10 : null; };
  return arr.flatMap((it) => {
    if (!it || typeof it !== 'object') return [];
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 80) : '';
    const grams = num(it.grams, 5000);
    if (!name || !grams) return [];
    return [{ name, grams, kcal: num(it.kcal, 10000) ?? 0, p: num(it.p, 1000) ?? 0, c: num(it.c, 1000) ?? 0, f: num(it.f, 1000) ?? 0 }];
  });
}

// ───────────────────────── client ─────────────────────────

/**
 * createAIClient({getKey, fetch, timeoutMs, isOnline})
 * getKey: () => string | Promise<string>   (reads settings; never cached here)
 */
export function createAIClient({ getKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = 45000, isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false) } = {}) {
  async function send(body) {
    const key = (await (getKey ? getKey() : ''))?.trim?.() || '';
    if (!key) throw new AIError('no_key');
    if (!isOnline()) throw new AIError('offline');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      throw new AIError(e && e.name === 'AbortError' ? 'timeout' : 'offline');
    } finally { if (timer) clearTimeout(timer); }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) throw errorFromStatus(res.status, json);
    if (!json || !Array.isArray(json.content)) throw new AIError('bad_response');
    const text = json.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    return { text, model: json.model || body.model, stopReason: json.stop_reason || null, usage: json.usage || null };
  }

  return {
    /** Coach chat: last 10 messages + compact context. Returns {text, model, stopReason, usage}. */
    async chat(messages, context = {}) {
      const msgs = prepareMessages(messages);
      if (!msgs.length) throw new AIError('empty_message');
      const summary = buildContextSummary(context);
      return send({ model: MODELS.coach, max_tokens: 1024, system: systemBlocks(summary ? `${COACH_SYSTEM}${CONTEXT_MARK}${summary}` : COACH_SYSTEM), messages: msgs });
    },

    /** Meal photo → {items:[{name, grams, kcal, p, c, f}], model}. */
    async analyzeMealPhoto(base64, mediaType = 'image/jpeg') {
      const data = typeof base64 === 'string' ? base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : '';
      if (!data || !PHOTO_TYPES.includes(mediaType) || (data.length * 3) / 4 > MAX_IMAGE_BYTES) throw new AIError('bad_image');
      const r = await send({
        model: MODELS.quick, max_tokens: 800,
        system: 'You are a nutrition estimator. Output strict JSON only.',
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: PHOTO_PROMPT },
        ] }],
      });
      return { items: parsePhotoItems(r.text), model: r.model };
    },
  };
}

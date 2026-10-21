// #/nutrition/add — search (Arabic normalisation + stems + synonyms), voice (ar-EG) with the local fast-path parser,
// favorites pinned, one-tap «+» with last qty, quick add, barcode (camera / photo / manual), photo AI + history,
// AI fallback «مش لاقيها؟», recipes and saved meals.
import { h } from '../../../ui/dom.js';
import { fmt, parseNum } from '../../../ui/num.js';
import { pop, haptic } from '../../../ui/anim.js';
import { isDayKey } from '../../../core/date.js';
import { validateQty } from '../../../core/targets.js';
import {
  SECTIONS, SECTION_LABEL, sectionForHour, searchFoods, suggestionsFor, typicalQty, makeEntry, quickEntry, validBarcode, offUrl, parseOFF, findByBarcode,
  entryFromAIItem, fatEntry, pushPhotoHistory,
} from '../logic.js';
import { kvGet, kvPatch, loadCatalog, loadUsage, saveFood, addEntries, rememberQty, aiClient, aiErrorText, dayLabel, relDay, fileToJpeg, hasAIKey, isOnline, foodFromAI } from '../data.js';
import { parseFoodUtterance, fastPathLog, voiceSupported, startVoice } from '../voice.js';
import { speechEnv, speechMessage, fileContextHint } from '../../../core/speech.js';
import { I, n0, topBar, foodRow, qtySheet } from '../ui.js';

const secOf = (s) => (SECTION_LABEL[s] ? s : sectionForHour(new Date().getHours()));

export async function addScreen(el, ctx, params) {
  const day = isDayKey(params.d) && params.d <= ctx.today() ? params.d : ctx.today();
  let section = secOf(params.s || params.section);
  const [{ list: catalog }, usage, nkv0] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, day), kvGet(ctx.db, 'nutrition')]);
  let cat = catalog;
  let nkv = nkv0;
  const lastQty = { ...(nkv.lastQty || {}) };
  let timer = null, stopVoice = null;

  const backParams = day === ctx.today() ? {} : { d: day };
  const sub = h('p', {});
  const setSub = () => { sub.textContent = `${relDay(day, ctx.today()) || dayLabel(day)} · ${SECTION_LABEL[section]}`; };
  const secChips = h('div', { class: 'chips nu-seg nu-pad', role: 'group', 'aria-label': 'الوجبة' });
  const drawSecChips = () => {
    secChips.textContent = '';
    for (const s of SECTIONS) secChips.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.key === section), onclick: () => { section = s.key; setSub(); drawSecChips(); draw(); } }, s.label));
  };
  const q = h('input', { id: 'nu-q', type: 'search', autocomplete: 'off', enterkeyhint: 'search', placeholder: 'مثلاً: رز، فراخ، «ضيف 150 جرام صدر فراخ»', 'aria-controls': 'nu-results' });
  const results = h('div', { id: 'nu-results', class: 'nu-results', 'aria-live': 'polite' });
  const voiceNote = h('p', { class: 'nu-hint', 'aria-live': 'polite' });
  const favs = () => nkv.favorites || {};

  const toggleFav = async (food, on) => {
    nkv = await kvPatch(ctx.db, 'nutrition', (n) => { const f = { ...(n.favorites || {}) }; if (on) f[food.id] = true; else delete f[food.id]; return { ...n, favorites: f }; });
    draw();
  };

  const logFood = async (food, qq, extra = []) => {
    let e;
    try { e = makeEntry(food, qq, section); } catch (x) { return x.message; }
    const ok = await addEntries(ctx, day, [e, ...extra], extra.length ? `اتسجّل ${food.name} + ${extra.length === 1 ? 'دهون مضافة' : 'دهون مضافة'}` : undefined);
    if (!ok) return 'ماقدرناش نحفظ دلوقتي. جرّب تاني.';
    lastQty[food.id] = qq; justNow[food.id] = qq; rememberQty(ctx.db, food.id, qq);
    return null;
  };

  // portion for this meal: what you logged in this meal before (eggs at breakfast ≠ chicken at lunch), else the last quantity
  const justNow = {};
  const qtyFor = (f) => justNow[f.id] || typicalQty(usage, f, section) || lastQty[f.id];
  const pick = (food, presetQty = null) => {
    const unit = food.unit || 'جرام';
    const def = presetQty || qtyFor(food) || (/جرام|مل/.test(unit) ? (food.per && food.per !== 1 ? food.per : 100) : 1);
    qtySheet(ctx, {
      title: food.name, sub: `لكل ${fmt(food.per)} ${unit}: ${fmt(food.kcal)} سعرة · ${fmt(food.p)} بروتين${food.fiber ? ` · ${fmt(food.fiber)} ألياف` : ''}`, unit, qty: def,
      favorite: food.id ? { on: !!favs()[food.id], toggle: (on) => toggleFav(food, on) } : null,
      fats: /جرام|مل/.test(unit) && food.cat !== 'دهون',
      preview: (qq) => { try { return { ok: true, entry: makeEntry(food, qq, section) }; } catch (e) { return { ok: false, message: e.message }; } },
      saveLabel: `سجّل في ${SECTION_LABEL[section]}`,
      onSave: async (qq, { fats }) => {
        const msg = await logFood(food, qq, fats.map((k) => fatEntry(k, section)).filter(Boolean));
        if (!msg) { q.value = ''; draw(); }
        return msg;
      },
    });
  };

  const quick = async (f) => {
    const qq = qtyFor(f) || (/جرام|مل/.test(f.unit || 'جرام') ? (f.per && f.per !== 1 ? f.per : 100) : 1);
    const msg = await logFood(f, qq);
    if (msg) ctx.toast(msg);
  };
  const row = (f, withQuick = false) => foodRow(f, { onPick: pick, fav: !!favs()[f.id], onQuick: withQuick ? quick : null,
    quickLabel: `سجّل ${f.name} ${fmt(qtyFor(f) || (/جرام|مل/.test(f.unit || 'جرام') ? 100 : 1))} ${f.unit || 'جرام'} في ${SECTION_LABEL[section]}` });

  const fastCard = (fp, raw) => {
    const e = (() => { try { return makeEntry(fp.food, fp.qty, fp.section || section); } catch { return null; } })();
    if (!e) return null;
    const sec = fp.section || section;
    const b = h('button', { type: 'button', class: 'btn nu-cta' }, I('plus'), `سجّل في ${SECTION_LABEL[sec]}`);
    b.addEventListener('click', async () => {
      b.disabled = true; pop(b); haptic();
      if (await addEntries(ctx, day, [{ ...e, src: 'voice' }], `اتسجّل ${fp.food.name} · ${fmt(e.kcal)} سعرة`)) { lastQty[fp.food.id] = fp.qty; rememberQty(ctx.db, fp.food.id, fp.qty); q.value = ''; draw(); }
      else b.disabled = false;
    });
    return h('div', { class: 'nu-card nu-fast', role: 'group', 'aria-label': 'تسجيل سريع' },
      h('p', { class: 'nu-kicker' }, 'فهمت', raw ? ` «${raw.slice(0, 60)}»` : ''),
      h('div', { class: 'nu-fast-row' }, h('div', { class: 'grow' }, h('b', {}, fp.food.name), h('small', {}, h('span', { class: 'num' }, fmt(fp.qty)), ` ${fp.food.unit || 'جرام'} · ${SECTION_LABEL[sec]}`)),
        h('span', { class: 'nu-fig' }, n0(e.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig nu-c-p' }, n0(e.p), h('small', {}, 'بروتين'))),
      h('div', { class: 'nu-fast-acts' }, b, h('button', { type: 'button', class: 'btn ghost', onclick: () => pick(fp.food, fp.qty) }, 'غيّر الكمية')));
  };

  function draw() {
    const query = q.value;
    results.textContent = '';
    if (!query.trim()) {
      const fav = cat.filter((f) => favs()[f.id]).slice(0, 8);
      const favIds = new Set(fav.map((f) => f.id));
      const sug = suggestionsFor(cat, usage, section).filter((f) => !favIds.has(f.id));
      const ids = new Set([...favIds, ...sug.map((f) => f.id)]);
      const rec = searchFoods(cat, '', { usage, limit: 12 }).filter((f) => !ids.has(f.id));
      if (fav.length) results.append(h('h3', { class: 'nu-h' }, 'المفضّلة'), ...fav.map((f) => row(f, true)));
      if (sug.length) results.append(h('h3', { class: 'nu-h' }, `بتسجّله عادةً في ${SECTION_LABEL[section]}`), ...sug.map((f) => row(f, true)));
      if (rec.length) results.append(h('h3', { class: 'nu-h' }, 'الأكتر استخدام'), ...rec.map((f) => row(f, true)));
      if (!fav.length && !sug.length && !rec.length) results.append(h('p', { class: 'nu-hint' }, `اكتب اسم الأكلة أو قولها بالصوت. فيه ${fmt(cat.length)} أكلة جاهزة، والبحث بيفهم «رز» و«أرز» و«دجاج» و«فراخ».`));
      return;
    }
    const parsed = parseFoodUtterance(query);
    const fp = parsed.qty ? fastPathLog(query, cat, { requireVerb: false }) : null;
    if (fp) { const c = fastCard(fp, ''); if (c) results.append(c); }
    const found = searchFoods(cat, parsed.qty && parsed.name ? parsed.name : query, { usage, limit: 30 });
    if (found.length) { results.append(...found.map((f) => row(f))); }
    if (!found.length || query.trim().length > 2) {
      const name = (parsed.name || query).trim().slice(0, 60);
      const ai = hasAIKey(ctx) && isOnline();
      const box = h('div', { class: found.length ? 'nu-notfound is-tail' : 'empty-state nu-notfound' },
        found.length ? h('p', { class: 'nu-hint' }, 'مش دي؟') : h('h3', {}, `مالقيناش «${name.slice(0, 40)}»`),
        found.length ? null : h('p', {}, 'جرّب اسم أقصر، أو اسأل عن قيمها، أو سجّلها بالسعرات والبروتين.'),
        h('div', { class: 'nu-row' },
          ai ? h('button', { type: 'button', class: 'btn ghost', onclick: () => aiFoodSheet(ctx, name, { day, getSection: () => section, onFood: async (food) => { cat = (await loadCatalog(ctx.db)).list; pick(food); } }) }, I('spark'), 'مش لاقيها؟ اسأل عن قيمها') : null,
          h('button', { type: 'button', class: 'btn ghost', onclick: () => quickSheet(ctx, day, () => section, name) }, 'إضافة سريعة')));
      results.append(box);
    }
  }
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 120); });
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const fp = fastPathLog(q.value, cat, { requireVerb: true });
    if (fp) { e.preventDefault(); results.querySelector('.nu-fast .nu-cta')?.focus(); }
  });

  // voice
  // always visible: without in-page speech (e.g. iOS home-screen app) it focuses the field for the keyboard mic
  const mic = h('button', { type: 'button', class: 'nu-mic', 'aria-label': 'قول الأكلة بالصوت', 'aria-pressed': 'false' }, I('mic'));
  mic.addEventListener('click', () => {
    if (stopVoice) { stopVoice(); stopVoice = null; mic.setAttribute('aria-pressed', 'false'); return; }
    if (!voiceSupported()) { voiceNote.textContent = speechMessage(speechEnv().reason || 'unsupported'); q.focus(); return; }
    mic.setAttribute('aria-pressed', 'true'); voiceNote.textContent = fileContextHint() || 'بسمعك… قول مثلاً «ميتين جرام فراخ»';
    stopVoice = startVoice({
      onInterim: (t) => { voiceNote.textContent = `سامعك: «${t.slice(0, 60)}»`; },
      onResult: (text, alts) => {
        const best = alts.map((a) => ({ a, fp: fastPathLog(a, cat) })).find((x) => x.fp) || { a: text, fp: null };
        voiceNote.textContent = `سمعت: «${best.a.slice(0, 80)}»`;
        q.value = best.a; draw();
        if (best.fp) { results.querySelector('.nu-fast')?.remove(); const c = fastCard(best.fp, best.a); if (c) results.prepend(c); }
        else if (!parseFoodUtterance(best.a).qty) voiceNote.textContent += ' · ماسمعناش الكمية، اختار الأكلة وحدد الكمية.';
      },
      onError: (m, code) => { voiceNote.textContent = m; if (code !== 'no-speech') q.focus(); },
      onEnd: () => { stopVoice = null; mic.setAttribute('aria-pressed', 'false'); if (/^(بسمعك|سامعك)/.test(voiceNote.textContent)) voiceNote.textContent = ''; },
    });
  });

  const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment', class: 'vh', tabindex: '-1', 'aria-hidden': 'true' });
  fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) photoFlow(ctx, day, () => section, f, cat); });

  const online = isOnline();
  const ai = hasAIKey(ctx);
  const tools = h('div', { class: 'nu-tools nu-pad' },
    h('button', { type: 'button', class: 'nu-tool', onclick: () => quickSheet(ctx, day, () => section) }, I('plus'), 'سريعة'),
    h('button', { type: 'button', class: 'nu-tool', onclick: () => barcodeFlow(ctx, async (food) => { cat = (await loadCatalog(ctx.db)).list; pick(food); }) }, I('barcode'), 'باركود'),
    ai && online ? h('button', { type: 'button', class: 'nu-tool', onclick: () => fileIn.click() }, I('camera'), 'صورة') : null,
    h('a', { class: 'nu-tool', href: `#/nutrition/meals?${new URLSearchParams({ d: day, s: section })}`, onclick: (e) => { e.preventDefault(); ctx.go('nutrition/meals', { d: day, s: section }); } }, I('food'), 'وجباتي'),
    h('a', { class: 'nu-tool', href: `#/nutrition/recipes?${new URLSearchParams({ d: day, s: section })}`, onclick: (e) => { e.preventDefault(); ctx.go('nutrition/recipes', { d: day, s: section }); } }, I('book'), 'وصفاتي'));
  const hist = Array.isArray(nkv.photoHistory) ? nkv.photoHistory.filter((x) => x && Array.isArray(x.items)) : [];
  const extras = h('div', { class: 'nu-pad nu-add-extras' },
    !online ? h('p', { class: 'nu-offline', role: 'status' }, I('wifioff', { size: 16 }), 'مفيش نت — المدرب والصور مش متاحين. البحث والتسجيل شغالين عادي.') : null,
    hist.length ? h('button', { type: 'button', class: 'nu-link', onclick: () => photoHistorySheet(ctx, day, () => section, hist) }, I('image', { size: 16 }), ` تحليلات الصور السابقة (${hist.length})`) : null);

  const bar = topBar(ctx, { title: 'سجّل أكل', backTo: ['nutrition', backParams] });
  bar.querySelector('.grow').append(sub);
  el.textContent = '';
  el.append(
    bar,
    h('div', { class: 'nu-body nu-add' }, secChips,
      h('div', { class: 'field nu-search nu-pad' }, h('label', { for: 'nu-q' }, 'دوّر على أكلة أو اكتب «ضيف 150 جرام …»'), h('div', { class: 'nu-search-box' }, I('search', { size: 18 }), q, mic), voiceNote),
      tools, extras, fileIn, h('div', { class: 'nu-pad' }, results)));
  setSub(); drawSecChips(); draw();
  return () => { clearTimeout(timer); if (stopVoice) stopVoice(); };
}

// ── AI fallback / AI add by name (never saved without confirm) ──
export function aiFoodSheet(ctx, name, { onFood } = {}) {
  const box = h('div', { class: 'nu-ai-food' });
  const status = h('p', { class: 'nu-hint', role: 'status' }, `بنسأل عن قيم «${name.slice(0, 40)}»…`);
  box.append(status);
  const s = ctx.sheet({ title: 'قيم الأكلة', body: box });
  (async () => {
    let food;
    try { food = await foodFromAI(ctx, name); } catch (e) {
      status.textContent = aiErrorText(e); status.classList.add('err');
      if (e && e.code === 'no_key') box.append(h('button', { type: 'button', class: 'btn ghost', onclick: () => { s.close(); ctx.go('profile'); } }, 'افتح الإعدادات'));
      return;
    }
    if (!food) { status.textContent = 'الرد ماكانش واضح. جرّب اسم أوضح أو استخدم الإضافة السريعة.'; status.classList.add('err'); return; }
    const { foodForm } = await import('./library.js');
    status.textContent = 'دي قيم تقديرية. راجعها وعدّل لو محتاج قبل ما تحفظ.';
    box.append(foodForm(ctx, { food: { ...food, id: null }, submitLabel: 'احفظ في أكلاتي وكمّل', onSaved: (saved) => { s.close(); onFood && onFood(saved); } }));
  })();
}

function quickSheet(ctx, day, getSection, name = '') {
  const f = (id, label, attrs) => {
    const input = h('input', { id, autocomplete: 'off', ...attrs });
    const err = h('p', { class: 'err', id: `${id}-err`, 'aria-live': 'polite' });
    input.setAttribute('aria-describedby', `${id}-err`);
    return { input, err, el: h('div', { class: 'field' }, h('label', { for: id }, label), input, err) };
  };
  const nm = f('nu-qa-name', 'الاسم (اختياري)', { type: 'text', maxlength: '60', value: name.slice(0, 60) });
  const kc = f('nu-qa-kcal', 'السعرات', { type: 'text', inputmode: 'numeric', class: 'num' });
  const pr = f('nu-qa-p', 'البروتين (جم)', { type: 'text', inputmode: 'decimal', class: 'num' });
  const check = (show) => {
    const r = quickEntry({ name: nm.input.value, kcal: parseNum(kc.input.value), p: pr.input.value === '' ? 0 : parseNum(pr.input.value) }, getSection());
    for (const [k, fl] of [['kcal', kc], ['p', pr], ['name', nm]]) {
      const msg = r.errors[k] || '';
      if (show || !msg) { fl.err.textContent = show ? msg : ''; if (msg && show) fl.input.setAttribute('aria-invalid', 'true'); else fl.input.removeAttribute('aria-invalid'); }
    }
    return r;
  };
  for (const fl of [nm, kc, pr]) { fl.input.addEventListener('blur', () => { if (fl.input.value !== '') check(true); }); fl.input.addEventListener('input', () => { fl.err.textContent = ''; fl.input.removeAttribute('aria-invalid'); }); }
  const body = h('div', {}, h('p', { class: 'lead' }, 'لما مش لاقي الأكلة: اكتب السعرات والبروتين بس.'), nm.el, h('div', { class: 'nu-two' }, kc.el, pr.el));
  ctx.sheet({ title: `إضافة سريعة · ${SECTION_LABEL[getSection()]}`, body, actions: [{ label: 'سجّل', run: async () => {
    const r = check(true);
    if (!r.ok) { (r.errors.kcal ? kc : r.errors.p ? pr : nm).input.focus(); return true; }
    await addEntries(ctx, day, [r.entry]);
    return false;
  } }, { label: 'إلغاء', ghost: true }] });
}

// ── barcode: camera (BarcodeDetector), still photo (BarcodeDetector on an image — iOS fallback), manual ──
function barcodeFlow(ctx, onFood) {
  let stream = null, timer = null, busy = false;
  const stop = () => { clearTimeout(timer); timer = null; if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } };
  const input = h('input', { id: 'nu-bc', type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'num', maxlength: '14', 'aria-describedby': 'nu-bc-err' });
  const err = h('p', { class: 'err', id: 'nu-bc-err', 'aria-live': 'polite' });
  const state = h('p', { class: 'nu-hint', 'aria-live': 'polite' });
  const video = h('video', { class: 'nu-video', playsinline: true, muted: true, 'aria-hidden': 'true' });
  const camWrap = h('div', { class: 'nu-cam', hidden: true }, video);
  const go = h('button', { type: 'button', class: 'btn nu-cta' }, 'دوّر');
  const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const photoIn = h('input', { type: 'file', accept: 'image/*', class: 'vh', tabindex: '-1', 'aria-hidden': 'true' });
  const photoBtn = hasDetector ? h('button', { type: 'button', class: 'btn ghost', onclick: () => photoIn.click() }, I('image', { size: 18 }), 'اقرأ الباركود من صورة') : null;
  photoIn.addEventListener('change', async () => {
    const f = photoIn.files && photoIn.files[0]; photoIn.value = '';
    if (!f) return;
    state.textContent = 'بنقرا الصورة…';
    try {
      const bmp = await createImageBitmap(f);
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const codes = await det.detect(bmp);
      bmp.close && bmp.close();
      const c = codes.find((x) => validBarcode(x.rawValue));
      if (!c) { state.textContent = ''; err.textContent = 'مالقيناش باركود واضح في الصورة. صوّره أقرب ومن غير لمعة، أو اكتب الرقم.'; return; }
      input.value = c.rawValue; lookup(c.rawValue);
    } catch { state.textContent = ''; err.textContent = 'ماقدرناش نقرا الصورة. اكتب الرقم اللي تحت الباركود.'; }
  });

  async function lookup(raw0) {
    const code = String(raw0 || '').replace(/\D+/g, '');
    if (!validBarcode(code)) { err.textContent = 'الرقم ده مش باركود صحيح. راجع الأرقام (8 أو 12 أو 13 رقم).'; input.setAttribute('aria-invalid', 'true'); return; }
    if (busy) return;
    busy = true; err.textContent = ''; input.removeAttribute('aria-invalid'); go.disabled = true; state.textContent = 'بندوّر على المنتج…';
    try {
      const { user } = await loadCatalog(ctx.db);
      const existing = findByBarcode(user, code);
      if (existing) { stop(); s.close(); onFood(existing); return; }
      if (navigator.onLine === false) throw Object.assign(new Error('offline'), { code: 'offline' });
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      let res;
      try { res = await fetch(offUrl(code), { signal: ctrl.signal, headers: { Accept: 'application/json' } }); } finally { clearTimeout(t); }
      const json = res.status === 404 ? { status: 0 } : res.ok ? await res.json().catch(() => null) : null;
      if (!json) throw Object.assign(new Error('server'), { code: 'server' });
      const food = parseOFF(json, code);
      if (!food) { state.textContent = ''; err.textContent = 'المنتج ده مش موجود أو مالوش سعرات مسجلة. استخدم الإضافة السريعة.'; return; }
      await saveFood(ctx.db, food);
      stop(); s.close(); onFood(food);
    } catch (e) {
      state.textContent = '';
      err.textContent = e && e.name === 'AbortError' ? 'الرد اتأخر. جرّب تاني.' : e && e.code === 'offline' ? 'مفيش إنترنت. اتأكد من الاتصال وجرّب تاني.' : 'ماقدرناش نوصل لقاعدة المنتجات دلوقتي. جرّب كمان شوية.';
    } finally { busy = false; go.disabled = false; }
  }
  go.addEventListener('click', () => lookup(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(input.value); });
  input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });

  const body = h('div', { class: 'nu-bc' }, camWrap, state,
    h('div', { class: 'field' }, h('label', { for: 'nu-bc' }, 'رقم الباركود'), input, err), go, photoBtn, photoIn,
    h('p', { class: 'nu-hint' }, 'البيانات من OpenFoodFacts. المنتج بيتحفظ عندك ومش بيتكرر لو صوّرته تاني.'));
  const s = ctx.sheet({ title: 'باركود', body, onClose: stop });

  if (hasDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream; camWrap.hidden = false; await video.play();
        state.textContent = 'وجّه الكاميرا على الباركود';
        const tick = async () => {
          if (!stream) return;
          try { const codes = await det.detect(video); const c = codes.find((x) => validBarcode(x.rawValue)); if (c) { input.value = c.rawValue; await lookup(c.rawValue); return; } } catch { /* keep trying */ }
          timer = setTimeout(tick, 350);
        };
        tick();
      } catch { stop(); camWrap.hidden = true; state.textContent = 'الكاميرا مش متاحة. صوّر الباركود أو اكتب الرقم اللي تحته.'; }
    })();
  } else state.textContent = 'اكتب الرقم اللي تحت الباركود.';
}

// ── photo → AI items → confirm/edit → log (history kept as text, no images) ──
async function photoFlow(ctx, day, getSection, file, catalog) {
  const box = h('div', { class: 'nu-photo' });
  const status = h('p', { class: 'nu-hint', role: 'status' }, 'بنحلّل الصورة…');
  box.append(status);
  const s = ctx.sheet({ title: 'وجبة من صورة', body: box });
  let items;
  try {
    const dataUrl = await fileToJpeg(file);
    items = (await aiClient(ctx).analyzeMealPhoto(dataUrl, 'image/jpeg')).items;
  } catch (e) {
    status.textContent = aiErrorText(e);
    status.classList.add('err');
    if (e && e.code === 'no_key') box.append(h('button', { type: 'button', class: 'btn ghost', onclick: () => { s.close(); ctx.go('profile'); } }, 'افتح الإعدادات'));
    return;
  }
  if (!items.length) { status.textContent = 'مالقيناش أكل واضح في الصورة. جرّب صورة أقرب أو سجّل يدوي.'; return; }
  kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, photoHistory: pushPhotoHistory(n.photoHistory, items) })).catch(() => {});
  status.textContent = 'راجع الأصناف والكميات قبل التسجيل. الأرقام تقدير.';
  itemsEditor(ctx, box, items, day, getSection, catalog, () => s.close());
}

function itemsEditor(ctx, box, items, day, getSection, catalog, done) {
  const rows = items.map((it, i) => {
    const on = h('input', { type: 'checkbox', checked: true, id: `nu-ph-${i}`, 'aria-label': `سجّل ${it.name}` });
    const name = h('input', { type: 'text', value: it.name, maxlength: '80', 'aria-label': 'اسم الصنف' });
    const g = h('input', { type: 'text', inputmode: 'numeric', class: 'num', value: String(it.grams), 'aria-label': `جرامات ${it.name}` });
    const fig = h('span', { class: 'nu-fig' });
    const err = h('p', { class: 'err', 'aria-live': 'polite' });
    const calc = () => {
      const v = validateQty(parseNum(g.value));
      fig.textContent = '';
      if (!v.ok) { err.textContent = v.message; g.setAttribute('aria-invalid', 'true'); return null; }
      err.textContent = ''; g.removeAttribute('aria-invalid');
      const k = v.qty / it.grams;
      const adj = { name: name.value.trim().slice(0, 80) || it.name, grams: v.qty, kcal: Math.round(it.kcal * k), p: Math.round(it.p * k * 10) / 10, c: Math.round(it.c * k * 10) / 10, f: Math.round(it.f * k * 10) / 10 };
      fig.append(n0(adj.kcal), h('small', {}, 'سعرة'));
      return adj;
    };
    g.addEventListener('input', calc); name.addEventListener('input', calc);
    calc();
    return { on, calc, el: h('div', { class: 'nu-ph-row' }, on, h('div', { class: 'grow' }, name, h('div', { class: 'nu-ph-g' }, g, h('small', {}, 'جم')), err), fig) };
  });
  const go = h('button', { type: 'button', class: 'btn nu-cta' }, `سجّل في ${SECTION_LABEL[getSection()]}`);
  go.addEventListener('click', async () => {
    const chosen = rows.filter((r) => r.on.checked).map((r) => r.calc());
    if (chosen.some((x) => !x)) return;
    if (!chosen.length) { done(); return; }
    const entries = chosen.map((it) => entryFromAIItem(it, getSection(), catalog)).map(({ matched, ...e }) => e);
    go.disabled = true;
    if (await addEntries(ctx, day, entries, `اتسجّل ${entries.length} صنف`)) done(); else go.disabled = false;
  });
  box.append(...rows.map((r) => r.el), go);
}

function photoHistorySheet(ctx, day, getSection, hist) {
  const fmtD = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const list = h('div', { class: 'nu-list' });
  const s = ctx.sheet({ title: 'تحليلات الصور السابقة', body: h('div', {}, h('p', { class: 'lead' }, 'آخر 20 تحليل (نص بس، الصور مش بتتحفظ).'), list) });
  for (const x of hist) {
    const kcal = x.items.reduce((a, b) => a + (Number(b.kcal) || 0), 0);
    list.appendChild(h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('b', {}, x.items.map((i) => i.name).join(' · ').slice(0, 80)), h('small', {}, fmtD.format(new Date(x.at)))),
      h('span', { class: 'nu-fig' }, n0(kcal), h('small', {}, 'سعرة')),
      h('button', { type: 'button', class: 'chip', onclick: async () => {
        s.close();
        const box = h('div', { class: 'nu-photo' }, h('p', { class: 'nu-hint' }, 'عدّل الكميات لو محتاج. الأرقام تقدير.'));
        const s2 = ctx.sheet({ title: 'سجّل تاني', body: box });
        itemsEditor(ctx, box, x.items, day, getSection, (await loadCatalog(ctx.db)).list, () => s2.close());
      } }, 'سجّل تاني')));
  }
}

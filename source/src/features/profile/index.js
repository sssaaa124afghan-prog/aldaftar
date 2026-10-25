// الملف: weight, age, training days, per-day-type targets, Anthropic key, backup, migration. (Dark only — no theme switch.)
import './profile.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, parseNum, countText } from '../../ui/num.js';
import { setTargets, validateTargets, kcalFromMacros } from '../../core/targets.js';
import { DEFAULT_TARGETS } from '../../core/schema.js';
import { createAIClient } from '../../core/ai.js';
import { loadTargets } from '../../app/day.js';
import { openWeightSheet, latestWeight } from './weight.js';
import { exportNow, pickAndImport } from './backup-ui.js';
import { renderMigrate } from './migration.js';
import { renderWelcome } from './onboarding.js';
import { haptic } from '../../ui/anim.js';

const DAYS = [[6, 'السبت'], [0, 'الأحد'], [1, 'الاتنين'], [2, 'التلات'], [3, 'الأربع'], [4, 'الخميس'], [5, 'الجمعة']];
const AGE_DEFAULT = 27;
// colour palettes (src/styles/palettes.css); '' = the default Electric Glass Pro look. Applied by main.js on settings:changed.
// Picker order: current → the 4 newest (owner's blue + grey first) → older ones. Swatch = CTA stops (+ secondary).
const PALETTES = [['', 'الحالي', '#FCD34D,#FB923C'], ['steel', 'أزرق فولاذي', '#60A5FA,#3B82F6 60%,#A3ABB8'], ['navy', 'كحلي ونحاس', '#EFA06A,#D97B3F 55%,#132042'], ['racing', 'أحمر سباق', '#EA2A33,#FF7A2F 60%,#A7AEBB'], ['tactical', 'زيتي تكتيكي', '#FFC94A,#B5CF3A 60%,#22261A'], ['emerald', 'Midnight Emerald', '#6EE7B7,#10B981'], ['ember', 'Carbon Ember', '#FF9A5C,#F2452E'], ['ocean', 'Ocean Neon', '#22D3EE,#3B82F6'], ['sand', 'رمال ملكية', '#F1DCAE,#C99D5E'], ['aurora', 'شفق فولاذي', '#D9F99D,#A3E635 55%,#C084FC']];

function paletteChips(ctx) {
  const cur = ctx.settings.get('palette') || '';
  const group = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 's-pal' });
  const btns = PALETTES.map(([id, name, sw]) => {
    const on = id === cur;
    const b = h('button', { type: 'button', class: 'chip pal-chip', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', dir: 'auto' },
      h('span', { class: 'pal-sw', 'aria-hidden': 'true', style: `background:linear-gradient(135deg,${sw})` }), name);
    b.addEventListener('click', () => pick(id));
    return b;
  });
  function pick(id, focus) {
    PALETTES.forEach(([pid], i) => { const on = pid === id; btns[i].setAttribute('aria-checked', String(on)); btns[i].tabIndex = on ? 0 : -1; if (on && focus) btns[i].focus(); });
    if ((ctx.settings.get('palette') || '') !== id) ctx.settings.set('palette', id);
  }
  group.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement); if (i < 0) return;
    const d = { ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1 }[e.key]; // RTL: left = next
    if (!d) return;
    e.preventDefault(); pick(PALETTES[(i + d + btns.length) % btns.length][0], true);
  });
  group.append(...btns);
  return group;
}

const section = (id, title, ico, ...kids) => h('section', { class: 'psec', 'aria-labelledby': id }, h('h2', { id }, ico ? raw(icon(ico)) : null, title), ...kids);

function field(id, labelText, input, hint) {
  input.id = id;
  const err = h('p', { class: 'err', id: `${id}-err`, 'aria-live': 'polite' });
  if (hint) input.setAttribute('aria-describedby', `${id}-hint ${id}-err`); else input.setAttribute('aria-describedby', `${id}-err`);
  return { el: h('div', { class: 'field' }, h('label', { for: id }, labelText), input, hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null, err), err };
}
const numInput = (value, mode = 'numeric') => h('input', { type: 'text', inputmode: mode, autocomplete: 'off', class: 'num', value: value ?? '' });

async function getProfile(db) { try { return (await db.get('profile', 'me')) || { key: 'me' }; } catch { return { key: 'me' }; } }

function targetsBlock(ctx, targets, type) {
  const t = targets[type] || DEFAULT_TARGETS[type];
  const ins = { kcal: numInput(t.kcal), p: numInput(t.p), c: numInput(t.c), f: numInput(t.f) };
  const names = { kcal: 'سعرات', p: 'بروتين', c: 'كارب', f: 'دهون' };
  const grid = h('div', { class: 'fgrid' });
  for (const k of Object.keys(ins)) grid.appendChild(h('div', { class: 'field' }, h('label', { for: `t-${type}-${k}` }, names[k]), Object.assign(ins[k], { id: `t-${type}-${k}` })));
  const note = h('p', { class: 'tnote', 'aria-live': 'polite' });
  const read = () => Object.fromEntries(Object.entries(ins).map(([k, i]) => [k, parseNum(i.value)]));
  const check = () => {
    const v = read(); const r = validateTargets(v);
    note.className = 'tnote';
    if (r.issues.some((i) => i.code !== 'kcal_mismatch')) { note.textContent = 'اكتب أرقام في الحدود المعقولة في الأربع خانات.'; note.classList.add('over'); return r; }
    const mk = kcalFromMacros(v);
    if (r.issues.length) { note.textContent = `الماكروز بتطلع ${fmt(mk)} سعرة، والهدف ${fmt(v.kcal)} (فرق ${fmt(v.kcal - mk, { sign: true })}). هنحفظ اللي كتبته.`; note.classList.add('warn'); }
    else note.textContent = `الماكروز = ${fmt(mk)} سعرة · متوافقة`;
    return r;
  };
  Object.values(ins).forEach((i) => i.addEventListener('input', check));
  check();
  const save = h('button', { type: 'button', class: 'btn ghost sm' }, 'احفظ الهدف');
  save.addEventListener('click', async () => {
    const cur = await loadTargets(ctx.db);
    const res = setTargets(cur, type, read());
    if (!res.saved) { check(); ins.kcal.focus(); return; }
    const prev = cur;
    try { await ctx.db.put('kv', { key: 'targets', value: res.targets }); } catch { ctx.toast('ماقدرناش نحفظ الهدف — جرّب تاني.'); return; }
    ctx.emit('settings:changed', { key: 'targets' });
    ctx.toast(type === 'training' ? 'اتحفظ هدف يوم التمرين' : type === 'heart' ? 'اتحفظ هدف يوم القلب' : 'اتحفظ هدف يوم الراحة', { action: { label: 'تراجع', run: async () => {
      await ctx.db.put('kv', { key: 'targets', value: prev }); ctx.emit('settings:changed', { key: 'targets' });
    } } });
  });
  const reset = h('button', { type: 'button', class: 'btn ghost sm' }, 'رجّع الافتراضي');
  reset.addEventListener('click', () => { const d = DEFAULT_TARGETS[type]; for (const k of Object.keys(ins)) ins[k].value = d[k]; check(); });
  const name = type === 'training' ? 'يوم التمرين' : type === 'heart' ? 'يوم القلب' : 'يوم الراحة';
  // one line per day type; the 4 fields open only on «عدّل» (set once, rarely changed)
  return h('details', { class: 'tblock' },
    h('summary', {}, h('span', { class: 'grow' }, h('b', {}, name), h('small', { class: 'num' }, `${fmt(t.kcal)} سعرة · بروتين ${fmt(t.p)} · كارب ${fmt(t.c)} · دهون ${fmt(t.f)} جم`)), h('span', { class: 'tedit' }, 'عدّل')),
    grid, note, h('div', { class: 'btn-row' }, save, reset));
}

async function renderProfile(el, ctx) {
  const db = ctx.db;
  const [prof, targets, w, meta] = await Promise.all([getProfile(db), loadTargets(db), latestWeight(db), db.get('meta', 'meta').catch(() => null)]);

  // body
  const wRow = h('button', { type: 'button', class: 'list-row' }, raw(icon('scale')),
    h('span', { class: 'grow' }, h('b', {}, 'وزن الجسم'), h('small', {}, w ? `آخر تسجيل ${w.day}` : 'لسه ماتسجلش')),
    w ? h('span', { class: 'num' }, `${fmt(w.kg, { dp: 1 })} كجم`) : h('span', { class: 'chip' }, 'سجّل'));
  wRow.addEventListener('click', () => openWeightSheet(ctx));
  const age = field('p-age', 'السن', numInput(prof.age ?? AGE_DEFAULT), prof.age ? '' : 'افتراضي 27 — عدّله لو مختلف');
  const ageIn = age.el.querySelector('input');
  ageIn.addEventListener('blur', async () => {
    const n = parseNum(ageIn.value);
    if (!Number.isInteger(n) || n < 12 || n > 100) { age.err.textContent = 'اكتب السن رقم صحيح بين 12 و 100'; ageIn.setAttribute('aria-invalid', 'true'); return; }
    age.err.textContent = ''; ageIn.removeAttribute('aria-invalid');
    if (n === prof.age) return;
    prof.age = n;
    try { await db.put('profile', { ...prof, key: 'me', age: n }); ctx.toast('اتحفظ السن'); } catch { ctx.toast('ماقدرناش نحفظ — جرّب تاني.'); }
  });
  ageIn.addEventListener('input', () => { age.err.textContent = ''; ageIn.removeAttribute('aria-invalid'); });
  const ht = field('p-height', 'الطول (سم)', numInput(prof.heightCm ?? ''), '');
  const htIn = ht.el.querySelector('input');
  htIn.addEventListener('blur', async () => {
    if (!htIn.value.trim()) return;
    const n = parseNum(htIn.value);
    if (!Number.isFinite(n) || n < 120 || n > 230) { ht.err.textContent = 'اكتب الطول بالسنتيمتر بين 120 و 230'; htIn.setAttribute('aria-invalid', 'true'); return; }
    ht.err.textContent = ''; htIn.removeAttribute('aria-invalid');
    if (Math.round(n) === prof.heightCm) return;
    prof.heightCm = Math.round(n);
    try { await db.put('profile', { ...prof, key: 'me', heightCm: prof.heightCm }); ctx.toast('اتحفظ الطول'); } catch { ctx.toast('ماقدرناش نحفظ — جرّب تاني.'); }
  });
  htIn.addEventListener('input', () => { ht.err.textContent = ''; htIn.removeAttribute('aria-invalid'); });

  // returning after a break: first 2 weeks lighter (workout reads settings 'wk.reentry')
  const re = ctx.settings.get('wk.reentry');
  const reOn = !!(re && re.startDay);
  const reSw = h('input', { type: 'checkbox', id: 'p-reentry', role: 'switch', checked: reOn ? true : null });
  const reHint = h('span', { class: 'hint', id: 'p-reentry-h' }, reOn ? `من ${re.startDay} لمدة ${re.weeks || 2} أسبوع: أوزان أخف ومجموعات أقل` : 'لو راجع بعد 3 شهور أو أكتر من غير تمرين');
  reSw.setAttribute('aria-describedby', 'p-reentry-h');
  reSw.addEventListener('change', async () => {
    const v = reSw.checked ? { startDay: ctx.today(), weeks: 2 } : null;
    await ctx.settings.set('wk.reentry', v);
    reHint.textContent = v ? `من ${v.startDay} لمدة أسبوعين: أوزان أخف ومجموعات أقل` : 'لو راجع بعد 3 شهور أو أكتر من غير تمرين';
    ctx.toast(v ? 'أسبوع رجوع اتفعّل' : 'أسبوع رجوع اتقفل');
  });

  // training days
  const td = new Set(ctx.settings.get('trainingDays'));
  const tdChips = h('div', { class: 'chips', role: 'group', 'aria-labelledby': 's-days' });
  const tdNote = h('p', { class: 'hint' });
  const tdCount = () => { tdNote.textContent = `${countText(td.size, 'day')} تمرين في الأسبوع · الأيام دي بتحدد هدف الأكل`; };
  for (const [d, name] of DAYS) {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': td.has(d) ? 'true' : 'false' }, name);
    b.addEventListener('click', () => {
      if (td.has(d)) td.delete(d); else td.add(d);
      b.setAttribute('aria-pressed', td.has(d) ? 'true' : 'false');
      ctx.settings.set('trainingDays', [...td].sort()); tdCount();
    });
    tdChips.appendChild(b);
  }
  tdCount();

  // API key
  const keyIn = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', dir: 'ltr', value: ctx.settings.get('anthropicKey') || '', placeholder: 'sk-ant-…' });
  const key = field('p-key', 'مفتاح Anthropic API', keyIn, 'محفوظ على الجهاز ده بس — مش بيدخل في النسخة الاحتياطية أبداً.');
  const keyMsg = h('p', { class: 'hint', 'aria-live': 'polite' });
  const saveKey = h('button', { type: 'button', class: 'btn ghost sm' }, 'احفظ المفتاح');
  const testKey = h('button', { type: 'button', class: 'btn ghost sm' }, 'جرّب المفتاح');
  const showKey = h('button', { type: 'button', class: 'btn ghost sm', 'aria-pressed': 'false' }, 'اظهر');
  showKey.addEventListener('click', () => { const on = keyIn.type === 'password'; keyIn.type = on ? 'text' : 'password'; showKey.textContent = on ? 'اخفي' : 'اظهر'; showKey.setAttribute('aria-pressed', String(on)); });
  saveKey.addEventListener('click', async () => {
    const v = keyIn.value.trim();
    if (v && !/^sk-ant-/.test(v)) { key.err.textContent = 'المفتاح عادة بيبدأ بـ sk-ant- — راجعه.'; }
    else key.err.textContent = '';
    await ctx.settings.set('anthropicKey', v);
    keyMsg.textContent = v ? 'اتحفظ المفتاح على الجهاز.' : 'اتمسح المفتاح.';
  });
  testKey.addEventListener('click', async () => {
    testKey.disabled = true; keyMsg.textContent = 'بنجرّب…';
    const v = keyIn.value.trim() || ctx.settings.get('anthropicKey');
    try {
      const ai = createAIClient({ getKey: () => v });
      await ai.chat([{ role: 'user', content: 'رد بكلمة واحدة: تمام' }]);
      keyMsg.textContent = 'المفتاح شغال.';
    } catch (e) { keyMsg.textContent = e && e.message ? e.message : 'المفتاح ماشتغلش.'; }
    testKey.disabled = false;
  });

  // «أكّد قبل تسجيل الأكل» (coach chat; default off = a valid food log is saved at once with «تراجع»)
  const cfSw = h('input', { type: 'checkbox', id: 'p-confirm-food', role: 'switch', checked: ctx.settings.get('coach.confirmFood') ? true : null, 'aria-describedby': 'p-confirm-food-h' });
  const cfHint = h('span', { class: 'hint', id: 'p-confirm-food-h' }, 'لو مقفول: الأكل اللي تقول للمدرب إنك أكلته بيتسجّل على طول ومعاه «تراجع»');
  cfSw.addEventListener('change', async () => { await ctx.settings.set('coach.confirmFood', cfSw.checked); ctx.toast(cfSw.checked ? 'هيسألك قبل ما يسجّل الأكل' : 'الأكل هيتسجّل على طول'); });

  // المظهر: «قلّل الحركة» + «اهتزاز خفيف» (main.js applies both on settings:changed)
  const rmSw = h('input', { type: 'checkbox', id: 'p-rm', role: 'switch', checked: ctx.settings.get('ui.reduceMotion') === true ? true : null, 'aria-describedby': 'p-rm-h' });
  const rmHint = h('span', { class: 'hint', id: 'p-rm-h' }, 'الشاشات بتتغيّر على طول من غير انزلاق أو أرقام بتعدّ');
  rmSw.addEventListener('change', async () => { await ctx.settings.set('ui.reduceMotion', rmSw.checked); ctx.toast(rmSw.checked ? 'الحركة اتقلّلت' : 'الحركة رجعت'); });
  const hpSw = h('input', { type: 'checkbox', id: 'p-haptic', role: 'switch', checked: ctx.settings.get('ui.haptics') !== false ? true : null, 'aria-describedby': 'p-haptic-h' });
  const hpHint = h('span', { class: 'hint', id: 'p-haptic-h' }, 'نبضة صغيرة لما تخلّص مجموعة، الراحة تخلص، رقم شخصي، أو أكل يتسجّل');
  hpSw.addEventListener('change', async () => { await ctx.settings.set('ui.haptics', hpSw.checked); if (hpSw.checked) haptic(); });

  // backup
  const exp = h('button', { type: 'button', class: 'list-row' }, raw(icon('download')), h('span', { class: 'grow' }, h('b', {}, 'اعمل نسخة احتياطية'), h('small', {}, meta && meta.lastBackupAt ? `آخر نسخة ${meta.lastBackupAt.slice(0, 10)}` : 'لسه مفيش نسخة — ملف JSON على جهازك')));
  exp.addEventListener('click', () => exportNow(ctx));
  const imp = h('button', { type: 'button', class: 'list-row' }, raw(icon('upload')), h('span', { class: 'grow' }, h('b', {}, 'استورد نسخة'), h('small', {}, 'من التطبيق ده أو من Solo Gym / NutriPro')));
  imp.addEventListener('click', () => pickAndImport(ctx, { after: () => ctx.go('profile') }));
  // «استورد أوزانك القديمة»: old GymPro Elite backup → working weights for the plan (#/workout/import, parsed on the device)
  const oldW = h('a', { class: 'list-row', href: '#/workout/import' }, raw(icon('dumbbell')), h('span', { class: 'grow' }, h('b', {}, 'استورد أوزانك القديمة'), h('small', {}, 'من ملف GymPro Elite · أول جلسة تفتح بأوزانك')), raw(icon('chevron')));
  const backupRows = [exp, imp, oldW];
  if (!meta || !meta.migratedAt) {
    const mig = h('a', { class: 'list-row', href: '#/profile/migrate' }, raw(icon('repeat')), h('span', { class: 'grow' }, h('b', {}, 'انقل بياناتك القديمة'), h('small', {}, 'من Solo Gym و NutriPro على الجهاز ده')), raw(icon('chevron')));
    backupRows.unshift(mig);
  }

  const name = (prof.name || '').trim();
  const initials = name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('') : 'أنا';
  const kgText = w ? `${fmt(w.kg, { dp: 1 })} كجم` : '—';
  fill(el, 
    h('header', { class: 'band' }, h('div', { class: 'grow' }, h('h1', {}, 'الملف'), h('p', {}, 'بياناتك وإعداداتك · على الجهاز ده بس'))),
    h('div', { class: 'pwrap' },
      h('div', { class: 'phero glass' },
        h('div', { class: 'pav', 'aria-hidden': 'true' }, initials),
        h('div', { class: 'grow' }, h('b', {}, name || 'ملفك الشخصي'),
          h('small', {}, `${countText(td.size, 'day')} تمرين في الأسبوع`)),
        h('div', { class: 'pstat' }, h('span', { class: 'num' }, kgText), h('small', {}, 'آخر وزن'))),
      section('s-body', 'الجسم', 'scale', h('div', { class: 'sheet-card plist' }, wRow), h('div', { class: 'sheet-card pform' }, h('div', { class: 'fgrid' }, age.el, ht.el))),
      section('s-days', 'التمرين', 'dumbbell', h('div', { class: 'sheet-card pform' }, h('p', { class: 'lbl' }, 'أيام الحديد'), tdChips, tdNote,
        h('label', { class: 'pswitch', for: 'p-reentry' }, h('span', {}, 'راجع بعد انقطاع', reHint), reSw, h('i', { 'aria-hidden': 'true' })))),
      section('s-targets', 'أهداف الأكل', 'food', h('p', { class: 'hint' }, 'كل نوع يوم ليه هدفه. اضغط «عدّل» لو عايز تغيّر.'),
        h('div', { class: 'sheet-card' }, targetsBlock(ctx, targets, 'training'), targetsBlock(ctx, targets, 'heart'), targetsBlock(ctx, targets, 'rest'))),
      section('s-ai', 'المدرب الذكي', 'spark', h('div', { class: 'sheet-card pform' }, key.el, h('div', { class: 'btn-row wrap' }, saveKey, testKey, showKey), keyMsg,
        h('label', { class: 'pswitch', for: 'p-confirm-food' }, h('span', {}, 'أكّد قبل تسجيل الأكل', cfHint), cfSw, h('i', { 'aria-hidden': 'true' })))),
      section('s-data', 'البيانات', 'download', h('div', { class: 'sheet-card plist' }, ...backupRows)),
      section('s-pal', 'المظهر', 'spark', h('details', { class: 'sheet-card pform pfold' }, h('summary', {}, h('span', { class: 'grow' }, 'ألوان البرنامج'), h('span', { class: 'tedit' }, 'غيّر')),
        paletteChips(ctx), h('p', { class: 'hint' }, 'نفس التصميم بألوان مختلفة · بيتغيّر على طول')),
        h('div', { class: 'sheet-card pform pfeel' },
          h('label', { class: 'pswitch', for: 'p-rm' }, h('span', {}, 'قلّل الحركة', rmHint), rmSw, h('i', { 'aria-hidden': 'true' })),
          h('label', { class: 'pswitch', for: 'p-haptic' }, h('span', {}, 'اهتزاز خفيف', hpHint), hpSw, h('i', { 'aria-hidden': 'true' })))),
    ));
}

export const routes = {
  profile: renderProfile,
  'profile/migrate': (el, ctx) => renderMigrate(el, ctx),
  'profile/welcome': (el, ctx, params) => renderWelcome(el, ctx, params),
};

// #/workout/kegel — pelvic floor training at home (plan/mens-health.md §2, §6). Private and calm:
// neutral title, on-device log in kv 'health'.kegel (never the sessions store), no streaks, no explicit wording.
import { h, N, ico, band, safeWrite } from './view.js';
import { tone } from './kit.js';
import { reduced } from '../../ui/anim.js';
import { kegelStage, kegelWeek, kegelSteps, kegelWeekCount, runner, loadHealth, patchHealth, buzz, cueSwitches, KEGEL_STAGES, POS, totalSecs } from './heart.js';
import { pelvisArt, positionsArt } from './kegel-art.js';

export const KEGEL_TITLE = 'تمرين قاع الحوض';
/** Progression levels (the last KEGEL_STAGES entry is maintenance, shown as «محافظة», not a 6th level). */
const LEVELS = KEGEL_STAGES.filter((s) => !s.maintenance).length;
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.max(0, t) % 60).padStart(2, '0')}`;
const CUE = {
  hold: ['شد', 'ارفع لجوه ولفوق · اتنفس طبيعي'],
  relax: ['ارخِ', 'سيب العضلات خالص · ده جزء من التمرين'],
  flick: ['شد سريع', 'ثانية واحدة'],
  frelax: ['ارخِ', 'سيب تماماً'],
  move: ['غيّر وضعك', ''],
};
export const KEGEL_TIPS = [
  'اتنفس طبيعي طول الوقت. متكتمش نفسك.',
  'البطن والأرداف والفخاد مرتاحين. حط إيدك على بطنك: المفروض متتحركش تقريباً.',
  'الحركة «رفع لجوه ولفوق»، مش «زق لتحت».',
  'الارتخاء الكامل بين كل عدّة جزء من التمرين، متستعجلوش.',
  'أكتر مش أحسن. لو المنطقة وجعتك، قلّل.',
  'كل يوم، مش أيام الجيم بس. النتيجة بتاخد من 3 لـ 6 شهور. ومتعملوش قبل سكوات أو روماني تقيل.',
];
const MISTAKES = ['كتم النفس أو الزق لتحت', 'شد الأرداف أو الفخاد أو البطن بدل قاع الحوض', 'إنك تنسى الارتخاء بين العدّات', 'إنك تزوّد أوي لحد ما المنطقة توجعك'];

function stageLine(st) {
  return [N(String(st.reps)), ' × شد ', N(String(st.hold)), ' ث / ارخِ ', N(String(st.relax)), ' ث', ' · سريع ', N(String(st.flicks)), ' × ', N('1'), ' ث'];
}

export async function renderKegel(el, ctx) {
  const prevTitle = document.title;
  document.title = KEGEL_TITLE;
  const today = ctx.today();
  const health = await loadHealth(ctx.db);
  const kg = health.kegel || {};
  const week = kegelWeek(kg.start || today, today);
  const auto = kegelStage(week);
  const st = KEGEL_STAGES.find((s) => s.stage === kg.stage) || auto;
  const startDow = ctx.settings.get('weekStart') ?? 1;
  const cnt = kegelWeekCount(kg.log, today, startDow);
  const rerender = () => ctx.go('workout/kegel');
  let closed = false;

  el.appendChild(band({ title: KEGEL_TITLE, sub: ['في البيت · حوالي ', N(String(Math.max(3, Math.round(totalSecs(kegelSteps(st)) / 60)))), ' دقايق · على جهازك بس'], back: () => ctx.go('workout') }));
  const root = h('div', { class: 'hk-root hk-kegel' });
  el.appendChild(root);

  // ── (a) onboarding «اعرفها الأول» ──
  const learn = h('details', { class: 'glass wk-card hk-learn', open: kg.onboarded ? null : true },
    h('summary', {}, h('h3', {}, 'اعرفها الأول'), h('small', {}, kg.onboarded ? 'افتح للمراجعة' : 'دقيقتين قبل أول مرة')),
    h('div', { class: 'hk-fold-body' },
      pelvisArt(),
      h('ol', { class: 'wk-steps hk-ol' },
        h('li', {}, 'العضلات دي هي اللي بتستخدمها عشان تمسك الغازات، أو توقف البول في النص.'),
        h('li', {}, h('b', {}, 'وقف البول ده بس عشان تعرفها مرة واحدة، مش تمرين. '), 'متكررهوش، لأنه ممكن يخلّي المثانة متفضاش كويس.'),
        h('li', {}, 'لما تشد هتحس برفعة خفيفة لجوه ولفوق في قاع الحوض، والبطن والأرداف والفخاد مرتاحين.'),
        h('li', {}, 'ابدأ نايم على ضهرك (أسهل)، وبعدين قاعد، وبعدين واقف (أصعب).')),
      h('h4', {}, 'أخطاء شائعة'),
      h('ul', { class: 'hk-x' }, ...MISTAKES.map((m) => h('li', {}, m))),
      h('h4', {}, 'امتى توقف وتكشف'),
      h('p', { class: 'wk-muted' }, 'لو حسيت بوجع في الحوض أو أسفل البطن أو وقت التبول، وقّف واكشف عند دكتور. ساعات العضلات بتبقى مشدودة زيادة، وعلاجها ارتخاء مش تقوية.'),
      kg.onboarded ? null : h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => { if (await safeWrite(ctx, () => patchHealth(ctx.db, (c) => ({ ...c, kegel: { ...(c.kegel || {}), onboarded: true } })))) rerender(); } }, 'فهمت، يلا نبدأ')));
  root.appendChild(learn);

  // ── level ──
  const levelChips = h('div', { class: 'chips hk-levels', role: 'group', 'aria-label': 'اختار المستوى' },
    // levels 1–5 + one «محافظة» chip (the maintenance stage after week 12), so the heading «المستوى N من 5» matches the chips (UX B5)
    ...KEGEL_STAGES.map((s) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.stage === st.stage),
      'aria-label': `${s.maintenance ? 'مستوى المحافظة' : `المستوى ${s.stage} من ${LEVELS}`}${s === auto ? ' (المقترح)' : ''}`,
      onclick: async () => { if (await safeWrite(ctx, () => patchHealth(ctx.db, (c) => ({ ...c, kegel: { ...(c.kegel || {}), stage: s === auto ? null : s.stage } })))) rerender(); } },
    s.maintenance ? 'محافظة' : N(String(s.stage)), s === auto ? h('small', {}, ' مقترح') : null)));
  root.appendChild(h('section', { class: 'glass wk-card hk-level', 'aria-labelledby': 'hk-lv-h' },
    h('h3', { id: 'hk-lv-h' }, st.maintenance ? 'مستوى المحافظة' : ['المستوى ', N(String(st.stage)), ' من ', N(String(LEVELS))],
      h('small', {}, st.maintenance ? 'بعد الأسبوع 12' : ['الأسبوع ', N(String(Math.min(week, 12))), ' من ', N('12')])),
    h('p', {}, ...stageLine(st), st.maxSet ? ' · وفي الآخر شدّة أقصى واحدة' : ''),
    h('p', { class: 'wk-muted' }, 'الأوضاع: ', st.positions.map((p) => POS[p]).join(' ← '), ' · ', st.perDay === 2 ? 'مرتين في اليوم' : 'مرة في اليوم، 5 أيام على الأقل'),
    st.stage === 5 ? h('p', { class: 'wk-muted' }, 'وجرّب شدّة خفيفة وإنت ماشي أو بعد ما تقوم من الكرسي.') : null,
    positionsArt(st.positions),
    h('p', { class: 'wk-hint quiet' }, 'تطلع المستوى اللي بعده بس لو كل العدّات كاملة، والارتخاء كامل، والنفس طبيعي. غير كده خليك فيه.'),
    levelChips));

  // ── (b) guided timer ──
  const steps = kegelSteps(st);
  const r = runner(steps);
  const total = totalSecs(steps);
  const circle = h('div', { class: 'hk-breath', 'aria-hidden': 'true' }, h('i', {}));
  const cue = h('b', { class: 'hk-cue' }, 'جاهز');
  const cueSub = h('p', { class: 'hk-cue-sub' }, 'لما تبدأ هنقولك امتى تشد وامتى ترخي.');
  const count = h('p', { class: 'hk-count' });
  const tLeft = h('p', { class: 'hk-tleft' });
  const poses = h('div', { class: 'hk-pose-now' });
  const play = h('button', { type: 'button', class: 'btn', onclick: () => { r.toggle(); paint(true); } }, 'ابدأ الجلسة');
  root.appendChild(h('section', { class: 'glass wk-card hk-kplayer', 'aria-labelledby': 'hk-kp-h' },
    h('h3', { id: 'hk-kp-h' }, 'الجلسة', h('small', {}, N(fmt(total)))),
    h('div', { class: 'hk-kstage', role: 'timer', 'aria-live': 'polite' }, circle, h('div', { class: 'hk-cuebox' }, cue, cueSub)),
    count, tLeft, poses,
    h('div', { class: 'wk-rx-ctrls' },
      h('button', { type: 'button', class: 'ibtn glass', 'aria-label': 'الخطوة اللي فاتت', onclick: () => { r.jump(-1); paint(true); } }, ico('skip')),
      play,
      h('button', { type: 'button', class: 'ibtn glass wk-flip', 'aria-label': 'الخطوة الجاية', onclick: () => { if (r.jump(1) === 'finished') finish(); else paint(true); } }, ico('skip'))),
    h('p', { class: 'wk-muted' }, 'تقدر تقفل الشاشة: لو فتحت الاهتزاز من تحت، هيهز مع كل شد وارخِ.')));

  let lastIdx = -1, saved = false;
  function paint(force) {
    const s = r.s, step = steps[s.idx], left = r.left();
    if (s.finished) {
      cue.textContent = 'خلصت'; cueSub.textContent = 'برافو. جلسة هادية ومظبوطة.'; circle.dataset.st = 'done';
      play.textContent = 'خلصت'; play.disabled = true; count.textContent = ''; tLeft.textContent = ''; return;
    }
    const [c, sub] = CUE[step.type];
    if (!s.started) { cue.textContent = 'جاهز'; cueSub.textContent = `ابدأ ${POS[step.pos]}`; }
    else {
      cue.textContent = step.type === 'move' ? (step.flicksNext ? 'استعد' : c) : step.max ? 'أقصى شدّة' : c;
      cueSub.textContent = step.type === 'move' ? (step.flicksNext ? 'شدّات سريعة ثانية واحدة' : POS[step.pos]) : sub;
    }
    count.textContent = '';
    if (step.of) count.append(step.type === 'flick' || step.type === 'frelax' ? 'سريع ' : 'عدّة ', N(`${step.rep}/${step.of}`), ' · ', POS[step.pos]);
    let gone = 0; for (let i = 0; i < s.idx; i++) gone += steps[i].dur; gone += step.dur - left;
    tLeft.textContent = ''; tLeft.append(N(String(left)), ' ث · ', N(`${fmt(gone)} / ${fmt(total)}`));
    play.textContent = r.running() ? 'وقّف' : s.started ? 'كمّل' : 'ابدأ الجلسة';
    if (lastIdx !== s.idx || force) {
      const changed = lastIdx !== s.idx; lastIdx = s.idx;
      circle.dataset.st = r.running() ? step.type : 'idle';
      circle.style.setProperty('--hk-d', reduced() ? '0s' : `${Math.max(0.3, Math.min(step.dur, 10))}s`);
      if (changed && r.running()) {
        if (step.type === 'hold' || step.type === 'flick') buzz(ctx, step.type === 'flick' ? 30 : 70);
        else if (step.type === 'relax') buzz(ctx, [25, 40, 25]);
        if (step.type === 'hold' || step.type === 'move') tone(ctx);
      }
      if (!poses.dataset.pos || poses.dataset.pos !== step.pos) { poses.dataset.pos = step.pos; poses.textContent = ''; poses.appendChild(positionsArt(st.positions, step.pos)); }
    }
  }
  async function finish() {
    if (saved) return; saved = true;
    buzz(ctx, [90, 60, 90]); tone(ctx); paint();
    const row = { day: ctx.today(), at: new Date().toISOString(), stage: st.stage, secs: total };
    if (await safeWrite(ctx, () => patchHealth(ctx.db, (c) => {
      const k = c.kegel || {};
      return { ...c, kegel: { ...k, onboarded: true, start: k.start || row.day, log: [...(k.log || []), row].slice(-500) } };
    }))) { ctx.toast('اتسجّلت الجلسة.'); setTimeout(() => { if (!closed) rerender(); }, 1200); }
  }
  const timer = setInterval(() => { if (closed) return; const res = r.tick(); if (res.finished) finish(); else paint(); }, 200);
  const onVis = () => { if (document.visibilityState === 'visible' && !closed) { const res = r.tick(); if (res.finished) finish(); else paint(); } };
  document.addEventListener('visibilitychange', onVis);
  paint(true);

  // ── (c) log, no streaks ──
  const target = st.perDay * 7;
  root.appendChild(h('section', { class: 'glass wk-card hk-klog', 'aria-labelledby': 'hk-kl-h' },
    h('h3', { id: 'hk-kl-h' }, 'الأسبوع ده'),
    h('div', { class: 'hk-klog-row' },
      h('div', {}, h('b', {}, N(String(cnt.week)), h('small', {}, ' من ', N(String(target)))), h('span', {}, 'جلسة الأسبوع ده')),
      h('div', {}, h('b', {}, N(String(cnt.today)), h('small', {}, ' من ', N(String(st.perDay)))), h('span', {}, 'النهارده'))),
    h('div', { class: 'bar glow-pink' }, h('i', { style: `--p:${Math.min(100, Math.round((cnt.week / target) * 100))}%` })),
    h('p', { class: 'wk-muted' }, 'لو فوّت يوم عادي، كمّل من بكرة. اربطها بعادة: الصبح بعد ما تغسل سنانك، والتانية في المواصلات أو على المكتب.')));

  // ── tips ──
  root.appendChild(h('section', { class: 'glass wk-card hk-tips', 'aria-labelledby': 'hk-kt-h' }, h('h3', { id: 'hk-kt-h' }, 'اعمله صح'), h('ul', {}, ...KEGEL_TIPS.map((t) => h('li', {}, t)))));
  root.appendChild(cueSwitches(ctx));

  // ── (d) privacy ──
  root.appendChild(h('section', { class: 'wk-card hk-priv', 'aria-labelledby': 'hk-pv-h' },
    h('h3', { id: 'hk-pv-h' }, 'خصوصيتك'),
    h('p', { class: 'wk-muted' }, 'السجل ده على جهازك بس، ومش بيظهر في التقدّم ولا في شاشة النهارده.'),
    h('button', { type: 'button', class: 'btn ghost danger sm', onclick: async () => {
      if (!(await ctx.confirm({ title: 'تمسح بيانات تمرين قاع الحوض؟', text: 'هيتمسح السجل والمستوى من الجهاز ده. مفيش رجوع.', confirmLabel: 'امسح بيانات التمرين', danger: true }))) return;
      if (await safeWrite(ctx, () => patchHealth(ctx.db, (c) => { const n = { ...c }; delete n.kegel; return n; }))) { ctx.toast('اتمسحت.'); rerender(); }
    } }, 'امسح بيانات التمرين ده')));

  return () => { closed = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); document.title = prevTitle; };
}

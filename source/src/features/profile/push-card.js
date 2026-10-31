// Profile › «تنبيه والشاشة مقفولة»: Worker URL + App token, «فعّل» (permission → subscribe → test push in 5 s)
// and «إيقاف ومسح» (cancel + forget on the server, unsubscribe on the phone, wipe the stored values).
// Uses the same .field / .sheet-card / .btn classes as the rest of the Profile screen; no new CSS.
import { h } from '../../ui/dom.js';
import { enablePush, disablePush, pushStatus } from '../../core/push.js';

const WHY = {
  bad_url: 'رابط الـWorker لازم يبدأ بـ https:// — انسخه زي ما طلع من wrangler deploy.',
  bad_token: 'التوكن قصير أو فيه حروف غريبة — انسخه تاني من غير مسافات.',
  no_sw: 'المتصفح ده مش بيدعم التنبيهات.',
  no_push: 'على الآيفون: ضيف البرنامج للشاشة الرئيسية (مشاركة › إضافة إلى الشاشة الرئيسية) وافتحه من الأيقونة، وبعدين جرّب تاني.',
  denied: 'التنبيهات مقفولة للبرنامج. افتح الإعدادات › الإشعارات › البرنامج ده وشغّلها، وبعدين جرّب تاني.',
  offline: 'مفيش نت دلوقتي أو الـWorker مش بيرد. اتأكد من الرابط والنت وجرّب تاني.',
  server: 'الـWorker ردّ بغلط. اتأكد إن المفاتيح اتحطت بـ wrangler secret put وإنك عملت deploy.',
  token: 'التوكن مش مطابق للي على الـWorker. انسخه تاني بالظبط.',
  subscribe: 'الآيفون رفض الاشتراك. اقفل البرنامج خالص وافتحه تاني من الأيقونة وجرّب.',
  off: 'التنبيه مش متفعّل.',
};

export function pushCard(ctx) {
  const urlIn = h('input', { id: 'p-push-url', type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', dir: 'ltr', placeholder: 'https://fit-push.xxxx.workers.dev', 'aria-describedby': 'p-push-url-h' });
  const tokIn = h('input', { id: 'p-push-token', type: 'password', autocomplete: 'off', spellcheck: 'false', dir: 'ltr', 'aria-describedby': 'p-push-token-h' });
  const msg = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const state = h('p', { class: 'lbl' });
  const onBtn = h('button', { type: 'button', class: 'btn sm' }, 'فعّل');
  const offBtn = h('button', { type: 'button', class: 'btn ghost sm', hidden: true }, 'إيقاف ومسح');

  async function refresh() {
    const s = await pushStatus();
    state.textContent = s.on ? 'متفعّل على الموبايل ده ✓' : 'مش متفعّل';
    offBtn.hidden = !s.on;
    if (s.on && s.url && !urlIn.value) urlIn.value = s.url;
  }

  onBtn.addEventListener('click', async () => {
    // permission must be asked inside this tap (iOS)
    onBtn.disabled = true; msg.textContent = 'بنفعّل…';
    try {
      const r = await enablePush({ url: urlIn.value, token: tokIn.value });
      if (r.ok) { msg.textContent = 'تمام. اقفل الشاشة دلوقتي — هيجيلك «تنبيه تجربة» بعد ٥ ثواني.'; tokIn.value = ''; }
      else msg.textContent = WHY[r.reason] || 'حصلت مشكلة. جرّب تاني.';
    } catch { msg.textContent = 'حصلت مشكلة. جرّب تاني.'; }
    onBtn.disabled = false;
    refresh();
  });

  offBtn.addEventListener('click', async () => {
    const ok = await ctx.confirm({ title: 'نوقف التنبيه ونمسح الاشتراك؟', text: 'هنمسح الاشتراك من الـWorker ومن الموبايل، ومش هيجيلك تنبيه والشاشة مقفولة لحد ما تفعّله تاني.', confirmLabel: 'إيقاف ومسح', danger: true });
    if (!ok) return;
    offBtn.disabled = true;
    const r = await disablePush();
    msg.textContent = r.server === 'failed' ? 'اتمسح من الموبايل. الـWorker ماردّش، بس الاشتراك اتلغى من الآيفون فمش هيوصل حاجة.' : 'اتوقف واتمسح كل حاجة.';
    urlIn.value = ''; tokIn.value = '';
    offBtn.disabled = false;
    refresh();
  });

  refresh();
  return h('div', { class: 'sheet-card pform' },
    h('p', { class: 'hint' }, 'بيصحّي الآيفون لما الراحة أو الجولة تخلص حتى والشاشة مقفولة. اللي بيطلع من الموبايل: الاشتراك ووقت النهاية بس — مفيش أسماء تمارين ولا أوزان.'),
    state,
    h('div', { class: 'field' }, h('label', { for: 'p-push-url' }, 'رابط الـWorker'), urlIn, h('p', { class: 'hint', id: 'p-push-url-h' }, 'اللي طلع لك بعد npx.cmd wrangler deploy')),
    h('div', { class: 'field' }, h('label', { for: 'p-push-token' }, 'App token'), tokIn, h('p', { class: 'hint', id: 'p-push-token-h' }, 'نفس التوكن اللي حطيته بـ wrangler secret put APP_TOKEN. محفوظ على الموبايل ده بس ومش بيدخل في النسخة الاحتياطية.')),
    h('div', { class: 'btn-row wrap' }, onBtn, offBtn),
    msg);
}

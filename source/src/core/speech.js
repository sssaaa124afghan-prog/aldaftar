// Shared browser speech recognition (Web Speech API) for the coach chat, food search and set logging.
// Why this exists (bug: «ماقدرناش نسمعك» most of the time):
//  - every error (no-speech, aborted, not-allowed, network…) used to show the same line in the chat;
//  - continuous:false + no interim results → Chrome/iOS stop at the first short pause, often before any result;
//  - iOS Safari ends a session early with no result and no error; a home-screen PWA (standalone) on iOS has no
//    working webkitSpeechRecognition at all → the keyboard dictation mic is the only reliable path there.
// Rules: one new recognizer per attempt, start() is called synchronously inside the tap handler (never after an await,
// or iOS refuses it), ar-EG first then ar-SA, interim text is exposed, auto-stop ~1.5 s after the last speech.

export const LANGS = Object.freeze(['ar-EG', 'ar-SA']);
export const PAGES_URL = 'https://sssaaa124afghan-prog.github.io/aldaftar/';

/** Environment probe (pure on the given window-like object). */
export function speechEnv(w = typeof window !== 'undefined' ? window : undefined) {
  const SR = w && (w.SpeechRecognition || w.webkitSpeechRecognition) || null;
  const nav = (w && w.navigator) || {};
  const ua = String(nav.userAgent || '');
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1);
  let standalone = nav.standalone === true;
  try { standalone = standalone || !!(w && w.matchMedia && w.matchMedia('(display-mode: standalone)').matches); } catch { /* ignore */ }
  const proto = String((w && w.location && w.location.protocol) || '');
  const fileCtx = proto === 'file:' || proto === 'content:';
  let reason = null;
  if (!SR) reason = 'unsupported';
  else if (ios && standalone) reason = 'ios-standalone'; // webkitSpeechRecognition is missing or broken in iOS home-screen apps
  return { SR, ios, standalone, fileCtx, secure: !!(w && w.isSecureContext), supported: !!SR && !reason, reason };
}

/** Arabic message per Web Speech error code, each with what to do next. */
export function speechMessage(code, env = speechEnv()) {
  const ios = env && env.ios;
  switch (code) {
    case 'not-allowed':
      if (env && env.fileCtx) return `الميكروفون مقفول للملف المحلي. افتح التطبيق من الرابط ${PAGES_URL} واسمح بالميكروفون.`;
      return ios ? 'الميكروفون مقفول. افتح الإعدادات › Safari › الميكروفون واختار «اسمح»، وبعدين جرّب تاني.'
        : 'الميكروفون مقفول. دوس على علامة القفل جنب العنوان › الأذونات › الميكروفون › اسمح، وجرّب تاني.';
    case 'service-not-allowed':
    case 'audio-capture':
      if (ios) return 'الآيفون مانع الصوت: فعّل «Siri والإملاء» من الإعدادات، واسمح بالميكروفون من الإعدادات › Safari › الميكروفون.';
      return code === 'audio-capture' ? 'مش لاقيين ميكروفون شغال. اقفل أي تطبيق تاني ماسكه وجرّب تاني.' : 'المتصفح مانع التعرّف على الصوت. اسمح بالميكروفون من إعدادات المتصفح، أو اكتب.';
    case 'no-speech': return 'ماسمعتش حاجة، قرّب الموبايل وجرّب تاني';
    case 'network': return 'التعرّف على الصوت محتاج إنترنت. اتأكد من النت وجرّب تاني، أو اكتب.';
    case 'language-not-supported': return 'العربي مش متاح في التعرّف على الصوت هنا. استخدم مايك الكيبورد 🎤 في خانة الكتابة.';
    case 'ios-standalone': return 'الصوت مش بيشتغل من أيقونة الشاشة الرئيسية في الآيفون. دوس في خانة الكتابة واستخدم مايك الكيبورد 🎤، أو افتح الرابط من Safari.';
    case 'unsupported': return 'المتصفح ده مش بيدعم الصوت. دوس في خانة الكتابة واستخدم مايك الكيبورد 🎤.';
    case 'start-failed': return 'ماقدرناش نشغّل الميكروفون. جرّب تاني، أو استخدم مايك الكيبورد 🎤.';
    default: return 'ماقدرناش نسمع دلوقتي. جرّب تاني أو اكتب.';
  }
}

/** One-time hint when the app runs from a local file (mic permission is not kept there). Returns the text or null. */
export function fileContextHint(env = speechEnv(), store = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!env || !env.fileCtx) return null;
  try { if (store && store.getItem('voiceFileHint')) return null; store && store.setItem('voiceFileHint', '1'); } catch { /* storage blocked: show it */ }
  return `إنت فاتح التطبيق من ملف على الجهاز، والميكروفون ممكن يتقفل كل مرة. للصوت افتح ${PAGES_URL}`;
}

/**
 * listen({onInterim(text), onResult(alts), onError(code, msg), onState(state), onEnd}, opts) → stop()
 * state: 'listening' → 'speech' (heard something) → 'idle'. stop() ends the session and delivers what was heard.
 * opts: {silenceMs=1500, maxMs=15000, env, langs}
 * Must be called synchronously from the tap handler.
 */
export function listen(cb = {}, { silenceMs = 1500, maxMs = 15000, env = speechEnv(), langs = LANGS } = {}) {
  const { onInterim, onResult, onError, onState, onEnd } = cb;
  const fail = (code) => { onError?.(code, speechMessage(code, env)); onState?.('idle'); onEnd?.(); return () => {}; };
  if (!env.SR) return fail('unsupported');
  if (env.reason) return fail(env.reason);
  let rec = null, li = 0, restarts = 0, finished = false, userStop = false, errored = null, langRetry = false;
  let finals = []; let interim = ''; let silenceT = 0; let maxT = 0; let heard = false;
  const t0 = Date.now();
  const clearT = () => { clearTimeout(silenceT); clearTimeout(maxT); };
  const deliver = () => {
    const segs = finals.filter((s) => s.length);
    let alts = [];
    if (segs.length === 1) alts = segs[0];
    else if (segs.length > 1) alts = [segs.map((s) => s[0]).join(' ').trim()];
    if (!alts.length && interim.trim()) alts = [interim.trim()];
    return alts.filter(Boolean);
  };
  const finish = () => {
    if (finished) return; finished = true; clearT();
    const alts = deliver();
    if (alts.length) onResult?.(alts);
    else if (errored) onError?.(errored, speechMessage(errored, env));
    else if (!userStop) onError?.('no-speech', speechMessage('no-speech', env));
    onState?.('idle'); onEnd?.();
  };
  const run = () => {
    let r;
    try { r = new env.SR(); } catch { errored = 'start-failed'; finish(); return; }
    rec = r;
    r.lang = langs[li]; r.interimResults = true; r.maxAlternatives = 5;
    r.continuous = !env.ios; // iOS Safari duplicates/garbles results in continuous mode
    r.onstart = () => onState?.('listening');
    r.onspeechstart = () => { heard = true; onState?.('speech'); };
    r.onresult = (e) => {
      const list = e && e.results ? e.results : [];
      const from = Number.isInteger(e.resultIndex) ? e.resultIndex : 0;
      let live = '';
      for (let i = from; i < list.length; i++) {
        const res = list[i]; if (!res) continue;
        const alts = [...res].map((a) => a && a.transcript && String(a.transcript).trim()).filter(Boolean);
        if (!alts.length) continue;
        if (res.isFinal === false) live += `${alts[0]} `; else finals[i] = alts;
      }
      finals = Array.from(finals, (x) => x || []);
      interim = live.trim();
      heard = true; onState?.('speech');
      const shown = [...finals.filter((x) => x.length).map((x) => x[0]), interim].join(' ').trim();
      if (shown) onInterim?.(shown);
      clearTimeout(silenceT);
      silenceT = setTimeout(() => { try { r.stop(); } catch { finish(); } }, silenceMs);
    };
    r.onerror = (e) => {
      const code = e && e.error;
      if (code === 'aborted') return;
      if ((code === 'language-not-supported' || code === 'bad-grammar') && li < langs.length - 1) { langRetry = true; return; }
      errored = code || 'unknown';
    };
    r.onend = () => {
      if (rec !== r || finished) return;
      if (langRetry && !userStop) { langRetry = false; li++; run(); return; }
      // iOS ends early with neither a result nor an error: restart once, inside the time window
      if (!userStop && !errored && !deliver().length && restarts < 1 && Date.now() - t0 < maxMs - 1000) { restarts++; run(); return; }
      finish();
    };
    try { r.start(); } catch { errored = 'start-failed'; finish(); }
  };
  run();
  maxT = setTimeout(() => { try { rec && rec.stop(); } catch { finish(); } }, maxMs);
  return () => {
    if (finished) return;
    userStop = true;
    try { rec && rec.stop(); } catch { finish(); return; }
    // some engines never fire onend after stop(): close ourselves shortly after
    setTimeout(finish, 1200);
  };
}

// Backup export / import UI over core/backup.js. The API key is never in a backup (core strips it).
import { h } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { loadData, saveData } from '../../core/db.js';
import { serializeBackup, backupFileName, importBackupToDB, markBackedUp } from '../../core/backup.js';

export async function exportNow(ctx) {
  try {
    const { data } = await loadData(ctx.db);
    const now = new Date();
    const blob = new Blob([serializeBackup(data, { now })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: backupFileName(now) });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await saveData(ctx.db, markBackedUp(data, now)).catch(() => null);
    ctx.toast('اتعملت نسخة احتياطية. احتفظ بالملف في مكان أمين.');
  } catch (e) {
    console.warn('[backup] export failed', e && e.code);
    ctx.toast('ماقدرناش نعمل النسخة دلوقتي — بياناتك سليمة، جرّب تاني.');
  }
}

/** Opens a file picker, then asks merge vs replace (merge is the default). */
export function pickAndImport(ctx, { after } = {}) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', class: 'vh', 'aria-hidden': 'true', tabindex: '-1' });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch { ctx.toast('الملف ماتقراش. جرّب ملف تاني.'); return; }
    const replace = await ctx.confirm({ title: 'تستورد إزاي؟', text: 'الدمج بيضيف اللي في الملف على بياناتك الحالية من غير ما يمسح حاجة. الاستبدال بيحط الملف مكان بياناتك (بنحتفظ بنسخة قبلها).', confirmLabel: 'استبدل بياناتي بالملف', cancelLabel: 'ادمج مع بياناتي', danger: true, dismissValue: null });
    if (replace === null) return; // dismissed (Esc / scrim / ×) → nothing imported
    const res = await importBackupToDB(ctx.db, text, { mode: replace ? 'replace' : 'merge' }).catch((e) => ({ ok: false, message: 'ماقدرناش نحفظ — بياناتك الحالية زي ما هي.', e }));
    if (!res.ok) { ctx.toast(res.message || 'الملف ده ماينفعش. بياناتك الحالية زي ما هي.'); return; }
    ['food:changed', 'session:changed', 'weight:changed', 'settings:changed'].forEach((ev) => ctx.emit(ev, { import: true }));
    const st = res.stats || {};
    const n = Object.values(st).reduce((a, v) => a + (typeof v === 'number' ? v : (v && typeof v.added === 'number' ? v.added : 0)), 0);
    ctx.toast(n ? `اتستورد الملف · ${fmt(n)} سجل` : 'اتستورد الملف');
    await after?.(res);
  });
  input.click();
}

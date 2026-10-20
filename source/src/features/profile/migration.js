// First-run migration gate + confirmation screen (#/profile/migrate).
// Preview uses the pure migrateLegacy(); the write uses runMigrationOnce() (old keys are never deleted).
import { h, raw } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt } from '../../ui/num.js';
import { LEGACY_KEYS, migrateLegacy, runMigrationOnce } from '../../core/migrate.js';
import { readStorageKey } from '../../core/db.js';
import { pickAndImport } from './backup-ui.js';

const DEFER = 'migration.deferred';
const store = () => { try { return window.localStorage; } catch { return null; } };

function legacyInput() {
  const s = store();
  const r = (k) => readStorageKey(s, k).raw;
  return { nutri: r(LEGACY_KEYS.nutri), gym: r(LEGACY_KEYS.gym), gymLastBackup: r(LEGACY_KEYS.gymLastBackup), gymCollapsed: r(LEGACY_KEYS.gymCollapsed) };
}

/** 'done' | 'pending' | 'deferred'. Runs the (no-op) migration silently when no legacy data exists. */
export async function readMigrationGate(db) {
  let meta;
  try { meta = await db.get('meta', 'meta'); } catch { return 'done'; }
  if (meta && meta.migratedAt) return 'done';
  const inp = legacyInput();
  if (!inp.nutri && !inp.gym) { await runMigrationOnce(store(), db).catch(() => null); return 'done'; }
  try { if (sessionStorage.getItem(DEFER)) return 'deferred'; } catch { /* ignore */ }
  return 'pending';
}

const LABELS = [
  ['sessions', 'جلسة تمرين'], ['sets', 'مجموعة'], ['foodDays', 'يوم أكل'], ['meals', 'وجبة'],
  ['customFoods', 'أكلة خاصة بيك'], ['savedMeals', 'وجبة محفوظة'], ['weights', 'تسجيل وزن'], ['measurements', 'قياس'],
  ['waterDays', 'يوم مية'], ['chatMessages', 'رسالة مع المدرب'],
];

function countsList(counts) {
  const ul = h('div', { class: 'sheet-card', style: 'margin:0' });
  const rows = LABELS.filter(([k]) => counts[k] > 0);
  if (!rows.length) ul.appendChild(h('p', { class: 'status' }, 'مفيش بيانات تتنقل.'));
  for (const [k, l] of rows) ul.appendChild(h('div', { class: 'cols entry', style: 'grid-template-columns:1fr auto' }, h('span', {}, l), h('span', { class: 'num' }, fmt(counts[k]))));
  return ul;
}

export function renderMigrate(el, ctx) {
  const { report } = migrateLegacy(legacyInput(), { now: new Date() });
  const src = [report.sources.gym.present && 'Solo Gym', report.sources.nutri.present && 'NutriPro'].filter(Boolean).join(' و ');
  const box = h('div', { class: 'sec' });
  const msg = h('p', { class: 'status', 'aria-live': 'polite' });
  const goBtn = h('button', { type: 'button', class: 'btn' }, raw(icon('download')), 'انقل بياناتي');
  const later = h('button', { type: 'button', class: 'btn ghost' }, 'مش دلوقتي');
  const fileBtn = h('button', { type: 'button', class: 'btn ghost' }, raw(icon('upload')), 'استورد من ملف نسخة احتياطية');
  el.append(
    h('header', { class: 'band' }, h('div', { class: 'grow' }, h('h1', {}, 'نقل بياناتك القديمة'), h('p', {}, src ? `لقينا بيانات من ${src} على الجهاز ده` : 'مفيش بيانات قديمة على الجهاز ده'))),
    h('div', { class: 'next' },
      h('h2', {}, 'كل اللي سجّلته هيتنقل هنا'),
      h('p', {}, 'النسخة القديمة هتفضل زي ما هي. مفيش حاجة هتتمسح.')),
    h('div', { style: 'padding:0 var(--gutter)' }, countsList(report.counts)),
    box,
  );
  if (report.sources.nutri.error || report.sources.gym.error) box.appendChild(h('p', { class: 'status over' }, h('i'), 'جزء من البيانات القديمة مش مقروء. هننقل الباقي ونحتفظ بنسخة منه.'));
  box.append(h('div', { style: 'display:flex;flex-direction:column;gap:var(--s3)' }, goBtn, fileBtn, later), msg);

  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true; msg.textContent = 'بننقل…';
    const r = await runMigrationOnce(store(), ctx.db);
    if (r.status === 'error') { goBtn.disabled = false; msg.textContent = 'ماقدرناش ننقل دلوقتي — بياناتك القديمة زي ما هي. جرّب تاني.'; return; }
    ctx.emit('food:changed', {}); ctx.emit('session:changed', {}); ctx.emit('weight:changed', {});
    const c = (r.report && r.report.counts) || {};
    ctx.toast(`اتنقل ${fmt(c.sessions || 0)} جلسة و ${fmt(c.meals || 0)} وجبة`);
    ctx.go('today');
  });
  later.addEventListener('click', () => { try { sessionStorage.setItem(DEFER, '1'); } catch { /* ignore */ } ctx.go('today'); });
  fileBtn.addEventListener('click', () => pickAndImport(ctx, { after: async () => { await runMigrationOnce(null, ctx.db).catch(() => null); ctx.go('today'); } }));
}

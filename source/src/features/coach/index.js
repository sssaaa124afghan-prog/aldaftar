// #/coach — the «المدرب» tab: the unified AI coach (training + nutrition). Also opened as a sheet via api.openCoachSheet().
import './coach.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { loadChat } from '../nutrition/data.js';
import { mountChat } from './chat.js';

async function coachScreen(el, ctx, params = {}) {
  const box = h('div', { class: 'co-page' });
  const clear = h('button', { type: 'button', class: 'co-ib', 'aria-label': 'امسح المحادثة', onclick: async () => {
    const all = await loadChat(ctx.db);
    if (!all.length) return;
    const ok = await ctx.confirm({ title: 'تمسح المحادثة؟', text: 'كل رسايل المدرب هتتمسح من الجهاز. أكلك وتمرينك مش هيتأثروا.', confirmLabel: 'امسح المحادثة', danger: true });
    if (!ok) return;
    try { await ctx.db.batch(all.map((m) => ({ store: 'chat', type: 'delete', key: m.id }))); } catch { /* ignore */ }
    mountChat(box, ctx, { intent: params.intent || 'chat' });
  } }, raw(icon('trash')));
  fill(el, h('header', { class: 'co-head' }, h('div', { class: 'grow' }, h('h1', {}, 'المدرب'), h('p', {}, 'تمرين وأكل في مكان واحد · الأكل بيتسجّل ومعاه «تراجع»')), clear), box);
  await mountChat(box, ctx, { intent: params.intent || 'chat' });
}

export const routes = { coach: coachScreen };

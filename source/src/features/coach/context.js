// Rich coach context (AI2): training + nutrition summary, block-selected by intent.
// Privacy whitelist: body metrics only (age, sex, height, weight, measurements). Never name, job, location, email…
import { addDays, diffDays, weekStart, isDayKey } from '../../core/date.js';
import { sumEntries, targetsForDay, heartDaysOf, heartDowOf, cardioOf, withDayTypes } from '../../core/targets.js';
import { boxingContextLines } from '../workout/boxing-plan.js';
import { DEFAULT_TARGETS } from '../../core/schema.js';
import * as WK from '../workout/logic.js';
import * as NU from '../nutrition/logic.js';
import * as M from '../progress/metrics.js';
import { cleanWeights, movingAvg7, weeklyTrend, weekAdherence } from '../progress/logic.js';
import { ALL_BLOCKS } from './prompts.js';
import { MUSCLE_LM } from '../workout/exercises.js';
import { weeklyPlanned } from '../workout/coach-bridge.js';

const r1 = (x) => Math.round(x * 10) / 10;
const s = (v, max = 60) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\[\[|\]\]/g, '').slice(0, max);
const PII = /^(name|fullName|firstName|lastName|job|jobTitle|employer|company|workplace|location|city|country|address|nationality|email|phone|birthDate|dob)$/i;
const SECRET = /key|token|secret|password/i;

/** Attached object → compact text: depth ≤ 3, ≤ 40 entries per level, PII/secret keys dropped, strings capped. */
export function sanitizeAttach(v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return s(v, 160).replace(/(sk-ant-[A-Za-z0-9_-]{8,})/g, '[redacted]');
  if (depth >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => sanitizeAttach(x, depth + 1)).filter((x) => x !== null);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 40)) {
      if (PII.test(k) && depth === 0) continue;
      if (SECRET.test(k) || k === 'profile') continue;
      const c = sanitizeAttach(x, depth + 1);
      if (c !== null && !(Array.isArray(c) && !c.length)) out[k] = c;
    }
    return out;
  }
  return null;
}

const setsTxt = (e) => WK.doneSets(e).slice(0, 5).map((t) => `${t.w}x${t.r}${t.rir !== null && t.rir !== undefined ? `@${t.rir}` : ''}`).join(' ');

/**
 * buildContext(data, {blocks, extra}) → text for the system prompt.
 * data: {today, profile:{age,sex,heightCm}, weights, sessions, foodLog:{day:entries}, targets, trainingDays, overrides,
 *        daily:{day:{wellness,waterMl}}, training:{injuries,goals}, progress:{goals}, nutrition:{dietMode,...}, measurements, startDow}
 */
export function buildContext(data, { blocks = ALL_BLOCKS, extra = null } = {}) {
  const want = new Set(blocks);
  const L = [];
  const today = data.today;
  const startDow = data.startDow ?? 1;
  const sessions = data.sessions || [];
  const ws = cleanWeights(data.weights || []);
  const avg = movingAvg7(ws); const trend = weeklyTrend(ws);
  const lastW = ws[ws.length - 1];
  const targets = withDayTypes(data.targets && data.targets.training ? data.targets : DEFAULT_TARGETS);
  const heartDow = Number.isInteger(data.heartDow) ? data.heartDow : null;
  const doneDays = new Set(M.lifting(sessions).map((x) => x.day));
  const heartDays = heartDaysOf(sessions);
  const tOf = (d) => targetsForDay(d, { targets, trainingDays: data.trainingDays, overrides: data.overrides || {}, sessionDays: doneDays, heartDays, heartDow });
  const foodLog = data.foodLog || {};
  const daily = data.daily || {};
  const p = data.profile || {};

  if (want.has('body')) {
    const parts = [p.age > 0 && `age ${p.age}`, (p.sex === 'male' || p.sex === 'female') && p.sex, p.heightCm > 0 && `${p.heightCm} cm`,
      lastW && `weight ${lastW.kg} kg (${lastW.day})`, avg.length && `7-day avg ${avg[avg.length - 1].avg7} kg`,
      trend && `trend ${trend.kgPerWeek > 0 ? '+' : ''}${trend.kgPerWeek} kg/week`].filter(Boolean);
    const m = [...(data.measurements || [])].sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
    if (m) {
      const bf = M.navyBF({ sex: p.sex || 'male', waist: +m.waist, neck: +m.neck, hip: +m.hip, heightCm: +p.heightCm });
      const mm = ['waist', 'chest', 'arm', 'thigh', 'neck', 'hip'].filter((k) => +m[k] > 0).map((k) => `${k} ${m[k]}`).join(', ');
      parts.push(`measurements ${s(m.day, 10)}: ${mm}${bf ? `, Navy BF ≈${bf}%` : ''}`);
    }
    if (parts.length) L.push(`Body: ${parts.join('; ')}`);
  }

  if (want.has('today') && today) {
    const t = tOf(today); const es = foodLog[today] || []; const sum = sumEntries(es);
    L.push(`Today ${today} (${t.type === 'training' ? 'training day' : t.type === 'heart' ? (data.cardio === 'boxing' ? 'boxing day: 30–40 min heavy bag + technique, no lifting' : 'heart day: 30 min cardio, no lifting') : 'rest day'}): target ${t.kcal} kcal P${t.p} C${t.c} F${t.f}; eaten ${Math.round(sum.kcal)} kcal P${r1(sum.p)} C${r1(sum.c)} F${r1(sum.f)}; left ${Math.round(t.kcal - sum.kcal)} kcal, ${r1(Math.max(0, t.p - sum.p))} g protein`);
    if (es.length) L.push(`Today entries: ${es.slice(0, 20).map((e) => `[${s(e.id, 40)}] ${NU.SECTION_LABEL[NU.sectionOf(e)] || ''} ${s(e.name, 40)} ${e.qty || ''}${e.unit ? s(e.unit, 8) : ''} ${Math.round(e.kcal || 0)}kcal P${r1(+e.p || 0)}`).join(' | ')}`);
    const d = daily[today] || {};
    if (d.waterMl > 0) L.push(`Water today: ${d.waterMl} ml`);
  }

  if (want.has('readiness') && today) {
    const w = (daily[today] || {}).wellness;
    if (w) {
      const sc = w.score ?? M.readinessScore(w);
      L.push(`Readiness today: ${sc}/100 (sleep ${w.sleepH ?? '?'} h, energy ${w.energy ?? '?'}/5, stress ${w.stress ?? '?'}/5, soreness ${w.soreness ?? '?'}/5) — ${M.readinessBand(sc).label}`);
    } else L.push('Readiness today: not logged');
    const sl = Array.from({ length: 7 }, (_, i) => (daily[addDays(today, -i)] || {}).wellness).filter((x) => x && x.sleepH > 0).map((x) => +x.sleepH);
    if (sl.length >= 3) L.push(`Sleep 7-day avg: ${r1(sl.reduce((a, b) => a + b, 0) / sl.length)} h`);
  }

  if (want.has('training') && today) {
    const from = addDays(today, -27);
    const ls = M.lifting(sessions).filter((x) => x.day >= from);
    const load = M.trainingLoad(sessions, today);
    let wp = null; try { wp = WK.weeksOnPlan(sessions, { plannedPerWeek: (data.trainingDays || [1, 2, 4, 5]).length, weekStartDow: startDow, today }); } catch { /* ignore */ }
    L.push(`Training last 4 weeks: ${ls.length} sessions, volume ${ls.reduce((a, x) => a + M.volumeOf(x), 0)} kg; plan ${(data.trainingDays || []).length || 4} days/week${wp ? `; weeks on plan ${wp.weeks}, this week ${wp.thisWeek}` : ''}`);
    if (load) L.push(`Training load (7d vs 28d avg): ratio ${load.ratio} (${load.level})`);
    const gap = ls.length ? diffDays(ls[ls.length - 1].day, today) : null;
    if (gap !== null) L.push(`Days since last session: ${gap}`);
    for (const x of ls.slice(-6).reverse()) {
      L.push(`- ${x.day} ${s(x.dayName, 30)}${x.durationMin ? ` ${x.durationMin}min` : ''}${x.mood ? ` mood ${x.mood}/5` : ''}: ${x.exercises.slice(0, 8).map((e) => `${s(WK.displayName(e) || e.name, 34)} ${setsTxt(e)}`).join('; ')}`);
    }
    const dl = (() => { try { return WK.deloadCheck(sessions, { today, deload: (data.training || {}).deload }); } catch { return null; } })();
    if (dl && dl.suggest) L.push(`Deload suggested: ${dl.reason}`);
  }

  if (want.has('strength') && today) {
    const lifts = M.liftsIn(sessions).slice(0, 8);
    const bw = lastW ? lastW.kg : null;
    const rows = [];
    for (const l of lifts) {
      const ser = M.e1rmSeries(sessions, l.item);
      if (!ser.length) continue;
      const cur = Math.max(...ser.slice(-3).map((x) => x.e1rm));
      const rate = M.progressRate(sessions, l.item, { today, weeks: 8 });
      const recent = ser.filter((x) => x.day >= addDays(today, -42));
      const plateau = recent.length >= 4 && rate !== null && Math.abs(rate) < 0.25;
      const lvl = l.lift && bw ? M.strengthLevel(cur, bw, l.lift, p.sex) : null;
      rows.push(`${s(l.name, 34)}: e1RM ${cur} kg, ${rate === null ? 'rate n/a' : `${rate > 0 ? '+' : ''}${rate} kg/week`}${plateau ? ', PLATEAU' : ''}${lvl ? `, level ${lvl.label} (${lvl.ratio}x BW)` : ''}`);
    }
    if (rows.length) L.push(`Strength (top lifts):\n${rows.map((x) => `- ${x}`).join('\n')}`);
    const prs = M.prTimeline(sessions).filter((x) => x.day >= addDays(today, -27)).slice(0, 8);
    L.push(prs.length ? `PRs last 4 weeks: ${prs.map((x) => `${x.day} ${s(x.name, 30)} ${x.w}x${x.r} (e1RM ${x.e1rm}, +${x.delta})`).join('; ')}` : 'PRs last 4 weeks: none');
  }

  if (want.has('volume') && today) {
    const wkStart = weekStart(today, startDow);
    const cur = WK.hardSetsByMuscle(sessions, wkStart, today);
    const prev = WK.hardSetsByMuscle(sessions, addDays(wkStart, -7), addDays(wkStart, -1));
    L.push(`Hard sets per muscle this week (last week) [MEV-MAV]: ${Object.keys(cur).map((m) => `${m} ${cur[m]} (${prev[m] || 0}) [${WK.VOL_LM[m] ? `${WK.VOL_LM[m].mev}-${WK.VOL_LM[m].mav}` : '-'}]`).join(', ')}`);
    const lag = M.laggingMuscle(sessions, today);
    if (lag) L.push(`Lagging muscle (28d): ${lag.muscle} ${lag.sets} hard sets vs ${lag.top} ${lag.topSets}`);
  }

  if (want.has('program') && data.program && Array.isArray(data.program.order)) L.push(...programLines(data, sessions, today));
  if (want.has('boxing') && today && data.program && data.cardio === 'boxing') {
    try {
      const f = WK.programFlags(data.program);
      L.push(...boxingContextLines({ startDay: data.program.startDay, today, deload: (data.training || {}).deload, bp: data.bp || [], sessions, dow: f.heartDow, startDow }));
    } catch { /* optional block */ }
  }

  if (want.has('injuries')) {
    const inj = Array.isArray((data.training || {}).injuries) ? data.training.injuries : [];
    const act = inj.filter((x) => x && !x.healed && !x.healedAt).slice(0, 6);
    L.push(act.length ? `Active injuries: ${act.map((x) => `${s(x.muscle || x.area || x.part, 20)} severity ${x.severity ?? x.level ?? '?'}/3${x.note ? ` (${s(x.note, 60)})` : ''}`).join('; ')}` : 'Active injuries: none logged');
  }

  if (want.has('goals') && today) {
    const goals = [...(((data.progress || {}).goals) || [])].slice(0, 6);
    if (goals.length) {
      L.push(`Strength goals: ${goals.map((g) => {
        const ser = M.e1rmSeries(sessions, g.item || { lib: g.lib, name: g.name });
        const cur = ser.length ? Math.max(...ser.slice(-3).map((x) => x.e1rm)) : null;
        const rate = M.progressRate(sessions, g.item || { lib: g.lib, name: g.name }, { today, weeks: 8 });
        const pd = cur ? M.predictDate(cur, rate, +g.target, today) : null;
        return `${s(g.name, 30)} target ${g.target} kg${g.by ? ` by ${s(g.by, 10)}` : ''}, now ${cur ?? '?'}${pd ? `, estimated ${pd.day}` : ''}`;
      }).join('; ')}`);
    }
  }

  if (want.has('nutrition') && today) {
    const adh = weekAdherence({ anchorDay: today, weekStartDow: startDow, trainingDays: data.trainingDays, sessions, foodLog, targets, overrides: data.overrides || {}, heartDow });
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter((d) => (foodLog[d] || []).length);
    const tot = last7.reduce((a, d) => { const x = sumEntries(foodLog[d]); return { k: a.k + x.kcal, p: a.p + x.p }; }, { k: 0, p: 0 });
    let hit = 0; for (const d of last7) if (sumEntries(foodLog[d]).p >= NU.targetRange(tOf(d)).pMin) hit++;
    const n = data.nutrition || {};
    const mode = n.dietMode || n.mode || n.goalMode;
    L.push(`Targets: training ${targets.training.kcal} kcal P${targets.training.p} C${targets.training.c} F${targets.training.f}; rest ${targets.rest.kcal} kcal P${targets.rest.p} C${targets.rest.c} F${targets.rest.f}; heart day ${targets.heart.kcal} kcal P${targets.heart.p} C${targets.heart.c} F${targets.heart.f}${mode ? `; diet mode ${s(mode, 20)}` : ''}`);
    L.push(last7.length ? `Nutrition last 7 days: ${last7.length} days logged, avg ${Math.round(tot.k / last7.length)} kcal, avg protein ${Math.round(tot.p / last7.length)} g, protein target hit ${hit}/${last7.length}; this week kcal in range ${adh.kcalDaysInRange}/${adh.daysLogged}` : 'Nutrition last 7 days: nothing logged');
  }

  if (want.has('weight') && avg.length) {
    L.push(`Weight 7-day avg series: ${avg.slice(-6).map((x) => `${x.day} ${x.avg7}`).join(', ')}`);
    const drop = M.bwDrop(ws); if (drop) L.push(`Warning: body weight dropped ${drop.drop} kg vs the previous 4 weigh-ins`);
  }

  if (want.has('patterns') && today) {
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
    const pt = M.eatingPatterns(foodLog, days, tOf);
    if (pt.days) L.push(`Eating patterns 30d (${pt.days} logged days): late-night eating ${pt.lateDays} days, no breakfast ${pt.skippedBreakfast} days, over target ${pt.overDays} days, eating window ~${pt.window ?? '?'} h, top foods ${pt.topFoods.map((f) => s(f.name, 24)).join(', ')}`);
    const ls = M.lifting(sessions).filter((x) => x.day >= addDays(today, -55));
    if (ls.length) {
      const dow = Array(7).fill(0); const hrs = [];
      for (const x of ls) { dow[new Date(`${x.day}T12:00:00`).getDay()]++; const t = Date.parse(x.startedAt || ''); if (Number.isFinite(t)) hrs.push(new Date(t).getHours()); }
      L.push(`Training patterns 8w: sessions by weekday Sun..Sat ${dow.join('/')}${hrs.length ? `, usual start hour ~${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}:00` : ''}`);
    }
  }

  if (want.has('attached') && extra && typeof extra === 'object') {
    const a = sanitizeAttach(extra);
    if (a && Object.keys(a).length) L.push(`Attached (${Object.keys(a).join(', ')}): ${JSON.stringify(a).slice(0, 3500)}`);
  }
  return L.join('\n');
}

/**
 * Compact program block (lives in the cached context): day → items «itemId/libId Arabic sets×reps rRest ssTag», weekly planned
 * sets per muscle vs MEV–MRV, the next session's last sets (for prefill), deload / block week and any pending prefill.
 */
export function programLines(data, sessions, today) {
  const pg = data.program; const out = [];
  const tr = data.training || {};
  out.push(`Program ${s(pg.activeProgram, 20)} (item: id/libId Arabic sets×reps rRestSec ssTag):`);
  for (const id of pg.order) {
    const d = pg.days[id]; if (!d) continue;
    let mins = null; try { mins = WK.estimateMinutes(d.items); } catch { /* ignore */ }
    out.push(`- ${s(id, 20)} «${s(d.name, 24)}»${mins ? ` ~${mins}min lifting` : ''}: ${d.items.slice(0, 12).map((it) => `${s(it.id, 20)}/${s(it.lib || '-', 12)} ${s(it.ar, 28)} ${it.sets}×${s(it.reps, 12)}${it.restS ? ` r${it.restS}` : ''}${it.ss ? ` ss${it.ss}` : ''}`).join('; ')}`);
  }
  const wk = weeklyPlanned(WK.boxingAdjust(pg).program); // Boxing Day: side delts −2 weekly sets
  out.push(`Planned weekly sets per muscle [MEV-MRV]: ${Object.keys(MUSCLE_LM).filter((m) => wk[m] !== undefined).map((m) => `${m} ${wk[m]} [${MUSCLE_LM[m].mev}-${MUSCLE_LM[m].mrv}]`).join(', ')}`);
  if (today) {
    let nid = null; try { nid = WK.nextDayId(pg, sessions, today); } catch { /* ignore */ }
    const nd = nid && pg.days[nid];
    if (nd) {
      const last = nd.items.map((it) => { const e = WK.exposures(sessions, it)[0]; return e ? `${s(it.id, 20)} ${s(e.session.day, 10)} ${setsTxt(e.ex)}` : `${s(it.id, 20)} new`; });
      out.push(`Next session: ${s(nid, 20)} «${s(nd.name, 24)}»; last sets: ${last.join('; ')}`);
    }
    const flags = WK.programFlags(pg);
    const mw = flags.meso ? WK.mesoWeek(pg.startDay, today) : null;
    const dl = tr.deload;
    out.push(`Block: ${mw ? `week ${mw} of 6 (week 6 = automatic deload)` : 'no 6-week block'}; deload ${WK.deloadActive(dl, today) ? `active since ${s(dl.start, 10)}` : dl && dl.active && dl.start > today ? `scheduled ${s(dl.start, 10)}` : 'none'}`);
    const pf = tr.coachPrefill && typeof tr.coachPrefill === 'object' ? Object.keys(tr.coachPrefill) : [];
    if (pf.length) out.push(`Pending next-session weights from you for: ${pf.map((x) => s(x, 20)).join(', ')}`);
  }
  return out;
}

/** Read everything buildContext needs from ctx.db (all reads wrapped). */
export async function loadCoachData(ctx) {
  const db = ctx.db; const today = ctx.today();
  const all = async (st) => { try { return await db.getAll(st); } catch { return []; } };
  const kv = async (k) => { try { const r = await db.get('kv', k); return r && r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; } };
  const [prof, weights, sessions, logs, dailyRows, measurements, targets, training, progress, nutrition, programRec, health] = await Promise.all([
    db.get('profile', 'me').catch(() => null), all('bodyweight'), all('sessions'), all('foodLog'), all('daily'), all('measurements'),
    kv('targets'), kv('training'), kv('progress'), kv('nutrition'), db.get('programs', 'current').catch(() => null), kv('health')]);
  const foodLog = {}; for (const r of logs) if (r && isDayKey(r.day) && Array.isArray(r.entries)) foodLog[r.day] = r.entries;
  const daily = {}; for (const r of dailyRows) if (r && isDayKey(r.day)) daily[r.day] = r;
  const p = prof || {};
  const age = p.age || (p.birthYear ? new Date().getFullYear() - p.birthYear : null);
  return {
    today, startDow: Number(ctx.settings.get('weekStart')) || 1, trainingDays: ctx.settings.get('trainingDays'),
    profile: { age, sex: p.sex || null, heightCm: p.heightCm || null }, // whitelist: no name / identifiers
    weights, sessions, foodLog, daily, measurements, targets: targets.training && targets.rest ? targets : null,
    overrides: nutrition.dayTypeOverrides || {}, heartDow: heartDowOf(programRec), cardio: cardioOf(programRec)?.kind || null, training, progress, nutrition,
    bp: Array.isArray(health.bp) ? health.bp : [], // only used to pick the boxing mode; readings never enter the context text
    program: (() => { try { return WK.normalizeProgram(programRec); } catch { return null; } })(),
  };
}

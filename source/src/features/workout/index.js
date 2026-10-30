// Workout feature: routes for the router (see docs/frontend-contract.md).
import './workout.css';
import { renderOverview, startSession } from './overview.js';
import { renderSession } from './session.js';
import { renderPlan } from './plan.js';
import { renderHistory } from './history.js';
import { renderRecovery } from './recovery.js';
import './health.css';
import { renderHeart } from './heart.js';
import { renderKegel } from './kegel.js';
import { renderBoxing } from './boxing.js';
import { renderLibrary } from './library.js';
import { renderTools } from './tools.js';
import { renderInjuries } from './injuries.js';
import { renderImport } from './import-ui.js';
import { loadTraining } from './store.js';
import { registerCustom } from './exercises.js';

// custom exercises (kv.training.customExercises) join the library before any screen renders
let customLoaded = null;
const ready = (ctx) => (customLoaded ||= loadTraining(ctx.db).then((t) => registerCustom(t.customExercises)).catch(() => {}));
const wrap = (fn) => async (el, ctx, params) => { await ready(ctx); return fn(el, ctx, params || {}); };

export const routes = {
  // #/workout?start=1 (from Today) starts the next planned session (or continues the running one)
  workout: wrap((el, ctx, params) => {
    if (params.start) {
      // drop ?start from history so Back never starts a second session
      try { history.replaceState(null, '', '#/workout'); } catch { /* ignore */ }
      startSession(ctx, { dayId: params.day });
      return;
    }
    return renderOverview(el, ctx, params);
  }),
  'workout/session': wrap(renderSession),
  'workout/plan': wrap(renderPlan),
  'workout/history': wrap(renderHistory),
  'workout/recovery': wrap(renderRecovery),
  'workout/heart': wrap(renderHeart),
  'workout/kegel': wrap(renderKegel),
  'workout/boxing': wrap(renderBoxing), // Thursday Boxing Day (replaces the Heart Day from plan v3)
  'workout/library': wrap(renderLibrary),
  'workout/tools': wrap(renderTools),
  'workout/injuries': wrap(renderInjuries),
  'workout/import': wrap(renderImport), // «استورد أوزانك القديمة» (Profile)
};

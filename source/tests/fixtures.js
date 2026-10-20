// Synthetic legacy fixtures built from the shapes in the two legacy apps (no real user data).
// NutriPro `N` (key nutriProAI_v3) and Solo Gym `G` (key gymProAI_v12_fixed).

export function nutriFixture() {
  return {
    goals: { cal: 2600, pro: 160, carb: 330, fat: 70 },
    goalsInitialized: true,
    profile: { age: 27, weight: 75, height: 173, gender: 'male', activity: 'moderate', activityFactor: 1.5 },
    foods: {
      f1: { name: 'صدور فراخ مشوية', cal: 165, pro: 31, carb: 0, fat: 3.6, unit: 'جرام', per: 100, cat: 'بروتين' },
      df_f2: { name: 'رز أبيض مطبوخ', cal: 130, pro: 2.7, carb: 28, fat: 0.3, unit: 'جرام', per: 100, cat: 'كارب' },
      u_whey: { name: 'واي بروتين', cal: 120, pro: 24, carb: 3, fat: 1.5, unit: 'سكوب', per: 1, cat: 'مكملات' },
      u_oats: { name: 'شوفان بيتي', cal: 380, pro: 13, carb: 66, fat: 7, unit: 'جرام', per: 100, cat: 'كارب' },
      bad: { cal: 10 }, // no name → skipped
    },
    _dbVersion: 999,
    log: {
      '2026-10-17': [
        { name: 'بيض', qty: 4, unit: 'حبة', cal: 280, pro: 24, carb: 2, fat: 20, section: 'فطار', time: '08:10' },
        { name: 'شوفان', qty: 60, unit: 'جرام', cal: 228, pro: 7.8, carb: 39.6, fat: 4.2, section: 'فطار', time: '08:10' },
      ],
      '2026-10-18': [
        { name: 'صدور فراخ مشوية', qty: 200, unit: 'جرام', cal: 330, pro: 62, carb: 0, fat: 7.2, section: 'غدا', time: '14:00' },
        'garbage-entry',
      ],
      'not-a-date': [{ name: 'x', cal: 1 }],
    },
    water: { '2026-10-17': 6, '2026-10-18': 8 },
    weightLog: { '2026-10-10': 75.4, '2026-10-17': 75.0 },
    savedMeals: {
      sm1: { name: 'فطار ثابت', section: 'فطار', items: [{ name: 'بيض', qty: 4, unit: 'حبة', cal: 280, pro: 24, carb: 2, fat: 20 }], savedAt: '2026-10-01' },
    },
    templates: {}, recipes: {}, favorites: { f1: true }, lastQty: { f1: 200 },
    dayTypes: { '2026-10-15': 'training', '2026-10-16': 'bogus' },
    adjustmentHistory: [], lastAdaptiveRun: null,
    notifications: { breakfast: '08:00', lunch: '14:00', dinner: '20:00', water: true },
    waterGoal: 10,
    xp: 1234, achievements: { a1: true }, freezes: 2, frozenDays: [], viewDate: '2026-10-18',
    profiles: { p1: {} }, activeProfile: 'p1',
  };
}

export function gymFixture() {
  return {
    ses: [
      { id: 1760650000000, dk: 'upperA', dn: 'Upper A', ms: 'صدر + ظهر', date: '2026-10-16T21:30:00.000Z', ds: '17/10/2026', duration: 62, mood: 4, note: 'كويس', fatigueScore: 30,
        exs: {
          uaFB: { name: 'Flat Barbell Bench Press', w: 62.5, vol: 1500, avgRPE: 8, sets: [{ w: 60, r: 8, rpe: 7, done: true }, { w: 62.5, r: 6, rpe: 8, done: true }, { w: 62.5, r: 6, rpe: 9, done: true }] },
          ub1: { name: 'Weighted Pull-Up', w: 10, vol: 240, sets: [{ w: 10, r: 8, done: true }, { w: 10, r: 8, done: true }, { w: 10, r: 8, done: true }] },
        } },
      { id: 1760736000000, dk: 'lowerA', dn: 'Lower A', date: '2026-10-17T18:00:00.000Z', duration: 55,
        exs: { la1: { name: 'Back Squat', w: 80, sets: [{ w: 80, r: 5, done: true }, { w: 0, r: 0, done: false }] } } },
    ],
    bw: [
      { w: 74.8, date: '2026-10-17T05:00:00.000Z', ds: '17/10/2026' },
      { w: 74.6, date: '2026-10-17T16:00:00.000Z', ds: '17/10/2026' }, // later same local day → wins
      { w: 74.2, date: '2026-10-18T20:30:00.000Z', ds: '19/10/2026' }, // 00:30 Dubai on the 19th
    ],
    days: { upperA: { name: 'Upper A', exercises: [{ id: 'uaFB', name: 'Flat Barbell Bench Press', sets: 4, reps: '5-8' }] } },
    activeProgram: 'ul',
    schedule: { 0: { type: 'rest' }, 1: { type: 'train' }, 2: { type: 'train' }, 3: { type: 'rest' }, 4: { type: 'train' }, 5: { type: 'train' }, 6: { type: 'rest' } },
    currentSets: { '2026-W42_upperA': { uaFB: [{ w: 60, r: 8 }] } }, doneExs: {}, completedDays: { '2026-W42': { upperA: true } },
    measurements: [{ date: '2026-10-01T10:00:00.000Z', ds: '1/10', waist: 82, chest: 100 }],
    wellness: { '2026-10-17': { sleep: 7, energy: 8, stress: 3, water: 3 } },
    wellnessLog: [{ d: '2026-10-17', score: 80 }],
    recoveryLog: [{ d: '2026-10-15' }], // dropped by legacy loadD
    isDeloadWeek: true, deloadStart: '2026-10-13', _deloadSuggested: '2026-10-12', // dropped by legacy loadD
    shadowArmy: [{ n: 'Igris' }], jcCompleted: true, // dropped by legacy loadD (gamification; raw copy only)
    profile: { name: 'Test User', age: 22, job: 'Accountant at Example Co', location: 'Somewhere' },
    chatHistory: [{ role: 'user', content: 'ازاي أزود البنش؟' }, { role: 'ai', content: 'زوّد 2.5 كجم لما تكمل 8 عدات.' }],
    aiKey: 'gsk_abcdefghijklmnopqrstuvwxyz123456', claudeKey: 'AIzaSyAbcdefghijklmnopqrstuvwxyz12345',
    notifications: true, sysSoundOff: true, pinnedNote: 'ركّز على النوم', uiCompact: true,
    xp: 5000, xpLevel: 12, lastRank: 'C', streak: 9, lastWo: '2026-10-17', theme: 'dark',
    injuries: [], supplements: [{ name: 'Creatine' }], templates: [], goals: {}, smartGoals: [],
    rpeHistory: {}, nextSessionPlan: {}, poJournal: {}, swapHistory: {}, homeMode: false,
  };
}

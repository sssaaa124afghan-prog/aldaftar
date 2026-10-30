// «فيديو الأداء» for the Boxing Day (boxing.js): one short technique video per curriculum item, from boxing coaching channels
// (Tony Jeffries, expertboxing, Precision Striking, fightTIPS, Muay Thai Madness) plus E3 Rehab for the core move.
// Same shape as exercise-videos.js VIDEOS and merged into it, so videoLink('box.jab') works everywhere.
// Each id was checked on BOX_VERIFIED with YouTube oEmbed (exists, public); title + channel are copied from that response,
// durations from the YouTube listing. To re-check: node scripts/check-videos.mjs
export const BOX_VERIFIED = '2026-10-30';
const v = (id, channel, title, dur) => Object.freeze({ id, channel, title, dur, verified: BOX_VERIFIED });

export const BOX_VIDEOS = Object.freeze({
  // gear + warm-up
  'box.wraps': v('CMS_ni5lEs4', 'Tony Jeffries', 'How to Wrap Your Own Hands for Boxing | The Best Way', '5:22'),
  'box.rope': v('wqN5bRkZPK0', 'Tony Jeffries', 'How to Jump Rope (Beginner to Expert)', '6:48'),
  // weeks 1–3: stance, guard, jab, cross, footwork
  'box.stance': v('JrCgR4xwg0A', 'expertboxing', 'Basic Boxing Stance', '4:33'),
  'box.guard': v('krh00SNH1Hg', 'Tony Jeffries', 'How to Avoid Dropping Hands in Boxing (KEEP HANDS UP!)', '5:25'),
  'box.jab': v('71nmi6nGcrY', 'Tony Jeffries', 'How to Throw the Perfect Jab in Boxing', '3:01'),
  'box.jabFix': v('26DSA5DRz0s', 'fightTIPS', '5 Common Jab Mistakes: This Should be Your Best Punch!', '5:27'),
  'box.cross': v('sK-6Ujp3KYY', 'Tony Jeffries', 'How to Throw the Perfect Cross (Right Hand / 2) in Boxing', '9:01'),
  'box.crossFix': v('o3k9NNAUwIE', 'fightTIPS', '5 Common Cross Mistakes: Perfect the "Right Straight"', '3:29'),
  'box.stepdrag': v('dHUutXudf8o', 'expertboxing', 'Boxing Footwork Technique #1 - Step-drag', '1:51'),
  'box.pivot': v('UWhig-IbcV0', 'expertboxing', 'Boxing Footwork Technique #2 - Pivot', '1:54'),
  'box.footDrill': v('zhWfajP4EVU', 'Tony Jeffries', 'Boxing Footwork Drills for Beginners', '3:05'),
  // weeks 4–6: hooks, uppercuts, 1-2 / 1-2-3 / 1-2-3-2
  'box.leadHook': v('NxIWai9sDR8', 'expertboxing', 'How to Throw a Left Hook', '4:54'),
  'box.rearHook': v('MJmHnyBjC6s', 'Tony Jeffries', 'How to throw the right hook in Boxing | Subscribe for more like this', '0:58'),
  'box.uppercut': v('ZmxyguvPwlo', 'expertboxing', 'How to Throw an Uppercut', '5:00'),
  'box.c12': v('YI0uAx1QPvI', 'expertboxing', 'How to Throw a SMOOTH 1-2 Punch Combination', '3:22'),
  'box.c123': v('awgP60rGSlw', 'Muay Thai Madness', 'The 1 - 2 - 3 / Jab - Cross - Hook Combination', '5:33'),
  'box.c1232': v('LKxMYyHIpH8', 'expertboxing', 'Basic Punch Combo (1-2-3-2)', '2:39'),
  // weeks 7–9: defense + counters
  'box.slip': v('FCM7m6TJWUQ', 'expertboxing', 'How to Slip Punches 1 of 3 - Boxing Slipping Technique', '2:02'),
  'box.roll': v('XIja1S9SXI4', 'Tony Jeffries', 'How to Roll a Punch in Boxing | Defense 101', '4:28'),
  'box.block': v('teZCdkaQS7g', 'expertboxing', 'How to Block Punches in Boxing', '2:36'),
  'box.parry': v('HL261oRyURE', 'expertboxing', 'How to Parry Punches 1 of 3 - Down Parry and Side Parry', '1:55'),
  'box.counter': v('LnRH1t4b-ZY', 'expertboxing', 'Boxing DEFENSE & COUNTER against the JAB PUNCH', '2:38'),
  'box.counterDrill': v('LF6rlUAU9cU', 'Precision Striking', 'Improve Your Counter Punching', '5:42'),
  // weeks 10–12: longer combos, angles, intensity, self-review
  'box.longCombo': v('cJCIyAwGZ10', 'Tony Jeffries', 'How to Keep Balance in Boxing when Throwing Long Combinations', '3:29'),
  'box.angles': v('xANWbip_1Ew', 'Precision Striking', 'How to Create Angles in Boxing | Both the Right and Left', '9:42'),
  'box.bag': v('7EHSN5T-ZQE', 'Tony Jeffries', 'How to Punch the Heavy Bag for Beginners | Part 1', '8:08'),
  'box.bagFix': v('7E9vRbDAy7w', 'fightTIPS', '5 Common Heavybag Mistakes that Most Beginners Make', '3:14'),
  'box.shadow': v('U8xJJEUKKm4', 'Precision Striking', 'How to Improve Your Shadow Boxing', '5:36'),
  // the one long video: self-coaching without a coach (filming + review), 11:38
  'box.selfReview': v('whRNDP_xlP0', 'Tony Jeffries', 'How to get great at BOXING without a Coach', '11:38'),
  // core block (anti-rotation)
  'box.pallof': v('LkYtiDAgUUM', 'E3 Rehab Exercise Library', 'Pallof Press / Multifidus Walkout (Band)', '0:16'),
});

/** Arabic name per video key (button labels, aria). */
export const BOX_VIDEO_NAME = Object.freeze({
  'box.wraps': 'لف رباط الإيد', 'box.rope': 'نط الحبل', 'box.stance': 'الوقفة', 'box.guard': 'الجارد', 'box.jab': 'الجاب',
  'box.jabFix': 'أخطاء الجاب', 'box.cross': 'الكروس', 'box.crossFix': 'أخطاء الكروس', 'box.stepdrag': 'ستيب دراج', 'box.pivot': 'البيفوت',
  'box.footDrill': 'تمارين الحركة', 'box.leadHook': 'الهوك الأمامي', 'box.rearHook': 'الهوك الخلفي', 'box.uppercut': 'الأبركت',
  'box.c12': 'كومبو 1-2', 'box.c123': 'كومبو 1-2-3', 'box.c1232': 'كومبو 1-2-3-2', 'box.slip': 'السليب', 'box.roll': 'الرول',
  'box.block': 'البلوك', 'box.parry': 'الباري', 'box.counter': 'الكاونتر على الجاب', 'box.counterDrill': 'تمرين الكاونتر',
  'box.longCombo': 'التوازن في الكومبو الطويل', 'box.angles': 'الزوايا', 'box.bag': 'الضرب على الشوال', 'box.bagFix': 'أخطاء الشوال',
  'box.shadow': 'الشادو', 'box.selfReview': 'تتعلم من غير مدرب', 'box.pallof': 'بالوف بريس',
});

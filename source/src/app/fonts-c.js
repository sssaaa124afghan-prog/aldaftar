// Design C «Daylight Athletic»: Alexandria (Arabic 400/700 + Latin 400) + Barlow Condensed 700 for numerals and Latin headlines.
import ar4 from '../assets/fonts/designs/alex-400.woff2?inline';
import ar7 from '../assets/fonts/designs/alex-700.woff2?inline';
import la4 from '../assets/fonts/designs/alexl-400.woff2?inline';
import n7 from '../assets/fonts/designs/bc-700.woff2?inline';
const AR = 'U+0600-0652,U+0660-066D,U+0670,U+06A9,U+06AF,U+06CC,U+200C-200F,U+FEFF'; const LA = 'U+0000-00FF,U+2009-2026,U+2066-2069,U+2212';
export const FACES = [
  { family: 'Alex', weight: '400 500', range: AR, src: ar4 }, { family: 'Alex', weight: '600 800', range: AR, src: ar7 },
  { family: 'Alex', weight: '400 800', range: LA, src: la4 },
  { family: 'Barlow C', weight: '500 800', range: 'U+0020-007E,U+00A0,U+00B7,U+00D7,U+2013,U+2212', src: n7 },
];

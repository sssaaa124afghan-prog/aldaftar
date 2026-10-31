// Design A «Night Session»: IBM Plex Sans Arabic + IBM Plex Sans (subset, see scripts/subset-fonts.sh). Registered by design.js.
import ar4 from '../assets/fonts/designs/plexar-400.woff2?inline';
import ar6 from '../assets/fonts/designs/plexar-600.woff2?inline';
import la4 from '../assets/fonts/designs/plex-400.woff2?inline';
import la6 from '../assets/fonts/designs/plex-600.woff2?inline';
const AR = 'U+0600-0652,U+0660-066D,U+0670,U+06A9,U+06AF,U+06CC,U+200C-200F,U+FEFF'; const LA = 'U+0000-00FF,U+2009-2026,U+2066-2069,U+2212';
export const FACES = [
  { family: 'Plex Ar', weight: '400 500', range: AR, src: ar4 }, { family: 'Plex Ar', weight: '600 700', range: AR, src: ar6 },
  { family: 'Plex Ar', weight: '400 500', range: LA, src: la4 }, { family: 'Plex Ar', weight: '600 700', range: LA, src: la6 },
];

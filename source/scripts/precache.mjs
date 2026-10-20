// Post-build: add every file in dist/assets to the service worker precache list and stamp a build id.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const dist = path.resolve('dist'); const swPath = path.join(dist, 'sw.js');
const adir = path.join(dist, 'assets');
const assets = fs.existsSync(adir) ? fs.readdirSync(adir).map((f) => `./assets/${f}`) : [];
const id = crypto.createHash('sha1').update(assets.join('|') + fs.readFileSync(path.join(dist, 'index.html'))).digest('hex').slice(0, 8);
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/const VERSION = '([^']*)';/, `const VERSION = '$1-${id}';`);
if (assets.length) sw = sw.replace(/const SHELL = \[/, `const SHELL = [${assets.map((a) => `'${a}'`).join(', ')}, `);
fs.writeFileSync(swPath, sw);
console.log(`precache: ${assets.length} assets, build ${id}`);

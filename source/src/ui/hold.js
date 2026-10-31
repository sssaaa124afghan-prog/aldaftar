// Press-and-hold repeat for steppers (UX audit #10): one step on tap, then repeats after 400 ms and speeds up
// (every 120 ms → 60 ms). Pointer events only; a click from the keyboard still steps once.
export function holdRepeat(btn, step) {
  let t = null; let n = 0; let held = false;
  const stop = () => { clearTimeout(t); t = null; };
  const tick = () => { n += 1; step(n); t = setTimeout(tick, n > 8 ? 60 : 120); };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false; n = 0; stop();
    t = setTimeout(() => { held = true; tick(); }, 400);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', (e) => { if (held) { e.preventDefault(); held = false; return; } step(0); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return stop;
}

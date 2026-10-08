// Interface layer over the pond (2026-10-07): title, tool rail and duck counter. Everything here sits in a fixed overlay ABOVE #pond and never touches the scene's own code:
// it only calls the public methods of Pond (addDuck, removeDuck, drop, setNight, audio).
//
// The words on screen live in COPY just below — edit them there.
//
// Removed at the owner's request on 2026-10-08 (code in git history): the Customize button and its panel (title editing,
// music volume, swimming pace, calm water, light tint, sound-effects switch, a second duck counter — last full version in
// commit b19802e), the fish picture top left, and the "Pop every bubble" tool (now the day / night switch).
import { AUDIO } from './config.js';

/* ------------------------------------------------------------------ words */
const COPY = {
  title: 'Just daily view\nof a tiny fish', // \n is a line break
  // One line under the title on how to play.
  subtitle: 'Bottom view looking up. Drag a duck, tap the surface, pop the bubbles or just do anything you want!',
  hide: 'Hide the interface',
  show: 'Show the interface',
};

/* ------------------------------------------------------------------ icons */
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  rain: svg('<path d="M12 3.5c2.6 3.3 4.5 5.8 4.5 8.3a4.5 4.5 0 0 1-9 0c0-2.500 1.900-5 4.500-8.300z"/><path d="M5 19.500c2.200-1.200 4.600-1.200 7 0s4.800 1.200 7 0"/>'),
  moon: svg('<path d="M19.500 14.600A7.800 7.800 0 0 1 9.400 4.500a7.800 7.800 0 1 0 10.100 10.100z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.400"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M18.700 5.300l-1.400 1.400M6.700 17.300l-1.400 1.400"/>'),
  soundOn: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.800 7.800 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  hide: svg('<path d="M3 12s3.300-6 9-6 9 6 9 6-3.300 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.600"/><path d="M4 4l16 16"/>'),
  show: svg('<path d="M3 12s3.300-6 9-6 9 6 9 6-3.300 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.600"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M6 12h12M12 6v12"/>'),
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ build */
export function createShell(pond) {
  const root = document.createElement('div');
  root.className = 'shell';
  root.innerHTML = `
    <div class="rail" role="toolbar" aria-label="Pond tools" aria-orientation="vertical">
      <button type="button" class="tool" data-act="rain" data-tip="Start a shower" aria-label="Start a shower">${ICON.rain}</button>
      <button type="button" class="tool" data-act="night" data-tip="Night" aria-label="Switch to night" aria-pressed="false">${ICON.moon}</button>
      <button type="button" class="tool" data-act="sound" data-tip="Mute sound" aria-label="Mute sound" aria-pressed="false">${ICON.soundOn}</button>
      <button type="button" class="tool" data-act="full" data-tip="Full screen" aria-label="Full screen">${ICON.full}</button>
      <button type="button" class="tool" data-act="hide" data-tip="${esc(COPY.hide)}" aria-label="${esc(COPY.hide)}">${ICON.hide}</button>
    </div>

    <section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">${esc(COPY.title)}</h1>
      <p class="hero-sub">${esc(COPY.subtitle)}</p>
    </section>

    <div class="counter" role="group" aria-label="Number of ducks">
      <button type="button" class="step" data-act="add-duck" aria-label="Add a duck">${ICON.plus}</button>
      <output class="count sr" aria-live="polite"></output>
      <button type="button" class="step" data-act="remove-duck" aria-label="Remove a duck">${ICON.minus}</button>
    </div>

    <button type="button" class="pill-btn restore" data-act="show">${ICON.show}<span>${esc(COPY.show)}</span></button>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const state = { muted: false, night: false };

  /* -------- pond actions -------- */
  const rain = () => {
    const v = pond.view;
    let made = 0;
    for (let tries = 0; tries < 200 && made < 12; tries++) {
      const x = v.x + Math.random() * v.w, y = v.y + Math.random() * v.h;
      if (!pond.inPond(x, y)) continue;
      setTimeout(() => { pond.drop(x, y); pond.audio?.touch(); }, made * 130 + Math.random() * 90);
      made++;
    }
  };
  // Day / night (2026-10-08, replaces "Pop every bubble"): the button shows where it will take you — a moon by day, a sun
  // by night (pressed, like the muted sound button). The night background loads in the background; until it has, the
  // pond waits and then fades over (Pond.setNight).
  const setNight = (on) => {
    state.night = on;
    const b = $('[data-act="night"]');
    const label = on ? 'Switch to day' : 'Switch to night';
    b.innerHTML = on ? ICON.sun : ICON.moon;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label);
    b.dataset.tip = on ? 'Day' : 'Night';
    pond.setNight(on);
    pond.touch();
  };
  const setMuted = (m) => {
    state.muted = m;
    const b = $('[data-act="sound"]');
    const label = m ? 'Turn sound on' : 'Mute sound';
    b.innerHTML = m ? ICON.soundOff : ICON.soundOn;
    b.setAttribute('aria-pressed', String(m));
    b.setAttribute('aria-label', label);
    b.dataset.tip = label;
    const a = pond.audio;
    if (a?.ctx) a.master.gain.setTargetAtTime(m ? 0 : AUDIO.master, a.ctx.currentTime, 0.08);
  };
  const setHidden = (h) => {
    document.body.classList.toggle('ui-hidden', h);
    (h ? $('.restore') : $('.rail [data-act="hide"]')).focus({ preventScroll: true });
  };

  /* -------- duck counter -------- */
  const syncCount = (n = pond.duckCount, max = pond.maxDucks) => {
    $$('.count').forEach((o) => { o.textContent = n === 1 ? '1 duck' : `${n} ducks`; });
    $$('[data-act="remove-duck"]').forEach((b) => { b.disabled = n <= 1; });
    $$('[data-act="add-duck"]').forEach((b) => { b.disabled = n >= max; });
  };
  pond.onDuckCount = syncCount;

  /* -------- events -------- */
  const ACTS = {
    'add-duck': () => pond.addDuck(),
    'remove-duck': () => pond.removeDuck(),
    rain,
    night: () => setNight(!state.night),
    sound: () => setMuted(!state.muted),
    full: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {}),
    hide: () => setHidden(true),
    show: () => setHidden(false),
  };

  root.addEventListener('pointerdown', () => pond.audio?.unlock());
  root.addEventListener('click', (e) => {
    const el = e.target.closest('button, a');
    if (!el || el.disabled) return;
    pond.audio?.unlock();
    if (el.dataset.act) ACTS[el.dataset.act]?.();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('ui-hidden')) setHidden(false);
  });

  if (!document.documentElement.requestFullscreen) $('[data-act="full"]').hidden = true;
  if (!pond.assets.duck.model) $$('.counter').forEach((c) => { c.hidden = true; });
  syncCount();
  requestAnimationFrame(() => root.classList.add('ready'));
  return { state };
}

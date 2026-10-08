// Interface layer over the pond (2026-10-07): title, tool rail, duck counter and the Customize panel. Everything here sits in a fixed overlay ABOVE #pond and never touches the scene's own code:
// it only calls the public methods of Pond (addDuck, removeDuck, drop, bubbles.pop, audio, teardown/build).
//
// The words on screen live in COPY just below — edit them there.
import { DUCKS, AUDIO, AMBIENT_GAIN } from './config.js';

/* ------------------------------------------------------------------ words */
const COPY = {
  // The title visitors see first. They can rewrite it in Customize → Title; this is what it starts as and what
  // "Reset" brings back. \n is a line break.
  title: 'Just daily view\nof a tiny fish',
  // One line under the title on how to play. Not editable by visitors.
  subtitle: 'Bottom view looking up. Drag a duck, tap the surface, pop the bubbles or just do anything you want!',
  hide: 'Hide the interface',
  show: 'Show the interface',
  customize: 'Customize',
  duck: 'Duck', // label between the + and − buttons
  icon: 'icons/fish.png', // top-left picture
};

const SPEEDS = [['Lazy', 0.55], ['Easy', 1], ['Zippy', 1.9]];
const LIGHTS = [['Noon', 'noon'], ['Golden hour', 'gold'], ['Dusk', 'dusk']];

/* ------------------------------------------------------------------ icons */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;
const ICON = {
  rain: svg('<path d="M12 3.5c2.6 3.3 4.5 5.8 4.5 8.3a4.5 4.5 0 0 1-9 0c0-2.500 1.900-5 4.500-8.300z"/><path d="M5 19.500c2.200-1.200 4.600-1.200 7 0s4.800 1.200 7 0"/>'),
  pop: svg('<circle cx="12" cy="12" r="5.200"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M18.700 5.300l-1.400 1.400M6.700 17.300l-1.400 1.400"/>'),
  soundOn: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.800 7.800 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  hide: svg('<path d="M3 12s3.300-6 9-6 9 6 9 6-3.300 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.600"/><path d="M4 4l16 16"/>'),
  show: svg('<path d="M3 12s3.300-6 9-6 9 6 9 6-3.300 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.600"/>'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M6 12h12M12 6v12"/>'),
  duck: '<svg viewBox="0 0 34 32" width="26" height="24" aria-hidden="true"><path d="M7 19c0-4.400 3.600-7 8.500-7 1.300 0 2.500.2 3.500.6.5-2.600 2.500-4.600 5-4.600 2.600 0 4.500 2 4.500 4.400 0 1.300-.5 2.400-1.400 3.200.9 1 1.400 2.300 1.400 3.600C28.500 23.800 24 27 17.500 27 11.600 27 7 24.200 7 19z" fill="currentColor"/><circle cx="24.600" cy="11.800" r="1.100" fill="#0b3a4a"/><path d="M28.600 12.400l3 .9-3 1.100z" fill="#f58a2b"/></svg>',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ build */
export function createShell(pond) {
  const root = document.createElement('div');
  root.className = 'shell';
  root.innerHTML = `
    <header class="bar">
      <img class="mark" src="${esc(COPY.icon)}" alt="" width="40" height="40">
      <button type="button" class="pill-btn" data-act="customize" aria-expanded="false" aria-controls="panel">${esc(COPY.customize)}</button>
    </header>

    <div class="rail" role="toolbar" aria-label="Pond tools" aria-orientation="vertical">
      <button type="button" class="tool" data-act="rain" data-tip="Start a shower" aria-label="Start a shower">${ICON.rain}</button>
      <button type="button" class="tool" data-act="pop-all" data-tip="Pop every bubble" aria-label="Pop every bubble">${ICON.pop}</button>
      <button type="button" class="tool" data-act="sound" data-tip="Mute sound" aria-label="Mute sound" aria-pressed="false">${ICON.soundOn}</button>
      <button type="button" class="tool" data-act="full" data-tip="Full screen" aria-label="Full screen">${ICON.full}</button>
      <button type="button" class="tool" data-act="hide" data-tip="${esc(COPY.hide)}" aria-label="${esc(COPY.hide)}">${ICON.hide}</button>
    </div>

    <section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">${esc(COPY.title)}</h1>
      <p class="hero-sub">${esc(COPY.subtitle)}</p>
    </section>

    <aside class="panel" id="panel" role="region" tabindex="-1" hidden></aside>

    <div class="counter" role="group" aria-label="Number of ducks">
      <button type="button" class="step" data-act="add-duck" aria-label="Add a duck">${ICON.plus}</button>
      <span class="count-label" aria-hidden="true">${esc(COPY.duck)}</span>
      <output class="count sr" aria-live="polite"></output>
      <button type="button" class="step" data-act="remove-duck" aria-label="Remove a duck">${ICON.minus}</button>
    </div>

    <button type="button" class="pill-btn restore" data-act="show">${ICON.show}<span>${esc(COPY.show)}</span></button>`;
  document.body.appendChild(root);

  // Light tint lives INSIDE #pond, above the canvas, so the interface itself is never tinted.
  const tint = document.createElement('div');
  tint.className = 'pond-tint';
  tint.setAttribute('aria-hidden', 'true');
  pond.el.appendChild(tint);

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const panel = $('#panel');
  const baseSpeed = DUCKS.speed, baseMusic = AUDIO.music;
  const state = { open: false, speed: 1, calm: !!pond.reduceMotion, light: 'noon', music: 1, sfx: true, muted: false };

  /* -------- editable title --------
     The title is so large that it lies across the pond, so it takes no clicks itself (ducks under it stay
     draggable). Visitors rewrite it in Customize → Title. Their wording is kept in THEIR browser only
     (localStorage); emptying the field, or Reset, brings back COPY.title. */
  const titleEl = $('#hero-title');
  const TITLE_KEY = 'ao-vit-title-4'; // bump the number when COPY.title changes, so everyone sees the new line
  const store = {
    get: () => { try { return localStorage.getItem(TITLE_KEY); } catch { return null; } },
    set: (v) => { try { v === null ? localStorage.removeItem(TITLE_KEY) : localStorage.setItem(TITLE_KEY, v); } catch { /* private window: just not remembered */ } },
  };
  const setTitle = (v) => {
    const own = v.trim() && v !== COPY.title;
    titleEl.textContent = own ? v.replace(/\s+$/, '') : COPY.title;
    store.set(own ? v : null);
  };
  const resetTitle = () => setTitle('');
  const saved = store.get();
  if (saved && saved.trim()) titleEl.textContent = saved;

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
  const popAll = () => {
    const b = pond.bubbles;
    if (!b) return;
    const live = [...b.items, ...b.taps].filter((q) => q.live && q.age >= 0).sort((p, q) => q.z - p.z);
    live.forEach((q, i) => setTimeout(() => { if (q.live) { b.pop(q, 1.35); pond.audio?.pop(); } }, i * 90));
    pond.touch();
  };
  const setSpeed = (m) => {
    state.speed = m;
    DUCKS.speed = baseSpeed * m; // survives a rebuild (resize)
    if (pond.ducks) pond.ducks.speed = DUCKS.speed * pond.objScale;
  };
  const setCalm = (on) => {
    if (state.calm === on) return;
    state.calm = on;
    pond.reduceMotion = on;
    pond.ambGain = (on ? 0.35 : 1) * AMBIENT_GAIN;
    pond.teardown();
    pond.build();
    pond.acc = 0;
    setSpeed(state.speed);
  };
  const setLight = (l) => { state.light = l; document.body.dataset.light = l; };
  const applyAudio = () => {
    const a = pond.audio;
    if (!a?.ctx) return;
    const t = a.ctx.currentTime;
    AUDIO.music = baseMusic * state.music; // startMusic() fades in to this if music has not begun yet
    a.master.gain.setTargetAtTime(state.muted ? 0 : AUDIO.master, t, 0.08);
    a.sfx.gain.setTargetAtTime(state.sfx ? AUDIO.sfx : 0, t, 0.05);
    if (a.musicSrc) {
      a.music.gain.cancelScheduledValues(t);
      a.music.gain.setTargetAtTime(AUDIO.music, t, 0.15);
    }
  };
  const setMuted = (m) => {
    state.muted = m;
    const b = $('[data-act="sound"]');
    const label = m ? 'Turn sound on' : 'Mute sound';
    b.innerHTML = m ? ICON.soundOff : ICON.soundOn;
    b.setAttribute('aria-pressed', String(m));
    b.setAttribute('aria-label', label);
    b.dataset.tip = label;
    applyAudio();
  };
  const setHidden = (h) => {
    document.body.classList.toggle('ui-hidden', h);
    (h ? $('.restore') : $('.rail [data-act="hide"]')).focus({ preventScroll: true });
  };

  /* -------- duck counter (also mirrored inside Customize) -------- */
  const syncCount = (n = pond.duckCount, max = pond.maxDucks) => {
    $$('.count').forEach((o) => { o.textContent = o.classList.contains('sr') ? (n === 1 ? '1 duck' : `${n} ducks`) : n; });
    $$('[data-act="remove-duck"]').forEach((b) => { b.disabled = n <= 1; });
    $$('[data-act="add-duck"]').forEach((b) => { b.disabled = n >= max; });
  };
  pond.onDuckCount = syncCount;

  /* -------- panel -------- */
  const closeBtn = `<button type="button" class="tool small close" data-act="close" aria-label="Close panel">${ICON.close}</button>`;
  const seg = (name, items, current) => `
    <div class="seg" role="radiogroup" aria-label="${name}">
      ${items.map(([label, val]) => `<button type="button" role="radio" data-set="${name}" data-val="${val}" aria-checked="${String(val) === String(current)}">${esc(label)}</button>`).join('')}
    </div>`;

  const customHtml = () => `${closeBtn}
    <div class="scroll">
    <h2>${esc(COPY.customize)}</h2>
    <p class="body">Changes apply straight away and last until you reload.</p>
    <div class="rows">
      <label class="row stack"><span class="row-label">Title</span>
        <textarea id="title-field" rows="2" maxlength="80" spellcheck="false" data-set="title" placeholder="${esc(COPY.title.replace('\n', ' '))}">${esc(titleEl.textContent)}</textarea>
      </label>
      <div class="row"><span class="row-label">Ducks</span>
        <div class="counter inline" role="group" aria-label="Number of ducks">
          <button type="button" class="step" data-act="add-duck" aria-label="Add a duck">${ICON.plus}</button>
          <output class="count"></output>
          <button type="button" class="step" data-act="remove-duck" aria-label="Remove a duck">${ICON.minus}</button>
        </div>
      </div>
      <div class="row"><span class="row-label">Swimming pace</span>${seg('speed', SPEEDS, state.speed)}</div>
      <div class="row"><span class="row-label">Water</span>${seg('calm', [['Lively', false], ['Calm', true]], state.calm)}</div>
      <div class="row"><span class="row-label">Light</span>${seg('light', LIGHTS, state.light)}</div>
      <label class="row"><span class="row-label">Music</span>
        <input type="range" min="0" max="1.6" step="0.05" value="${state.music}" data-set="music" aria-label="Music volume">
      </label>
      <div class="row"><span class="row-label">Quacks, pops and splashes</span>${seg('sfx', [['On', true], ['Off', false]], state.sfx)}</div>
    </div>
    <button type="button" class="text-btn" data-act="reset">Reset to how it started</button>
    </div>`;

  const open = (show, focus = true) => {
    state.open = show;
    $('[data-act="customize"]').setAttribute('aria-expanded', String(show));
    document.body.classList.toggle('panel-open', show);
    panel.hidden = !show;
    if (!show) return;
    panel.setAttribute('aria-label', COPY.customize);
    panel.innerHTML = customHtml();
    // replay the short entrance so opening reads as a change
    panel.classList.remove('in'); void panel.offsetWidth; panel.classList.add('in');
    syncCount();
    if (focus) panel.focus({ preventScroll: true });
  };

  const reset = () => {
    resetTitle(); setSpeed(1); setLight('noon'); state.music = 1; state.sfx = true; applyAudio(); setCalm(false);
    open(true, false);
  };

  /* -------- events -------- */
  const ACTS = {
    'add-duck': () => pond.addDuck(),
    'remove-duck': () => pond.removeDuck(),
    rain,
    'pop-all': popAll,
    sound: () => setMuted(!state.muted),
    full: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {}),
    hide: () => setHidden(true),
    show: () => setHidden(false),
    customize: () => open(!state.open),
    close: () => { open(false); $('[data-act="customize"]').focus({ preventScroll: true }); },
    reset,
  };
  const SETTERS = {
    speed: (v) => setSpeed(+v),
    calm: (v) => setCalm(v === 'true'),
    light: setLight,
    title: setTitle,
    sfx: (v) => { state.sfx = v === 'true'; applyAudio(); },
    music: (v) => { state.music = +v; applyAudio(); },
  };

  root.addEventListener('pointerdown', () => pond.audio?.unlock());
  root.addEventListener('click', (e) => {
    const el = e.target.closest('button, a');
    if (!el || el.disabled) return;
    pond.audio?.unlock();
    if (el.dataset.act) ACTS[el.dataset.act]?.();
    else if (el.dataset.set) {
      SETTERS[el.dataset.set](el.dataset.val);
      el.parentElement.querySelectorAll('[role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b === el)));
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset?.set) SETTERS[el.dataset.set](el.value);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.body.classList.contains('ui-hidden')) setHidden(false);
    else if (state.open) ACTS.close();
  });

  if (!document.documentElement.requestFullscreen) $('[data-act="full"]').hidden = true;
  if (!pond.assets.duck.model) $$('.counter').forEach((c) => { c.hidden = true; });
  setLight('noon');
  open(false, false);
  syncCount();
  requestAnimationFrame(() => root.classList.add('ready'));
  return { open, state };
}

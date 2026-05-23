(() => {
  'use strict';

  // ---------- localStorage helpers ----------
  const KEY = {
    name:    'soar.dragonName',
    pos:     'soar.dragonPos',
    weather: 'soar.weather',
    muted:   'soar.muted',
  };
  const lsGet = (k, fallback = null) => {
    try { const v = localStorage.getItem(k); return v === null ? fallback : v; }
    catch { return fallback; }
  };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // ---------- DOM ----------
  const scene       = document.getElementById('scene');
  const dragonWrap  = document.getElementById('dragon-wrap');
  const creatureWrap= document.getElementById('creature-wrap');
  const nameDisplay = document.getElementById('dragon-name-display');
  const modal       = document.getElementById('name-modal');
  const nameInput   = document.getElementById('name-input');
  const nameSubmit  = document.getElementById('name-submit');
  const toolboxBtn  = document.getElementById('toolbox-btn');
  const toolboxPanel= document.getElementById('toolbox-panel');
  const muteBtn     = document.getElementById('mute-btn');
  const music       = document.getElementById('music');

  // ---------- Dragon position + movement ----------
  // Position stored as the dragon's center, in viewport pixels.
  const DRAGON_W = 150;
  const DRAGON_H = 150;
  const GROUND_H = 80;
  const SPEED_PX_PER_SEC = 220; // calm pace

  const clampPos = (x, y) => {
    const minX = DRAGON_W / 2;
    const maxX = window.innerWidth - DRAGON_W / 2;
    const minY = DRAGON_H / 2;
    const maxY = window.innerHeight - GROUND_H - DRAGON_H / 2;
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  };

  const defaultPos = () => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });

  const loadPos = () => {
    const raw = lsGet(KEY.pos);
    if (!raw) return defaultPos();
    try {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return clampPos(p.x, p.y);
    } catch {}
    return defaultPos();
  };

  let pos = loadPos();
  let facingLeft = false;

  const applyDragonTransform = () => {
    // dragon-wrap is centered via margin offsets; translate from its CSS center
    const dx = pos.x - window.innerWidth / 2;
    const dy = pos.y - window.innerHeight / 2;
    dragonWrap.style.transform = `translate(${dx}px, ${dy}px)`;
    dragonWrap.classList.toggle('facing-left', facingLeft);
  };
  applyDragonTransform();

  // Held-direction state — buttons set/unset flags; an rAF loop moves the dragon.
  const held = { up: false, down: false, left: false, right: false };

  let lastFrame = 0;
  let savePosTimer = null;
  const schedulePosSave = () => {
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      lsSet(KEY.pos, JSON.stringify({ x: pos.x, y: pos.y }));
    }, 300);
  };

  // ---------- Companion phoenix state ----------
  // Phoenix tracks the dragon with a gentle lag: a separate facing state
  // and (x, y) that ease toward the dragon's "trailing slot" each frame.
  const PHOENIX_TRAIL_X = 130;       // px behind dragon along the facing axis
  const PHOENIX_TRAIL_Y = -55;       // negative = slightly above dragon
  const PHOENIX_CATCHUP_RATE = 5;    // 1/s — higher = snappier ease
  const PHOENIX_FLIP_DELAY_MS = 350; // facing-flip lag after dragon turns

  // Phoenix facing trails dragon facing on a timer so the flip happens
  // a moment after the dragon's. The trail-offset side flips at the same
  // time, so the phoenix doesn't slingshot through the dragon when the
  // dragon turns — it stays on the old side until its own flip fires.
  let phoenixFacingLeft = facingLeft;
  let lastSeenDragonFacing = facingLeft;
  let phoenixFlipTimer = null;
  let phoenixX = pos.x + (phoenixFacingLeft ? PHOENIX_TRAIL_X : -PHOENIX_TRAIL_X);
  let phoenixY = pos.y + PHOENIX_TRAIL_Y;

  const applyPhoenixTransform = () => {
    const dx = phoenixX - window.innerWidth / 2;
    const dy = phoenixY - window.innerHeight / 2;
    creatureWrap.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  creatureWrap.classList.toggle('facing-left', phoenixFacingLeft);
  applyPhoenixTransform();

  const tick = (now) => {
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
    lastFrame = now;

    let dx = 0, dy = 0;
    if (held.left)  dx -= 1;
    if (held.right) dx += 1;
    if (held.up)    dy -= 1;
    if (held.down)  dy += 1;

    if (dx !== 0 || dy !== 0) {
      // normalize diagonals
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      const move = SPEED_PX_PER_SEC * dt;
      const next = clampPos(pos.x + dx * move, pos.y + dy * move);
      if (next.x !== pos.x || next.y !== pos.y) {
        pos = next;
        if (dx < 0) facingLeft = true;
        else if (dx > 0) facingLeft = false;
        applyDragonTransform();
        schedulePosSave();
      }
    }

    // When the dragon flips, schedule the phoenix to flip a moment later.
    // Cancel any pending flip if the dragon turns again before it fires.
    if (facingLeft !== lastSeenDragonFacing) {
      lastSeenDragonFacing = facingLeft;
      clearTimeout(phoenixFlipTimer);
      phoenixFlipTimer = setTimeout(() => {
        phoenixFacingLeft = facingLeft;
        creatureWrap.classList.toggle('facing-left', phoenixFacingLeft);
      }, PHOENIX_FLIP_DELAY_MS);
    }

    // Ease phoenix toward its trailing slot behind the dragon. Frame-rate
    // independent: same feel at 30fps and 60fps. After ~0.3s the phoenix
    // has closed >75% of the gap, after ~0.6s >95%.
    const targetX = pos.x + (phoenixFacingLeft ? PHOENIX_TRAIL_X : -PHOENIX_TRAIL_X);
    const targetY = pos.y + PHOENIX_TRAIL_Y;
    const k = dt > 0 ? 1 - Math.exp(-PHOENIX_CATCHUP_RATE * dt) : 0;
    phoenixX += (targetX - phoenixX) * k;
    phoenixY += (targetY - phoenixY) * k;
    applyPhoenixTransform();

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---------- D-pad input wiring ----------
  const padButtons = document.querySelectorAll('.pad-btn');
  padButtons.forEach((btn) => {
    const dir = btn.dataset.dir;
    const press   = (e) => { e.preventDefault(); held[dir] = true; };
    const release = (e) => { e.preventDefault(); held[dir] = false; };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    // Fallback for older Safari touch
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend',   release);
  });

  // Release everything on blur (e.g. modal opens, tab hidden)
  window.addEventListener('blur', () => {
    held.up = held.down = held.left = held.right = false;
  });

  // Reclamp on resize / orientation change so dragon doesn't end up off-screen
  window.addEventListener('resize', () => {
    pos = clampPos(pos.x, pos.y);
    applyDragonTransform();
  });

  // ---------- Weather ----------
  const VALID_WEATHER = ['sunny', 'cloudy', 'rainy'];
  const setWeather = (w, persist = true) => {
    if (!VALID_WEATHER.includes(w)) w = 'sunny';
    scene.classList.remove('weather-sunny', 'weather-cloudy', 'weather-rainy');
    scene.classList.add(`weather-${w}`);
    document.querySelectorAll('.weather-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.weather === w);
    });
    if (persist) lsSet(KEY.weather, w);
  };
  setWeather(lsGet(KEY.weather, 'sunny'), false);

  document.querySelectorAll('.weather-btn').forEach((b) => {
    b.addEventListener('click', () => setWeather(b.dataset.weather));
  });

  // ---------- Toolbox panel ----------
  let toolboxOpen = false;
  const setToolbox = (open) => {
    toolboxOpen = open;
    toolboxPanel.hidden = !open;
  };
  toolboxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setToolbox(!toolboxOpen);
  });
  // Tap anywhere else closes it
  document.addEventListener('click', (e) => {
    if (!toolboxOpen) return;
    if (toolboxPanel.contains(e.target) || toolboxBtn.contains(e.target)) return;
    setToolbox(false);
  });

  // ---------- Music + mute ----------
  let muted = lsGet(KEY.muted, '1') === '1';
  const applyMute = () => {
    music.muted = muted;
    muteBtn.classList.toggle('unmuted', !muted);
    lsSet(KEY.muted, muted ? '1' : '0');
  };
  applyMute();

  // Try to start playback (most browsers allow muted autoplay)
  const tryPlay = () => {
    const p = music.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* will play on first interaction */ });
  };
  tryPlay();

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    applyMute();
    if (!muted) tryPlay();
  });

  // First user interaction kicks playback (in case autoplay was blocked)
  const onFirstInteraction = () => {
    tryPlay();
    document.removeEventListener('pointerdown', onFirstInteraction);
    document.removeEventListener('keydown',     onFirstInteraction);
  };
  document.addEventListener('pointerdown', onFirstInteraction, { once: true });
  document.addEventListener('keydown',     onFirstInteraction, { once: true });

  // ---------- Name modal ----------
  const showName = (name) => {
    nameDisplay.textContent = name;
    nameDisplay.hidden = false;
  };

  const savedName = lsGet(KEY.name);
  if (savedName) {
    showName(savedName);
  } else {
    modal.hidden = false;
    setTimeout(() => nameInput.focus(), 350);
  }

  const validate = () => {
    const v = nameInput.value.trim();
    nameSubmit.disabled = v.length === 0;
  };
  nameInput.addEventListener('input', validate);
  validate();

  const submitName = () => {
    const v = nameInput.value.trim();
    if (!v) return;
    lsSet(KEY.name, v);
    showName(v);
    modal.hidden = true;
  };
  nameSubmit.addEventListener('click', submitName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitName(); }
  });

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline-only nicety */ });
    });
  }
})();

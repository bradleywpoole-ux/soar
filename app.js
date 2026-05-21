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
  const creature    = document.getElementById('creature');
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
  const DRAGON_W = 220;
  const DRAGON_H = 180;
  const GROUND_H = 96;
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

  // ---------- Creature drift cycle ----------
  const creatureCycle = () => {
    // Reset to off-screen-right, then trigger the animation
    creature.classList.remove('creature-drifting');
    // force reflow so the animation restarts
    void creature.offsetWidth;
    creature.classList.add('creature-drifting');
  };
  creature.addEventListener('animationend', () => {
    creature.classList.remove('creature-drifting');
    const waitMs = 30000 + Math.random() * 30000; // 30–60s
    setTimeout(creatureCycle, waitMs);
  });
  // Kick off after a short initial delay so the scene settles first
  setTimeout(creatureCycle, 3000);

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

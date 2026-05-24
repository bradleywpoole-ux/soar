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
  const ground      = document.getElementById('ground');
  const bgFar       = document.getElementById('bg-far');
  const bgNear      = document.getElementById('bg-near');
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

  // ---------- World + camera (Layer 1: horizontal scrolling) ----------
  // Dragon position split into world space and screen space:
  //   pos.x  = worldX. Unbounded. Persisted. What the phoenix follows.
  //   pos.y  = viewport-relative Y. (No vertical world yet — later layer.)
  //   cameraX = worldX shown at the horizontal center of the screen.
  //
  // Screen-X of any world entity = (entity.worldX - cameraX) + innerWidth/2.
  // Wrap elements are CSS-centered via left:50% + negative margin, so their
  // transform's translate dx is just (entity.worldX - cameraX) — same shape
  // as before, only the right-hand side is now camera-relative.
  //
  // Camera uses a deadzone: a centered box of half-width
  // DEADZONE_HALF_RATIO * innerWidth where the dragon can move freely
  // without scrolling. The camera only seeks a new target when the dragon
  // pushes outside that box, and it eases toward it — never snaps.
  const DRAGON_W = 150;
  const DRAGON_H = 150;
  // Invisible floor for the dragon's clamp. The forest band is 240px
  // tall with the image now tiled at background-size: 720px auto (see
  // styles.css for the geometry). At that scale, solid tree foliage
  // sits ~24px down from the top of the band; GROUND_H=220 keeps the
  // dragon's belly ~8px above that line — still in the misty mask-fade
  // region so Ki Ki visually grazes the treetops without sinking into
  // dense foliage. Visual forest height (--forest-h in CSS) is 240px.
  const GROUND_H = 220;
  const SPEED_PX_PER_SEC = 220;        // calm pace
  const DEADZONE_HALF_RATIO = 0.225;   // 45% of viewport (the middle 45% holds the dragon still)
  const CAMERA_CATCHUP_RATE = 4;       // 1/s — exponential ease, calm

  const clampY = (y) => {
    const minY = DRAGON_H / 2;
    const maxY = window.innerHeight - GROUND_H - DRAGON_H / 2;
    return Math.max(minY, Math.min(maxY, y));
  };

  const defaultPos = () => ({
    // Start centered on screen. worldX = innerWidth/2 is arbitrary (the
    // world is infinite); same value for cameraX puts the dragon at
    // screen center on first run.
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });

  const loadPos = () => {
    const raw = lsGet(KEY.pos);
    if (!raw) return defaultPos();
    try {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        // x is treated as worldX (no clamp — infinite world). y stays
        // viewport-relative, clamped to the floor. Existing localStorage
        // data written by the pre-scrolling version lands here with x =
        // whatever the old on-screen x was; since cameraX initializes
        // to pos.x below, the dragon appears centered on first load
        // and the saved value just becomes the new world origin.
        return { x: p.x, y: clampY(p.y) };
      }
    } catch {}
    return defaultPos();
  };

  let pos = loadPos();
  let facingLeft = false;
  // Start the camera on the dragon — first frame draws Ki Ki dead-center.
  let cameraX = pos.x;

  const applyDragonTransform = () => {
    // Wrap is CSS-centered; translate offsets from viewport center.
    // For a world-space entity the on-screen offset is worldX - cameraX.
    const dx = pos.x - cameraX;
    const dy = pos.y - window.innerHeight / 2;
    dragonWrap.style.transform = `translate(${dx}px, ${dy}px)`;
    dragonWrap.classList.toggle('facing-left', facingLeft);
  };

  // ---------- Parallax layers ----------
  // Each entry's element scrolls horizontally at -cameraX * speed.
  // speed < 1 = slower than the world (distant); speed = 1 = forest;
  // speed > 1 = faster than the world (close). repeat-x in CSS makes
  // each tile loop seamlessly, so cameraX can grow without bound.
  const PARALLAX_LAYERS = [
    { el: bgFar,  speed: 0.30 },   // distant mountains/hills, far behind forest
    { el: ground, speed: 1.00 },   // forest = the world's reference plane
    { el: bgNear, speed: 1.60 },   // close grass/leaves, in front of forest
  ];

  const applyParallaxScroll = () => {
    for (const layer of PARALLAX_LAYERS) {
      layer.el.style.backgroundPositionX = `${-cameraX * layer.speed}px`;
    }
  };

  applyDragonTransform();
  applyParallaxScroll();

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
    // phoenixX is in world space (it follows pos.x = worldX with an offset),
    // so the on-screen offset from viewport center is phoenixX - cameraX.
    const dx = phoenixX - cameraX;
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
      // worldX is unbounded (infinite world), Y stays viewport-clamped.
      const nextX = pos.x + dx * move;
      const nextY = clampY(pos.y + dy * move);
      if (nextX !== pos.x || nextY !== pos.y) {
        pos.x = nextX;
        pos.y = nextY;
        if (dx < 0) facingLeft = true;
        else if (dx > 0) facingLeft = false;
        schedulePosSave();
      }
    }

    // ----- Camera follow with deadzone -----
    // If the dragon is inside the deadzone, the camera holds still.
    // Outside the deadzone, the camera seeks a target that just barely
    // brings the dragon back to the deadzone edge, then eases toward it
    // (so reversing direction near the edge feels smooth, not jolty).
    const deadzoneHalf = window.innerWidth * DEADZONE_HALF_RATIO;
    const offsetFromCamera = pos.x - cameraX;
    let cameraTargetX = cameraX;
    if (offsetFromCamera >  deadzoneHalf) cameraTargetX = pos.x - deadzoneHalf;
    else if (offsetFromCamera < -deadzoneHalf) cameraTargetX = pos.x + deadzoneHalf;
    if (cameraTargetX !== cameraX) {
      const camK = dt > 0 ? 1 - Math.exp(-CAMERA_CATCHUP_RATE * dt) : 0;
      cameraX += (cameraTargetX - cameraX) * camK;
    }

    // Camera or dragon may have changed this frame — repaint both.
    // (Cheap when no values changed; transforms are GPU-composited.)
    applyDragonTransform();
    applyParallaxScroll();

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

  // Reclamp on resize / orientation change so dragon doesn't end up below
  // the (now possibly different) floor. World-X is intentionally not
  // touched — the world is unbounded. The deadzone width re-computes
  // from window.innerWidth on the next tick, and any mismatch eases out
  // via the normal camera follow.
  window.addEventListener('resize', () => {
    pos.y = clampY(pos.y);
    applyDragonTransform();
    applyParallaxScroll();
    applyPhoenixTransform();
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

/* Standalone starfield background for the static pages — same engine as the
   home page's src/particles/starfield.js (scrollable-starfield port) with a
   gentle ambient drift. Creates its own fixed canvas (#starfield-bg) behind
   the page content; include with <script src="./starfield-bg.js" defer>. */
(function () {
  var AMBIENT = 9;                              // px/s scroll-equivalent drift
  var MOVING_DENSITY = 1500 / (1920 * 1080);    // moving stars per CSS px^2
  var STATIC_DENSITY = 23500 / (1920 * 1080);   // backdrop stars per CSS px^2
  var MAX_STATIC = 100000;                      // safety cap for huge displays
  var WRAP_MARGIN = 20;                         // overscan margin, px
  var SCROLL_FACTOR = 1.0;                      // scroll px -> animation frames
  var BACKDROP_FACTOR = 0.02;                   // backdrop drifts at 2% of scroll
  var LERP = 0.09;                              // inertial smoothing per frame

  // The CSS fade-in (@keyframes phi-starfield-in, site-theme.css) is meant to
  // be a one-time "materializing" moment, not something that replays on
  // every page navigation — each static page is a separate document load,
  // so without this it re-plays every time and reads as constant flicker.
  // Play it once per browser session (sessionStorage survives navigations
  // within a tab but not new tabs/windows), then skip straight to opaque.
  var SESSION_KEY = 'phi-starfield-shown';
  var alreadyShown = false;
  try { alreadyShown = window.sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { /* storage unavailable, fall back to always-fade */ }

  var canvas = document.getElementById('starfield-bg');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'starfield-bg';
    canvas.setAttribute('aria-hidden', 'true');
    if (alreadyShown) {
      canvas.style.opacity = '1';
      canvas.style.animation = 'none';
    } else {
      try { window.sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) { /* ignore */ }
    }
    document.body.prepend(canvas);
  }
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduceMotion = motionQuery.matches;
  motionQuery.addEventListener && motionQuery.addEventListener('change', function (e) {
    reduceMotion = e.matches;
  });

  var W = 0, H = 0, DPR = 1;
  var stars = [], staticStars = [];
  var backdrop = null, backdropH = 0;
  var current = 0, firstPaint = true, lastPainted = NaN;

  function hash01(i, lap) {
    var h = (i * 374761393 + lap * 668265263) | 0;
    h = ((h ^ (h >>> 13)) * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function makeStar() {
    var size = (0.1 + Math.random() * 0.9) * 2.0;
    return {
      x: Math.random() * (W + WRAP_MARGIN),
      y: Math.random() * H,
      size: size,
      speed: size * (0.2 + Math.random() * 0.4),
      r: 0.85 + Math.random() * 0.15,
      g: 0.85 + Math.random() * 0.15 * 0.5,
      b: 0.85 + Math.random() * 0.15,
      a: Math.random(),
    };
  }

  function styleOf(s, alphaScale) {
    return 'rgba(' + Math.round(s.r * 255) + ',' + Math.round(s.g * 255) + ',' +
           Math.round(s.b * 255) + ',' + (Math.min(1, s.a) * alphaScale).toFixed(3) + ')';
  }

  function dot(c, x, y, radius) {
    c.beginPath();
    c.arc(x, y, radius, 0, 6.283185307);
    c.fill();
  }

  function buildField(keepStars) {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (!keepStars) {
      var rawStatic = STATIC_DENSITY * W * H;
      var capScale = Math.min(1, MAX_STATIC / rawStatic);

      var nMoving = Math.round(MOVING_DENSITY * W * H * capScale);
      stars = [];
      for (var i = 0; i < nMoving; i++) {
        var s = makeStar();
        s.size += 1.0;
        s.a += 0.3;
        s.style = styleOf(s, 1);
        stars.push(s);
      }

      var nStatic = Math.round(rawStatic * capScale);
      staticStars = [];
      for (var j = 0; j < nStatic; j++) {
        var t = makeStar();
        t.y = Math.random() * (H + WRAP_MARGIN);
        staticStars.push(t);
      }
    }

    backdropH = H + WRAP_MARGIN;
    backdrop = document.createElement('canvas');
    backdrop.width = W * DPR;
    backdrop.height = backdropH * DPR;
    var bctx = backdrop.getContext('2d');
    bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (var k = 0; k < staticStars.length; k++) {
      var u = staticStars[k];
      bctx.fillStyle = styleOf(u, 0.7);
      dot(bctx, u.x, u.y, u.size);
    }

    firstPaint = true;
    lastPainted = NaN;
  }

  function paint(offset) {
    ctx.clearRect(0, 0, W, H);

    var span = backdropH;
    var bgShift = (offset * BACKDROP_FACTOR) % span;
    if (bgShift < 0) bgShift += span;
    ctx.drawImage(backdrop, 0, -bgShift, W, span);
    ctx.drawImage(backdrop, 0, span - bgShift, W, span);

    var wrapSpan = H + WRAP_MARGIN;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var raw = s.y - offset * s.speed * SCROLL_FACTOR;
      var lap = Math.floor(raw / wrapSpan);
      var y = raw - lap * wrapSpan;
      var x = lap === 0 ? s.x : hash01(i, lap) * (W + WRAP_MARGIN);
      ctx.fillStyle = s.style;
      dot(ctx, x, y - WRAP_MARGIN * 0.5, s.size);
    }
  }

  /* Drift accumulates only while the tab is visible, so hidden tabs stop
     painting and returning doesn't fast-forward the field. */
  var driftPx = 0;
  var driftClock = performance.now();

  /* Freeze hook: pages with a pinned section (research page's Outcomes
     horizontal scroll) call window.phiStarfieldFreeze(true) while pinned so
     the starfield holds perfectly still — no scroll parallax, no ambient
     drift — instead of competing with the sideways card motion. On
     unfreeze, the usual LERP glides the field to the new scroll position. */
  var frozen = false, frozenScroll = 0;
  window.phiStarfieldFreeze = function (on) {
    on = !!on;
    if (on === frozen) return;
    frozen = on;
    if (frozen) frozenScroll = window.scrollY || window.pageYOffset || 0;
  };

  function advanceDrift() {
    var now = performance.now();
    if (AMBIENT && !reduceMotion && !frozen && document.visibilityState !== 'hidden') {
      driftPx += ((now - driftClock) / 1000) * AMBIENT;
    }
    driftClock = now;
    return driftPx;
  }

  function tick() {
    var scroll = frozen ? frozenScroll : (window.scrollY || window.pageYOffset || 0);
    var target = scroll + advanceDrift();
    if (firstPaint) { current = target; firstPaint = false; }
    else if (reduceMotion) current = target;
    else current += (target - current) * LERP;
    if (Math.abs(target - current) < 0.05) current = target;

    if (current !== lastPainted) {
      paint(current);
      lastPainted = current;
    }
  }

  function frame() {
    tick();
    requestAnimationFrame(frame);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var keep = window.innerWidth === W && Math.abs(window.innerHeight - H) < 200;
      buildField(keep);
    }, 150);
  });

  buildField();
  requestAnimationFrame(frame);
})();

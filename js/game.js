/* ==========================================================================
 * game.js — 水果碰碰 主程式
 * ========================================================================== */
(function () {
  'use strict';

  const { Body, World } = window.Physics;
  const META = window.SPRITE_META;
  const Sound = window.Sound;

  // ---------------------------------------------------------------- 常數
  const BOX_W = 440;          // 箱子內寬
  const BOX_H = 580;          // 箱子內高
  const WALL = 14;            // 牆厚
  const TOP = 180;            // 箱口上方的空間（放吉祥物）
  const FLOOR = 14;
  const SIDE = WALL + 24;      // 畫布左右邊距（牆外框與蝴蝶結）
  const LW = BOX_W + SIDE * 2;
  const LH = TOP + BOX_H + FLOOR + 8;
  const LINE_Y = 0;           // 危險線 = 箱口
  const HOLD_TOP = -100;      // 手上水果的頂端
  const OVER_LIMIT = 2.4;     // 超過危險線幾秒就結束
  const DROP_COOLDOWN = 0.45;
  const FIXED_DT = 1 / 60;
  const MASCOT_SCALE = 0.27;
  const WAVE_INTERVALS = [30, 25, 20, 15, 10]; // 各階段的水果雨間隔（秒），最後停在 10 秒
  const STAGE_SECONDS = 300;  // 每玩 5 分鐘進入下一階段
  const WAVE_LEVELS = [0.55, 0.35, 0.10]; // 水果雨裡各種小水果的機率（櫻桃 / 藍莓 / 葡萄）

  const FRUITS = [
    { name: '櫻桃', r: 24, color: '#ff6b8b' },
    { name: '藍莓', r: 31, color: '#7fa8ff' },
    { name: '葡萄', r: 37, color: '#b892ff' },
    { name: '橘子', r: 43, color: '#ffad5c' },
    { name: '檸檬', r: 51, color: '#ffe36e' },
    { name: '青蘋果', r: 58, color: '#a8e063' },
    { name: '水蜜桃', r: 68, color: '#ffb6cf' },
    { name: '椰子', r: 80, color: '#c9a27e' },
    { name: '火龍果', r: 93, color: '#ff5fc4' },
    { name: '哈密瓜', r: 110, color: '#8fe3cf' },
    { name: '西瓜', r: 132, color: '#5cc46a' },
  ];
  const MELON = FRUITS.length - 1;
  const SPAWN_WEIGHTS = [0.27, 0.25, 0.2, 0.16, 0.12];

  // 箱子：糖果條紋牆（stripeA / stripeB）、可可色外框、點點底紋
  const THEMES = {
    day: {
      panelTop: 'rgba(255,251,253,0.84)', panelBottom: 'rgba(255,232,243,0.92)',
      stripeA: '#ffa8cb', stripeB: '#fff3f8', wallLine: '#e27aa6', ink: '#7a3d55',
      dot: 'rgba(255,150,195,0.16)',
      line: '255,100,150', guide: 'rgba(226,122,166,0.5)', shine: 'rgba(255,255,255,0.45)',
    },
    night: {
      panelTop: 'rgba(78,62,150,0.55)', panelBottom: 'rgba(50,38,118,0.74)',
      stripeA: '#bfa9ff', stripeB: '#f6f2ff', wallLine: '#8f78ee', ink: '#3e2f7a',
      dot: 'rgba(255,255,255,0.07)',
      line: '255,140,200', guide: 'rgba(240,230,255,0.55)', shine: 'rgba(255,255,255,0.12)',
    },
  };

  // ---------------------------------------------------------------- 工具
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const $ = id => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 私密模式等 */ } },
  };

  function loadImg(src) { const im = new Image(); im.src = src; return im; }
  const isReady = im => im.complete && im.naturalWidth > 0;
  const fruitSrc = i => `assets/fruits/${i}.png`;
  const fruitImgs = FRUITS.map((_, i) => loadImg(fruitSrc(i)));
  const mascotImg = loadImg('assets/mascot.png');
  const bowImg = loadImg('assets/bow.png');

  // 圖樣快取（條紋牆、點點底紋），切換主題時重建
  const patterns = {};
  function getPatterns(T) {
    if (patterns.theme === T) return patterns;
    const stripe = document.createElement('canvas');
    stripe.width = stripe.height = 24;
    const s = stripe.getContext('2d');
    s.fillStyle = T.stripeB; s.fillRect(0, 0, 24, 24);
    s.fillStyle = T.stripeA;
    for (const o of [-24, 0, 24]) {
      s.beginPath(); s.moveTo(o, 24); s.lineTo(o + 12, 24); s.lineTo(o + 36, 0); s.lineTo(o + 24, 0); s.closePath(); s.fill();
    }
    const dots = document.createElement('canvas');
    dots.width = dots.height = 30;
    const d = dots.getContext('2d');
    d.fillStyle = T.dot;
    d.beginPath(); d.arc(7.5, 7.5, 3.2, 0, Math.PI * 2); d.arc(22.5, 22.5, 3.2, 0, Math.PI * 2); d.fill();
    patterns.theme = T;
    patterns.stripe = ctx.createPattern(stripe, 'repeat');
    patterns.dots = ctx.createPattern(dots, 'repeat');
    return patterns;
  }

  // ---------------------------------------------------------------- 狀態
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let scale = 1, dpr = 1;

  const settings = Object.assign({ music: true, sfx: true, theme: 'day' }, store.get('melonMerge.settings', {}));
  const world = new World({
    width: BOX_W, height: BOX_H,
    gravity: 1650, substeps: 12,
    restitution: 0.12, friction: 0.3, staticFriction: 0.55,
  });

  const game = {
    state: 'title',            // title | playing | paused | over
    score: 0,
    best: store.get('melonMerge.best', 0),
    held: null,                // { level, t }
    next: 0,
    cooldown: 0,
    aimX: BOX_W / 2,
    mascotX: BOX_W / 2,
    mascotTilt: 0,
    keyDir: 0,
    time: 0,                   // 遊戲時間（暫停時停止）
    clock: 0,                  // 動畫時鐘（一直跑）
    merges: [],
    particles: [],
    popups: [],
    banner: null,
    shake: 0,
    combo: 0,
    lastMergeAt: -10,
    danger: 0,
    warnTimer: 0,
    culprit: null,
    discovered: new Set(),
    maxLevel: 0,
    stats: { drops: 0, merges: 0, melons: 0, waves: 0 },
    stage: 0,                  // 難度階段（0 ~ 4）
    waveTimer: WAVE_INTERVALS[0], // 距離下一陣水果雨的秒數
    waveQueue: [],             // 正在依序落下的水果
  };

  // ---------------------------------------------------------------- 物理事件
  world.onPair = (a, b) => {
    if (game.state !== 'playing' || a.merging || b.merging) return;
    a.merging = b.merging = true;
    world.remove(a); world.remove(b);
    game.merges.push([a, b]);
  };
  world.onImpact = (a, b, speed) => {
    if (game.state !== 'playing' || speed < 160) return;
    const lvl = b ? Math.max(a.level, b.level) : a.level;
    Sound.hit(lvl / MELON, clamp((speed - 160) / 900, 0.12, 1));
  };

  function makeFruit(x, y, level, fromR) {
    const b = new Body(x, y, fromR || FRUITS[level].r, { level });
    if (fromR) b.growTo(FRUITS[level].r, 0.2); // 物理引擎會在子步驟中平滑長大
    b.age = 0;
    b.pop = fromR ? 0 : 1;
    b.overT = 0;
    b.merging = false;
    return b;
  }

  function weightedPick(weights) {
    let r = Math.random(), i = 0;
    for (; i < weights.length - 1; i++) { r -= weights[i]; if (r < 0) break; }
    return i;
  }
  const randLevel = () => weightedPick(SPAWN_WEIGHTS);

  const heldY = lvl => HOLD_TOP + FRUITS[lvl].r;

  // ---------------------------------------------------------------- 遊戲流程
  function startGame() {
    world.clear();
    Object.assign(game, {
      state: 'playing', score: 0, held: { level: 0, t: 0 }, next: randLevel(), cooldown: 0,
      time: 0, merges: [], particles: [], popups: [], banner: null, shake: 0, combo: 0,
      lastMergeAt: -10, danger: 0, warnTimer: 0, culprit: null, discovered: new Set([0]),
      maxLevel: 0, stats: { drops: 0, merges: 0, melons: 0, waves: 0 },
      stage: 0, waveTimer: WAVE_INTERVALS[0], waveQueue: [],
    });
    Sound.setStage(0);
    updateScoreUI(false);
    setNextUI();
    refreshRing();
    hideOverlays();
    Sound.duck(false);
  }

  function drop() {
    if (game.state !== 'playing' || !game.held) return;
    const lvl = game.held.level, r = FRUITS[lvl].r;
    const x = clamp(game.mascotX, r, BOX_W - r) + rand(-0.3, 0.3);
    const b = makeFruit(x, heldY(lvl), lvl);
    b.vy = 60;
    world.add(b);
    game.held = null;
    game.cooldown = DROP_COOLDOWN;
    game.stats.drops++;
    discover(lvl);
    Sound.drop();
  }

  function processMerges() {
    for (const [a, b] of game.merges) {
      const lvl = a.level + 1;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      game.combo = game.time - game.lastMergeAt < 0.9 ? game.combo + 1 : 0;
      game.lastMergeAt = game.time;
      game.stats.merges++;
      addScore(lvl * (lvl + 1) / 2, x, y - 10);

      if (lvl <= MELON) {
        const nb = makeFruit(x, y, lvl, FRUITS[lvl].r * 0.5);
        nb.vx = (a.vx + b.vx) * 0.25;
        nb.vy = (a.vy + b.vy) * 0.25;
        world.add(nb);
        discover(lvl);
        burst(x, y, lvl, FRUITS[a.level].color);
        Sound.merge(lvl, game.combo);
        if (lvl === MELON) {
          game.stats.melons++;
          showBanner('大西瓜！', '#4cbb5a');
          confetti();
          Sound.watermelon();
        }
      } else {
        // 兩顆西瓜相遇：一起消失，送大獎
        burst(x, y, MELON, FRUITS[MELON].color);
        burst(x, y, MELON, '#ff4d6d');
        showBanner('西瓜派對！', '#ff4d6d');
        confetti();
        Sound.watermelon();
      }
      if (game.combo >= 1) {
        game.popups.push({ x, y: y - 42, text: `連鎖 ×${game.combo + 1}`, life: 0, max: 1.0, size: 20, color: '#ff7a59' });
      }
      if (lvl >= 6) game.shake = Math.max(game.shake, (lvl - 5) * 2.4);
    }
    game.merges.length = 0;
  }

  function addScore(points, x, y) {
    game.score += points;
    game.popups.push({ x, y, text: `+${points}`, life: 0, max: 0.9, size: 18 + Math.min(points, 66) * 0.25, color: '#fff' });
    updateScoreUI(true);
  }

  function discover(lvl) {
    game.maxLevel = Math.max(game.maxLevel, lvl);
    if (!game.discovered.has(lvl)) {
      game.discovered.add(lvl);
      refreshRing(lvl);
    }
  }

  // ---------------------------------------------------------------- 水果雨
  // 時間到就直接從箱口灑下一小批小水果。每玩 STAGE_SECONDS 秒進入下一階段：
  // 間隔縮短 5 秒（30 → 10 秒為止），背景音樂也跟著加快、升調。
  function planWave() {
    const n = Math.min(6, 4 + game.stage); // 階段越高越多：4 → 6 顆
    const slot = BOX_W / n;
    const items = [];
    for (let i = 0; i < n; i++) {
      const level = weightedPick(WAVE_LEVELS);
      const r = FRUITS[level].r;
      items.push({ level, x: clamp(slot * (i + 0.5) + rand(-0.25, 0.25) * slot, r, BOX_W - r) });
    }
    for (let i = items.length - 1; i > 0; i--) { // 打亂落下順序
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  const waveY = lvl => -FRUITS[lvl].r - 8;

  function updateWave(dt) {
    const stage = Math.min(WAVE_INTERVALS.length - 1, Math.floor(game.time / STAGE_SECONDS));
    if (stage !== game.stage) {
      game.stage = stage;
      game.waveTimer = Math.min(game.waveTimer, WAVE_INTERVALS[stage]);
      Sound.setStage(stage);
      Sound.levelUp();
      showBanner('節奏加快！', '#ff7aa8');
    }
    game.waveTimer -= dt;
    if (game.waveTimer <= 0) {
      planWave().forEach((it, i) => game.waveQueue.push({ x: it.x, level: it.level, at: game.time + i * 0.12, i }));
      game.waveTimer += WAVE_INTERVALS[game.stage];
      game.stats.waves++;
      Sound.rain();
    }
    while (game.waveQueue.length && game.time >= game.waveQueue[0].at) {
      const it = game.waveQueue.shift();
      const b = makeFruit(it.x, waveY(it.level), it.level);
      b.vy = 120;
      b.pop = 0;
      world.add(b);
      discover(it.level);
      game.particles.push({ type: 'ring', x: b.x, y: b.y, life: 0, max: 0.3, r0: b.r * 0.4, r1: b.r * 1.4, color: '#ffffff' });
      Sound.plink(it.i);
    }
  }

  function checkDanger(dt) {
    let near = false, maxOver = 0, worst = null;
    for (const b of world.bodies) {
      if (b.removed) continue;
      const top = b.y - b.r;
      if (b.age > 0.8 && top < LINE_Y + 45) near = true;
      if (b.age > 1.0 && top < LINE_Y) {
        b.overT += dt;
        if (b.overT > maxOver) { maxOver = b.overT; worst = b; }
      } else {
        b.overT = 0;
      }
    }
    const target = maxOver > 0 ? 0.55 + 0.45 * (maxOver / OVER_LIMIT) : near ? 0.35 : 0;
    game.danger += (target - game.danger) * Math.min(1, dt * 6);
    if (maxOver > 0.15) {
      game.warnTimer -= dt;
      if (game.warnTimer <= 0) { Sound.warn(); game.warnTimer = lerp(0.6, 0.25, maxOver / OVER_LIMIT); }
    } else {
      game.warnTimer = 0;
    }
    if (maxOver > OVER_LIMIT) gameOver(worst);
  }

  function gameOver(culprit) {
    game.state = 'over';
    game.culprit = culprit;
    game.held = null;
    game.shake = 8;
    Sound.gameOver();
    Sound.duck(true);
    const isNew = game.score > game.best;
    if (isNew) { game.best = game.score; store.set('melonMerge.best', game.best); }
    setTimeout(() => { if (game.state === 'over') showOverOverlay(isNew); }, 1400);
  }

  // ---------------------------------------------------------------- 特效
  function burst(x, y, lvl, color) {
    const r = FRUITS[lvl].r;
    const n = 10 + lvl * 3;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(120, 380) + lvl * 18;
      game.particles.push({
        type: 'juice', x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140,
        life: 0, max: rand(0.45, 0.85), size: rand(3, 6) + lvl * 0.45, color,
      });
    }
    for (let i = 0; i < 4 + lvl; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 200);
      game.particles.push({
        type: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0, max: rand(0.5, 0.9), size: rand(5, 9) + lvl * 0.5,
        color: Math.random() < 0.5 ? '#fff6a8' : '#ffffff', rot: rand(0, 6), spin: rand(-6, 6),
      });
    }
    game.particles.push({ type: 'ring', x, y, life: 0, max: 0.4, r0: r * 0.5, r1: r * 1.7, color: '#ffffff' });
    if (game.particles.length > 600) game.particles.splice(0, game.particles.length - 600);
  }

  function confetti() {
    const colors = ['#ff5d73', '#ffd84d', '#38b000', '#4cc9f0', '#ff9f1c', '#c77dff'];
    for (let i = 0; i < 90; i++) {
      game.particles.push({
        type: 'confetti', x: rand(0, BOX_W), y: rand(-TOP, -20),
        vx: rand(-60, 60), vy: rand(0, 160), life: 0, max: rand(2.0, 3.2),
        w: rand(6, 11), h: rand(3, 6), color: colors[i % colors.length],
        rot: rand(0, 6), spin: rand(-8, 8),
      });
    }
  }

  function showBanner(text, color) {
    game.banner = { text, color, t: 0, max: 2.0 };
  }

  // ---------------------------------------------------------------- 更新
  function update(dt) {
    game.time += dt;

    if (game.state === 'playing' && !game.held) {
      game.cooldown -= dt;
      if (game.cooldown <= 0) {
        game.held = { level: game.next, t: 0 };
        game.next = randLevel();
        setNextUI();
      }
    }
    if (game.held) game.held.t += dt;
    if (game.state === 'playing') updateWave(dt);

    for (const b of world.bodies) {
      b.age += dt;
      if (b.pop < 1) b.pop = Math.min(1, b.pop + dt / 0.32);
    }

    world.step(dt);
    processMerges();
    if (game.state === 'playing') checkDanger(dt);
  }

  function updateVisuals(dt) {
    game.clock += dt;
    if (game.keyDir && (game.state === 'playing' || game.state === 'title')) {
      game.aimX = clamp(game.aimX + game.keyDir * 430 * dt, 0, BOX_W);
    }
    const r = game.held ? FRUITS[game.held.level].r : 18;
    const target = clamp(game.aimX, r, BOX_W - r);
    const prev = game.mascotX;
    game.mascotX += (target - game.mascotX) * Math.min(1, dt * 20);
    const v = (game.mascotX - prev) / Math.max(dt, 1e-3);
    game.mascotTilt += (clamp(v * 0.0007, -0.25, 0.25) - game.mascotTilt) * Math.min(1, dt * 10);

    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.life += dt;
      if (p.life >= p.max) { game.particles.splice(i, 1); continue; }
      if (p.type === 'juice') { p.vy += 1000 * dt; p.vx *= 0.99; }
      else if (p.type === 'star') { p.vy += 120 * dt; p.rot += p.spin * dt; }
      else if (p.type === 'confetti') {
        p.vy = Math.min(p.vy + 300 * dt, 220); p.vx += Math.sin(game.clock * 3 + p.rot) * 20 * dt; p.rot += p.spin * dt;
      }
      if (p.type !== 'ring') { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    for (let i = game.popups.length - 1; i >= 0; i--) {
      const p = game.popups[i];
      p.life += dt;
      if (p.life >= p.max) game.popups.splice(i, 1);
    }
    if (game.banner) { game.banner.t += dt; if (game.banner.t > game.banner.max) game.banner = null; }
    game.shake = Math.max(0, game.shake - dt * 22);
    if (game.state !== 'playing') game.danger = Math.max(0, game.danger - dt);
  }

  // ---------------------------------------------------------------- 繪圖
  function render() {
    const T = THEMES[settings.theme];
    const k = scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = game.shake ? rand(-game.shake, game.shake) : 0;
    const sy = game.shake ? rand(-game.shake, game.shake) : 0;
    ctx.setTransform(k, 0, 0, k, (SIDE + sx) * k, (TOP + sy) * k);

    drawBox(T);
    drawDangerLine(T);
    drawGuide(T);
    for (const b of world.bodies) {
      if (b.removed) continue;
      const s = b.pop < 1 ? 1 + 0.16 * Math.sin(b.pop * Math.PI) : 1;
      drawFruit(b.level, b.x, b.y, b.r, b.angle, s);
      if (b === game.culprit && game.state === 'over' && Math.sin(game.clock * 14) > 0) {
        ctx.strokeStyle = `rgba(${T.line},0.95)`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    drawWalls(T);
    drawParticles();
    drawHolder();
    drawPopups(T);
    drawBanner(T);
  }

  function roundedU(path) {
    const x0 = -WALL / 2, x1 = BOX_W + WALL / 2, yb = BOX_H + FLOOR / 2, yt = -16, rad = 24;
    path.beginPath();
    path.moveTo(x0, yt);
    path.arcTo(x0, yb, x1, yb, rad);
    path.arcTo(x1, yb, x1, yt, rad);
    path.lineTo(x1, yt);
  }

  function drawBox(T) {
    // 箱內底色
    ctx.save();
    roundedU(ctx);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -16, 0, BOX_H);
    g.addColorStop(0, T.panelTop);
    g.addColorStop(1, T.panelBottom);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = getPatterns(T).dots;
    ctx.fill();
    // 玻璃反光
    ctx.clip();
    ctx.fillStyle = T.shine;
    ctx.beginPath();
    ctx.moveTo(BOX_W * 0.62, -16); ctx.lineTo(BOX_W * 0.74, -16);
    ctx.lineTo(BOX_W * 0.38, BOX_H); ctx.lineTo(BOX_W * 0.26, BOX_H);
    ctx.fill();
    // 危險時上方泛紅
    if (game.danger > 0.01) {
      const rg = ctx.createLinearGradient(0, -16, 0, 120);
      rg.addColorStop(0, `rgba(${T.line},${0.35 * game.danger})`);
      rg.addColorStop(1, `rgba(${T.line},0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, -16, BOX_W, 136);
    }
    ctx.restore();
  }

  function drawWalls(T) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    roundedU(ctx);
    ctx.strokeStyle = T.ink; ctx.lineWidth = WALL + 10; ctx.stroke();      // 可可色外框
    roundedU(ctx);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = WALL + 5; ctx.stroke();   // 白色描邊
    roundedU(ctx);
    ctx.strokeStyle = getPatterns(T).stripe; ctx.lineWidth = WALL; ctx.stroke(); // 糖果條紋
    ctx.translate(-2.5, -1);
    roundedU(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3; ctx.stroke(); // 反光
    ctx.restore();
    // 兩根牆頂端的蝴蝶結
    if (isReady(bowImg)) {
      const w = 58, h = w * bowImg.naturalHeight / bowImg.naturalWidth;
      for (const x of [-WALL / 2, BOX_W + WALL / 2]) {
        ctx.save();
        ctx.translate(x, -18);
        ctx.rotate((x < 0 ? -1 : 1) * (0.12 + Math.sin(game.clock * 2.4) * 0.04));
        ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }
  }

  function drawDangerLine(T) {
    const blink = game.danger > 0.5 ? 0.6 + 0.4 * Math.sin(game.clock * (8 + game.danger * 10)) : 1;
    const a = (0.28 + 0.65 * game.danger) * blink;
    ctx.save();
    ctx.strokeStyle = `rgba(${T.line},${a})`;
    ctx.lineWidth = 3 + game.danger * 2;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -game.clock * 18;
    ctx.beginPath(); ctx.moveTo(4, LINE_Y); ctx.lineTo(BOX_W - 4, LINE_Y); ctx.stroke();
    ctx.restore();
  }

  // 從 x 往下看，碰到的第一個表面（水果頂端或地板）
  function landingY(x) {
    let yEnd = BOX_H;
    for (const b of world.bodies) {
      const dx = Math.abs(b.x - x);
      if (dx < b.r) yEnd = Math.min(yEnd, b.y - Math.sqrt(b.r * b.r - dx * dx));
    }
    return yEnd;
  }

  function drawGuide(T) {
    if (game.state !== 'playing' || !game.held) return;
    const lvl = game.held.level, r = FRUITS[lvl].r;
    const x = clamp(game.mascotX, r, BOX_W - r);
    const yEnd = landingY(x);
    const y0 = heldY(lvl) + r;
    if (yEnd <= y0) return;
    ctx.save();
    ctx.strokeStyle = T.guide;
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 9]);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y0 + 6); ctx.lineTo(x, yEnd); ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFruit(lvl, x, y, r, angle, s) {
    const im = fruitImgs[lvl], m = META.fruits[lvl];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (isReady(im)) {
      const k = (r * s) / m.r;
      ctx.drawImage(im, -m.cx * k, -m.cy * k, m.w * k, m.h * k);
    } else {
      ctx.fillStyle = FRUITS[lvl].color;
      ctx.beginPath(); ctx.arc(0, 0, r * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawHolder() {
    const bob = Math.sin(game.clock * 3.2) * 3;
    const x = game.mascotX;
    if (game.held && game.state === 'playing') {
      const lvl = game.held.level;
      const appear = game.held.t < 0.28 ? easeOutBack(game.held.t / 0.28) : 1;
      drawFruit(lvl, x, heldY(lvl) + bob, FRUITS[lvl].r, 0, Math.max(0.01, appear));
    }
    if (!isReady(mascotImg)) return;
    const m = META.mascot, s = MASCOT_SCALE;
    const flap = 1 + Math.sin(game.clock * 9) * 0.025;
    ctx.save();
    ctx.translate(x, HOLD_TOP + 8 + bob);
    ctx.rotate(game.mascotTilt);
    ctx.scale(1, flap);
    if (game.state === 'over') ctx.rotate(Math.sin(game.clock * 6) * 0.08);
    ctx.drawImage(mascotImg, -m.hx * s, -m.hy * s, m.w * s, m.h * s);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of game.particles) {
      const t = p.life / p.max, a = 1 - t;
      ctx.globalAlpha = Math.max(0, a);
      if (p.type === 'juice') {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'star') {
        drawStar(p.x, p.y, p.size * (1 - t * 0.3), p.rot, p.color);
      } else if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 5 * a;
        ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r0, p.r1, easeOutCubic(t)), 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'confetti') {
        ctx.globalAlpha = Math.min(1, a * 3);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) + 0.2);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStar(x, y, r, rot, color) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.32;
      const a = (i / 8) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function outlinedText(text, x, y, size, fill, ink, weight) {
    ctx.font = `${weight || 800} ${size}px 'Baloo 2', 'Huninn', 'Microsoft JhengHei', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size * 0.22);
    ctx.strokeStyle = ink;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function drawPopups(T) {
    for (const p of game.popups) {
      const t = p.life / p.max;
      const s = t < 0.2 ? easeOutBack(t / 0.2) : 1;
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.save();
      ctx.translate(p.x, p.y - easeOutCubic(t) * 40);
      ctx.scale(s, s);
      outlinedText(p.text, 0, 0, p.size, p.color, T.ink);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawBanner(T) {
    const b = game.banner;
    if (!b) return;
    const s = b.t < 0.4 ? easeOutBack(b.t / 0.4) : 1;
    const a = b.t > b.max - 0.4 ? (b.max - b.t) / 0.4 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.translate(BOX_W / 2, BOX_H * 0.3);
    ctx.rotate(Math.sin(b.t * 5) * 0.04);
    ctx.scale(s, s);
    outlinedText(b.text, 0, 0, 58, b.color, '#ffffff', 900);
    ctx.lineWidth = 3;
    outlinedText(b.text, 0, 0, 58, b.color, T.ink, 900);
    ctx.restore();
  }

  // ---------------------------------------------------------------- UI
  const ui = {
    score: $('score'), best: $('best'), nextImg: $('next-img'), nextName: $('next-name'),
    ring: $('ring'), toast: $('toast'),
    ovStart: $('ov-start'), ovPause: $('ov-pause'), ovOver: $('ov-over'), ovHowto: $('ov-howto'),
    btnMusic: $('btn-music'), btnSfx: $('btn-sfx'),
  };

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function updateScoreUI(animate) {
    ui.score.textContent = game.score;
    ui.best.textContent = Math.max(game.best, game.score);
    if (animate) bump(ui.score);
  }

  function setNextUI() {
    const lvl = game.next;
    ui.nextImg.src = fruitSrc(lvl);
    const size = 46 + lvl * 10;
    ui.nextImg.style.width = size + 'px';
    ui.nextName.textContent = FRUITS[lvl].name;
    ui.nextImg.classList.remove('pop');
    void ui.nextImg.offsetWidth;
    ui.nextImg.classList.add('pop');
  }

  function buildRing() {
    const R = 76, C = 98;
    FRUITS.forEach((f, i) => {
      const a = -Math.PI / 2 + (i / FRUITS.length) * Math.PI * 2;
      const im = document.createElement('img');
      im.src = fruitSrc(i);
      im.alt = f.name;
      im.title = f.name;
      const size = 24 + i * 2.6;
      im.style.width = size + 'px';
      im.style.left = C + Math.cos(a) * R + 'px';
      im.style.top = C + Math.sin(a) * R + 'px';
      ui.ring.appendChild(im);
    });
  }

  function refreshRing(flashLevel) {
    const imgs = ui.ring.querySelectorAll('img');
    imgs.forEach((im, i) => {
      im.classList.toggle('got', game.discovered.has(i));
      if (i === flashLevel) {
        im.classList.remove('flash'); void im.offsetWidth; im.classList.add('flash');
      }
    });
  }

  let toastTimer = 0;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1400);
  }

  function hideOverlays() {
    [ui.ovStart, ui.ovPause, ui.ovOver, ui.ovHowto].forEach(o => o.classList.remove('show'));
  }

  // 玩法說明裡的進化順序
  function buildHowtoRing() {
    const box = $('howto-ring');
    FRUITS.forEach((f, i) => {
      if (i) { const a = document.createElement('i'); a.textContent = '›'; box.appendChild(a); }
      const im = document.createElement('img');
      im.src = fruitSrc(i); im.alt = f.name; im.title = f.name;
      box.appendChild(im);
    });
  }

  // 回到封面
  function goHome() {
    world.clear();
    game.state = 'title';
    game.held = null;
    game.particles.length = 0;
    game.popups.length = 0;
    game.banner = null;
    hideOverlays();
    $('cover-best').textContent = game.best;
    ui.ovStart.classList.add('show');
    Sound.setStage(0);
    Sound.duck(false);
  }

  function showOverOverlay(isNew) {
    $('new-record').classList.toggle('show', isNew);
    $('final-best').textContent = game.best;
    $('final-fruit-img').src = fruitSrc(game.maxLevel);
    $('final-fruit-name').textContent = FRUITS[game.maxLevel].name;
    $('final-stats').textContent =
      `放下 ${game.stats.drops} 顆・合成 ${game.stats.merges} 次・撐過 ${game.stats.waves} 陣水果雨・大西瓜 ${game.stats.melons} 顆`;
    ui.ovOver.classList.add('show');
    updateScoreUI(false);
    // 分數跳動
    const el = $('final-score'), target = game.score, t0 = performance.now();
    (function tick(now) {
      const t = Math.min(1, (now - t0) / 900);
      el.textContent = Math.round(target * easeOutCubic(t));
      if (t < 1) requestAnimationFrame(tick);
    })(t0);
    if (isNew) Sound.newRecord();
  }

  function pause() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    ui.ovPause.classList.add('show');
    Sound.duck(true);
  }
  function resume() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    ui.ovPause.classList.remove('show');
    Sound.duck(false);
  }
  function togglePause() {
    if (game.state === 'playing') pause(); else if (game.state === 'paused') resume();
  }

  function applySoundButtons() {
    ui.btnMusic.classList.toggle('muted', !settings.music);
    ui.btnSfx.classList.toggle('muted', !settings.sfx);
  }
  function toggleMusic() {
    settings.music = !settings.music;
    Sound.setMusic(settings.music);
    store.set('melonMerge.settings', settings);
    applySoundButtons();
    toast(settings.music ? '♪ 音樂：開' : '♪ 音樂：關');
  }
  function toggleSfx() {
    settings.sfx = !settings.sfx;
    Sound.setSfx(settings.sfx);
    store.set('melonMerge.settings', settings);
    applySoundButtons();
    Sound.click();
    toast(settings.sfx ? '音效：開' : '音效：關');
  }
  function setTheme(name) {
    settings.theme = name;
    document.body.classList.toggle('theme-day', name === 'day');
    document.body.classList.toggle('theme-night', name === 'night');
    document.querySelector('meta[name="theme-color"]').content = name === 'day' ? '#ffd6e8' : '#5a4aa8';
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.theme === name));
    store.set('melonMerge.settings', settings);
    if (Sound.ready) Sound.playMusic(name);
  }

  function initAudio() {
    Sound.musicOn = settings.music;
    Sound.sfxOn = settings.sfx;
    Sound.init();
    Sound.playMusic(settings.theme);
  }

  // ---------------------------------------------------------------- 尺寸
  const mobileQuery = window.matchMedia('(max-width: 900px), (max-aspect-ratio: 1/1)');
  function resize() {
    const stage = $('stage');
    const availH = stage.clientHeight;
    const availW = mobileQuery.matches
      ? stage.clientWidth
      : Math.max(200, window.innerWidth - 2 * (230 + 28) - 60);
    scale = Math.max(0.3, Math.min(availW / LW, availH / LH));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = Math.floor(LW * scale) + 'px';
    canvas.style.height = Math.floor(LH * scale) + 'px';
    canvas.width = Math.round(LW * scale * dpr);
    canvas.height = Math.round(LH * scale * dpr);
  }

  // ---------------------------------------------------------------- 輸入
  function worldX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / scale - SIDE;
  }
  let dragging = false;
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse' || dragging) game.aimX = clamp(worldX(e.clientX), 0, BOX_W);
  });
  canvas.addEventListener('pointerdown', e => {
    if (game.state !== 'playing') return;
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    game.aimX = clamp(worldX(e.clientX), 0, BOX_W);
  });
  canvas.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    game.aimX = clamp(worldX(e.clientX), 0, BOX_W);
    if (e.pointerType !== 'mouse') game.mascotX = clamp(game.aimX, 0, BOX_W); // 觸控：放開的位置就是投放點
    drop();
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  const keys = { left: false, right: false };
  function updateKeyDir() { game.keyDir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); }
  window.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = true; updateKeyDir(); return; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = true; updateKeyDir(); return; }
    if (e.repeat) return;
    if (k === ' ' || k === 'ArrowDown' || k === 's' || k === 'S' || k === 'Enter') {
      e.preventDefault();
      if (game.state === 'playing') drop();
      else if (ui.ovHowto.classList.contains('show')) ui.ovHowto.classList.remove('show');
      else if (game.state === 'title') beginFromTitle();
      else if (game.state === 'paused') resume();
      else if (game.state === 'over' && ui.ovOver.classList.contains('show')) { Sound.click(); startGame(); }
    } else if (k === 'Escape' && ui.ovHowto.classList.contains('show')) {
      ui.ovHowto.classList.remove('show');
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      togglePause();
    } else if (k === 'm' || k === 'M') {
      toggleMusic();
    } else if (k === 'n' || k === 'N') {
      toggleSfx();
    } else if (k === 't' || k === 'T') {
      setTheme(settings.theme === 'day' ? 'night' : 'day');
    }
  });
  window.addEventListener('keyup', e => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    updateKeyDir();
  });

  function beginFromTitle() {
    initAudio();
    Sound.start();
    startGame();
  }

  function onClick(id, fn) {
    $(id).addEventListener('click', e => { e.currentTarget.blur(); fn(e); });
  }
  onClick('btn-start', beginFromTitle);
  onClick('btn-resume', () => { Sound.click(); resume(); });
  onClick('btn-restart', () => { Sound.click(); startGame(); });
  onClick('btn-again', () => { Sound.click(); startGame(); });
  onClick('btn-pause', () => { Sound.click(); togglePause(); });
  onClick('btn-music', () => { if (!Sound.ready) initAudio(); toggleMusic(); });
  onClick('btn-sfx', () => { if (!Sound.ready) initAudio(); toggleSfx(); });
  onClick('btn-theme', () => { Sound.click(); setTheme(settings.theme === 'day' ? 'night' : 'day'); });
  onClick('btn-howto', () => { if (!Sound.ready) initAudio(); Sound.click(); ui.ovHowto.classList.add('show'); });
  onClick('btn-howto-close', () => { Sound.click(); ui.ovHowto.classList.remove('show'); });
  onClick('btn-home', () => { Sound.click(); goHome(); });
  onClick('btn-over-home', () => { Sound.click(); goHome(); });
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { Sound.click(); setTheme(c.dataset.theme); }));

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- 主迴圈
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (game.state === 'playing' || game.state === 'over') {
      acc += dt;
      let n = 0;
      while (acc >= FIXED_DT && n < 5) { update(FIXED_DT); acc -= FIXED_DT; n++; }
      if (n === 5) acc = 0;
    }
    if (game.state !== 'paused') updateVisuals(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- 啟動
  buildRing();
  buildHowtoRing();
  refreshRing();
  $('cover-best').textContent = game.best;
  setTheme(settings.theme);
  applySoundButtons();
  updateScoreUI(false);
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  requestAnimationFrame(frame);

  // 方便除錯 / 測試
  window.__game = {
    game, world, FRUITS, makeFruit, startGame, drop, BOX_W, BOX_H,
    // 快轉 sec 秒（分頁在背景時 requestAnimationFrame 不會跑，測試用）
    advance(sec) {
      const n = Math.round(sec / FIXED_DT);
      for (let i = 0; i < n; i++) {
        if (game.state === 'playing' || game.state === 'over') update(FIXED_DT);
        updateVisuals(FIXED_DT);
      }
      render();
    },
  };
})();

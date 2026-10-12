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

  // 特殊道具：drop = 像水果一樣放下；instant = 按下立即生效
  const TOOLS = {
    bomb:    { name: '炸彈',     key: '1', mode: 'drop', r: 26, desc: '放下後碰到東西就爆炸，炸掉周圍的水果（哈密瓜和西瓜太大炸不掉）' },
    rainbow: { name: '彩虹星',   key: '2', mode: 'drop', r: 26, desc: '碰到哪一種水果，場上同種的水果全部消失' },
    broom:   { name: '魔法掃把', key: '3', mode: 'instant', desc: '立刻掃掉最上層的水果，快滿出來時救命用' },
    shake:   { name: '搖搖鈴',   key: '4', mode: 'instant', desc: '整箱水果跳起來重新排列，容易觸發連鎖合成' },
  };
  const TOOL_IDS = Object.keys(TOOLS);
  const TOOL_WEIGHTS = [0.3, 0.25, 0.25, 0.2];
  const TOOL_MAX = 3;          // 每種道具最多帶幾個
  const BUBBLE_R = 26;
  const BUBBLE_LIFE = 25;      // 道具泡泡幾秒後消失
  const BUBBLE_CHANCE = 0.6;   // 每陣水果雨夾帶道具泡泡的機率
  const REWARD_LEVEL = 6;      // 合成出水蜜桃（含）以上送一個道具
  const BOMB_RADIUS = 115;

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
  const toolSrc = id => `assets/tools/${id}.png`;
  const toolImgs = Object.fromEntries(TOOL_IDS.map(id => [id, loadImg(toolSrc(id))]));

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
    stats: { drops: 0, merges: 0, melons: 0, waves: 0, collected: 0, used: 0 },
    stage: 0,                  // 難度階段（0 ~ 4）
    waveTimer: WAVE_INTERVALS[0], // 距離下一陣水果雨的秒數
    waveQueue: [],             // 正在依序落下的水果
    tools: { bomb: 0, rainbow: 0, broom: 0, shake: 0 }, // 道具背包
    restoreLevel: null,        // 用完放下型道具後，要還給玩家的水果
    zaps: [],                  // 依序消除的水果（彩虹星、掃把）
    sweep: null,               // 掃把動畫
    grace: 0,                  // 道具生效後的保護時間（不判定超線）
  };

  // ---------------------------------------------------------------- 物理事件
  world.onPair = (a, b) => {
    if (game.state !== 'playing' || a.special || b.special || a.merging || b.merging) return;
    a.merging = b.merging = true;
    world.remove(a); world.remove(b);
    game.merges.push([a, b]);
  };
  world.onImpact = (a, b, speed) => {
    if (game.state !== 'playing' || speed < 160) return;
    const lvl = Math.max(0, b ? Math.max(a.level, b.level) : a.level);
    Sound.hit(lvl / MELON, clamp((speed - 160) / 900, 0.12, 1));
  };
  world.onContact = (a, b) => {
    if (game.state !== 'playing') return;
    for (const [s, o] of [[a, b], [b, a]]) {
      if (s.removed || o.removed) continue;
      if (s.special === 'rainbow') rainbowHit(s, o);
      // 玩家剛放下的水果撞到道具泡泡 → 泡泡破掉、收進背包
      else if (s.special === 'bubble' && !o.special && o.droppedAt != null && game.time - o.droppedAt < 3) popBubble(s);
    }
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
  const heldR = h => (h.tool ? TOOLS[h.tool].r : FRUITS[h.level].r);

  // ---------------------------------------------------------------- 遊戲流程
  function startGame() {
    world.clear();
    Object.assign(game, {
      state: 'playing', score: 0, held: { level: 0, t: 0 }, next: randLevel(), cooldown: 0,
      time: 0, merges: [], particles: [], popups: [], banner: null, shake: 0, combo: 0,
      lastMergeAt: -10, danger: 0, warnTimer: 0, culprit: null, discovered: new Set([0]),
      maxLevel: 0, stats: { drops: 0, merges: 0, melons: 0, waves: 0, collected: 0, used: 0 },
      stage: 0, waveTimer: WAVE_INTERVALS[0], waveQueue: [],
      tools: { bomb: 0, rainbow: 0, broom: 0, shake: 0 }, restoreLevel: null, zaps: [], sweep: null, grace: 0,
    });
    updateToolsUI();
    Sound.setStage(0);
    updateScoreUI(false);
    setNextUI();
    refreshRing();
    hideOverlays();
    Sound.duck(false);
  }

  function drop() {
    if (game.state !== 'playing' || !game.held) return;
    const h = game.held, r = heldR(h);
    const x = clamp(game.mascotX, r, BOX_W - r) + rand(-0.3, 0.3);
    if (h.tool) {
      const b = makeSpecial(h.tool, x, HOLD_TOP + r);
      b.vy = 60;
      game.restoreLevel = h.saved;   // 道具用完把原本手上的水果還回來
    } else {
      const b = makeFruit(x, heldY(h.level), h.level);
      b.vy = 60;
      b.droppedAt = game.time;
      world.add(b);
      game.stats.drops++;
      discover(h.level);
    }
    game.held = null;
    game.cooldown = DROP_COOLDOWN;
    updateToolsUI();
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
        // 旁邊的道具泡泡被合成震破
        for (const bb of world.bodies) {
          if (bb.special === 'bubble' && !bb.removed && Math.hypot(bb.x - x, bb.y - y) < FRUITS[lvl].r + bb.r + 24) popBubble(bb);
        }
        if (lvl >= REWARD_LEVEL) grantTool(randomTool(), x, y - FRUITS[lvl].r);
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

  // ---------------------------------------------------------------- 特殊道具
  const randomTool = () => TOOL_IDS[weightedPick(TOOL_WEIGHTS)];

  function makeSpecial(kind, x, y, tool) {
    const r = kind === 'bubble' ? BUBBLE_R : TOOLS[kind].r;
    const b = new Body(x, y, r, { level: -1 });
    b.special = kind;
    b.tool = tool || kind;
    b.age = 0;
    b.pop = 0;
    b.overT = 0;
    b.merging = false;
    if (kind === 'bubble') b.life = BUBBLE_LIFE;
    world.add(b);
    return b;
  }

  function useTool(id) {
    if (game.state !== 'playing') return;
    const T = TOOLS[id];
    // 手上已經拿著同一個道具 → 取消，放回背包
    if (game.held && game.held.tool === id) {
      game.tools[id]++;
      const saved = game.held.saved;
      game.held = saved != null ? { level: saved, t: 0 } : null;
      if (!game.held) game.cooldown = 0;
      updateToolsUI();
      Sound.click();
      return;
    }
    if (game.tools[id] <= 0) {
      nudgeTool(id);
      toast(`還沒有${T.name}：用水果撞破道具泡泡，或合成出水蜜桃以上就能拿到`);
      return;
    }
    if (T.mode === 'drop') {
      let saved = null;
      if (game.held) {
        if (game.held.tool) { game.tools[game.held.tool]++; saved = game.held.saved; }
        else saved = game.held.level;
      } else if (game.restoreLevel != null) {
        saved = game.restoreLevel;
        game.restoreLevel = null;
      }
      game.held = { tool: id, t: 0, saved };
      game.cooldown = 0;
      Sound.toolArm();
    } else if (id === 'broom') {
      if (!useBroom()) { toast('箱子裡沒有水果可以掃'); return; }
    } else if (id === 'shake') {
      useShake();
    }
    game.tools[id]--;
    game.stats.used++;
    updateToolsUI();
  }

  function grantTool(id, x, y) {
    if (game.tools[id] >= TOOL_MAX) {
      addScore(20, x, y);
      return;
    }
    game.tools[id]++;
    game.stats.collected++;
    game.popups.push({ x, y: y - 20, text: `獲得${TOOLS[id].name}！`, life: 0, max: 1.2, size: 20, color: '#ffe066' });
    flyToSlot(id, x, y);
    Sound.collect();
    if (!store.get('melonMerge.toolTip', false)) {
      store.set('melonMerge.toolTip', true);
      toast(`獲得${TOOLS[id].name}！點道具按鈕（或按數字鍵 ${TOOLS[id].key}）使用`);
    }
  }

  function popBubble(b) {
    if (b.removed) return;
    world.remove(b);
    game.particles.push({ type: 'ring', x: b.x, y: b.y, life: 0, max: 0.35, r0: b.r * 0.6, r1: b.r * 2, color: '#ffffff' });
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, 220);
      game.particles.push({ type: 'star', x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rand(0.4, 0.7), size: rand(4, 8), color: i % 2 ? '#bfe9ff' : '#ffd1ea', rot: rand(0, 6), spin: rand(-6, 6) });
    }
    Sound.bubblePop();
    grantTool(b.tool, b.x, b.y);
  }

  function explode(bomb) {
    world.remove(bomb);
    const R = BOMB_RADIUS, R2 = R * 2.6;
    let pts = 0;
    for (const b of world.bodies) {
      if (b.removed || b === bomb) continue;
      const dx = b.x - bomb.x, dy = b.y - bomb.y, d = Math.hypot(dx, dy) || 1;
      if (b.special === 'bubble') { if (d < R + b.r) popBubble(b); continue; }
      if (!b.special && b.level < 9 && d < R + b.r * 0.35) {
        b.merging = true;
        world.remove(b);
        burst(b.x, b.y, b.level, FRUITS[b.level].color);
        pts += b.level + 1;
      } else if (d < R2) {
        const f = 1 - d / R2, k = 1100 * f / Math.sqrt(1 + Math.max(0, b.level) * 0.5);
        b.vx += dx / d * k;
        b.vy += dy / d * k - 250 * f;
      }
    }
    game.particles.push({ type: 'ring', x: bomb.x, y: bomb.y, life: 0, max: 0.5, r0: 20, r1: R * 1.4, color: '#ffe066' });
    game.particles.push({ type: 'ring', x: bomb.x, y: bomb.y, life: 0, max: 0.4, r0: 10, r1: R, color: '#ffffff' });
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(200, 520);
      game.particles.push({ type: 'juice', x: bomb.x, y: bomb.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 0, max: rand(0.4, 0.8), size: rand(4, 9), color: ['#ffd84d', '#ff8fbf', '#b9a2ff', '#ffffff'][i % 4] });
    }
    if (pts) addScore(pts, bomb.x, bomb.y - 24);
    showBanner('轟！', '#ff7aa8');
    game.shake = 16;
    game.grace = Math.max(game.grace, 1.5);
    Sound.boom();
  }

  function rainbowHit(star, other) {
    if (star.used || other.removed) return;
    if (other.special === 'bubble') { popBubble(other); return; }
    if (other.special) return;
    star.used = true;
    world.remove(star);
    const L = other.level;
    const targets = world.bodies.filter(b => !b.removed && !b.special && !b.merging && b.level === L);
    targets.sort((a, b) => Math.hypot(a.x - star.x, a.y - star.y) - Math.hypot(b.x - star.x, b.y - star.y));
    targets.forEach((b, i) => {
      b.merging = true; // 排隊消除的水果不能再被合成
      game.zaps.push({ body: b, at: game.time + 0.1 + i * 0.08, kind: 'rainbow', n: i });
    });
    for (let i = 0; i < 6; i++) {
      game.particles.push({ type: 'ring', x: star.x, y: star.y, life: -i * 0.06, max: 0.5, r0: 10, r1: 90 + i * 20, color: ['#ff8fbf', '#ffb38a', '#ffe066', '#7fdcbc', '#8fc8ff', '#b9a2ff'][i] });
    }
    showBanner(`${FRUITS[L].name}全部消失！`, '#b892ff');
    game.grace = Math.max(game.grace, 1);
    Sound.rainbow();
  }

  function useBroom() {
    const fruits = world.bodies.filter(b => !b.removed && !b.special);
    if (!fruits.length) return false;
    const top = Math.min(...fruits.map(b => b.y - b.r));
    // 只掃最上層：最多 150px，且不超過水果堆高度的 45%
    const cut = top + Math.min(150, (BOX_H - top) * 0.45);
    const victims = fruits.filter(b => b.y < cut);
    if (!victims.length) victims.push(fruits.reduce((m, b) => (b.y - b.r < m.y - m.r ? b : m)));
    const dur = 0.7;
    game.sweep = { t: 0, dur, top: Math.max(top, -40), cut };
    victims.forEach(b => {
      b.merging = true;
      game.zaps.push({ body: b, at: game.time + 0.05 + ((b.x + 30) / (BOX_W + 60)) * dur, kind: 'sweep', n: 0 });
    });
    game.zaps.sort((a, b) => a.at - b.at);
    game.grace = Math.max(game.grace, 2);
    showBanner('掃乾淨！', '#5cc4a0');
    Sound.sweep();
    return true;
  }

  function useShake() {
    for (const b of world.bodies) {
      if (b.removed) continue;
      const k = 1 - Math.max(0, b.level) * 0.045;
      b.vy -= rand(650, 950) * k;
      b.vx += rand(-220, 220);
      b.w += rand(-6, 6);
    }
    game.shake = 14;
    game.grace = Math.max(game.grace, 2.8);
    showBanner('搖一搖！', '#ff9fc8');
    Sound.rattle();
  }

  function updateTools(dt) {
    for (const b of world.bodies) {
      if (b.removed || !b.special) continue;
      if (b.pop < 1) b.pop = Math.min(1, b.pop + dt / 0.3);
      if (b.special === 'bomb') {
        if (b.fuse == null && b.touched) b.fuse = 0.15;
        if (b.fuse != null && (b.fuse -= dt) <= 0) explode(b);
      } else if (b.special === 'bubble') {
        b.life -= dt;
        if (b.life <= 0) {
          world.remove(b);
          game.particles.push({ type: 'ring', x: b.x, y: b.y, life: 0, max: 0.3, r0: b.r * 0.5, r1: b.r * 1.5, color: '#ffffff' });
          Sound.plink(0);
        }
      }
    }
    // 依序消除（彩虹星、掃把）
    while (game.zaps.length && game.time >= game.zaps[0].at) {
      const z = game.zaps.shift();
      const b = z.body;
      if (b.removed) continue;
      world.remove(b);
      if (z.kind === 'rainbow') {
        burst(b.x, b.y, b.level, ['#ff8fbf', '#ffb38a', '#ffe066', '#7fdcbc', '#8fc8ff', '#b9a2ff'][z.n % 6]);
        addScore((b.level + 1) * 2, b.x, b.y - 10);
        Sound.zap(z.n);
      } else {
        burst(b.x, b.y, b.level, FRUITS[b.level].color);
        Sound.plink(Math.floor(b.x / 80));
      }
    }
  }

  function drawTool(id, x, y, r, angle, s) {
    const im = toolImgs[id];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    if (isReady(im)) {
      const box = r * (id === 'bomb' ? 2.75 : 2.35) * s;
      const k = box / Math.max(im.naturalWidth, im.naturalHeight);
      const w = im.naturalWidth * k, h = im.naturalHeight * k;
      const oy = id === 'bomb' ? -h * 0.14 : 0; // 炸彈的引信在上面，讓圓形本體對齊碰撞圓
      ctx.drawImage(im, -w / 2, -h / 2 + oy, w, h);
    } else {
      ctx.fillStyle = '#b9a2ff';
      ctx.beginPath(); ctx.arc(0, 0, r * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawGlow(x, y, r, rgb) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},0.45)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function drawSpecial(b) {
    const s = b.pop < 1 ? 0.6 + 0.4 * easeOutBack(b.pop) : 1;
    if (b.special === 'bubble') {
      const blink = b.life < 5 && Math.sin(game.clock * 14) < 0 ? 0.4 : 1;
      const wob = 1 + Math.sin(game.clock * 4 + b.id) * 0.05;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.translate(b.x, b.y);
      ctx.scale(wob * s, (2 - wob) * s);
      const g = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.35, b.r * 0.1, 0, 0, b.r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.55, 'rgba(225,240,255,0.35)');
      g.addColorStop(0.85, 'rgba(255,200,235,0.5)');
      g.addColorStop(1, 'rgba(185,160,255,0.85)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = blink;
      drawTool(b.tool, b.x, b.y, b.r * 0.62, Math.sin(game.clock * 2 + b.id) * 0.25, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.72 * s, -2.6, -1.9); ctx.stroke();
      ctx.restore();
    } else if (b.special === 'bomb') {
      const flash = b.fuse != null ? 1 + 0.25 * Math.abs(Math.sin(game.clock * 40)) : 1;
      if (b.fuse != null) drawGlow(b.x, b.y, b.r * 2.4, '255,90,120');
      drawTool('bomb', b.x, b.y, b.r, b.angle, s * flash);
    } else if (b.special === 'rainbow') {
      const hue = (game.clock * 120) % 360;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2);
      g.addColorStop(0, `hsla(${hue},100%,80%,0.55)`);
      g.addColorStop(1, `hsla(${hue},100%,80%,0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2); ctx.fill();
      drawTool('rainbow', b.x, b.y, b.r, b.angle, s);
    }
  }

  function drawSweep() {
    const sw = game.sweep;
    if (!sw) return;
    const t = sw.t / sw.dur;
    const x = lerp(-30, BOX_W + 30, t);
    const y = (sw.top + sw.cut) / 2;
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - t);
    ctx.fillStyle = '#fff6fb';
    ctx.fillRect(0, sw.top, x, sw.cut - sw.top);
    ctx.restore();
    drawTool('broom', x, y, 46, -0.6 + Math.sin(game.clock * 18) * 0.25, 1);
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
      const items = planWave();
      items.forEach((it, i) => game.waveQueue.push({ x: it.x, level: it.level, at: game.time + i * 0.12, i }));
      if (Math.random() < BUBBLE_CHANCE) {
        game.waveQueue.push({ bubble: true, x: rand(BUBBLE_R, BOX_W - BUBBLE_R), at: game.time + items.length * 0.12 + 0.1, i: items.length });
      }
      game.waveTimer += WAVE_INTERVALS[game.stage];
      game.stats.waves++;
      Sound.rain();
    }
    while (game.waveQueue.length && game.time >= game.waveQueue[0].at) {
      const it = game.waveQueue.shift();
      if (it.bubble) {
        const bb = makeSpecial('bubble', it.x, -BUBBLE_R - 8, randomTool());
        bb.vy = 120;
        Sound.plink(it.i);
        continue;
      }
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
    if (game.grace > 0) {
      game.grace -= dt;
      for (const b of world.bodies) b.overT = 0;
    }
    for (const b of world.bodies) {
      if (b.removed || b.special) continue;
      if (game.grace > 0) continue;
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
        if (game.restoreLevel != null) {
          game.held = { level: game.restoreLevel, t: 0 };
          game.restoreLevel = null;
        } else {
          game.held = { level: game.next, t: 0 };
          game.next = randLevel();
          setNextUI();
        }
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
    if (game.state === 'playing') updateTools(dt);
    if (game.state === 'playing') checkDanger(dt);
  }

  function updateVisuals(dt) {
    game.clock += dt;
    if (game.keyDir && (game.state === 'playing' || game.state === 'title')) {
      game.aimX = clamp(game.aimX + game.keyDir * 430 * dt, 0, BOX_W);
    }
    const r = game.held ? heldR(game.held) : 18;
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
    if (game.sweep) {
      game.sweep.t += dt;
      if (game.sweep.t > game.sweep.dur) game.sweep = null;
      else if (Math.random() < 0.7) {
        const sx = lerp(-30, BOX_W + 30, game.sweep.t / game.sweep.dur);
        game.particles.push({ type: 'star', x: sx + rand(-20, 20), y: rand(game.sweep.top, game.sweep.cut), vx: rand(-40, 40), vy: rand(-80, 20), life: 0, max: 0.6, size: rand(5, 9), color: Math.random() < 0.5 ? '#fff6a8' : '#ffc4e1', rot: rand(0, 6), spin: rand(-6, 6) });
      }
    }
    game.shake = Math.max(0, game.shake - dt * 22);
    updateToolHint();
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
      if (b.special) { drawSpecial(b); continue; }
      const s = b.pop < 1 ? 1 + 0.16 * Math.sin(b.pop * Math.PI) : 1;
      drawFruit(b.level, b.x, b.y, b.r, b.angle, s);
      if (b === game.culprit && game.state === 'over' && Math.sin(game.clock * 14) > 0) {
        ctx.strokeStyle = `rgba(${T.line},0.95)`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    drawWalls(T);
    drawSweep();
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
    const r = heldR(game.held);
    const x = clamp(game.mascotX, r, BOX_W - r);
    const yEnd = landingY(x);
    const y0 = HOLD_TOP + 2 * r;
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
      const h = game.held, r = heldR(h);
      const appear = Math.max(0.01, h.t < 0.28 ? easeOutBack(h.t / 0.28) : 1);
      if (h.tool) {
        drawGlow(x, HOLD_TOP + r + bob, r * 1.7, h.tool === 'bomb' ? '255,120,160' : '200,170,255');
        drawTool(h.tool, x, HOLD_TOP + r + bob, r, Math.sin(game.clock * 5) * 0.15, appear);
      } else {
        drawFruit(h.level, x, heldY(h.level) + bob, r, 0, appear);
      }
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
      if (p.life < 0) continue; // 延遲出現的粒子（life 從負數開始）還沒輪到
      const t = Math.min(1, p.life / p.max), a = 1 - t;
      ctx.globalAlpha = Math.max(0, a);
      if (p.type === 'juice') {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.size * (1 - t * 0.5)), 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'star') {
        drawStar(p.x, p.y, p.size * (1 - t * 0.3), p.rot, p.color);
      } else if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 5 * a;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, lerp(p.r0, p.r1, easeOutCubic(t))), 0, Math.PI * 2); ctx.stroke();
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

  const toolBtns = {};
  function buildToolsUI() {
    const box = $('tools');
    TOOL_IDS.forEach(id => {
      const T = TOOLS[id];
      const btn = document.createElement('button');
      btn.className = 'tool-btn empty';
      btn.title = `${T.name}（${T.key}）：${T.desc}`;
      btn.setAttribute('aria-label', T.name);
      btn.innerHTML = `<img src="${toolSrc(id)}" alt=""><b class="cnt">0</b><span class="tkey">${T.key}</span>`;
      btn.addEventListener('click', e => { e.currentTarget.blur(); useTool(id); });
      box.appendChild(btn);
      toolBtns[id] = btn;
    });
    const help = $('howto-tools');
    TOOL_IDS.forEach(id => {
      const row = document.createElement('div');
      row.className = 'howto-tool';
      row.innerHTML = `<img src="${toolSrc(id)}" alt=""><div><b>${TOOLS[id].name}</b>　${TOOLS[id].desc}</div>`;
      help.appendChild(row);
    });
  }

  function updateToolsUI(flashId) {
    TOOL_IDS.forEach(id => {
      const btn = toolBtns[id];
      if (!btn) return;
      const n = game.tools[id];
      btn.querySelector('.cnt').textContent = n;
      btn.classList.toggle('empty', n <= 0 && !(game.held && game.held.tool === id));
      btn.classList.toggle('armed', !!(game.held && game.held.tool === id));
      if (id === flashId) { btn.classList.remove('got'); void btn.offsetWidth; btn.classList.add('got'); }
    });
  }

  function nudgeTool(id) {
    const btn = toolBtns[id];
    btn.classList.remove('nope'); void btn.offsetWidth; btn.classList.add('nope');
  }

  // 道具從遊戲畫面飛進背包按鈕
  function flyToSlot(id, wx, wy) {
    const btn = toolBtns[id];
    const cr = canvas.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const sx = cr.left + (wx + SIDE) * scale, sy = cr.top + (wy + TOP) * scale;
    const img = document.createElement('img');
    img.src = toolSrc(id);
    img.className = 'fly-tool';
    img.style.left = sx + 'px';
    img.style.top = sy + 'px';
    document.body.appendChild(img);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transform = `translate(${br.left + br.width / 2 - sx}px, ${br.top + br.height / 2 - sy}px) scale(0.55)`;
    }));
    setTimeout(() => { img.remove(); updateToolsUI(id); }, 700);
  }

  // 危險時提示可以用的救命道具
  let hintOn = false;
  function updateToolHint() {
    const on = game.state === 'playing' && game.danger > 0.5;
    if (on === hintOn) return;
    hintOn = on;
    ['broom', 'bomb', 'shake'].forEach(id => toolBtns[id] && toolBtns[id].classList.toggle('hint', on));
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
    game.zaps.length = 0;
    game.sweep = null;
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
      `放下 ${game.stats.drops} 顆・合成 ${game.stats.merges} 次・撐過 ${game.stats.waves} 陣水果雨・` +
      `收集道具 ${game.stats.collected} 個・使用 ${game.stats.used} 次・大西瓜 ${game.stats.melons} 顆`;
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
    } else {
      const id = TOOL_IDS.find(t => TOOLS[t].key === k);
      if (id) useTool(id);
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
  let frameErrors = 0;
  function frame(now) {
    // 不論這一格發生什麼錯誤，都一定排下一格，遊戲不會整個停住
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      if (game.state === 'playing' || game.state === 'over') {
        acc += dt;
        let n = 0;
        while (acc >= FIXED_DT && n < 5) { update(FIXED_DT); acc -= FIXED_DT; n++; }
        if (n === 5) acc = 0;
      }
      if (game.state !== 'paused') updateVisuals(dt);
      render();
    } catch (err) {
      if (frameErrors++ < 5) console.error('[水果碰碰] 畫面更新錯誤：', err);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- 啟動
  buildRing();
  buildHowtoRing();
  buildToolsUI();
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
    game, world, FRUITS, makeFruit, startGame, drop, BOX_W, BOX_H, grantTool, useTool, makeSpecial,
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

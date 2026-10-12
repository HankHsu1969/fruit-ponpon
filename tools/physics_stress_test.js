// 無頭壓力測試 v2：使用引擎內建的 growTo，統計爆衝 / 穿透 / 效能
global.window = global;
require(process.argv[2] || require('path').join(__dirname, '../js/physics.js'));
const { Body, World } = window.Physics;
const R = [24, 31, 37, 43, 51, 58, 68, 80, 93, 110, 132];
let seed = +process.argv[3] || 1;
const SUB = +(process.argv[4] || 12);
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const W = 440, H = 580;
const world = new World({ width: W, height: H, gravity: 1650, substeps: SUB, restitution: 0.12, friction: 0.3, staticFriction: 0.55 });
const merges = [];
world.onPair = (a, b) => { if (a.merging || b.merging) return; a.merging = b.merging = true; world.remove(a); world.remove(b); merges.push([a, b]); };
const dt = 1 / 60;
let nextWave = 10, waves = 0; let t = 0, nextDrop = 0, drops = 0, mergeCount = 0, maxLevel = 0, melons = 0, steps = 0;
let maxOverlap = 0, restOverlap = 0, maxSpeedOld = 0, explosions = 0, nan = false, escaped = 0;
const t0 = process.hrtime.bigint();
for (; t < 900 && drops < 3000; t += dt) {
  if (t >= nextDrop) {
    const lvl = Math.floor(rnd() * 5), r = R[lvl];
    let x = r + rnd() * (W - 2 * r);
    const same = world.bodies.filter(b => b.level === lvl);
    if (same.length && rnd() < 0.8) x = Math.min(W - r, Math.max(r, same[Math.floor(rnd() * same.length)].x));
    const b = new Body(x, -100 + r, r, { level: lvl, vy: 60 }); b.age = 0;
    world.add(b); drops++; nextDrop = t + 1.5;
  }
  if (process.argv[5] === 'wave' && t >= nextWave) {
    const n = Math.min(6, 3 + Math.floor(t / 60)), slot = W / n;
    for (let i = 0; i < n; i++) {
      const u = rnd(), lvl = u < 0.55 ? 0 : u < 0.9 ? 1 : 2, r = R[lvl];
      const x = Math.min(W - r, Math.max(r, slot * (i + 0.5) + (rnd() - 0.5) * 0.5 * slot));
      const b = new Body(x, -r - 8, r, { level: lvl, vy: 120 }); b.age = 0; world.add(b);
    }
    waves++; nextWave += 10;
  }
  for (const b of world.bodies) b.age += dt;
  world.step(dt); steps++;
  for (const [a, b] of merges) {
    mergeCount++;
    const lvl = a.level + 1;
    if (lvl <= 10) {
      const nb = new Body((a.x + b.x) / 2, (a.y + b.y) / 2, R[lvl] * 0.5, { level: lvl, vx: (a.vx + b.vx) / 4, vy: (a.vy + b.vy) / 4 });
      nb.growTo(R[lvl], 0.2); nb.age = 0; world.add(nb); maxLevel = Math.max(maxLevel, lvl);
      if (lvl === 10) melons++;
    } else melons += 0;
  }
  merges.length = 0;
  const B = world.bodies.filter(b => !b.removed);
  for (const b of B) {
    if (!isFinite(b.x) || !isFinite(b.y)) nan = true;
    if (b.x < -1 || b.x > W + 1 || b.y > H + 1) escaped++;
    const sp = Math.hypot(b.vx, b.vy);
    if (b.age > 1.5 && b.y > 0) { maxSpeedOld = Math.max(maxSpeedOld, sp); if (sp > 1200) explosions++; }
  }
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const a = B[i], c = B[j];
    if (a.r < a.targetR || c.r < c.targetR) continue;
    const ov = a.r + c.r - Math.hypot(a.x - c.x, a.y - c.y);
    if (ov > maxOverlap) maxOverlap = ov;
    if (Math.hypot(a.vx, a.vy) < 40 && Math.hypot(c.vx, c.vy) < 40 && ov > restOverlap) restOverlap = ov;
  }
  let over = false;
  for (const b of B) { if (b.age > 1 && b.y - b.r < 0) { b.overT = (b.overT || 0) + dt; if (b.overT > 2.4) over = true; } else b.overT = 0; }
  if (over) break;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ waves, seed: process.argv[3], sub: SUB, simSec: +t.toFixed(0), drops, merges: mergeCount, maxLevel, melons, maxOverlap: +maxOverlap.toFixed(2), restOverlap: +restOverlap.toFixed(2), maxSpeedOld: +maxSpeedOld.toFixed(0), explosions, nan, escaped, msPerStep: +(ms / steps).toFixed(3) }));

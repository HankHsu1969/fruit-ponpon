/* ==========================================================================
 * physics.js — 圓形剛體物理引擎（XPBD small-steps）
 *
 * - 重力、圓與圓 / 圓與牆的碰撞
 * - 靜摩擦 / 動摩擦，摩擦會帶動旋轉（水果會滾動）
 * - 彈性係數、滾動阻力
 * - 每幀拆成多個子步驟（substeps），堆疊穩定、不會互相穿透
 *
 * 座標：x 向右、y 向下。箱子內部 x ∈ [0, width]，地板在 y = height，
 * 左右牆往上無限延伸（水果可以超出箱口）。
 * ========================================================================== */
(function (global) {
  'use strict';

  let nextId = 1;

  class Body {
    constructor(x, y, r, opts) {
      opts = opts || {};
      this.id = nextId++;
      this.x = x; this.y = y;
      this.px = x; this.py = y;          // 子步驟開始時的位置
      this.vx = opts.vx || 0; this.vy = opts.vy || 0;
      this.pvx = 0; this.pvy = 0; this.pw = 0; // 子步驟開始時的速度（算反彈用）
      this.angle = opts.angle || 0; this.prevAngle = this.angle;
      this.w = opts.w || 0;              // 角速度
      this.level = opts.level || 0;
      this.removed = false;
      this.touched = false;              // 是否曾經碰撞過
      this.setRadius(r);
      this.targetR = r;                  // 合成後的新水果會在子步驟中平滑長大到 targetR
      this.growRate = 0;                 // 每秒增加的半徑
    }
    growTo(r, seconds) {
      this.targetR = r;
      this.growRate = Math.max(1e-3, (r - this.r) / seconds);
    }
    setRadius(r) {
      this.r = r;
      this.m = r * r;                    // 2D 均勻密度：質量 ∝ 面積
      this.im = 1 / this.m;
      this.I = 0.5 * this.m * r * r;     // 實心圓盤轉動慣量
      this.iI = 1 / this.I;
    }
  }

  class World {
    constructor(opts) {
      this.width = opts.width;
      this.height = opts.height;
      this.gravity = opts.gravity != null ? opts.gravity : 1600;
      this.substeps = opts.substeps || 8;
      this.restitution = opts.restitution != null ? opts.restitution : 0.15;
      this.staticFriction = opts.staticFriction != null ? opts.staticFriction : 0.6;
      this.friction = opts.friction != null ? opts.friction : 0.35;
      this.rollingResistance = opts.rollingResistance != null ? opts.rollingResistance : 0.0025;
      this.airDrag = opts.airDrag != null ? opts.airDrag : 0.0002;
      this.maxSpeed = opts.maxSpeed || 2400;
      // 推開重疊時，最多只有這個速度（px/s）會轉成水果的實際速度
      this.maxDepenetration = opts.maxDepenetration || 600;
      this.bodies = [];
      this._contacts = [];
      this._pool = [];
      this.onPair = null;    // (a, b) 兩顆水果接觸時呼叫（用於合成）
      this.onImpact = null;  // (a, b|null, speed) 有明顯撞擊時呼叫（用於音效）
    }

    add(body) { this.bodies.push(body); return body; }
    remove(body) { body.removed = true; }
    clear() { this.bodies.length = 0; }

    step(dt) {
      if (this.bodies.some(b => b.removed)) {
        this.bodies = this.bodies.filter(b => !b.removed);
      }
      const h = dt / this.substeps;
      for (let s = 0; s < this.substeps; s++) this._substep(h);
    }

    _contact() {
      const c = this._pool[this._contacts.length] || (this._pool[this._contacts.length] = {});
      this._contacts.push(c);
      return c;
    }

    _substep(h) {
      const B = this.bodies;
      const g = this.gravity;
      const drag = 1 - this.airDrag;

      // 1) 積分：先存舊狀態，再用速度預測新位置
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (b.removed) continue;
        if (b.r < b.targetR) b.setRadius(Math.min(b.targetR, b.r + b.growRate * h));
        b.pvx = b.vx; b.pvy = b.vy; b.pw = b.w;
        b.vy += g * h;
        b.vx *= drag; b.vy *= drag;
        b.px = b.x; b.py = b.y; b.prevAngle = b.angle;
        b.cx = 0; b.cy = 0;              // 本子步驟的穿透修正量
        b.x += b.vx * h; b.y += b.vy * h;
        b.angle += b.w * h;
      }

      // 2) 位置約束：碰撞偵測 + 推開 + 靜摩擦
      this._contacts.length = 0;
      // sweep-and-prune：依左緣排序（幾乎已排序，插入排序很快）
      for (let i = 1; i < B.length; i++) {
        const b = B[i], key = b.x - b.r;
        let j = i - 1;
        while (j >= 0 && B[j].x - B[j].r > key) { B[j + 1] = B[j]; j--; }
        B[j + 1] = b;
      }
      for (let i = 0; i < B.length; i++) {
        const a = B[i];
        if (a.removed) continue;
        const maxX = a.x + a.r;
        for (let j = i + 1; j < B.length; j++) {
          const b = B[j];
          if (b.x - b.r > maxX) break;
          if (b.removed) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const rs = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rs * rs) continue;
          let d = Math.sqrt(d2), nx, ny;
          if (d < 1e-6) { nx = 0; ny = 1; d = 0; } else { nx = dx / d; ny = dy / d; }
          this._solvePosition(a, b, nx, ny, rs - d);
          if (this.onPair && a.level === b.level) {
            this.onPair(a, b);
            if (a.removed) break;
          }
        }
        if (a.removed) continue;
        // 牆壁與地板
        if (a.x - a.r < 0) this._solvePosition(a, null, -1, 0, a.r - a.x);
        if (a.x + a.r > this.width) this._solvePosition(a, null, 1, 0, a.x + a.r - this.width);
        if (a.y + a.r > this.height) this._solvePosition(a, null, 0, 1, a.y + a.r - this.height);
      }

      // 3) 由位置差推回速度。穿透修正量太大時只把一部分算進速度，
      //    重疊會被完全推開，但不會因此把水果彈飛。
      const ih = 1 / h, vmax = this.maxSpeed, lim = this.maxDepenetration * h;
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (b.removed) continue;
        let dx = b.x - b.px, dy = b.y - b.py;
        const c = Math.hypot(b.cx, b.cy);
        if (c > lim) { const k = 1 - lim / c; dx -= b.cx * k; dy -= b.cy * k; }
        b.vx = dx * ih;
        b.vy = dy * ih;
        b.w = (b.angle - b.prevAngle) * ih;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > vmax) { b.vx *= vmax / sp; b.vy *= vmax / sp; }
      }

      // 4) 速度修正：動摩擦、反彈、滾動阻力
      const C = this._contacts;
      const bounceThreshold = 3 * g * h;
      for (let k = 0; k < C.length; k++) {
        const c = C[k], a = c.a, b = c.b;
        if (a.removed || (b && b.removed)) continue;
        const nx = c.nx, ny = c.ny;
        const wa = a.im, wb = b ? b.im : 0;

        // 接觸點相對速度（A 相對於 B），vn > 0 表示互相靠近
        let vx = a.vx - a.w * c.ray, vy = a.vy + a.w * c.rax;
        let pvx = a.pvx - a.pw * c.ray, pvy = a.pvy + a.pw * c.rax;
        if (b) {
          vx -= b.vx - b.w * c.rby; vy -= b.vy + b.w * c.rbx;
          pvx -= b.pvx - b.pw * c.rby; pvy -= b.pvy + b.pw * c.rbx;
        }
        const vn = vx * nx + vy * ny;
        const pvn = pvx * nx + pvy * ny;

        // 動摩擦（庫倫：切向衝量 ≤ μ × 法向衝量）
        const vtx = vx - vn * nx, vty = vy - vn * ny;
        const vt = Math.hypot(vtx, vty);
        if (vt > 1e-6) {
          const kt = 3 * wa + (b ? 3 * wb : 0); // 圓：1/m + r²/I = 3/m
          const J = Math.min(vt / kt, this.friction * c.lambda * ih);
          const Px = -vtx / vt * J, Py = -vty / vt * J;
          a.vx += Px * wa; a.vy += Py * wa;
          a.w += (c.rax * Py - c.ray * Px) * a.iI;
          if (b) {
            b.vx -= Px * wb; b.vy -= Py * wb;
            b.w -= (c.rbx * Py - c.rby * Px) * b.iI;
          }
        }

        // 反彈：把法向相對速度設為 -e × 撞擊前速度（慢速接觸則為 0，避免抖動）
        const target = pvn > bounceThreshold ? -this.restitution * pvn : 0;
        const Jn = (target - vn) / (wa + wb);
        a.vx += nx * Jn * wa; a.vy += ny * Jn * wa;
        if (b) { b.vx -= nx * Jn * wb; b.vy -= ny * Jn * wb; }

        // 滾動阻力，讓水果最後會停下來
        const rr = 1 - this.rollingResistance;
        a.w *= rr;
        if (b) b.w *= rr;

        if (pvn > 120 && this.onImpact) this.onImpact(a, b, pvn);
      }
    }

    // 法向推開（按反質量比例分配）＋ 靜摩擦（抵消接觸點的切向滑動）
    _solvePosition(a, b, nx, ny, pen) {
      const wa = a.im, wb = b ? b.im : 0;
      const lambda = pen / (wa + wb);
      a.x -= nx * lambda * wa; a.y -= ny * lambda * wa;
      a.cx -= nx * lambda * wa; a.cy -= ny * lambda * wa;
      if (b) {
        b.x += nx * lambda * wb; b.y += ny * lambda * wb;
        b.cx += nx * lambda * wb; b.cy += ny * lambda * wb;
      }
      a.touched = true;
      if (b) b.touched = true;

      const rax = nx * a.r, ray = ny * a.r;
      const rbx = b ? -nx * b.r : 0, rby = b ? -ny * b.r : 0;

      // 本子步驟中接觸點的相對位移（含旋轉造成的位移）
      const dta = a.angle - a.prevAngle;
      let dpx = (a.x - a.px) - dta * ray;
      let dpy = (a.y - a.py) + dta * rax;
      if (b) {
        const dtb = b.angle - b.prevAngle;
        dpx -= (b.x - b.px) - dtb * rby;
        dpy -= (b.y - b.py) + dtb * rbx;
      }
      const dn = dpx * nx + dpy * ny;
      const tx = dpx - dn * nx, ty = dpy - dn * ny;
      const tl = Math.hypot(tx, ty);
      if (tl > 1e-9) {
        const k = 1 / (3 * wa + (b ? 3 * wb : 0));
        if (tl * k < this.staticFriction * lambda) {
          const Px = -tx * k, Py = -ty * k;
          a.x += Px * wa; a.y += Py * wa;
          a.angle += (rax * Py - ray * Px) * a.iI;
          if (b) {
            b.x -= Px * wb; b.y -= Py * wb;
            b.angle -= (rbx * Py - rby * Px) * b.iI;
          }
        }
      }

      const c = this._contact();
      c.a = a; c.b = b; c.nx = nx; c.ny = ny; c.lambda = lambda;
      c.rax = rax; c.ray = ray; c.rbx = rbx; c.rby = rby;
    }
  }

  global.Physics = { Body, World };
})(window);

/* ==========================================================================
 * audio.js — Web Audio 即時合成的背景音樂與音效（不需要任何音檔）
 *
 * 音樂：白天主題（馬林巴琴輕快曲，112 BPM）、夜晚主題（Lo-fi 電鋼琴，78 BPM）
 * 音效：投放、碰撞、合成（越大的水果音越華麗、連鎖合成音階上升）、
 *       大西瓜慶祝、危險警告、遊戲結束、新紀錄、按鈕
 * ========================================================================== */
(function (global) {
  'use strict';

  const AC = global.AudioContext || global.webkitAudioContext;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---------------------------------------------------------------- 曲目資料
  // 旋律格式：[小節內的 16 分音符位置, MIDI 音高, 長度(16分音符數)]
  const DAY = {
    bpm: 112,
    // 16 小節：A 段 8 小節 + B 段 8 小節
    chords: [
      'C', 'Am', 'F', 'G', 'C', 'Am', 'Dm|G', 'C',
      'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C',
    ],
    melody: [
      [[0, 76, 2], [2, 79, 2], [4, 84, 3], [8, 83, 2], [10, 81, 2], [12, 79, 4]],
      [[0, 81, 2], [2, 79, 2], [4, 76, 2], [6, 79, 2], [8, 81, 6], [14, 79, 2]],
      [[0, 77, 2], [2, 81, 2], [4, 84, 3], [8, 86, 2], [10, 84, 2], [12, 81, 4]],
      [[0, 79, 2], [2, 81, 2], [4, 83, 2], [6, 86, 2], [8, 83, 4], [12, 79, 4]],
      [[0, 76, 2], [2, 79, 2], [4, 84, 3], [8, 88, 2], [10, 86, 2], [12, 84, 4]],
      [[0, 81, 3], [4, 84, 2], [6, 81, 2], [8, 79, 4], [12, 76, 4]],
      [[0, 77, 2], [2, 81, 2], [4, 79, 2], [6, 77, 2], [8, 76, 2], [10, 74, 2], [12, 79, 4]],
      [[0, 72, 4], [4, 76, 2], [6, 79, 2], [8, 84, 6]],
      [[0, 81, 4], [4, 84, 4], [8, 81, 2], [10, 79, 2], [12, 77, 4]],
      [[0, 79, 4], [4, 83, 4], [8, 86, 4], [12, 83, 4]],
      [[0, 83, 2], [2, 79, 2], [4, 76, 4], [8, 79, 2], [10, 83, 2], [12, 88, 4]],
      [[0, 84, 6], [6, 83, 2], [8, 81, 8]],
      [[0, 77, 2], [2, 81, 2], [4, 84, 2], [6, 81, 2], [8, 86, 4], [12, 84, 4]],
      [[0, 83, 2], [2, 84, 2], [4, 86, 2], [6, 88, 2], [8, 86, 4], [12, 83, 4]],
      [[0, 84, 2], [2, 79, 2], [4, 76, 2], [6, 79, 2], [8, 84, 4], [12, 88, 4]],
      [[0, 84, 8]],
    ],
  };
  const DAY_CHORDS = {
    C: { tones: [60, 64, 67], bass: 48 },
    Am: { tones: [57, 60, 64], bass: 45 },
    F: { tones: [57, 60, 65], bass: 41 },
    G: { tones: [55, 59, 62], bass: 43 },
    Dm: { tones: [57, 62, 65], bass: 38 },
    Em: { tones: [55, 59, 64], bass: 40 },
  };

  const NIGHT = {
    bpm: 78,
    chords: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7', 'Fmaj7', 'Em7', 'Dm7', 'Cmaj7'],
    melody: [
      [[2, 72, 2], [4, 76, 4], [10, 79, 2], [12, 77, 4]],
      [[0, 76, 6], [8, 74, 2], [10, 72, 2], [12, 71, 4]],
      [[2, 69, 2], [4, 72, 4], [8, 77, 4], [12, 76, 2], [14, 74, 2]],
      [[0, 72, 8], [12, 67, 4]],
      [[0, 81, 4], [4, 79, 2], [6, 77, 2], [8, 76, 4], [12, 77, 4]],
      [[0, 79, 6], [8, 76, 4], [12, 74, 4]],
      [[0, 72, 2], [2, 74, 2], [4, 77, 4], [8, 81, 4], [12, 79, 4]],
      [[0, 76, 12]],
    ],
  };
  const NIGHT_CHORDS = {
    Fmaj7: { tones: [53, 57, 60, 64], bass: 41 },
    Em7: { tones: [52, 55, 59, 62], bass: 40 },
    Dm7: { tones: [50, 53, 57, 60], bass: 38 },
    Cmaj7: { tones: [48, 52, 55, 59], bass: 36 },
  };

  // 各階段的速度倍率與移調（半音）
  const STAGE_TEMPO = [1, 1.08, 1.17, 1.27, 1.38];
  const STAGE_KEY = [0, 1, 2, 3, 5];

  // ---------------------------------------------------------------- 引擎
  const Sound = {
    ctx: null,
    musicOn: true,
    sfxOn: true,
    musicLevel: 0.42,
    sfxLevel: 0.9,
    _song: null,
    _timer: null,
    _ducked: false,

    get ready() { return !!this.ctx; },

    // 必須在使用者手勢（點擊）中呼叫
    init() {
      if (!AC) return;
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const ctx = this.ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.2;
      comp.connect(ctx.destination);

      this.master = ctx.createGain(); this.master.gain.value = 0.9;
      this.master.connect(comp);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? this.musicLevel : 0;
      this.musicBus.connect(this.master);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? this.sfxLevel : 0;
      this.sfxBus.connect(this.master);

      // 共用殘響
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(2.4, 3.2);
      const wet = ctx.createGain(); wet.gain.value = 0.32;
      this.reverb.connect(wet); wet.connect(this.master);

      this.musicVerb = ctx.createGain(); this.musicVerb.gain.value = 0.35;
      this.musicVerb.connect(this.reverb);
      this.sfxVerb = ctx.createGain(); this.sfxVerb.gain.value = 0.25;
      this.sfxVerb.connect(this.reverb);
      // 音樂/音效開關也要控制殘響送出量
      this.musicBus.connect(this.musicVerb);
      this.sfxBus.connect(this.sfxVerb);

      // 白噪音
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
      });
    },

    _impulse(seconds, decay) {
      const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    },

    setMusic(on) {
      this.musicOn = on;
      if (this.ctx) this._fade(this.musicBus.gain, on ? this._musicTarget() : 0, 0.3);
    },
    setSfx(on) {
      this.sfxOn = on;
      if (this.ctx) this._fade(this.sfxBus.gain, on ? this.sfxLevel : 0, 0.05);
    },
    duck(on) { // 暫停時把音樂調小
      this._ducked = on;
      if (this.ctx && this.musicOn) this._fade(this.musicBus.gain, this._musicTarget(), 0.4);
    },
    _musicTarget() { return this._ducked ? this.musicLevel * 0.35 : this.musicLevel; },
    _fade(param, value, time) {
      const t = this.ctx.currentTime;
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(value, t + time);
    },

    // ------------------------------------------------------------ 合成器零件
    _env(gainNode, t, peak, attack, decay, sustain, release) {
      const g = gainNode.gain;
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(peak, t + attack);
      if (sustain != null) {
        g.setTargetAtTime(peak * sustain, t + attack, decay / 3);
        g.setTargetAtTime(0.0001, t + attack + decay, release / 4);
      } else {
        g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      }
    },

    _osc(type, freq, t, dur, dest) {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
      return o;
    },

    _noise(t, dur, gain, ftype, freq, Q, dest) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = ftype; f.frequency.value = freq; f.Q.value = Q || 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
      return { src, filter: f, gain: g };
    },

    // 馬林巴琴：基音 + 第 4 泛音（敲擊感）
    marimba(midi, t, vel, dest, len) {
      const ctx = this.ctx, f = mtof(midi);
      const g = ctx.createGain(); g.connect(dest || this.musicBus);
      const decay = len || Math.max(0.35, 1.1 - (midi - 60) * 0.02);
      this._env(g, t, 0.32 * vel, 0.003, decay);
      this._osc('sine', f, t, decay, g);
      const g2 = ctx.createGain(); g2.connect(dest || this.musicBus);
      this._env(g2, t, 0.09 * vel, 0.002, 0.07);
      this._osc('sine', f * 3.93, t, 0.1, g2);
      const g3 = ctx.createGain(); g3.connect(dest || this.musicBus);
      this._env(g3, t, 0.05 * vel, 0.002, decay * 0.5);
      this._osc('triangle', f * 2, t, decay * 0.5, g3);
    },

    // 鐘聲：非整數泛音
    bell(midi, t, vel, dest, len) {
      const ctx = this.ctx, f = mtof(midi);
      const parts = [[1, 1, 1], [2.76, 0.45, 0.55], [5.4, 0.22, 0.32], [8.93, 0.1, 0.2]];
      const L = len || 1.4;
      for (const [ratio, amp, dec] of parts) {
        const g = ctx.createGain(); g.connect(dest || this.sfxBus);
        this._env(g, t, 0.22 * vel * amp, 0.002, L * dec);
        this._osc('sine', f * ratio, t, L * dec, g);
      }
    },

    // 撥弦和弦（三角波 + 低通）
    pluck(midi, t, vel, dest) {
      const ctx = this.ctx, f = mtof(midi);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.25);
      const g = ctx.createGain();
      lp.connect(g); g.connect(dest || this.musicBus);
      this._env(g, t, 0.11 * vel, 0.004, 0.32);
      this._osc('triangle', f, t, 0.35, lp);
    },

    bass(midi, t, dur, vel, dest) {
      const ctx = this.ctx, f = mtof(midi);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
      const g = ctx.createGain();
      lp.connect(g); g.connect(dest || this.musicBus);
      this._env(g, t, 0.34 * vel, 0.01, dur * 0.9, 0.6, 0.12);
      this._osc('triangle', f, t, dur + 0.15, lp);
      this._osc('sine', f, t, dur + 0.15, lp);
    },

    // FM 電鋼琴
    epiano(midi, t, dur, vel, dest) {
      const ctx = this.ctx, f = mtof(midi);
      const out = ctx.createGain(); out.connect(dest || this.musicBus);
      this._env(out, t, 0.12 * vel, 0.006, Math.min(dur, 2.2), 0.35, 0.5);
      const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
      const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f;
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(f * 1.6, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.6);
      mod.connect(idx); idx.connect(car.frequency); car.connect(out);
      const end = t + dur + 0.8;
      car.start(t); mod.start(t); car.stop(end); mod.stop(end);
    },

    kick(t, vel, dest) {
      const ctx = this.ctx;
      const g = ctx.createGain(); g.connect(dest || this.musicBus);
      this._env(g, t, 0.5 * vel, 0.002, 0.32);
      const o = this._osc('sine', 130, t, 0.35, g);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    },
    snare(t, vel, dest) {
      this._noise(t, 0.16, 0.16 * vel, 'bandpass', 1900, 0.8, dest || this.musicBus);
      const g = this.ctx.createGain(); g.connect(dest || this.musicBus);
      this._env(g, t, 0.1 * vel, 0.002, 0.08);
      this._osc('triangle', 210, t, 0.1, g);
    },
    hat(t, vel, dest, open) {
      this._noise(t, open ? 0.18 : 0.045, 0.06 * vel, 'highpass', 7500, 0.7, dest || this.musicBus);
    },
    shaker(t, vel, dest) {
      this._noise(t, 0.07, 0.035 * vel, 'bandpass', 6200, 1.2, dest || this.musicBus);
    },

    // ------------------------------------------------------------ 音樂排程
    playMusic(theme) {
      if (!this.ctx) return;
      const song = theme === 'night' ? NIGHT : DAY;
      if (this._song === song && this._timer) return;
      this.stopMusic();
      this._song = song;
      this._bar = 0; this._step = 0;
      this._next = this.ctx.currentTime + 0.12;
      this._timer = setInterval(() => this._schedule(), 25);
      this._schedule();
    },
    stopMusic() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      this._song = null;
    },
    // 難度階段（0 ~ 4）：每升一階，速度變快、升調，並加入更多樂器層
    _stage: 0,
    setStage(stage) { this._stage = Math.max(0, Math.min(STAGE_TEMPO.length - 1, stage)); },

    _schedule() {
      const song = this._song;
      if (!song || !this.ctx) return;
      const sd = 60 / (song.bpm * STAGE_TEMPO[this._stage]) / 4; // 16 分音符長度
      const horizon = this.ctx.currentTime + 0.15;
      // 分頁切回時避免一次補播一大串
      if (this._next < this.ctx.currentTime - 0.2) this._next = this.ctx.currentTime + 0.05;
      while (this._next < horizon) {
        if (song === DAY) this._dayStep(this._bar, this._step, this._next, sd);
        else this._nightStep(this._bar, this._step, this._next, sd);
        this._next += sd;
        if (++this._step >= 16) {
          this._step = 0;
          this._bar = (this._bar + 1) % song.chords.length;
        }
      }
    },

    _dayStep(bar, step, t, sd) {
      const S = this._stage, k = STAGE_KEY[S];
      const parts = DAY.chords[bar].split('|');
      const chord = DAY_CHORDS[parts.length > 1 && step >= 8 ? parts[1] : parts[0]];
      // 旋律
      for (const [s, m, len] of DAY.melody[bar]) {
        if (s === step) this.marimba(m + k, t, 0.85, null, Math.max(0.3, len * sd * 1.6));
      }
      // 低音：第 1、3 拍（根音 / 五度）
      if (step === 0) this.bass(chord.bass + k, t, sd * 6, 1);
      if (step === 8) this.bass(chord.bass + 7 + k, t, sd * 6, 0.85);
      // 和弦：反拍撥奏
      if (step === 4 || step === 12) {
        chord.tones.forEach((m, i) => this.pluck(m + 12 + k, t + i * 0.012, 0.9));
      }
      if (step === 6 || step === 14) chord.tones.forEach(m => this.pluck(m + 12 + k, t, 0.45));
      // 鼓
      const kick = S >= 3 ? step % 4 === 0 : (step === 0 || step === 8 || (step === 10 && bar % 2 === 1));
      if (kick) this.kick(t, 0.75);
      if (step === 4 || step === 12) this.snare(t, 0.45);
      if (step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.9 : 0.5);
      if (step % 2 === 1) this.shaker(t, 0.6);
      if (bar % 4 === 3 && step === 14) this.hat(t, 0.8, null, true);
      // 階段 1：16 分音符的腳踏鈸
      if (S >= 1 && step % 2 === 1) this.hat(t, 0.4);
      // 階段 2：高音琶音對位
      if (S >= 2 && step % 2 === 0) this.pluck(chord.tones[(step / 2) % chord.tones.length] + 24 + k, t, 0.32);
      // 階段 3：每 4 小節的小鼓過門
      if (S >= 3 && bar % 4 === 3 && step >= 12) this.snare(t, 0.25 + (step - 12) * 0.1);
      // 階段 4：八分音符低音推進
      if (S >= 4 && step % 2 === 0 && step % 8 !== 0) this.bass(chord.bass + 12 + k, t, sd * 1.5, 0.45);
    },

    _nightStep(bar, step, t, sd) {
      const S = this._stage, k = STAGE_KEY[S];
      const chord = NIGHT_CHORDS[NIGHT.chords[bar]];
      const swing = step % 2 === 1 ? sd * 0.28 : 0; // 搖擺節奏
      const tt = t + swing;
      // 電鋼琴和弦：第 1 拍長音，第 3 拍後的反拍再按一次
      if (step === 0) chord.tones.forEach((m, i) => this.epiano(m + 12 + k, t + i * 0.018, sd * 9, 0.8));
      if (step === 11) chord.tones.slice(1).forEach((m, i) => this.epiano(m + 12 + k, tt + i * 0.015, sd * 4, 0.45));
      // 旋律（鐘聲）
      for (const [s, m, len] of NIGHT.melody[bar]) {
        if (s === step) this.bell(m + k, tt, 0.55, this.musicBus, Math.max(0.8, len * sd * 2));
      }
      // 低音
      if (step === 0) this.bass(chord.bass + k, t, sd * 7, 1);
      if (step === 10) this.bass(chord.bass + 12 + k, tt, sd * 2, 0.6);
      if (step === 12) this.bass(chord.bass + 7 + k, t, sd * 4, 0.8);
      // 鼓（輕柔）
      const kick = S >= 3 ? step % 4 === 0 || step === 10 : (step === 0 || step === 10 || (step === 7 && bar % 2 === 1));
      if (kick) this.kick(tt, 0.65);
      if (step === 4 || step === 12) this.snare(t, 0.35);
      if (step % 2 === 0) this.hat(tt, 0.45);
      if (step % 2 === 1) this.hat(tt, 0.25);
      // 階段 1：沙鈴
      if (S >= 1 && step % 2 === 1) this.shaker(tt, 0.5);
      // 階段 2：高音琶音
      if (S >= 2 && step % 2 === 0) this.pluck(chord.tones[(step / 2) % chord.tones.length] + 24 + k, tt, 0.28);
      // 階段 3：小鼓過門
      if (S >= 3 && bar % 4 === 3 && step >= 12) this.snare(t, 0.2 + (step - 12) * 0.08);
      // 階段 4：八分音符低音推進
      if (S >= 4 && step % 2 === 0 && step % 8 !== 0) this.bass(chord.bass + 12 + k, tt, sd * 1.5, 0.4);
    },

    // ------------------------------------------------------------ 音效
    _now() { return this.ctx.currentTime + 0.005; },
    _can() { return this.ctx && this.sfxOn; },

    drop() {
      if (!this._can()) return;
      const t = this._now(), ctx = this.ctx;
      const g = ctx.createGain(); g.connect(this.sfxBus);
      this._env(g, t, 0.22, 0.004, 0.12);
      const o = this._osc('sine', 680, t, 0.13, g);
      o.frequency.exponentialRampToValueAtTime(240, t + 0.11);
      this._noise(t, 0.08, 0.05, 'highpass', 3000, 0.7, this.sfxBus);
    },

    _lastHit: 0,
    hit(size, strength) { // size, strength ∈ [0,1]
      if (!this._can()) return;
      const t = this._now();
      if (t - this._lastHit < 0.045) return;
      this._lastHit = t;
      const ctx = this.ctx;
      const f = 230 - size * 150;
      const g = ctx.createGain(); g.connect(this.sfxBus);
      this._env(g, t, 0.32 * strength, 0.002, 0.14 + size * 0.1);
      const o = this._osc('sine', f, t, 0.3, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.12);
      this._noise(t, 0.06, 0.08 * strength, 'lowpass', 900, 0.7, this.sfxBus);
    },

    merge(level, combo) {
      if (!this._can()) return;
      const t = this._now(), ctx = this.ctx;
      const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98, 100, 103];
      const note = scale[Math.min(scale.length - 1, level + Math.min(combo, 3))];
      const f = mtof(note);
      // 「啵」的泡泡聲
      const g = ctx.createGain(); g.connect(this.sfxBus);
      this._env(g, t, 0.34, 0.002, 0.09);
      const o = this._osc('sine', f * 0.35, t, 0.1, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.06);
      // 鐘聲
      this.bell(note, t + 0.025, 0.75, this.sfxBus, 0.9 + level * 0.08);
      if (level >= 4) this.bell(note + 7, t + 0.08, 0.45, this.sfxBus, 1.0);
      if (level >= 6) {
        this.bell(note + 12, t + 0.14, 0.4, this.sfxBus, 1.2);
        this.marimba(note - 24, t, 0.9, this.sfxBus, 0.8);
      }
      if (level >= 8) {
        this.kick(t, 0.9, this.sfxBus);
        const sh = this._noise(t, 0.7, 0.05, 'highpass', 6500, 0.7, this.sfxBus);
        sh.gain.gain.setValueAtTime(0.0001, t);
        sh.gain.gain.linearRampToValueAtTime(0.05, t + 0.25);
        sh.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      }
    },

    watermelon() {
      if (!this._can()) return;
      const t = this._now();
      const arp = [72, 76, 79, 84, 88, 91, 96];
      arp.forEach((m, i) => this.marimba(m, t + i * 0.06, 1, this.sfxBus, 0.6));
      [84, 88, 91, 96].forEach((m, i) => this.bell(m, t + 0.45 + i * 0.02, 0.7, this.sfxBus, 2.2));
      this.kick(t, 1, this.sfxBus);
      this.kick(t + 0.45, 1, this.sfxBus);
      const sh = this._noise(t + 0.4, 1.6, 0.06, 'highpass', 7000, 0.7, this.sfxBus);
      sh.gain.gain.setValueAtTime(0.0001, t + 0.4);
      sh.gain.gain.linearRampToValueAtTime(0.06, t + 0.6);
      sh.gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    },

    // 水果雨落下：上行鐘聲 + 沙鈴
    rain() {
      if (!this._can()) return;
      const t = this._now();
      [76, 81, 86, 91].forEach((m, i) => this.bell(m, t + i * 0.09, 0.42, this.sfxBus, 0.9));
      this.shaker(t, 1.2, this.sfxBus);
      this.shaker(t + 0.18, 1.2, this.sfxBus);
      this.shaker(t + 0.36, 1.2, this.sfxBus);
    },

    // 進入下一階段：快速上行琶音
    levelUp() {
      if (!this._can()) return;
      const t = this._now();
      [72, 76, 79, 84, 88, 91].forEach((m, i) => this.marimba(m, t + i * 0.055, 1, this.sfxBus, 0.5));
      this.bell(96, t + 0.35, 0.6, this.sfxBus, 1.4);
    },

    // 水果雨落下的「噗」聲，依序升高
    plink(i) {
      if (!this._can()) return;
      const t = this._now(), ctx = this.ctx;
      const f = mtof(84 + [0, 2, 4, 7, 9, 12][i % 6]);
      const g = ctx.createGain(); g.connect(this.sfxBus);
      this._env(g, t, 0.17, 0.002, 0.12);
      const o = this._osc('sine', f * 0.55, t, 0.14, g);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    },

    warn() {
      if (!this._can()) return;
      const t = this._now(), ctx = this.ctx;
      [[988, 0], [740, 0.11]].forEach(([f, d]) => {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
        const g = ctx.createGain(); lp.connect(g); g.connect(this.sfxBus);
        this._env(g, t + d, 0.07, 0.004, 0.09);
        this._osc('square', f, t + d, 0.1, lp);
      });
    },

    gameOver() {
      if (!this._can()) return;
      const t = this._now() + 0.05;
      [79, 76, 72, 67, 64].forEach((m, i) => this.marimba(m, t + i * 0.17, 1, this.sfxBus, 0.8));
      this.bell(48, t + 0.9, 0.8, this.sfxBus, 2.5);
      this.bell(55, t + 0.92, 0.5, this.sfxBus, 2.5);
    },

    newRecord() {
      if (!this._can()) return;
      const t = this._now() + 0.1;
      [72, 76, 79, 84, 88, 91, 96, 100].forEach((m, i) => this.bell(m, t + i * 0.07, 0.6, this.sfxBus, 1.2));
    },

    click() {
      if (!this._can()) return;
      const t = this._now(), ctx = this.ctx;
      const g = ctx.createGain(); g.connect(this.sfxBus);
      this._env(g, t, 0.14, 0.002, 0.06);
      const o = this._osc('triangle', 1100, t, 0.07, g);
      o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
    },

    start() {
      if (!this._can()) return;
      const t = this._now();
      [72, 79, 84, 88].forEach((m, i) => this.bell(m, t + i * 0.08, 0.6, this.sfxBus, 1.0));
    },
  };

  global.Sound = Sound;
})(window);

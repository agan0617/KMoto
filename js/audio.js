// 音效（規格 9.3）：全部用 Web Audio 即時合成。
export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = 0.7;
    this.started = false;
  }

  start() {
    if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol * 0.6; this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.connect(this.master);
    // 噪音緩衝
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 引擎：鋸齒＋方波 → 低通
    this.eng = { g: c.createGain(), f: c.createBiquadFilter(), o1: c.createOscillator(), o2: c.createOscillator(), lfo: c.createOscillator(), lg: c.createGain() };
    const e = this.eng;
    e.o1.type = 'sawtooth'; e.o2.type = 'square';
    e.f.type = 'lowpass'; e.f.frequency.value = 900; e.f.Q.value = 2;
    e.g.gain.value = 0;
    e.lfo.frequency.value = 23; e.lg.gain.value = 6;
    e.lfo.connect(e.lg); e.lg.connect(e.o1.frequency); e.lg.connect(e.o2.frequency);
    const g2 = c.createGain(); g2.gain.value = 0.45;
    e.o1.connect(e.f); e.o2.connect(g2); g2.connect(e.f); e.f.connect(e.g); e.g.connect(this.comp);
    e.o1.start(); e.o2.start(); e.lfo.start();
    // 風切、環境（城市底噪）、雨
    this.wind = this._loopNoise('bandpass', 800, 0.6, 0);
    this.amb = this._loopNoise('lowpass', 420, 0.7, 0);
    this.rain = this._loopNoise('highpass', 2500, 0.3, 0);
    this.crowd = this._loopNoise('bandpass', 700, 1.5, 0);
    this.boostN = this._loopNoise('bandpass', 1800, 0.8, 0);
    // 給愛麗絲
    this.elise = { g: c.createGain(), next: 0, i: 0 };
    this.elise.g.gain.value = 0; this.elise.g.connect(this.comp);
    this.chant = { next: 0, g: c.createGain(), i: 0 };
    this.chant.g.gain.value = 0; this.chant.g.connect(this.comp);
    this.bass = { next: 0, g: c.createGain() };
    this.bass.g.gain.value = 0; this.bass.g.connect(this.comp);
    this.drum = { next: 0, g: c.createGain() };
    this.drum.g.gain.value = 0; this.drum.g.connect(this.comp);
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v * 0.6; }

  _loopNoise(type, freq, q, gain) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.comp); src.start();
    return { f, g };
  }

  // 每幀：引擎、風、環境
  update(state) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const { speed = 0, boost = false, running = false, night = 0, wet = false, market = 0, elise = 0, drums = 0, crashed = false, chant = 0, bass = 0 } = state;
    const s = Math.min(1.6, speed / 27.8);
    const e = this.eng;
    const base = 62 + 120 * s + (boost ? 34 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(600 + 1500 * s + (boost ? 600 : 0), t, 0.08);
    e.g.gain.setTargetAtTime(running && !crashed ? 0.07 + 0.06 * s : 0.0, t, 0.08);
    this.wind.g.gain.setTargetAtTime(running ? 0.02 + 0.09 * s * s : 0, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(500 + 900 * s, t, 0.1);
    this.amb.g.gain.setTargetAtTime(0.05 + (night ? 0.01 : 0.03), t, 0.3);
    this.rain.g.gain.setTargetAtTime(wet ? 0.07 : 0, t, 0.3);
    this.crowd.g.gain.setTargetAtTime(market * 0.06, t, 0.3);
    this.boostN.g.gain.setTargetAtTime(boost && running ? 0.05 : 0, t, 0.05);
    // 給愛麗絲（垃圾車），elise＝0～1 音量
    this.elise.g.gain.setTargetAtTime(elise * 0.09, t, 0.2);
    if (elise > 0.01) this._eliseTick(t);
    this.drum.g.gain.setTargetAtTime(drums * 0.5, t, 0.2);
    this.chant.g.gain.setTargetAtTime(chant * 0.5, t, 0.2);
    if (chant > 0.01) this._chantTick(t);
    this.bass.g.gain.setTargetAtTime(bass * 0.6, t, 0.2);
    if (bass > 0.01) this._bassTick(t);
    if (drums > 0.01) this._drumTick(t);
  }

  _eliseTick(t) {
    // E D# E D# E B D C A ‧ C E A B ‧ E G# B C（公版旋律）
    const N = [[659, 1], [622, 1], [659, 1], [622, 1], [659, 1], [494, 1], [587, 1], [523, 1], [440, 2], [0, 1], [262, 1], [330, 1], [440, 1], [494, 2], [0, 1], [330, 1], [415, 1], [494, 1], [523, 2], [0, 2]];
    const el = this.elise;
    if (el.next < t - 1) el.next = t + 0.05;
    while (el.next < t + 0.3) {
      const [f, d] = N[el.i % N.length];
      const dur = d * 0.2;
      if (f) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0, el.next); g.gain.linearRampToValueAtTime(0.5, el.next + 0.01); g.gain.exponentialRampToValueAtTime(0.01, el.next + dur * 0.95);
        o.connect(g); g.connect(el.g); o.start(el.next); o.stop(el.next + dur);
      }
      el.next += dur; el.i++;
    }
  }

  // 宣傳車喇叭：「凍蒜！凍蒜！」（失真人聲感：鋸齒波＋母音共振峰）＋鞭炮
  _chantTick(t) {
    const ch = this.chant, c = this.ctx;
    if (ch.next < t - 1) ch.next = t + 0.05;
    while (ch.next < t + 0.4) {
      const k = ch.i % 4;
      if (k < 2) {
        // 「凍」「蒜」兩個音節：音高往下滑
        const st = ch.next, dur = 0.32;
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(k === 0 ? 210 : 230, st); o.frequency.linearRampToValueAtTime(k === 0 ? 170 : 150, st + dur);
        const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = k === 0 ? 600 : 750; f1.Q.value = 5;
        const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = k === 0 ? 1000 : 1250; f2.Q.value = 6;
        const sh = c.createWaveShaper(); const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 4); } sh.curve = cv;
        const g = c.createGain(); g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.9, st + 0.03); g.gain.setValueAtTime(0.9, st + dur * 0.7); g.gain.linearRampToValueAtTime(0, st + dur);
        o.connect(f1); o.connect(f2); f1.connect(sh); f2.connect(sh); sh.connect(g); g.connect(ch.g);
        o.start(st); o.stop(st + dur + 0.02);
        ch.next += 0.42;
      } else {
        if (k === 3 && Math.random() < 0.5) for (let j = 0; j < 8; j++) this._noiseHit(ch.next + j * 0.05, 1800, 0.05, 0.4, ch.g);
        ch.next += 0.5;
      }
      ch.i++;
    }
  }

  // 毒駕車的重低音
  _bassTick(t) {
    const b = this.bass;
    if (b.next < t - 1) b.next = t + 0.05;
    while (b.next < t + 0.3) { this._thump(b.next, 50, 0.22, b.g, 1); b.next += 0.5; }
  }

  _drumTick(t) {
    const dr = this.drum;
    if (dr.next < t - 1) dr.next = t + 0.05;
    while (dr.next < t + 0.3) {
      const k = Math.floor(dr.next * 4) % 8;
      this._thump(dr.next, k % 2 ? 90 : 70, 0.18, dr.g, 0.8);
      if (k === 0) this._noiseHit(dr.next, 3000, 0.5, 0.3, dr.g, 'bandpass', 1.5); // 鑼
      if (Math.random() < 0.3) for (let j = 0; j < 6; j++) this._noiseHit(dr.next + j * 0.04 + Math.random() * 0.02, 1800, 0.05, 0.35, dr.g); // 鞭炮
      dr.next += 0.25;
    }
  }

  _thump(t, f, dur, dest, vol = 1) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + dur * 0.5);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.comp); o.start(t); o.stop(t + dur + 0.02);
  }

  _noiseHit(t, freq, dur, vol, dest, type = 'bandpass', q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.comp);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
    return f;
  }

  beep(f, dur = 0.12, vol = 0.18, type = 'square') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.comp); o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, opt = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    switch (name) {
      case 'horn': {
        for (const [f, d] of [[420, 0], [505, 0]]) {
          const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
          o.type = 'square'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = 2200;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11, t + 0.01); g.gain.setValueAtTime(0.11, t + 0.16); g.gain.linearRampToValueAtTime(0, t + 0.2);
          g.gain.setValueAtTime(0, t + 0.26); g.gain.linearRampToValueAtTime(0.11, t + 0.27); g.gain.setValueAtTime(0.11, t + 0.42); g.gain.linearRampToValueAtTime(0, t + 0.46);
          o.connect(fl); fl.connect(g); g.connect(this.comp); o.start(t); o.stop(t + 0.5);
        }
        break;
      }
      case 'near': case 'close': {
        const f = this._noiseHit(t, 600, name === 'close' ? 0.5 : 0.35, name === 'close' ? 0.5 : 0.3, null, 'bandpass', 2);
        f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.35);
        break;
      }
      case 'crash':
        this._noiseHit(t, 900, 0.6, 0.8, null, 'lowpass', 0.7);
        this._thump(t, 55, 0.4, null, 1.0);
        this._noiseHit(t + 0.1, 3000, 1.2, 0.25, null, 'bandpass', 0.8); // 刮地
        break;
      case 'graze':
        this._noiseHit(t, 4200, 0.25, 0.35, null, 'bandpass', 6);
        this._thump(t, 120, 0.15, null, 0.4);
        break;
      case 'scrape': this._noiseHit(t, 2500, 0.2, 0.2, null, 'bandpass', 3); break;
      case 'knock': this._thump(t, 160, 0.2, null, 0.6); this._noiseHit(t, 1200, 0.15, 0.2); break;
      case 'pothole': this._thump(t, 70, 0.25, null, 0.9); break;
      case 'splash': this._noiseHit(t, 1500, 0.5, 0.4, null, 'highpass', 0.5); break;
      case 'boost': { const f = this._noiseHit(t, 300, 0.8, 0.5, null, 'bandpass', 1.5); f.frequency.exponentialRampToValueAtTime(3000, t + 0.6); break; }
      case 'charge': this.beep(1320, 0.12, 0.12, 'triangle'); this.beep(1760, 0.15, 0.08, 'triangle'); break;
      case 'door': this._thump(t, 200, 0.12, null, 0.4); break;
      case 'bark': for (const dt of [0, 0.22]) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(520, t + dt); o.frequency.exponentialRampToValueAtTime(260, t + dt + 0.12); g.gain.setValueAtTime(0.18, t + dt); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.15); o.connect(g); g.connect(this.comp); o.start(t + dt); o.stop(t + dt + 0.18); } break;
      case 'engineTell': { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(210, t + 0.8); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 1.0); o.connect(g); g.connect(this.comp); o.start(t); o.stop(t + 1.05); break; }
      case 'gust': { const f = this._noiseHit(t, 400, 1.6, 0.35, null, 'bandpass', 0.7); f.frequency.linearRampToValueAtTime(900, t + 0.8); break; }
      case 'otherHorn': { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = opt.f || 380; g.gain.setValueAtTime(0.04, t); g.gain.linearRampToValueAtTime(0, t + 0.3); o.connect(g); g.connect(this.comp); o.start(t); o.stop(t + 0.32); break; }
      case 'star': this.beep(1318, 0.18, 0.15, 'triangle'); break;
      case 'turnBeep': [0, 0.5, 1.0, 1.5].forEach((d) => setTimeout(() => this.beep(1000, 0.25, 0.06, 'square'), d * 1000)); break;
      case 'win': [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => this.beep(f, 0.2, 0.14, 'triangle'), i * 110)); break;
      case 'lose': [440, 392, 330].forEach((f, i) => setTimeout(() => this.beep(f, 0.3, 0.12, 'triangle'), i * 180)); break;
    }
  }
}

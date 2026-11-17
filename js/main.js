// KMoto 主程式：畫面流程、輸入、鏡頭、後製、HUD（規格第 2、8、9 章）。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LEVELS, CHAPTERS, DESTS, HAZARD_INFO, levelById } from './levels.js';
import { Sim, STEP } from './sim.js';
import { TUNING } from './tuning.js';
import { World, ENV } from './render/world.js';
import { Actors } from './render/actors.js';
import { buildTextures, loadFonts } from './render/textures.js';
import { Audio } from './audio.js';
import { loadProps } from './render/props.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- 存檔（規格 10.3） ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密模式 */ } },
};
let progress = store.get('kmoto.progress.v1', {});
let quality = store.get('kmoto.quality', isTouch ? 'low' : 'high');
let volume = store.get('kmoto.volume', 0.7);
let chapter = store.get('kmoto.chapter', 1);

// ---------- 渲染器 ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
const pmrem = new THREE.PMREMGenerator(renderer);
let composer = null, bloom = null, blurPass = null, renderPass = null;

const RadialBlur = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0 }, center: { value: new THREE.Vector2(0.5, 0.52) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; uniform vec2 center; varying vec2 vUv;
    void main(){ vec2 d = vUv - center; float l = length(d); vec4 c = vec4(0.0);
      for (int i = 0; i < 8; i++) { c += texture2D(tDiffuse, vUv - d * strength * l * float(i) / 7.0); }
      gl_FragColor = c / 8.0; }`,
};

function setupComposer() {
  composer = null;
  if (quality !== 'high') return;
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(null, camera);
  composer.addPass(renderPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.9);
  composer.addPass(bloom);
  blurPass = new ShaderPass(RadialBlur);
  composer.addPass(blurPass);
  composer.addPass(new OutputPass());
}

function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, isTouch ? 1.25 : 1));
  renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  setupComposer();
  resize();
  if (stage) stage.setShadowSize(quality === 'high' ? 2048 : 1024);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(w, h);
  const fx = $('fx'); fx.width = w; fx.height = h;
}
window.addEventListener('resize', resize);

// ---------- 資源 ----------
let T = null;
const skyCache = new Map();
const texLoader = new THREE.TextureLoader();
function loadTex(url, srgb = true, repeat = true) {
  return new Promise((res, rej) => texLoader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    res(t);
  }, undefined, rej));
}
async function getSky(name) {
  if (skyCache.has(name)) return skyCache.get(name);
  const t = await loadTex(`assets/sky/${name}.jpg`, true, false);
  t.mapping = THREE.EquirectangularReflectionMapping;
  const env = pmrem.fromEquirectangular(t).texture;
  const v = { bg: t, env };
  skyCache.set(name, v);
  return v;
}

// ---------- 關卡場景 ----------
class Stage {
  constructor(level, sky, { attract = false } = {}) {
    this.level = level;
    this.attract = attract;
    const envKey = level.time;
    this.env = ENV[envKey];
    const env = this.env;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = sky.bg;
    scene.backgroundIntensity = env.night ? 0.8 : 1.0;
    scene.environment = sky.env;
    scene.environmentIntensity = env.env;
    scene.fog = new THREE.Fog(env.horizon, env.fog[0], env.fog[1]);
    this.hemi = new THREE.HemisphereLight(env.hemi[0], env.hemi[1], env.hemi[2]);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(env.sun[0], env.sun[1]);
    sun.castShadow = true;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun = sun;
    this.sunDir = new THREE.Vector3(...env.sunDir).normalize();
    scene.add(sun); scene.add(sun.target);
    this.setShadowSize(quality === 'high' ? 2048 : 1024);
    this.sim = new Sim(level);
    if (attract) { this.sim.countdown = 1e9; }
    this.world = new World(scene, this.sim, T, envKey);
    this.actors = new Actors(scene, this.sim, env);
    if (attract) this.actors.player.visible = false;
    this.rain = this.sim.wet ? makeRain(scene, this.sim.weather === 'typhoon') : null;
    this.camS = 0; this.camX = 0; this.shake = 0; this.fov = 62;
    this.timeScale = 1; this.slowT = 0;
    this.announced300 = false;
    this.doneT = 0;
    this.smoke = makeSmoke(scene);
  }

  setShadowSize(n) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== n) { s.mapSize.set(n, n); if (s.map) { s.map.dispose(); s.map = null; } }
  }

  prebuild() {
    this.world.prebuild(this.sim.player.s);
    this.actors.update(0);
  }

  dispose() {
    this.world.dispose();
    this.actors.dispose();
    this.scene.traverse((o) => { if (o.isMesh && o.userData.ownMat) { o.geometry.dispose(); o.material.dispose(); } });
  }
}

function makeRain(scene, typhoon) {
  const N = typhoon ? 2600 : 1800;
  const pos = new Float32Array(N * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineBasicMaterial({ color: '#c8d2dc', transparent: true, opacity: 0.42, depthWrite: false });
  const lines = new THREE.LineSegments(g, m);
  lines.frustumCulled = false;
  scene.add(lines);
  const drops = [];
  for (let i = 0; i < N; i++) drops.push({ x: (Math.random() - 0.5) * 50, y: Math.random() * 22, z: (Math.random() - 0.5) * 50 });
  return { lines, drops, pos, slant: 0 };
}

function makeSmoke(scene) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(230,226,220,0.7)'); grd.addColorStop(1, 'rgba(230,226,220,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const sprites = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.55 }));
    s.visible = false; s.scale.setScalar(5 + Math.random() * 4);
    s.userData.ph = Math.random() * 10;
    s.userData.own = true;
    scene.add(s); sprites.push(s);
  }
  return sprites;
}

// ---------- 狀態 ----------
let stage = null, menuStage = null, nextStage = null;
let state = 'loading';
let curLevel = null;
const audio = new Audio();
audio.setVolume(volume);

// ---------- 輸入（規格 4.1） ----------
const keys = new Set();
const edge = { boost: false, horn: false };
const touch = { left: false, right: false, brake: false, boost: false, horn: false };
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyS: 'brake', ArrowDown: 'brake',
  Space: 'boost', KeyW: 'boost', ArrowUp: 'boost', KeyH: 'horn', ShiftLeft: 'horn', ShiftRight: 'horn',
};
window.addEventListener('keydown', (e) => {
  if (anyDialogOpen() && e.code !== 'Escape') return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (closeTopDialog()) return;
    if (state === 'play') pauseGame(); else if (state === 'pause') resumeGame();
    return;
  }
  const a = KEYMAP[e.code];
  if (!a) return;
  e.preventDefault();
  if (!keys.has(a)) { if (a === 'boost') edge.boost = true; if (a === 'horn') edge.horn = true; }
  keys.add(a);
  audio.start();
});
window.addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) keys.delete(a); });
window.addEventListener('blur', () => { keys.clear(); for (const k in touch) touch[k] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); });

function setupTouch() {
  if (!isTouch) return;
  const pad = $('tSteer');
  const pts = new Map();
  const upd = () => {
    const r = pad.getBoundingClientRect();
    touch.left = touch.right = false;
    for (const x of pts.values()) { if (x < r.left + r.width / 2) touch.left = true; else touch.right = true; }
    pad.children[0].classList.toggle('on', touch.left); pad.children[1].classList.toggle('on', touch.right);
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); pts.set(e.pointerId, e.clientX); upd(); audio.start(); });
  pad.addEventListener('pointermove', (e) => { if (pts.has(e.pointerId)) { pts.set(e.pointerId, e.clientX); upd(); } });
  const end = (e) => { pts.delete(e.pointerId); upd(); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  for (const b of document.querySelectorAll('#tRight .tb')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); touch[k] = true; b.classList.add('on'); if (k === 'boost') edge.boost = true; if (k === 'horn') edge.horn = true; audio.start(); });
    const up = () => { touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  }
}

function readInput() {
  return {
    left: keys.has('left') || touch.left,
    right: keys.has('right') || touch.right,
    brake: keys.has('brake') || touch.brake,
    boostDown: edge.boost, hornDown: edge.horn,
  };
}

// ---------- UI ----------
function show(id, on = true) { $(id).hidden = !on; }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600); }
function anyDialogOpen() { return !$('dlgSettings').hidden || !$('dlgHelp').hidden; }
function closeTopDialog() {
  for (const id of ['dlgSettings', 'dlgHelp']) if (!$(id).hidden) { show(id, false); return true; }
  return false;
}
for (const d of ['dlgSettings', 'dlgHelp']) {
  $(d).addEventListener('pointerdown', (e) => { if (e.target === $(d)) show(d, false); });
  $(d).querySelector('[data-close]').addEventListener('click', () => show(d, false));
}

function pop(text, cls = 'info') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls; el.textContent = text;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function fmtT(t) { return t.toFixed(1); }

function renderMenu() {
  const tabs = $('tabs'); tabs.innerHTML = '';
  let total = 0;
  for (const lv of LEVELS) total += progress[lv.id]?.stars || 0;
  $('totalStars').textContent = `★ 總計 ${total}/60`;
  for (const ch of CHAPTERS) {
    const lvls = LEVELS.filter((l) => l.ch === ch.n);
    const st = lvls.reduce((a, l) => a + (progress[l.id]?.stars || 0), 0);
    const b = document.createElement('button');
    b.className = ch.n === chapter ? 'on' : '';
    b.innerHTML = `${ch.n}. ${ch.name}<small>★ ${st}/12</small>`;
    b.onclick = () => { chapter = ch.n; store.set('kmoto.chapter', chapter); renderMenu(); };
    tabs.appendChild(b);
  }
  const cards = $('cards'); cards.innerHTML = '';
  const icon = { morning: '☀', noon: '☀', dusk: '🌇', night: '🌙', rain: '🌧' };
  for (const lv of LEVELS.filter((l) => l.ch === chapter)) {
    const pr = progress[lv.id];
    const c = document.createElement('button');
    c.className = 'lv';
    const stars = [1, 2, 3].map((k) => `<span class="${(pr?.stars || 0) >= k ? '' : 'off'}">★</span>`).join('');
    c.innerHTML = `<div class="no"><span>${lv.id}</span><span>${icon[lv.time]}</span></div><div class="t">${lv.title}</div>
      <div class="d">${DESTS[lv.dest].label}・${(lv.length / 1000).toFixed(1)} km</div>
      <div class="st">${stars}</div><div class="best">${pr ? '最佳 剩 ' + pr.bestRemain.toFixed(1) + ' 秒' : '尚未過關'}</div>`;
    c.onclick = () => { audio.start(); openIntro(lv); };
    cards.appendChild(c);
  }
  $('ver').textContent = 'v' + VERSION;
}

function openIntro(lv) {
  curLevel = lv;
  $('iNo').textContent = `第 ${lv.ch} 章 ・ ${lv.id}`;
  $('iTitle').textContent = lv.title;
  $('iText').textContent = lv.text[0];
  $('iDest').textContent = DESTS[lv.dest].label;
  $('iLimit').textContent = lv.limit + ' 秒';
  $('iLen').textContent = (lv.length / 1000).toFixed(1) + ' km';
  $('iStars').textContent = `★★ 剩 ${lv.star[0]} 秒　★★★ 剩 ${lv.star[1]} 秒且不摔車`;
  const nh = $('iNew'); nh.innerHTML = '';
  if (lv.intro.length) {
    for (const k of lv.intro) {
      const h = HAZARD_INFO[k];
      const d = document.createElement('div'); d.className = 'h';
      d.innerHTML = `<b>新障礙：${h.name}</b>${h.hint}`;
      nh.appendChild(d);
    }
  } else {
    const d = document.createElement('div'); d.className = 'h'; d.innerHTML = '<b>終極考驗</b>前面所有的三寶與路障都會出現，而且更多。'; nh.appendChild(d);
  }
  show('menu', false); show('result', false); show('pause', false);
  show('intro', true);
  const go = $('iGo'); go.disabled = true; go.textContent = '載入中…';
  state = 'intro';
  prepareStage(lv).then(() => { go.disabled = false; go.textContent = '出發！'; });
}

let prepToken = 0;
async function prepareStage(lv) {
  const tok = ++prepToken;
  const sky = await getSky(ENV[lv.time].sky);
  await new Promise((r) => setTimeout(r, 30));
  if (tok !== prepToken) return;
  if (nextStage) { nextStage.dispose(); nextStage = null; }
  nextStage = new Stage(lv, sky);
  nextStage.prebuild();
  // 先在背景編譯一次（避免開跑時卡頓）
  renderer.compile(nextStage.scene, camera);
}

$('iBack').onclick = () => { if (nextStage) { nextStage.dispose(); nextStage = null; } prepToken++; goMenu(); };
$('iGo').onclick = () => startLevel();

function startLevel() {
  if (!nextStage) return;
  audio.start();
  show('intro', false);
  if (stage && stage !== menuStage) stage.dispose();
  stage = nextStage; nextStage = null;
  if (renderPass) renderPass.scene = stage.scene;
  state = 'play';
  show('hud', true); show('touch', isTouch);
  $('hTitle').textContent = `${curLevel.id} ${curLevel.title}`;
  lastCount = 4;
  fpsAcc = { t: 0, n: 0 };
}

function goMenu() {
  state = 'menu';
  if (stage && stage !== menuStage) { stage.dispose(); }
  stage = menuStage;
  if (renderPass && stage) renderPass.scene = stage.scene;
  show('hud', false); show('touch', false); show('intro', false); show('pause', false); show('result', false);
  show('menu', true);
  renderMenu();
}

function pauseGame() { if (state !== 'play') return; state = 'pause'; show('pause', true); }
function resumeGame() { if (state !== 'pause') return; state = 'play'; show('pause', false); }
for (const b of document.querySelectorAll('#pause [data-a]')) {
  b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'resume') resumeGame();
    else if (a === 'restart') { show('pause', false); openIntro(curLevel); }
    else if (a === 'help') show('dlgHelp', true);
    else if (a === 'settings') openSettings();
    else if (a === 'home') goMenu();
  };
}
$('btnPause').addEventListener('pointerdown', (e) => { e.stopPropagation(); pauseGame(); });
$('btnHelp').onclick = () => show('dlgHelp', true);
$('btnSettings').onclick = () => openSettings();
function openSettings() {
  $('sQuality').value = quality;
  $('sVolume').value = Math.round(volume * 100);
  show('dlgSettings', true);
}
$('sQuality').onchange = () => { quality = $('sQuality').value; store.set('kmoto.quality', quality); applyQuality(); };
$('sVolume').oninput = () => { volume = $('sVolume').value / 100; store.set('kmoto.volume', volume); audio.setVolume(volume); };
$('sClear').onclick = () => {
  if ($('sClear').dataset.confirm) { progress = {}; store.set('kmoto.progress.v1', progress); $('sClear').textContent = '清除紀錄'; delete $('sClear').dataset.confirm; renderMenu(); toast('紀錄已清除'); }
  else { $('sClear').dataset.confirm = '1'; $('sClear').textContent = '再按一次確認清除'; }
};

function showResult(res) {
  state = 'result';
  const lv = curLevel;
  const pr = progress[lv.id];
  let isNew = false;
  if (res.win) {
    if (!pr || res.remain > pr.bestRemain) isNew = !!pr || true;
    progress[lv.id] = {
      stars: Math.max(res.stars, pr?.stars || 0),
      bestRemain: Math.max(res.remain, pr?.bestRemain || 0),
      bestNear: Math.max(res.near + res.close, pr?.bestNear || 0),
    };
    store.set('kmoto.progress.v1', progress);
  }
  $('rTitle').textContent = res.win ? '趕上了！' : '來不及了…';
  $('rTitle').style.color = res.win ? '#ffcf3a' : '#aaa';
  $('rText').textContent = res.win ? lv.text[1] : lv.text[2];
  const spans = $('rStars').children;
  for (const s of spans) s.classList.remove('on');
  for (let k = 0; k < res.stars; k++) setTimeout(() => { spans[k].classList.add('on'); audio.play('star'); }, 350 + k * 250);
  const first = res.win ? `<div><small>剩餘時間</small><b>${res.remain.toFixed(1)} 秒</b>${isNew && pr ? '<div class="new">★新紀錄</div>' : ''}</div>`
    : `<div><small>還差</small><b>${res.shortBy} 公尺</b></div>`;
  $('rData').innerHTML = first +
    `<div><small>擦身而過</small><b>${res.near + res.close}</b></div>
     <div><small>驚險</small><b>${res.close}</b></div>
     <div><small>摔車</small><b>${res.crashes}</b></div>
     <div><small>最高時速</small><b>${res.maxKmh} km/h</b></div>
     <div><small>時限</small><b>${lv.limit} 秒</b></div>`;
  const btns = $('rBtns'); btns.innerHTML = '';
  const add = (t, f, cls = '') => { const b = document.createElement('button'); b.textContent = t; b.className = cls; b.onclick = f; btns.appendChild(b); };
  add('選關', () => goMenu());
  add('再挑戰', () => openIntro(lv), res.win ? '' : 'primary');
  const idx = LEVELS.indexOf(lv);
  if (res.win && idx < LEVELS.length - 1) add('下一關', () => { chapter = LEVELS[idx + 1].ch; store.set('kmoto.chapter', chapter); openIntro(LEVELS[idx + 1]); }, 'primary');
  audio.play(res.win ? 'win' : 'lose');
  show('result', true);
}

// ---------- 遊戲迴圈 ----------
let acc = 0, last = performance.now(), lastCount = 4, fpsAcc = { t: 0, n: 0 };
const _p = {}, _q = {};
const fxc = $('fx').getContext('2d');
const lines = Array.from({ length: 40 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), sp: 0.5 + Math.random() }));
let hornTimer = 5;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt);
}

let botDrive = null;
function tick(dt) {
  if (!stage) return;
  const st = stage, sim = st.sim, p = sim.player;

  if (state === 'menu') {
    st.camS += 6 * dt;
    p.s = st.camS + 6; p.x = 0; p.v = 0;
    sim.step(dt, null);
  } else if (state === 'play') {
    // 慢動作
    let ts = 1;
    if (st.slowT > 0) { st.slowT -= dt; ts = st.slowScale; }
    acc += dt * ts;
    const inp = botDrive ? botDrive.input(dt) : readInput();
    let first = true;
    while (acc >= STEP) {
      sim.step(STEP, first ? inp : { ...inp, boostDown: false, hornDown: false });
      first = false;
      acc -= STEP;
    }
    edge.boost = false; edge.horn = false;
    handleFx(st);
    if (sim.result) {
      st.doneT += dt;
      const wait = sim.result.win ? 0.9 : 1.6;
      if (st.doneT > wait && state === 'play') showResult(sim.result);
    }
    // 自動降畫質（規格 8.2）
    if (quality === 'high') {
      fpsAcc.t += dt; fpsAcc.n++;
      if (fpsAcc.t > 3) {
        const fps = fpsAcc.n / fpsAcc.t;
        fpsAcc = { t: 0, n: 0 };
        if (fps < 40) { quality = 'low'; store.set('kmoto.quality', quality); applyQuality(); toast('畫面不夠順，已自動切到省電畫質'); }
      }
    }
  } else if (state === 'result' || state === 'intro') {
    sim.step(dt, null);
  }
  sim.fx.length = 0;
  st.world.update(state === 'menu' ? st.camS : p.s, sim.clock);
  st.actors.update(state === 'pause' ? 0 : dt);
  if (state === 'menu') st.actors.player.visible = false;
  updateCamera(st, dt);
  updateEnv(st, dt);
  updateHud(st);
  drawFx(st, dt);
  updateAudio(st, dt);
  if (composer) {
    renderPass.scene = st.scene;
    const b = st.env.bloom;
    bloom.strength = b[0]; bloom.radius = b[1]; bloom.threshold = b[2];
    const speedK = Math.max(0, p.v / TUNING.maxSpeed - 0.85);
    blurPass.uniforms.strength.value = state === 'play' ? (p.boostT > 0 ? 0.07 : speedK * 0.12) : 0;
    renderer.toneMappingExposure = st.env.exposure;
    composer.render();
  } else {
    renderer.toneMappingExposure = st.env.exposure;
    renderer.render(st.scene, camera);
  }
}

function updateCamera(st, dt) {
  const sim = st.sim, p = sim.player, R = sim.route;
  if (state === 'menu') {
    R.toWorld(st.camS, 1.5, _p);
    R.toWorld(st.camS + 30, 0, _q);
    camera.position.set(_p.wx, 3.2, _p.wz);
    camera.lookAt(_q.wx, 2.2, _q.wz);
    camera.fov = 60; camera.updateProjectionMatrix();
    return;
  }
  const k = Math.min(1, dt * 7);
  st.camX += (p.x - st.camX) * k;
  const back = 4.4 + Math.min(1.2, p.v / TUNING.maxSpeed) * 0.6;
  R.toWorld(p.s - back, st.camX * 0.9 + p.x * 0.1, _p);
  R.toWorld(p.s + 12, st.camX * 0.6 + p.x * 0.4, _q);
  const lift = p.crash ? Math.min(1.5, p.crash.t) : 0;
  let sx = 0, sy = 0;
  if (st.shake > 0) { st.shake = Math.max(0, st.shake - dt * 2.2); const a = st.shake * st.shake * 0.35; sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; }
  camera.position.set(_p.wx + sx, 1.95 + lift + sy, _p.wz);
  camera.lookAt(_q.wx, 1.05, _q.wz);
  const fovT = 62 + 14 * Math.min(1.3, p.v / TUNING.maxSpeed) + (p.boostT > 0 ? 6 : 0);
  st.fov += (fovT - st.fov) * Math.min(1, dt * 3);
  camera.fov = st.fov; camera.updateProjectionMatrix();
}

function updateEnv(st, dt) {
  const s = st.sun, p = st.sim.player;
  const tx = camera.position.x, tz = camera.position.z;
  s.target.position.set(tx, 0, tz);
  s.position.set(tx + st.sunDir.x * 120, st.sunDir.y * 120, tz + st.sunDir.z * 120);
  // 雨
  if (st.rain) {
    const r = st.rain, pos = r.pos;
    const wind = st.sim.player.wind || 0;
    r.slant += ((st.sim.gust.t > 0 || st.sim.gust.next < 0.6 ? wind * 0.6 + (st.sim.gust.dir || 0) * 0.5 : 0) - r.slant) * Math.min(1, dt * 3);
    const vy = 18 * dt;
    const sm = st.sim.route.sample(p.s, {});
    let i = 0;
    for (const d of r.drops) {
      d.y -= vy;
      if (d.y < 0) { d.y = 20 + Math.random() * 3; d.x = (Math.random() - 0.5) * 50; d.z = (Math.random() - 0.5) * 50; }
      const wx = camera.position.x + d.x + sm.fx * 12, wz = camera.position.z + d.z + sm.fz * 12;
      const sl = r.slant * 0.5;
      pos[i++] = wx; pos[i++] = d.y; pos[i++] = wz;
      pos[i++] = wx + sm.rx * sl - sm.fx * 0.25; pos[i++] = d.y + 0.7; pos[i++] = wz + sm.rz * sl - sm.fz * 0.25;
    }
    r.lines.geometry.attributes.position.needsUpdate = true;
  }
  // 遶境煙
  let smokeEv = null;
  for (const ev of st.sim.events) if (ev.type === 'procession' && ev.smoke && ev.state !== 'wait' && ev.state !== 'done') smokeEv = ev;
  st.smoke.forEach((sp, k) => {
    if (!smokeEv) { sp.visible = false; return; }
    sp.visible = true;
    const sm = smokeEv.smoke;
    const ss = sm.s - 18 + (k * 37 % 36) + Math.sin(st.sim.clock * 0.4 + sp.userData.ph) * 2;
    const xx = sm.x0 + ((k * 0.37) % 1) * (sm.x1 - sm.x0);
    st.sim.route.toWorld(ss, xx, _p);
    sp.position.set(_p.wx, 1.2 + (k % 3) * 0.8 + Math.sin(st.sim.clock + k) * 0.3, _p.wz);
  });
}

function updateHud(st) {
  const sim = st.sim, p = sim.player;
  if (state !== 'play' && state !== 'pause') return;
  const tl = Math.max(0, sim.timeLeft);
  const ht = $('hTime');
  ht.textContent = fmtT(tl);
  ht.classList.toggle('warn', tl <= 10 && sim.phase === 'run');
  const f = Math.max(0, Math.min(1, p.s / sim.L));
  $('hProgFill').style.width = (f * 100) + '%';
  $('hProgBike').style.left = (f * 100) + '%';
  $('hDist').textContent = `還有 ${Math.max(0, (sim.L - p.s) / 1000).toFixed(2)} km`;
  $('hStats').textContent = `擦身 ×${p.near + p.close}　摔車 ×${p.crashes}`;
  const sp = $('hSpeed');
  sp.firstChild.textContent = Math.round(p.v * 3.6);
  sp.classList.toggle('boost', p.boostT > 0);
  $('hDot1').classList.toggle('on', p.boostCharges >= 1);
  $('hDot2').classList.toggle('on', p.boostCharges >= 2);
  $('hMeter').style.width = (p.boostCharges >= TUNING.boostMax ? 100 : p.boostMeter * 100) + '%';
  // 倒數
  const c = $('center');
  if (sim.phase === 'countdown') {
    const n = Math.ceil(sim.countdown);
    if (n !== lastCount && n <= 3 && n >= 1) { lastCount = n; audio.beep(523, 0.15, 0.2); }
    c.textContent = n; c.className = '';
  } else if (sim.phase === 'run' && sim.t < 0.8) { c.textContent = 'GO!'; c.className = 'go'; }
  else if (sim.result && !sim.result.win) { c.textContent = '來不及了…'; c.className = 'small'; }
  else c.textContent = '';
  // 摔車淡出淡入
  const fade = $('fade');
  if (p.crash) {
    const t = p.crash.t;
    fade.style.opacity = t > TUNING.crashSlide ? Math.min(1, (t - TUNING.crashSlide) / (TUNING.crashFade * 0.5)) * 0.9 : 0;
  } else fade.style.opacity = 0;
}

function handleFx(st) {
  const sim = st.sim, p = sim.player;
  for (const f of sim.fx) {
    switch (f.type) {
      case 'go': audio.beep(1046, 0.5, 0.2); break;
      case 'tick': audio.beep(880, 0.1, 0.16); break;
      case 'near': pop('擦身而過！', 'near'); audio.play('near'); st.shake = Math.max(st.shake, 0.25); break;
      case 'close': pop('驚險！', 'close'); audio.play('close'); st.shake = Math.max(st.shake, 0.4); st.slowT = 0.15; st.slowScale = 0.6; break;
      case 'graze': pop('擦撞！', 'bad'); audio.play('graze'); st.shake = Math.max(st.shake, 0.6); break;
      case 'crash': pop('摔車！', 'bad'); audio.play('crash'); st.shake = 1.2; break;
      case 'scrape': pop('擦牆', 'bad'); audio.play('scrape'); st.shake = Math.max(st.shake, 0.3); break;
      case 'knock': pop('撞飛！', 'bad'); audio.play('knock'); st.shake = Math.max(st.shake, 0.3); break;
      case 'pothole': audio.play('pothole'); st.shake = Math.max(st.shake, 0.55); break;
      case 'splash': audio.play('splash'); break;
      case 'slip': pop('打滑！', 'bad'); break;
      case 'boost': audio.play('boost'); st.shake = Math.max(st.shake, 0.3); break;
      case 'charge': pop('衝刺 +1', 'near'); audio.play('charge'); break;
      case 'horn': audio.play('horn'); break;
      case 'tell': if (f.ev === 'alley' || f.ev === 'pullout') audio.play('engineTell'); if (f.ev === 'bigturn') audio.play('turnBeep'); break;
      case 'door': audio.play('door'); break;
      case 'bark': audio.play('bark'); break;
      case 'gustWarn': audio.play('gust'); break;
      case 'gust': st.shake = Math.max(st.shake, 0.3); break;
      case 'arrive': st.slowT = 0.6; st.slowScale = 0.5; break;
      case 'timeout': break;
    }
  }
  if (!st.announced300 && sim.L - p.s < 300 && sim.phase === 'run') { st.announced300 = true; pop('目的地就在前面！', 'info'); }
}

function drawFx(st, dt) {
  const w = fxc.canvas.width, h = fxc.canvas.height;
  fxc.clearRect(0, 0, w, h);
  if (state !== 'play') return;
  const p = st.sim.player;
  const k = p.v / TUNING.maxSpeed;
  if (k < 0.7 && p.boostT <= 0) return;
  const inten = Math.min(1, (k - 0.7) / 0.5) + (p.boostT > 0 ? 0.5 : 0);
  const cx = w / 2, cy = h * 0.52;
  fxc.lineCap = 'round';
  for (const l of lines) {
    l.r += dt * l.sp * (1.6 + inten * 2);
    if (l.r > 1) { l.r = 0.25 + Math.random() * 0.2; l.a = Math.random() * Math.PI * 2; }
    const R = Math.max(w, h) * 0.7;
    const r0 = l.r * R, r1 = r0 + R * 0.12 * (0.5 + inten);
    // 只畫在畫面兩側（上下少一點）
    const ca = Math.cos(l.a), sa = Math.sin(l.a);
    if (Math.abs(sa) > 0.8 && p.boostT <= 0) continue;
    fxc.strokeStyle = p.boostT > 0 ? `rgba(170,220,255,${0.35 * inten})` : `rgba(255,255,255,${0.22 * inten})`;
    fxc.lineWidth = 1.5 + inten * 1.5;
    fxc.beginPath(); fxc.moveTo(cx + ca * r0, cy + sa * r0); fxc.lineTo(cx + ca * r1, cy + sa * r1); fxc.stroke();
  }
}

function updateAudio(st, dt) {
  if (!audio.ctx) return;
  const sim = st.sim, p = sim.player;
  let elise = 0, drums = 0, chant = 0, bass = 0;
  for (const e of sim.active || []) {
    if (e.music) elise = Math.max(elise, 1 - Math.abs(e.s - p.s) / 140);
    if (e.campaign) chant = Math.max(chant, 1 - Math.abs(e.s - p.s) / 170);
    if (e.drugged) bass = Math.max(bass, 1 - Math.abs(e.s - p.s) / 90);
    if (e.kind === 'proc') drums = Math.max(drums, 1 - Math.abs(e.s - p.s) / 160);
  }
  const running = state === 'play' && sim.phase !== 'countdown';
  audio.update({
    speed: state === 'play' ? p.v : 0, boost: p.boostT > 0, running: state === 'play' || state === 'pause' ? running && state === 'play' : false,
    night: st.env.night, wet: sim.wet && state !== 'menu', market: sim.route.typeAt(p.s) === 'market' && state === 'play' ? 1 : 0,
    elise: state === 'play' ? elise : 0, drums: state === 'play' ? drums : 0, crashed: !!p.crash,
    chant: state === 'play' ? chant : 0, bass: state === 'play' ? bass : 0,
  });
  if (state === 'play') {
    hornTimer -= dt;
    if (hornTimer <= 0) { hornTimer = 6 + Math.random() * 8; audio.play('otherHorn', { f: 330 + Math.random() * 160 }); }
  }
}

// ---------- 啟動 ----------
window.addEventListener('error', (e) => { const el = $('err'); el.hidden = false; el.textContent = '載入失敗：' + (e.message || e.error); });
window.addEventListener('unhandledrejection', (e) => { const el = $('err'); el.hidden = false; el.textContent = '載入失敗：' + (e.reason?.message || e.reason); });

async function boot() {
  const ld = $('ldText');
  ld.textContent = '載入中… 10%';
  await loadFonts();
  ld.textContent = '載入中… 30%';
  T = buildTextures(7);
  const [road, roadN, grass] = await Promise.all([loadTex('assets/tex/road.jpg'), loadTex('assets/tex/road_n.jpg', false), loadTex('assets/tex/grass.jpg')]);
  T.road = road; T.roadN = roadN; T.grass = grass;
  await loadProps();
  ld.textContent = '載入中… 60%';
  applyQuality();
  const lv0 = LEVELS[0];
  const sky = await getSky(ENV[lv0.time].sky);
  ld.textContent = '載入中… 80%';
  menuStage = new Stage(lv0, sky, { attract: true });
  menuStage.camS = 10;
  menuStage.sim.player.s = 16;
  menuStage.prebuild();
  stage = menuStage;
  setupTouch();
  ld.textContent = '載入中… 100%';
  show('loading', false);
  goMenu();
  // 除錯：?level=1-1 直接開某關
  const q = new URLSearchParams(location.search);
  if (q.get('level') && levelById(q.get('level'))) openIntro(levelById(q.get('level')));
  requestAnimationFrame(frame);
  window.__kmoto = {
    get stage() { return stage; }, get state() { return state; }, startLevel, openIntro, renderer, camera,
    // 除錯：手動推進（瀏覽器分頁在背景時 requestAnimationFrame 會停）
    advance(sec, fps = 30) { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) tick(1 / fps); return stage.sim.player.s; },
    async bot(skill = 'normal') { const { Bot } = await import('./bot.js'); botDrive = skill ? new Bot(stage.sim, skill, 1) : null; },
  };
}
boot();

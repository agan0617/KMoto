// 車輛與人物模型預覽頁：node tools/serve.mjs 8790 → http://localhost:8790/tools/preview_vehicles.html
// 網址參數：?night=1  &view=<區名>  &cam=x,y,z&look=x,y,z（截圖用）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeVehicle, makePedestrian, makeDog, makePlayerBike, makeProcessionUnit, makeParkedScooterGeo, setLights, triCount } from '../js/render/vehicles.js';

const qs = new URLSearchParams(location.search);
if (qs.get('ui') === '0') document.getElementById('ui').style.display = 'none';
addEventListener('keydown', (e) => { if (e.key === 'h') { const u = document.getElementById('ui'); u.style.display = u.style.display === 'none' ? '' : 'none'; } });
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 500);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// 地面（柏油色）
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(-20, 30, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbcd2ff, 0x3a3530, 0.6);
scene.add(hemi);
const loader = new THREE.TextureLoader();
const skies = {};
for (const k of ['noon', 'night']) {
  skies[k] = loader.load(`../assets/sky/${k}.jpg`, (t) => { t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; });
}
const streetLights = [];
for (let i = 0; i < 6; i++) {
  const l = new THREE.PointLight(0xffd9a0, 0, 25, 1.6);
  l.position.set(-14 + i * 6, 5, 4);
  scene.add(l);
  streetLights.push(l);
}

// ---------------------------------------------------------------- 擺模型
const rows = {};
const items = [];
function place(obj, x, z, label, row, rotY = 0) {
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY;
  scene.add(obj);
  items.push({ obj, label, tris: triCount(obj) });
  (rows[row] ??= []).push(obj);
}
// 第一排：機車類
let x = -12;
const scoots = [
  ['scooter', { seed: 1 }], ['scooter', { seed: 2 }], ['scooter', { seed: 3, cargo: 'delivery' }], ['scooter', { seed: 4, cargo: 'basket' }],
  ['scooter', { seed: 5, raincoat: true }], ['scooter', { seed: 9 }], ['oldscooter', { seed: 6 }], ['oldscooter', { seed: 8 }], ['bicycle', { seed: 7 }],
];
for (const [k, o] of scoots) { place(makeVehicle(k, o), x, 8, `${k} ${o.seed}${o.cargo ? ' ' + o.cargo : ''}${o.raincoat ? ' 雨衣' : ''}`, 'bikes', 0.5); x += 1.6; }
place(makePlayerBike({}), x + 0.6, 8, 'player komugi', 'bikes', 0.5);
place(makePlayerBike({ passenger: 'wife' }), x + 2.4, 8, 'player wife', 'bikes', 0.5);
place(makePlayerBike({ raincoat: true }), x + 4.2, 8, 'player 雨衣', 'bikes', 0.5);
// 第二排：汽車
x = -14;
for (const [k, s] of [['car', 1], ['car', 2], ['car', 3], ['car', 5], ['taxi', 1], ['pickup', 1], ['pickup', 2]]) { place(makeVehicle(k, { seed: s }), x, 0, `${k} ${s}`, 'cars', 0.6); x += 3.4; }
// 第三排：大車
x = -14;
for (const [k, s] of [['bus', 1], ['truck', 1], ['garbage', 1]]) { place(makeVehicle(k, { seed: s }), x, -10, `${k} ${s}`, 'big', 0.7); x += 7; }
// 選舉宣傳車
place(makeVehicle('campaign', { seed: 1 }), 8, -10, 'campaign 1', 'big', 0.7);
place(makeVehicle('campaign', { seed: 4 }), 13, -10, 'campaign 4', 'big', -0.5);
// 停放機車（街景合併用的單一幾何，頂點色）：騎樓一排斜停
{
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const tris = [];
  for (let i = 0; i < 14; i++) {
    const geo = makeParkedScooterGeo(i * 17 + 3);
    tris.push((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(-14 + i * 0.85, 0, 24);
    m.rotation.y = -0.35 + Math.PI;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }
  items.push({ obj: new THREE.Group(), label: `parked x14 (min/max)`, tris: `${Math.min(...tris)}/${Math.max(...tris)}` });
  console.log('parked same-seed cached:', makeParkedScooterGeo(3) === makeParkedScooterGeo(3), Object.keys(makeParkedScooterGeo(3).attributes).join(','));
}
// 第四排：人、狗、遶境
x = -12;
const peds = [{}, { phone: true }, { bag: true }, { umbrella: true }, { raincoat: true }, {}, {}, { phone: true }];
peds.forEach((o, i) => { place(makePedestrian({ seed: 10 + i * 7, ...o }), x, 16, `ped ${Object.keys(o).join(',') || '一般'}`, 'peds', 0.3); x += 0.9; });
for (let i = 0; i < 3; i++) { place(makeDog({ seed: i * 3 + 1 }), x, 16, `dog ${i}`, 'peds', 0.8); x += 1.0; }
place(makeProcessionUnit('palanquin', { seed: 1 }), x + 1.5, 16, 'palanquin', 'peds', 0.4);
place(makeProcessionUnit('flag', { seed: 2 }), x + 4, 16, 'flag', 'peds', 0.4);
place(makeProcessionUnit('drum', { seed: 3 }), x + 6, 16, 'drum', 'peds', 0.4);

document.getElementById('list').textContent = items.map((i) => `${i.label.padEnd(26)} ${String(i.tris).padStart(6)} tris`).join('\n');

// ---------------------------------------------------------------- 鏡頭
const views = {
  all: [[0, 22, 38], [0, 0, 4]],
  bikes: [[-4, 3.2, 14.5], [-3.5, 0.8, 8]],
  player: [[6.5, 1.6, 11.2], [4.8, 0.8, 8]],
  playerback: [[3.6, 2.2, 3.8], [4.8, 0.9, 8]],
  cars: [[-4, 3.5, 9], [-4, 0.7, 0]],
  carsrear: [[-9.5, 2.2, -3.6], [-7.5, 0.7, 0]],
  big: [[-6, 5, 2], [-6, 1.5, -10]],
  peds: [[-5, 2.2, 21.5], [-5, 0.9, 16]],
  proc: [[4, 3, 21.5], [3.5, 1.2, 16]],
  campaign: [[16, 4.2, -3.5], [10.5, 1.4, -10]],
  parked: [[-8, 2.6, 28.5], [-8.5, 0.6, 24]],
};
let yaw = 0, pitch = 0.3, dist = 30, target = new THREE.Vector3();
function setView(name) {
  const [c, l] = views[name];
  camera.position.set(...c);
  target.set(...l);
  const d = new THREE.Vector3().subVectors(camera.position, target);
  dist = d.length(); yaw = Math.atan2(d.x, d.z); pitch = Math.asin(d.y / dist);
}
function applyOrbit() {
  camera.position.set(target.x + dist * Math.cos(pitch) * Math.sin(yaw), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(pitch) * Math.cos(yaw));
  camera.lookAt(target);
}
const vdiv = document.getElementById('views');
for (const k of Object.keys(views)) { const b = document.createElement('button'); b.textContent = k; b.onclick = () => { setView(k); applyOrbit(); }; vdiv.appendChild(b); }
setView(qs.get('view') || 'all');
if (qs.get('cam')) { camera.position.set(...qs.get('cam').split(',').map(Number)); target.set(...(qs.get('look') || '0,0,0').split(',').map(Number)); const d = new THREE.Vector3().subVectors(camera.position, target); dist = d.length(); yaw = Math.atan2(d.x, d.z); pitch = Math.asin(d.y / dist); }
applyOrbit();
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey || e.button === 2 }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.shift) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    target.addScaledVector(right, -dx * dist * 0.0015);
    target.y += dy * dist * 0.0015;
  } else { yaw -= dx * 0.005; pitch = Math.max(-0.1, Math.min(1.5, pitch + dy * 0.005)); }
  applyOrbit();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { dist = Math.max(1, dist * (1 + Math.sign(e.deltaY) * 0.1)); applyOrbit(); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// ---------------------------------------------------------------- 日夜、燈
let night = qs.get('night') === '1', brake = false, blink = false, door = false, spin = false;
function applyMode() {
  const sky = skies[night ? 'night' : 'noon'];
  scene.background = sky; scene.environment = sky;
  scene.environmentIntensity = night ? 0.35 : 1.0;
  scene.backgroundIntensity = night ? 0.8 : 1.0;
  sun.intensity = night ? 0.15 : 2.6;
  sun.color.set(night ? 0x8fa6e0 : 0xfff3e0);
  hemi.intensity = night ? 0.15 : 0.6;
  bloom.strength = night ? 0.9 : 0.35;
  for (const l of streetLights) l.intensity = night ? 40 : 0;
  for (const it of items) setLights(it.obj, { head: night, tail: night, brake, roof: night ? 1 : 0.35 });
  document.getElementById('day').classList.toggle('on', !night);
  document.getElementById('night').classList.toggle('on', night);
}
document.getElementById('day').onclick = () => { night = false; applyMode(); };
document.getElementById('night').onclick = () => { night = true; applyMode(); };
document.getElementById('brake').onclick = (e) => { brake = !brake; e.target.classList.toggle('on', brake); applyMode(); };
document.getElementById('blink').onclick = (e) => { blink = !blink; e.target.classList.toggle('on', blink); };
document.getElementById('door').onclick = (e) => { door = !door; e.target.classList.toggle('on', door); };
document.getElementById('spin').onclick = (e) => { spin = !spin; e.target.classList.toggle('on', spin); };
if (qs.get('brake') === '1') brake = true;
if (qs.get('door') === '1') door = true;
applyMode();

const clock = new THREE.Clock();
function loop() {
  const t = clock.getElapsedTime();
  const on = blink && (Math.floor(t * 2.5) % 2 === 0);
  for (const it of items) {
    const ud = it.obj.userData;
    if (ud.lights) setLights(it.obj, { blinkL: on, blinkR: on });
    if (ud.doorFL) ud.doorFL.rotation.y = THREE.MathUtils.lerp(ud.doorFL.rotation.y, door ? -1.05 : 0, 0.12);
    if (spin && ud.wheels) for (const w of ud.wheels) w.rotation.x += 0.15;
    if (ud.legL && ud.legR) { const s = Math.sin(t * 6) * 0.45; ud.legL.rotation.x = s; ud.legR.rotation.x = -s; if (!ud.phone) { ud.armL.rotation.x = -s * 0.7; ud.armR.rotation.x = s * 0.7; } }
    if (ud.legs) ud.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 9 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.5; });
    if (ud.steer) ud.steer.rotation.y = Math.sin(t) * 0.25;
  }
  composer.render();
  requestAnimationFrame(loop);
}
loop();
window.__ready = true;

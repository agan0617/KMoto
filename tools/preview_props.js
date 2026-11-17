// 街景小物件預覽：排成格子、白天光線。網址參數：?only=name1,name2 只看某幾個；?cam=x,y,z&look=x,y,z；?night=1
// 瀏覽器分頁在背景時 requestAnimationFrame 會停，所以每次改鏡頭都直接 render 一次（window.render()）。
import * as THREE from 'three';
import { loadProps, propGeo, propNames } from '../js/render/props.js';

const q = new URLSearchParams(location.search);
const night = q.get('night') === '1';
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? '#1a2030' : '#a9c1d6');
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(night ? '#5d6f9e' : '#e6f2ff', '#6e6656', night ? 0.5 : 1.3));
const sun = new THREE.DirectionalLight('#fff6e6', night ? 0.4 : 2.6);
sun.position.set(10, 22, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
const glow = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ffd890', emissiveIntensity: night ? 3 : 0.8 });

await loadProps('../assets/props.glb');
const only = q.get('only') ? q.get('only').split(',') : null;
const names = propNames().filter((n) => !n.endsWith('__glow') && (!only || only.includes(n)));
const cols = Math.ceil(Math.sqrt(names.length * 1.6));
const lines = [];
names.forEach((n, i) => {
  const g = propGeo(n);
  const sz = new THREE.Vector3(); g.boundingBox.getSize(sz);
  const x = (i % cols - (cols - 1) / 2) * 4.2, z = Math.floor(i / cols) * 5.5;
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, 0, -z); m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  try { const gg = propGeo(n + '__glow'); const mg = new THREE.Mesh(gg, glow); mg.position.copy(m.position); scene.add(mg); } catch { /* 沒有發光部件 */ }
  const tris = g.attributes.position.count / 3;
  lines.push(`${n}  ${tris} 三角面  ${sz.x.toFixed(2)}×${sz.y.toFixed(2)}×${sz.z.toFixed(2)}`);
});
document.getElementById('info').textContent = lines.join('\n');
if (q.get('ui') === '0') document.getElementById('info').style.display = 'none';

function setCam(p, l) { camera.position.set(...p); camera.lookAt(...l); }
const rows = Math.ceil(names.length / cols);
if (q.get('cam')) setCam(q.get('cam').split(',').map(Number), (q.get('look') || '0,1,0').split(',').map(Number));
else setCam([0, 9 + rows * 2, 14], [0, 1, -rows * 2.4]);

// window.solo(['ac_split','cone'])：只顯示這幾個、排成一列、鏡頭從右前方 3/4 角度框住
window.solo = (list, { yaw = 0.55, pitch = 0.28, pad = 1.25 } = {}) => {
  const objs = scene.children.filter((o) => o.isMesh && o !== ground);
  for (const o of objs) o.visible = false;
  let x = 0;
  const box = new THREE.Box3();
  for (const n of list) {
    const g = propGeo(n);
    const sz = new THREE.Vector3(); g.boundingBox.getSize(sz);
    const m = objs.find((o) => o.geometry === g);
    const gl = (() => { try { return propGeo(n + '__glow'); } catch { return null; } })();
    const mg = gl ? objs.find((o) => o.geometry === gl) : null;
    const w = Math.max(sz.x, sz.z);
    m.position.set(x + w / 2, 0, 0); m.visible = true;
    if (mg) { mg.position.copy(m.position); mg.visible = true; }
    box.expandByObject(m);
    x += w + 0.4;
  }
  const c = new THREE.Vector3(), s = new THREE.Vector3();
  box.getCenter(c); box.getSize(s);
  const r = s.length() / 2 * pad;
  const d = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const p = [c.x + Math.sin(yaw) * Math.cos(pitch) * d, c.y + Math.sin(pitch) * d, c.z + Math.cos(yaw) * Math.cos(pitch) * d];
  return window.render(p, [c.x, c.y, c.z]);
};

window.render = (p, l) => {
  if (p) setCam(p, l || [0, 1, 0]);
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return 'ok';
};
window.render();
window.addEventListener('resize', () => window.render());

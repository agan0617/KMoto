// 把一台車（vehicles.js 的 Group）裡不會動的零件依「材質類型」合併，減少繪製次數（規格 10.1）。
// 會動的（輪子、龍頭、車門）各自在自己的座標系裡合併；車燈材質（會開關）與有貼圖的材質保持原樣。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CLASS = {};
function classMat(key) {
  if (CLASS[key]) return CLASS[key];
  const o = { vertexColors: true };
  if (key === 'gloss') Object.assign(o, { roughness: 0.32, metalness: 0.25 });
  else if (key === 'metal') Object.assign(o, { roughness: 0.3, metalness: 0.85 });
  else if (key === 'glass') Object.assign(o, { roughness: 0.06, metalness: 0.4 });
  else Object.assign(o, { roughness: 0.75, metalness: 0.0 });
  CLASS[key] = new THREE.MeshStandardMaterial(o);
  return CLASS[key];
}

function classify(m) {
  if (m.map || m.emissiveMap || m.alphaMap || m.transparent || m.alphaTest > 0 || m.side === THREE.DoubleSide) return null; // 保留
  if (m.metalness > 0.6) return 'metal';
  if ((m.roughness ?? 1) < 0.15) return 'glass';
  if ((m.roughness ?? 1) < 0.5) return 'gloss';
  return 'matte';
}

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _c = new THREE.Color();

function flattenInto(node, stop, keepMats) {
  node.updateMatrixWorld(true);
  _inv.copy(node.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  const walk = (o) => {
    if (o !== node && stop.has(o)) return;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh) {
      const mat = Array.isArray(o.material) ? null : o.material;
      const key = mat && !keepMats.has(mat) ? classify(mat) : null;
      if (key) {
        let g = o.geometry.clone();
        if (g.index) g = g.toNonIndexed();
        _m.multiplyMatrices(_inv, o.matrixWorld);
        g.applyMatrix4(_m);
        const n = g.attributes.position.count;
        _c.copy(mat.color);
        const col = new Float32Array(n * 3);
        const vc = mat.vertexColors ? g.attributes.color : null;
        for (let i = 0; i < n; i++) {
          col[i * 3] = _c.r * (vc ? vc.getX(i) : 1);
          col[i * 3 + 1] = _c.g * (vc ? vc.getY(i) : 1);
          col[i * 3 + 2] = _c.b * (vc ? vc.getZ(i) : 1);
        }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        g.morphAttributes = {};
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(g);
        remove.push(o);
      }
    }
    for (const c of o.children.slice()) walk(c);
  };
  walk(node);
  for (const o of remove) {
    if (o.children.length) {
      // 底下還掛著東西：留一個空節點接住
      const holder = new THREE.Object3D();
      holder.position.copy(o.position); holder.quaternion.copy(o.quaternion); holder.scale.copy(o.scale);
      for (const c of o.children.slice()) holder.add(c);
      o.parent.add(holder);
    }
    o.parent.remove(o);
  }
  for (const [key, list] of buckets) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, classMat(key));
    mesh.castShadow = true; mesh.receiveShadow = true;
    node.add(mesh);
  }
}

export function flattenVehicle(root) {
  const ud = root.userData;
  const anim = [];
  if (ud.wheels) anim.push(...ud.wheels);
  if (ud.frontSteer) anim.push(ud.frontSteer);
  if (ud.doorFL) anim.push(ud.doorFL);
  if (ud.legL) anim.push(ud.legL, ud.legR, ud.armL, ud.armR);
  if (ud.legs) anim.push(...ud.legs);
  const stop = new Set(anim.filter(Boolean));
  const keep = new Set();
  if (ud.lights) for (const arr of Object.values(ud.lights)) for (const m of arr || []) keep.add(m);
  const saved = root.matrix.clone();
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);
  flattenInto(root, stop, keep);
  for (const a of stop) flattenInto(a, new Set([...stop].filter((x) => x !== a)), keep);
  root.matrix.copy(saved);
  return root;
}

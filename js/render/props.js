// 街景小物件（assets/props.glb，tools/blender/build_props.py 產生）。
// 用法：await loadProps() 一次 → propGeo('ac_split') 取合併好的幾何（快取）→ geo.clone() 丟進 Bucket。
// 每個幾何只有 position／normal／uv／color 四個屬性：材質色（baseColor）已乘進頂點色、沒有 index。
// 原點在底部中心，+Y 朝上，+Z 朝馬路。發光部件是另一個名稱 <name>__glow。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const geos = new Map();
const _c = new THREE.Color();

export async function loadProps(url = 'assets/props.glb') {
  if (geos.size) return;
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  for (const top of gltf.scene.children) {
    const list = [];
    top.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      // 頂層節點的局部座標（原點＝物件底部中心）：用相對於頂層的矩陣
      const m = new THREE.Matrix4().copy(top.matrixWorld).invert().multiply(o.matrixWorld);
      g.applyMatrix4(m);
      const n = g.attributes.position.count;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      _c.copy(mat.color || _c.set(1, 1, 1));
      const col = new Float32Array(n * 3);
      const vc = g.attributes.color;
      for (let i = 0; i < n; i++) {
        let r = _c.r, gg = _c.g, b = _c.b;
        if (vc) { r *= vc.getX(i); gg *= vc.getY(i); b *= vc.getZ(i); }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      g.morphAttributes = {};
      list.push(g);
    });
    if (!list.length) continue;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    geos.set(top.name, merged);
  }
}

export function propGeo(name) {
  const g = geos.get(name);
  if (!g) throw new Error('沒有這個物件：' + name);
  return g;
}

export function propNames() { return [...geos.keys()]; }

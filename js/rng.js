// 固定種子亂數（mulberry32）：同一關每次挑戰的路線、車流、事件都一樣（規格 2.3）。
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  // 依權重挑：{ key: weight }
  r.weighted = (obj) => {
    let sum = 0;
    for (const k in obj) sum += obj[k];
    let x = r() * sum;
    for (const k in obj) { x -= obj[k]; if (x <= 0) return k; }
    return Object.keys(obj)[0];
  };
  return r;
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

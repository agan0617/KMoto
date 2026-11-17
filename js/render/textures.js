// 程式畫的貼圖（規格 6.3、9.1）：磁磚外牆、窗、店面、招牌、地磚、鐵皮、路面字。
// 全部畫在 canvas 上，用 CanvasTexture 交給 three.js。圖集座標：cell(i) → [u0,v0,u1,v1]。
import * as THREE from 'three';
import { makeRng } from '../rng.js';

export const FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",sans-serif';
export const SERIF = '"Noto Serif TC","PMingLiU","Songti TC",serif';

export async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`900 64px "Noto Sans TC"`, '台灣機車行'),
        document.fonts.load(`700 64px "Noto Sans TC"`, '早餐店'),
        document.fonts.load(`900 64px "Noto Serif TC"`, '天后宮'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* 沒網路就用系統字型 */ }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}
function mix(a, b, t) {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return '#' + c.getHexString();
}

// 牆面磁磚調色盤（米白、淺綠、粉紅、灰…）
export const TILE_COLORS = ['#e6dfcd', '#d6d3c7', '#c9d6c8', '#e6c8bd', '#bcc5cc', '#d8cbb0', '#efebe3', '#c7b6a0', '#d9d0c1', '#b9c2b4', '#e3d6c6', '#a9b3b8'];

// 磁磚紋：二丁掛（磚形錯縫）、馬賽克、大方磚、洗石子
function drawTiles(g, x, y, w, h, base, kind, rng) {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  const grout = shade(base, 0.82);
  if (kind === 0) { // 二丁掛
    const tw = 26, th = 9;
    for (let yy = y, r = 0; yy < y + h; yy += th, r++) {
      for (let xx = x - (r % 2) * tw / 2; xx < x + w; xx += tw) {
        g.fillStyle = shade(base, 0.94 + rng() * 0.1);
        g.fillRect(xx + 1, yy + 1, tw - 2, th - 2);
      }
    }
    g.fillStyle = grout; g.globalAlpha = 0.25;
    for (let yy = y; yy < y + h; yy += th) g.fillRect(x, yy, w, 1);
    g.globalAlpha = 1;
  } else if (kind === 1) { // 馬賽克
    const s = 7;
    for (let yy = y; yy < y + h; yy += s) for (let xx = x; xx < x + w; xx += s) {
      g.fillStyle = shade(base, 0.9 + rng() * 0.18);
      g.fillRect(xx + 0.5, yy + 0.5, s - 1, s - 1);
    }
  } else if (kind === 2) { // 大方磚
    const s = 40;
    for (let yy = y; yy < y + h; yy += s) for (let xx = x; xx < x + w; xx += s) {
      g.fillStyle = shade(base, 0.95 + rng() * 0.07);
      g.fillRect(xx + 1, yy + 1, s - 2, s - 2);
    }
  } else { // 洗石子／粉刷
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = shade(base, 0.82 + rng() * 0.3);
      g.fillRect(x + rng() * w, y + rng() * h, 2, 2);
    }
  }
  g.restore();
}

// 往下流的水痕與髒污
function drawGrime(g, x, y, w, h, rng, amount = 1) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  for (let i = 0; i < 9 * amount; i++) {
    const sx = x + rng() * w, sw = 6 + rng() * 26, sy = y + rng() * h * 0.6;
    const grd = g.createLinearGradient(0, sy, 0, sy + h * 0.6);
    grd.addColorStop(0, 'rgba(40,36,30,0.16)');
    grd.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = grd;
    g.fillRect(sx, sy, sw, h * 0.6);
  }
  const bot = g.createLinearGradient(0, y + h * 0.75, 0, y + h);
  bot.addColorStop(0, 'rgba(30,28,25,0)');
  bot.addColorStop(1, 'rgba(30,28,25,0.22)');
  g.fillStyle = bot; g.fillRect(x, y + h * 0.75, w, h * 0.25);
  g.restore();
}

// 鋁窗（含窗簾、玻璃反光）。lit：夜晚亮燈
function drawWindow(g, x, y, w, h, rng, lit, eg) {
  const frame = rng() < 0.7 ? '#c9ccce' : '#8a6b4a';
  g.fillStyle = shade('#3b3f44', 0.8);
  g.fillRect(x - 4, y - 4, w + 8, h + 10); // 窗洞陰影
  g.fillStyle = frame;
  g.fillRect(x, y, w, h);
  const panes = rng() < 0.5 ? 2 : 3;
  const pw = (w - 6) / panes;
  for (let i = 0; i < panes; i++) {
    const px = x + 3 + i * pw + 2, py = y + 3, ph = h - 6, pww = pw - 4;
    const grd = g.createLinearGradient(px, py, px + pww, py + ph);
    grd.addColorStop(0, '#5d7286');
    grd.addColorStop(0.45, '#2e3a46');
    grd.addColorStop(1, '#4b5966');
    g.fillStyle = grd;
    g.fillRect(px, py, pww, ph);
    // 窗簾
    if (rng() < 0.65) {
      const cc = rng.pick(['#e8dcc0', '#c5d3d8', '#e2c4c4', '#d8d0b8', '#b7c7a8', '#f0eee8']);
      g.fillStyle = cc;
      g.globalAlpha = 0.85;
      const cw = pww * (0.3 + rng() * 0.7);
      g.fillRect(rng() < 0.5 ? px : px + pww - cw, py, cw, ph);
      g.globalAlpha = 0.25; g.fillStyle = '#000';
      for (let k = 0; k < 6; k++) g.fillRect(px + rng() * pww, py, 1.5, ph);
      g.globalAlpha = 1;
    }
    // 反光斜線
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.moveTo(px + pww * 0.2, py); g.lineTo(px + pww * 0.45, py); g.lineTo(px + pww * 0.05, py + ph); g.lineTo(px - pww * 0.2 + 1, py + ph); g.fill();
    if (eg && lit) {
      eg.fillStyle = rng.pick(['#ffd9a0', '#fff0d0', '#d8ecff', '#ffe6b8']);
      eg.globalAlpha = 0.65 + rng() * 0.35;
      eg.fillRect(px, py, pww, ph);
      eg.globalAlpha = 1;
    }
  }
  // 窗台
  g.fillStyle = shade(frame, 0.75);
  g.fillRect(x - 6, y + h, w + 12, 5);
}

export function buildTextures(seed = 7) {
  const rng = makeRng(seed);
  const T = {};

  // ---------- 外牆圖集：4×4 格，每格＝一層樓一個開間（寬 4.5 m、高 3.2 m） ----------
  {
    const S = 512, N = 4;
    const c = canvas(S * N, S * N), g = c.getContext('2d');
    const e = canvas(S * N, S * N), eg = e.getContext('2d');
    eg.fillStyle = '#000'; eg.fillRect(0, 0, e.width, e.height);
    T.facadeCells = [];
    for (let i = 0; i < N * N; i++) {
      const cx = (i % N) * S, cy = Math.floor(i / N) * S;
      const base = TILE_COLORS[i % TILE_COLORS.length];
      const kind = i % 4;
      drawTiles(g, cx, cy, S, S, base, kind, rng);
      // 樓板線
      g.fillStyle = shade(base, 0.78);
      g.fillRect(cx, cy + S - 18, S, 18);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(cx, cy + S - 18, S, 4);
      // 窗：一大一小或一個大窗
      const lit = rng() < 0.5;
      if (i % 3 === 0) {
        drawWindow(g, cx + 50, cy + 120, 250, 230, rng, lit, eg);
        drawWindow(g, cx + 350, cy + 170, 110, 120, rng, rng() < 0.4, eg);
      } else if (i % 3 === 1) {
        drawWindow(g, cx + 70, cy + 110, 372, 250, rng, lit, eg);
      } else {
        // 陽台落地門
        drawWindow(g, cx + 60, cy + 70, 230, 330, rng, lit, eg);
        drawWindow(g, cx + 330, cy + 150, 130, 140, rng, rng() < 0.4, eg);
      }
      drawGrime(g, cx, cy, S, S, rng, 1.2);
      T.facadeCells.push([cx / c.width, 1 - (cy + S) / c.height, (cx + S) / c.width, 1 - cy / c.height]);
    }
    T.facade = tex(c); T.facadeE = tex(e);
  }

  // ---------- 店面圖集（一樓，寬 4.5 m、高 3.4 m）：4×4 ----------
  {
    const W = 512, H = 400, N = 4;
    const c = canvas(W * N, H * N), g = c.getContext('2d');
    const e = canvas(W * N, H * N), eg = e.getContext('2d');
    eg.fillStyle = '#000'; eg.fillRect(0, 0, e.width, e.height);
    T.shopCells = [];
    const kinds = ['shutter', 'goods', 'eatery', 'mart', 'halfshutter', 'scooter', 'goods', 'eatery', 'shutter', 'pharmacy', 'goods', 'tea', 'eatery', 'halfshutter', 'goods', 'mart'];
    for (let i = 0; i < N * N; i++) {
      const cx = (i % N) * W, cy = Math.floor(i / N) * H;
      const k = kinds[i];
      // 內部
      const inner = g.createLinearGradient(0, cy, 0, cy + H);
      inner.addColorStop(0, '#5a5650'); inner.addColorStop(1, '#2c2a27');
      g.fillStyle = inner; g.fillRect(cx, cy, W, H);
      const lightIn = (alpha, col = '#fff2d6') => { eg.globalAlpha = alpha; eg.fillStyle = col; eg.fillRect(cx + 8, cy + 30, W - 16, H - 40); eg.globalAlpha = 1; };
      if (k === 'shutter' || k === 'halfshutter') {
        const down = k === 'shutter' ? H : H * (0.35 + rng() * 0.3);
        if (k === 'halfshutter') {
          // 半開：下面看得到店內
          g.fillStyle = '#7d756a'; g.fillRect(cx, cy, W, H);
          for (let r = 0; r < 6; r++) { g.fillStyle = rng.pick(['#c94f3d', '#e2b13c', '#4f8bc9', '#6aa76a', '#e6e1d6']); g.fillRect(cx + 20 + rng() * 380, cy + H - 120 + rng() * 60, 40 + rng() * 60, 30 + rng() * 40); }
          lightIn(0.5);
        }
        const col = rng.pick(['#9aa1a6', '#7f9a8c', '#a3a9ad', '#8c97a8', '#b0ab9f']);
        for (let y = cy; y < cy + down; y += 9) {
          g.fillStyle = shade(col, 0.88 + ((y / 9) % 2) * 0.12);
          g.fillRect(cx, y, W, 9);
        }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx, cy + down - 6, W, 6);
        drawGrime(g, cx, cy, W, down, rng, 0.8);
        // 塗鴉／貼紙
        if (rng() < 0.6) { g.fillStyle = '#ffffff'; g.font = `700 30px ${FONT}`; g.globalAlpha = 0.8; g.fillText(rng.pick(['停車請勿擋門', '出入口 請勿停車', '店面出租', '吉屋出售']), cx + 60, cy + 120); g.globalAlpha = 1; }
      } else {
        // 開著的店：天花板燈、貨架、商品
        g.fillStyle = '#e8e2d4'; g.fillRect(cx, cy, W, 26);
        for (let x = cx + 40; x < cx + W; x += 110) { g.fillStyle = '#fffbe8'; g.fillRect(x, cy + 8, 70, 8); eg.fillStyle = '#fff6dc'; eg.fillRect(x - 4, cy + 4, 78, 16); }
        if (k === 'goods' || k === 'mart' || k === 'pharmacy') {
          const floorCol = k === 'mart' ? '#f4f4ef' : '#cfc6b4';
          g.fillStyle = floorCol; g.fillRect(cx, cy + H - 50, W, 50);
          for (let sh = 0; sh < 4; sh++) {
            const sy = cy + 60 + sh * 70;
            g.fillStyle = '#8b8378'; g.fillRect(cx + 20, sy + 52, W - 40, 6);
            for (let x = cx + 24; x < cx + W - 30; x += 10 + rng() * 14) {
              g.fillStyle = rng.pick(['#d84a3a', '#f0c23c', '#3b7dd8', '#3fa45b', '#f2f2f2', '#e88a2c', '#b04ac0', '#2bb5b5']);
              const hh = 20 + rng() * 30;
              g.fillRect(x, sy + 52 - hh, 8 + rng() * 6, hh);
            }
          }
          if (k === 'mart') { g.fillStyle = 'rgba(200,230,255,0.25)'; g.fillRect(cx, cy, W, H); lightIn(0.95, '#f4fbff'); }
          else if (k === 'pharmacy') { g.fillStyle = '#2e9a54'; g.fillRect(cx + 200, cy + 34, 100, 18); lightIn(0.8, '#f0fff4'); }
          else lightIn(0.7);
        } else if (k === 'eatery') {
          g.fillStyle = '#d4cbb8'; g.fillRect(cx, cy + H - 60, W, 60);
          // 桌椅、鍋、不鏽鋼台
          g.fillStyle = '#c7ccd0'; g.fillRect(cx + 10, cy + H - 170, 190, 110);
          g.fillStyle = '#9ea5aa'; g.fillRect(cx + 10, cy + H - 170, 190, 10);
          for (let k2 = 0; k2 < 3; k2++) { g.fillStyle = '#444'; g.beginPath(); g.ellipse(cx + 50 + k2 * 55, cy + H - 178, 24, 10, 0, 0, Math.PI * 2); g.fill(); }
          for (let t = 0; t < 3; t++) { g.fillStyle = rng.pick(['#d93f33', '#e8e8e8', '#3a6fc4']); g.fillRect(cx + 240 + t * 85, cy + H - 110, 60, 8); g.fillRect(cx + 265 + t * 85, cy + H - 102, 8, 50); }
          for (let t = 0; t < 6; t++) { g.fillStyle = rng.pick(['#d93f33', '#3a6fc4', '#2e9a54']); g.fillRect(cx + 235 + t * 45, cy + H - 70, 22, 22); }
          // 菜單板
          g.fillStyle = '#f6efd8'; g.fillRect(cx + 230, cy + 50, 260, 140);
          g.fillStyle = '#b3261e'; g.font = `700 22px ${FONT}`;
          const menu = rng.pick([['滷肉飯 35', '雞肉飯 40', '貢丸湯 30', '燙青菜 35'], ['蛋餅 30', '蘿蔔糕 35', '鐵板麵 50', '大冰奶 30'], ['牛肉麵 160', '乾麵 50', '餛飩湯 60', '小菜 30'], ['炒飯 80', '炒麵 80', '酸辣湯 40', '水餃 6']]);
          menu.forEach((m, j) => g.fillText(m, cx + 245, cy + 82 + j * 30));
          lightIn(0.75);
        } else if (k === 'tea') {
          g.fillStyle = '#f1ece0'; g.fillRect(cx, cy + 180, W, H - 180);
          g.fillStyle = '#5b3a24'; g.fillRect(cx + 30, cy + 200, W - 60, 90);
          for (let t = 0; t < 7; t++) { g.fillStyle = rng.pick(['#e9c58c', '#d2a065', '#f5ead8', '#b98b5d']); g.fillRect(cx + 50 + t * 60, cy + 150, 30, 50); }
          g.fillStyle = '#1f1f1f'; g.fillRect(cx + 40, cy + 40, W - 80, 90);
          g.fillStyle = '#ffd56a'; g.font = `700 24px ${FONT}`;
          g.fillText('珍珠奶茶 55　紅茶 30', cx + 60, cy + 78); g.fillText('多多綠 50　鮮奶茶 60', cx + 60, cy + 112);
          eg.fillStyle = '#ffe7a0'; eg.fillRect(cx + 40, cy + 40, W - 80, 90);
          lightIn(0.8);
        } else if (k === 'scooter') {
          g.fillStyle = '#9a958c'; g.fillRect(cx, cy + H - 60, W, 60);
          for (let t = 0; t < 4; t++) {
            const x = cx + 30 + t * 115, y = cy + H - 150;
            g.fillStyle = rng.pick(['#e8e8e8', '#c62b2b', '#2b4fa8', '#222', '#9fa7ad']);
            g.beginPath(); g.ellipse(x + 50, y + 45, 50, 32, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(x + 15, y + 85, 16, 0, 7); g.arc(x + 85, y + 85, 16, 0, 7); g.fill();
          }
          g.fillStyle = '#3d3d3d'; for (let t = 0; t < 12; t++) g.fillRect(cx + 20 + t * 40, cy + 60 + (t % 3) * 30, 26, 18);
          lightIn(0.6);
        }
      }
      // 騎樓柱的陰影邊
      const sh = g.createLinearGradient(cx, 0, cx + 40, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.fillRect(cx, cy, 40, H);
      const sh2 = g.createLinearGradient(cx + W - 40, 0, cx + W, 0);
      sh2.addColorStop(0, 'rgba(0,0,0,0)'); sh2.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = sh2; g.fillRect(cx + W - 40, cy, 40, H);
      T.shopCells.push({ kind: k, uv: [cx / c.width, 1 - (cy + H) / c.height, (cx + W) / c.width, 1 - cy / c.height] });
    }
    T.shop = tex(c); T.shopE = tex(e);
  }

  // ---------- 招牌（直式 12 個、橫式 12 個） ----------
  {
    const c = canvas(2048, 2048), g = c.getContext('2d');
    T.signV = []; T.signH = [];
    const names = shuffle(rng, SHOP_NAMES.slice());
    let ni = 0;
    const next = () => names[(ni++) % names.length];
    // 直式：上半部 12 格，每格 170×1024
    for (let i = 0; i < 12; i++) {
      const x = i * 170, y = 0, w = 170, h = 1024;
      const st = rng.pick(SIGN_STYLES);
      drawSignBox(g, x, y, w, h, st);
      const name = next().replace(/\s/g, '');
      const chars = [...name].slice(0, 6);
      const fs = Math.min(140, (h - 120) / chars.length);
      g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${fs}px ${st.serif ? SERIF : FONT}`;
      chars.forEach((ch, j) => {
        const cy2 = y + 60 + fs * (j + 0.5) + ((h - 120) - fs * chars.length) / 2;
        if (st.stroke) { g.lineWidth = 8; g.strokeStyle = st.stroke; g.strokeText(ch, x + w / 2, cy2); }
        g.fillText(ch, x + w / 2, cy2);
      });
      // 電話號碼小字
      g.font = `700 22px ${FONT}`; g.fillStyle = st.sub || st.fg;
      g.save(); g.translate(x + w / 2, y + h - 34); g.fillText('☎ 2' + (6000000 + Math.floor(rng() * 3999999)), 0, 0); g.restore();
      T.signV.push([x / 2048, 1 - (y + h) / 2048, (x + w) / 2048, 1 - y / 2048]);
    }
    // 橫式：下半部 2 欄 × 6 列，每格 1024×170
    for (let i = 0; i < 12; i++) {
      const x = (i % 2) * 1024, y = 1024 + Math.floor(i / 2) * 170, w = 1024, h = 170;
      const st = rng.pick(SIGN_STYLES);
      drawSignBox(g, x, y, w, h, st);
      const name = next();
      g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 112;
      g.font = `900 ${fs}px ${st.serif ? SERIF : FONT}`;
      while (g.measureText(name).width > w - 160 && fs > 40) { fs -= 6; g.font = `900 ${fs}px ${st.serif ? SERIF : FONT}`; }
      if (st.stroke) { g.lineWidth = 8; g.strokeStyle = st.stroke; g.strokeText(name, x + w / 2, y + h / 2 + 4); }
      g.fillText(name, x + w / 2, y + h / 2 + 4);
      // 左側圖示圓
      g.fillStyle = st.fg; g.beginPath(); g.arc(x + 70, y + h / 2, 44, 0, 7); g.fill();
      g.fillStyle = st.bg; g.font = `900 52px ${FONT}`; g.fillText([...name][0], x + 70, y + h / 2 + 3);
      T.signH.push([x / 2048, 1 - (y + h) / 2048, (x + w) / 2048, 1 - y / 2048]);
    }
    T.sign = tex(c);
  }

  // ---------- 鐵皮浪板（藍、灰、鏽） ----------
  T.corr = {};
  for (const [k, col] of Object.entries({ blue: '#4f7fae', gray: '#9aa2a8', rust: '#9b6a4a', green: '#6f9a7e', white: '#d8dcde' })) {
    const c = canvas(256, 256), g = c.getContext('2d');
    for (let x = 0; x < 256; x += 16) {
      const grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, shade(col, 0.7)); grd.addColorStop(0.5, shade(col, 1.1)); grd.addColorStop(1, shade(col, 0.75));
      g.fillStyle = grd; g.fillRect(x, 0, 16, 256);
    }
    const r2 = makeRng(k.length * 31);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,70,40,${0.05 + r2() * 0.12})`; g.fillRect(r2() * 256, r2() * 256, 3 + r2() * 20, 10 + r2() * 60); }
    T.corr[k] = tex(c, { repeat: true });
  }

  // ---------- 側牆（粉刷水泥＋水痕） ----------
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    drawTiles(g, 0, 0, 512, 512, '#c9c4ba', 3, rng);
    drawGrime(g, 0, 0, 512, 512, rng, 2);
    T.wall = tex(c, { repeat: true });
  }

  // ---------- 人行道地磚（紅磚／灰磚）、騎樓磁磚 ----------
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#8a5a4a'; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 32) for (let x = (y / 32) % 2 * 32; x < 512; x += 64) {
      g.fillStyle = rng.pick(['#9a5d4c', '#a8705d', '#8c5446', '#b07a62', '#7f7a74', '#96918a']);
      g.fillRect(x + 2, y + 2, 60, 28);
    }
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(0,0,0,${rng() * 0.12})`; g.fillRect(rng() * 512, rng() * 512, 2, 2); }
    T.brick = tex(c, { repeat: true });
  }
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    for (let y = 0; y < 512; y += 64) for (let x = 0; x < 512; x += 64) {
      g.fillStyle = rng.pick(['#bdb5a6', '#c6bfb2', '#b2aa9b', '#cfc8bb']);
      g.fillRect(x, y, 64, 64);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y, 64, 2); g.fillRect(x, y, 2, 64);
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(40,30,20,0.08)'; g.beginPath(); g.arc(rng() * 512, rng() * 512, 4 + rng() * 26, 0, 7); g.fill(); }
    T.floor = tex(c, { repeat: true });
  }
  // 稻田
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#5f8f3c'; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 8) for (let x = 0; x < 512; x += 6) {
      g.fillStyle = rng.pick(['#6ea444', '#7cb04c', '#558a36', '#89ba58']);
      g.fillRect(x + rng() * 2, y, 3, 6);
    }
    g.fillStyle = 'rgba(80,110,140,0.25)'; for (let y = 0; y < 512; y += 64) g.fillRect(0, y, 512, 6);
    T.paddy = tex(c, { repeat: true });
  }
  // 路面字（慢、停、機車優先…）與待轉區
  T.text = {};
  for (const word of ['慢', '停', '機車優先', '公車專用', '禁止臨時停車', '待轉']) {
    const c = canvas(256, word.length > 1 ? 1024 : 256), g = c.getContext('2d');
    g.fillStyle = word === '禁止臨時停車' || word === '公車專用' ? '#f2d23c' : '#f3f3ee';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...word];
    const fs = word.length > 1 ? Math.min(220, 1000 / chars.length) : 220;
    g.font = `900 ${fs}px ${FONT}`;
    // 路面字是拉長的（從騎士角度看才正常）：一個字一格，由近到遠排
    chars.forEach((ch, i) => {
      g.save();
      g.translate(128, c.height - fs * (i + 0.5) - (c.height - fs * chars.length) / 2);
      g.scale(1, 1.0);
      g.fillText(ch, 0, 0);
      g.restore();
    });
    const t = tex(c);
    T.text[word] = t;
  }
  {
    const c = canvas(256, 256), g = c.getContext('2d');
    g.strokeStyle = '#f3f3ee'; g.lineWidth = 10; g.strokeRect(8, 8, 240, 240);
    g.fillStyle = '#f3f3ee';
    // 機車圖示
    g.beginPath(); g.arc(80, 170, 26, 0, 7); g.arc(180, 170, 26, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillStyle = '#f3f3ee'; g.fillRect(85, 120, 95, 30); g.fillRect(150, 80, 14, 50); g.fillRect(140, 72, 40, 10);
    T.waitBox = tex(c);
  }
  // 鐵窗（白色格柵，透明底，alphaTest）
  {
    const c = canvas(256, 256), g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f2f2ee';
    for (let x = 0; x < 256; x += 18) g.fillRect(x, 0, 5, 256);
    for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 7);
    // 花樣
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 4;
    for (let x = 9; x < 256; x += 36) { g.beginPath(); g.arc(x, 128, 10, 0, 7); g.stroke(); }
    g.fillRect(0, 249, 256, 7);
    T.grille = tex(c, { repeat: true });
  }
  // 大樓（遠景）：窗格
  {
    const c = canvas(256, 256), g = c.getContext('2d');
    const e = canvas(256, 256), eg = e.getContext('2d');
    eg.fillStyle = '#000'; eg.fillRect(0, 0, 256, 256);
    g.fillStyle = '#b9b4aa'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
      g.fillStyle = shade('#3c4652', 0.8 + rng() * 0.4); g.fillRect(x + 5, y + 8, 22, 18);
      if (rng() < 0.35) { eg.fillStyle = rng.pick(['#ffe2b0', '#fff4dc', '#d8e8ff']); eg.fillRect(x + 5, y + 8, 22, 18); }
    }
    drawGrime(g, 0, 0, 256, 256, rng, 1.5);
    T.tower = tex(c, { repeat: true }); T.towerE = tex(e, { repeat: true });
  }
  // 地面光暈（路燈照地）
  {
    const c = canvas(128, 128), g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,214,150,0.9)'); grd.addColorStop(0.5, 'rgba(255,190,120,0.35)'); grd.addColorStop(1, 'rgba(255,170,100,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    T.glow = tex(c);
  }
  // 遮雨棚條紋（夜市）
  {
    const c = canvas(256, 64), g = c.getContext('2d');
    for (let x = 0; x < 256; x += 32) { g.fillStyle = (x / 32) % 2 ? '#f4f1ea' : '#d4352b'; g.fillRect(x, 0, 32, 64); }
    T.stripe = tex(c, { repeat: true });
  }
  return T;
}

function shuffle(rng, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const SIGN_STYLES = [
  { bg: '#c8102e', fg: '#fff4c2', frame: '#f0f0f0' },
  { bg: '#ffd400', fg: '#c8102e', frame: '#c8102e' },
  { bg: '#ffffff', fg: '#1d4fa3', frame: '#1d4fa3' },
  { bg: '#0b5d3b', fg: '#ffffff', frame: '#dfe7e2' },
  { bg: '#1d4fa3', fg: '#ffffff', frame: '#e8e8e8' },
  { bg: '#ffffff', fg: '#c8102e', frame: '#c8102e' },
  { bg: '#f26b1d', fg: '#ffffff', frame: '#ffffff' },
  { bg: '#1a1a1a', fg: '#ffd400', frame: '#ffd400' },
  { bg: '#fff3d6', fg: '#7a1f0f', frame: '#7a1f0f', serif: true },
  { bg: '#7a1f0f', fg: '#ffe9a8', frame: '#e3c26a', serif: true },
  { bg: '#e6f2ff', fg: '#0a3f86', frame: '#0a3f86' },
  { bg: '#ff4fa3', fg: '#ffffff', frame: '#ffffff', stroke: '#b0105d' },
];

function drawSignBox(g, x, y, w, h, st) {
  g.fillStyle = st.frame; g.fillRect(x, y, w, h);
  const b = 10;
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  grd.addColorStop(0, shade(st.bg, 1.08)); grd.addColorStop(1, shade(st.bg, 0.9));
  g.fillStyle = grd; g.fillRect(x + b, y + b, w - b * 2, h - b * 2);
  // 髒污
  g.fillStyle = 'rgba(60,50,40,0.08)';
  g.fillRect(x + b, y + h - b - h * 0.08, w - b * 2, h * 0.08);
}

// 店名清單（不用真實品牌；規格 6.3）
export const SHOP_NAMES = [
  '早餐店', '阿美早餐', '永和豆漿', '自助餐', '滷肉飯', '雞肉飯', '牛肉麵', '陽春麵', '水餃專賣',
  '手搖飲', '大杯紅茶', '珍珠奶茶', '藥局', '健保藥局', '牙醫診所', '小兒科', '中醫診所',
  '機車行', '輪胎行', '五金行', '通訊行', '補習班', '美語補習班', '彩券行', '檳榔', '當舖',
  '洗衣店', '自助洗衣', '鎖匙', '冷氣行', '水電行', '眼鏡行', '電器行', '金飾銀樓', '房屋仲介',
  '小麥超商', 'KTV', '卡拉OK', '熱炒', '海產', '鹹酥雞', '蚵仔煎', '臭豆腐', '刈包', '鍋貼',
  '便當', '素食', '燒臘', '麻辣燙', '火鍋', '冰果室', '豆花', '剪髮', '美容院', '按摩',
  '寵物美容', '動物醫院', '文具行', '書局', '照相館', '神明佛具', '茶行', '米行', '雜貨店',
  '汽車美容', '鐵窗工程', '室內設計', '搬家公司', '快炒一百', '阿婆鐵蛋', '大腸包小腸',
];

// 其他給 props 用的：招牌隨機名
export function randomName(rng) { return rng.pick(SHOP_NAMES); }
export { shade, mix };

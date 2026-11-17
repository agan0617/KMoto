# KMoto

騎機車在台灣街頭高速狂奔、閃過車陣與三寶、趕在時限內抵達目的地的 3D 網頁遊戲。網頁版：<https://agan0617.github.io/KMoto/>（Android App 外殼在 [KMotoApp](https://github.com/agan0617/KMotoApp)）

正本規格在 [docs/spec.html](docs/spec.html)：玩法、數值、關卡、驗收標準都以規格為準，改玩法先改規格。

## 關卡

5 章、20 關，全部一開始就能玩。每關一個生活主題，倒數計時，抵達目的地才算過關；難度只由**障礙**控制（車流密度、三寶種類與頻率、路面障礙、路段、天候），機車性能每關都一樣。

| 章 | 名稱 | 路段 | 關卡 |
|---|---|---|---|
| 1 | 巷弄日常 | 巷弄、社區街道 | 蛋餅要涼了／打卡倒數 08:59／垃圾車來了！／便當忘了帶 |
| 2 | 大馬路求生 | 社區街道、市區幹道 | 珍奶冰塊要化了／趕搭高鐵／面試別遲到／午休只剩 20 分 |
| 3 | 夜市霓虹 | 夜市老街、街道、幹道 | 夜市擺攤要開了／演唱會開場前／雞排攤要收了／末班捷運 |
| 4 | 西濱與鄉間 | 省道、街道 | 拜拜供品忘了帶／回老家吃團圓飯／颱風天下班／媽祖遶境 |
| 5 | 人生大事 | 全部混合 | 跨年煙火倒數／求婚戒指忘在家／狗狗看急診／老婆快生了！ |

障礙有 22 種三寶事件（突然切車道、巷口竄出、開門殺、計程車急停、公車切出、逆向、違規迴轉、併排停車、外送員看手機、路邊起步不看、酒駕、毒駕、選舉宣傳車、右轉車切機車道、大車內輪差、行人走車道、遶境隊伍、垃圾車、流浪狗…）加上坑洞、凸起的人孔蓋、施工封路、積水、颱風側風。對應的台灣交通亂象見規格 5.8。

## 玩法

| 動作 | 鍵盤 | 觸控 |
|---|---|---|
| 油門 | 自動（按住煞車時不給油） | 自動 |
| 左右閃 | A／D、← → | 左下 ◀ ▶（手指可以滑動換邊） |
| 煞車 | S、↓ | 煞 |
| 衝刺 | 空白鍵、W、↑ | 衝 |
| 喇叭 | H、Shift | 叭 |
| 暫停 | Esc、P | 右上 Ⅱ |

- 從車旁 0.6 公尺內高速超過＝**擦身而過**，0.3 公尺內＝**驚險！**，都會累積衝刺（最多存兩次，每次 2.5 秒、140 km/h）。
- 從前後撞上車、或撞到人、狗、掉落物＝**摔車**，損失 5～6 秒；側面輕碰只是擦撞。
- 按喇叭，前方的一般車會讓路——三寶不會。
- ★ 抵達、★★ 剩餘時間達標、★★★ 剩餘時間達標而且整關沒摔車。

## 執行

靜態網站，沒有建置步驟。本機開發：

```
node tools/serve.mjs 8790
```

開 <http://localhost:8790/>；`?level=2-3` 直接開某關的開場卡。

## 目錄

| 路徑 | 內容 |
|---|---|
| `js/sim.js` | 遊戲模擬（機車物理、車流、三寶事件、碰撞、計時），不碰畫面，node 也能跑 |
| `js/route.js` | 路線中心線、路段斷面、路口與號誌 |
| `js/levels.js` | 20 關資料、障礙說明、文案 |
| `js/render/world.js` | 街景：建築、騎樓、招牌、路面標線、電線、號誌、夜市、省道、目的地 |
| `js/render/textures.js` | 程式畫的貼圖：磁磚外牆、店面、招牌、地磚、路面字 |
| `js/render/vehicles.js` | 車輛、行人、狗、玩家機車、遶境隊伍（程式建模） |
| `js/render/props.js`＋`assets/props.glb` | 街景小物件（Blender 建模，`tools/blender/build_props.py` 產生） |
| `js/render/actors.js` | 模擬裡的東西 → 3D 物件 |
| `js/main.js`、`js/audio.js` | 畫面流程、鏡頭、後製、HUD；Web Audio 即時合成音效 |

## 工具

| 指令 | 用途 |
|---|---|
| `node tools/sim.mjs normal 5` | 自動駕駛跑全部關卡：過關率、剩餘時間、摔車、擦身而過 |
| `node tools/calibrate.mjs 5` → `node tools/apply_calibration.mjs` | 依自動駕駛校準時限與星等門檻，寫回 `js/levels.js` |
| `node tools/spec_levels.mjs` | 依 `js/levels.js` 重產規格 7.2〈關卡總表〉 |
| `node tools/check_events.mjs` | 檢查每關的三寶事件都放得進路線 |
| `node tools/crashlog.mjs <關>`、`node tools/stuck.mjs <關>` | 自動駕駛每次摔車的狀況、卡住的位置 |
| `blender -b --factory-startup -P tools/blender/build_props.py` | 重產 `assets/props.glb`（Blender 4.2） |
| `tools/preview_vehicles.html`、`tools/preview_props.html` | 車輛、街景小物件的預覽頁 |

## 版權

Copyright © 2026 agan0617. All rights reserved. 保留所有權利，詳見 [LICENSE](LICENSE)。

使用的第三方素材（依各自授權）：

- 天空圖（`assets/sky/`）與路面、草地照片材質（`assets/tex/`）：[Poly Haven](https://polyhaven.com)，CC0
- [three.js](https://threejs.org) r187（`lib/three/`）：MIT License
- 字型：[Noto Sans TC／Noto Serif TC](https://fonts.google.com/noto)（Google Fonts，SIL Open Font License）
- 〈給愛麗絲〉（貝多芬）旋律為公有領域；遊戲內招牌的店名、品牌都是虛構的

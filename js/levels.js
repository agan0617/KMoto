// 關卡資料（規格第 7 章）。時限與星等門檻經 tools/sim.mjs 校準（規格〈版本歷史〉）。

// 障礙說明（開場卡「新障礙」用；規格 5.4、5.5）
export const HAZARD_INFO = {
  parked: { name: '路邊機車', hint: '巷子兩邊停滿機車，路面比看起來窄' },
  uncle: { name: '阿伯慢騎', hint: '老機車、戴斗笠的阿伯，左右飄而且不理喇叭' },
  oncoming: { name: '對向來車', hint: '雙向道路，騎到左邊要小心迎面的車' },
  light: { name: '紅綠燈路口', hint: '前車會停在停止線前，從縫鑽過去' },
  pothole: { name: '坑洞', hint: '路面的黑色破洞，壓到會減速、方向亂抖' },
  garbage: { name: '垃圾車', hint: '聽到〈給愛麗絲〉就是了，旁邊有追車的住戶' },
  ped: { name: '行人亂穿越', hint: '站在兩台停著的車中間、看著路中的人，要衝出來了' },
  alley: { name: '巷口竄出', hint: '巷口地上先照出車燈、聽到引擎聲，機車要衝出來了' },
  cutin: { name: '突然切車道', hint: '旁邊車道的車左右晃一下、不打方向燈，就要切過來' },
  bus: { name: '公車切出', hint: '站牌邊的公車打左方向燈，要切回車道了' },
  taxi: { name: '計程車急停', hint: '路邊有人招手，前面的小黃會突然停下來' },
  double: { name: '併排停車', hint: '打雙黃燈停在車道上的車' },
  cross: { name: '橫向車流', hint: '紅燈時路口有車從兩側衝過' },
  door: { name: '開門殺', hint: '路邊的車亮煞車燈、駕駛在動，門要開了' },
  crowd: { name: '夜市人潮', hint: '夜市路上到處是逛街的人' },
  phone: { name: '低頭族', hint: '看手機過馬路，走到一半還會停下來' },
  wrongway: { name: '逆向機車', hint: '自己車道遠方出現迎面的車燈' },
  uturn: { name: '違規迴轉', hint: '前車減速、車頭往左偏，要整台橫過來迴轉' },
  construction: { name: '施工封路', hint: '紅白三角錐排成斜線、閃黃燈，封住車道' },
  truck: { name: '砂石車', hint: '大車慢慢開，貼著它騎會被風壓推開' },
  dogs: { name: '流浪狗', hint: '聽到狗叫，馬上會有狗衝過馬路' },
  typhoon: { name: '颱風', hint: '雨絲角度一變就是側風要來了；路上有積水和掉落的招牌' },
  procession: { name: '遶境隊伍', hint: '鑼鼓鞭炮聲，神轎佔住大半條路，只能從一側過' },
  delivery: { name: '外送員分心', hint: '揹外送箱、低頭看手機的機車，會往旁邊飄還會急煞' },
  pullout: { name: '路邊起步不看', hint: '路邊停的車冒排氣、亮煞車燈，馬上會切出來' },
  drunk: { name: '酒駕', hint: '遠遠就看到大幅蛇行的車，時快時慢，抓它的節奏再過' },
  drugged: { name: '毒駕', hint: '一直閃大燈的車，會突然急煞、猛衝、橫移，離它遠一點' },
  walker: { name: '行人走車道', hint: '人行道被機車、攤販、變電箱塞滿，行人只好貼著路邊走在車道上' },
  rightturn: { name: '右轉車切機車道', hint: '旁邊車道的車減速、往右靠（有時連方向燈都不打），要切過你的前面右轉' },
  bigturn: { name: '大車內輪差', hint: '公車、砂石車打右方向燈、先往左擺，車尾會掃進機車道' },
  bump: { name: '補丁路', hint: '凸起的人孔蓋、挖了又補的路面，壓到會彈一下、方向亂抖' },
  campaign: { name: '選舉宣傳車', hint: '「凍蒜！」的喇叭聲，宣傳車跨兩車道慢慢開，後面還跟著插旗的機車' },
};

// 目的地（規格 6.4）
export const DESTS = {
  grandma: { label: '巷尾的阿嬤家', sign: '阿嬤家', kind: 'house' },
  office: { label: '公司大樓', sign: '宏達大樓', kind: 'office' },
  garbage: { label: '追上垃圾車', sign: '垃圾車', kind: 'garbage' },
  school: { label: '國中校門', sign: '市立明德國民中學', kind: 'school' },
  office2: { label: '辦公大樓櫃台', sign: '信義金融中心', kind: 'office' },
  hsr: { label: '高鐵站', sign: '高鐵站', kind: 'station' },
  tech: { label: '科技公司', sign: '小麥科技', kind: 'office' },
  bank: { label: '銀行', sign: '第一信託銀行', kind: 'bank' },
  market: { label: '夜市入口牌樓', sign: '小麥夜市', kind: 'marketgate' },
  arena: { label: '演唱會場館', sign: '巨蛋', kind: 'arena' },
  chicken: { label: '雞排攤', sign: '大雞排', kind: 'stall' },
  mrt: { label: '捷運站入口', sign: '捷運 市府站', kind: 'mrt' },
  temple: { label: '海邊的廟', sign: '天后宮', kind: 'temple' },
  sanheyuan: { label: '老家三合院', sign: '老家', kind: 'sanheyuan' },
  home: { label: '家門口', sign: '家', kind: 'house' },
  templeTown: { label: '廟口', sign: '鎮瀾宮', kind: 'temple' },
  plaza: { label: '市府廣場', sign: '跨年晚會', kind: 'plaza' },
  restaurant: { label: '海景餐廳', sign: '海景餐廳', kind: 'restaurant' },
  vet: { label: '動物醫院', sign: '24H 動物醫院', kind: 'vet' },
  hospital: { label: '醫院急診', sign: '急診', kind: 'hospital' },
};

const ALL = ['uncle', 'ped', 'alley', 'cutin', 'bus', 'taxi', 'double', 'door', 'wrongway', 'uturn', 'dogs', 'truck', 'delivery', 'pullout', 'drunk', 'drugged', 'campaign', 'walker', 'rightturn', 'bigturn'];

// segs：[[路段代號, 長度], ...]；dens：[同向, 對向]（每 100 m 每車道）；ev：三寶/km；hz：路障/km
// star：[★★ 門檻秒, ★★★ 門檻秒]
export const LEVELS = [
  { id: '1-1', title: '蛋餅要涼了', dest: 'grandma', segs: [['alley', 1400]], time: 'morning', limit: 71, star: [9, 16],
    dens: [0.6, 0.3], ev: 3, hz: 0, events: ['uncle'], intro: ['parked', 'uncle'],
    text: ['早餐店老闆娘：「阿嬤的蛋餅跟溫奶茶，涼了她會念喔！」', '阿嬤：「還燒的捏，乖孫！」', '蛋餅涼了，阿嬤念了半小時。'] },
  { id: '1-2', title: '打卡倒數 08:59', dest: 'office', segs: [['alley', 500], ['street', 1100]], time: 'morning', limit: 80, star: [10, 18],
    dens: [0.8, 0.5], ev: 4, hz: 1, events: ['uncle'], intro: ['oncoming', 'light', 'pothole', 'bump'],
    text: ['08:57，打卡機在等你。遲到一次扣全勤。', '08:59:59，嗶——打卡成功。', '09:00:01。全勤獎金，再見。'] },
  { id: '1-3', title: '垃圾車來了！', dest: 'garbage', segs: [['alley', 600], ['street', 1100]], time: 'dusk', limit: 83, star: [10, 18],
    dens: [0.9, 0.6], ev: 5, hz: 1, events: ['uncle', 'garbage', 'ped', 'walker'], intro: ['garbage', 'ped', 'walker'],
    text: ['〈給愛麗絲〉越來越遠了，手上還提著三包垃圾。', '趕上了！垃圾準確投進車斗。', '垃圾車轉彎走了，垃圾要在家多放一天。'] },
  { id: '1-4', title: '便當忘了帶', dest: 'school', segs: [['alley', 700], ['street', 1100]], time: 'noon', limit: 89, star: [11, 20],
    dens: [1.0, 0.7], ev: 6, hz: 2, events: ['uncle', 'ped', 'alley'], intro: ['alley'],
    text: ['兒子傳訊息：「媽說你要送便當來，第四節下課前。」', '兒子：「謝啦，爸。」（難得）', '兒子只好吃福利社麵包。'] },

  { id: '2-1', title: '珍奶冰塊要化了', dest: 'office2', segs: [['street', 600], ['avenue', 1400]], time: 'noon', limit: 96, star: [12, 21],
    dens: [1.2, 0.8], ev: 6, hz: 2, events: ['ped', 'alley', 'cutin', 'delivery'], intro: ['cutin', 'delivery'],
    text: ['外送單：珍奶半糖少冰。冰塊正在融化中。', '客人：「冰塊還在耶！五星好評。」', '客人：「這是奶茶湯吧？」一星。'] },
  { id: '2-2', title: '趕搭高鐵', dest: 'hsr', segs: [['street', 500], ['avenue', 1700]], time: 'morning', limit: 93, star: [11, 20],
    dens: [1.3, 0.8], ev: 7, hz: 2, events: ['cutin', 'alley', 'bus', 'taxi', 'delivery', 'walker'], intro: ['bus', 'taxi'],
    text: ['高鐵 10:31 發車，你 10:28 還在路上。', '車門關上前一秒，你衝進車廂。', '列車開走了，改搭下一班自由座站著回去。'] },
  { id: '2-3', title: '面試別遲到', dest: 'tech', segs: [['avenue', 2200]], time: 'noon', limit: 115, star: [14, 25],
    dens: [1.5, 0.9], ev: 8, hz: 2, events: ['cutin', 'bus', 'taxi', 'double', 'delivery', 'rightturn'], intro: ['double', 'cross', 'rightturn'],
    text: ['夢想公司的終面，十點整，人資說不等人。', '「你看起來很有衝勁。」錄取！', '人資：「我們會再通知你。」'] },
  { id: '2-4', title: '午休只剩 20 分', dest: 'bank', segs: [['street', 800], ['avenue', 1500]], time: 'noon', limit: 111, star: [13, 24],
    dens: [1.6, 0.9], ev: 9, hz: 3, events: ['cutin', 'taxi', 'double', 'door', 'ped', 'pullout'], intro: ['door', 'pullout'],
    text: ['午休剩 20 分鐘，銀行三點半關門，要匯款。', '15:29，拿到號碼牌。', '鐵門在你面前拉下來。'] },

  { id: '3-1', title: '夜市擺攤要開了', dest: 'market', segs: [['street', 900], ['market', 1100]], time: 'night', limit: 111, star: [13, 24],
    dens: [1.2, 0.8], ev: 9, hz: 2, events: ['ped', 'alley', 'door', 'uncle', 'delivery'], intro: ['crowd', 'phone'],
    text: ['夜市六點開市，攤位的瓦斯桶還在你後座。', '瓦斯接上，第一鍋開炸！', '隔壁攤把客人都搶走了。'] },
  { id: '3-2', title: '演唱會開場前', dest: 'arena', segs: [['avenue', 1500], ['street', 900]], time: 'night', limit: 119, star: [14, 26],
    dens: [1.7, 1.0], ev: 10, hz: 3, events: ['cutin', 'taxi', 'ped', 'wrongway', 'door', 'drunk'], intro: ['wrongway', 'drunk'],
    text: ['演唱會七點半開場，第一首是你最愛的歌。', '前奏剛好響起，全場尖叫。', '你在場外聽完了第一首。'] },
  { id: '3-3', title: '雞排攤要收了', dest: 'chicken', segs: [['street', 900], ['market', 800], ['street', 600]], time: 'night', limit: 134, star: [16, 29],
    dens: [1.6, 1.0], ev: 11, hz: 3, events: ['wrongway', 'uturn', 'ped', 'alley', 'door', 'pullout', 'drunk'], intro: ['uturn'],
    text: ['雞排攤老闆說今天只剩最後一塊，十點收攤。', '最後一塊雞排，切不切、要不要辣？', '老闆：「明天請早。」'] },
  { id: '3-4', title: '末班捷運', dest: 'mrt', segs: [['street', 700], ['avenue', 1900]], time: 'night', limit: 130, star: [16, 29],
    dens: [1.8, 1.0], ev: 11, hz: 5, events: ['cutin', 'uturn', 'taxi', 'bus', 'wrongway', 'double', 'drugged', 'rightturn'], intro: ['construction', 'drugged'],
    text: ['末班捷運 23:58，錯過就要搭小黃回家。', '你滑進車廂，車門關上。', '月台空了，計程車跳表中。'] },

  { id: '4-1', title: '拜拜供品忘了帶', dest: 'temple', segs: [['street', 600], ['highway', 2200]], time: 'dusk', limit: 135, star: [16, 30],
    dens: [1.4, 0.8], ev: 8, hz: 4, events: ['truck', 'cutin', 'uncle', 'uturn', 'campaign', 'bigturn'], intro: ['truck', 'campaign', 'bigturn'],
    text: ['媽說拜拜的供品放在你車上，廟口在等。', '供品到齊，阿姨們鬆了一口氣。', '拜拜只好用旁邊攤販的鳳梨。'] },
  { id: '4-2', title: '回老家吃團圓飯', dest: 'sanheyuan', segs: [['highway', 2000], ['alley', 900]], time: 'dusk', limit: 141, star: [17, 31],
    dens: [1.5, 0.8], ev: 10, hz: 4, events: ['truck', 'dogs', 'uncle', 'alley', 'wrongway', 'drunk'], intro: ['dogs'],
    text: ['除夕，全家都到了，只差你。', '「人到齊了，開飯！」', '年夜飯的雞腿被表弟吃掉了。'] },
  { id: '4-3', title: '颱風天下班', dest: 'home', segs: [['avenue', 1200], ['street', 900], ['alley', 700]], time: 'rain', weather: 'typhoon', limit: 129, star: [15, 28],
    dens: [1.3, 0.8], ev: 10, hz: 6, events: ['cutin', 'taxi', 'double', 'door', 'alley', 'dogs', 'delivery', 'drugged'], intro: ['typhoon'],
    text: ['颱風警報發布，公司宣布提早下班，風雨越來越大。', '你濕透地進門，泡麵已經煮好了。', '你在騎樓躲雨躲到天亮。'] },
  { id: '4-4', title: '媽祖遶境', dest: 'templeTown', segs: [['street', 1200], ['highway', 1000], ['street', 800]], time: 'dusk', limit: 159, star: [19, 35],
    dens: [1.6, 0.9], ev: 12, hz: 4, events: ['procession', 'ped', 'alley', 'uturn', 'dogs', 'truck', 'campaign', 'drunk'], intro: ['procession'],
    text: ['你是遶境隊伍的鑼手，鑼還在你家。', '鑼聲響起，隊伍出發！', '隊伍只好用手機放鑼聲。'] },

  { id: '5-1', title: '跨年煙火倒數', dest: 'plaza', segs: [['street', 800], ['avenue', 1600], ['market', 600]], time: 'night', limit: 144, star: [17, 32],
    dens: [2.2, 1.2], ev: 13, hz: 5, events: ALL, intro: [],
    text: ['跨年倒數只剩幾分鐘，朋友都在廣場等你。', '「5、4、3、2、1——新年快樂！」', '你在路上看到煙火，從後照鏡。'] },
  { id: '5-2', title: '求婚戒指忘在家', dest: 'restaurant', segs: [['alley', 600], ['street', 900], ['highway', 1700]], time: 'dusk', limit: 151, star: [18, 33],
    dens: [2.2, 1.2], ev: 14, hz: 6, events: ALL, intro: [],
    text: ['求婚就在今晚，戒指卻還在家裡的抽屜。', '單膝跪下：「嫁給我好嗎？」她說好。', '她等到餐廳打烊。（戒指還在口袋裡）'] },
  { id: '5-3', title: '狗狗看急診', dest: 'vet', segs: [['street', 900], ['avenue', 1500], ['street', 900]], time: 'rain', weather: 'rain', limit: 173, star: [21, 38],
    dens: [2.4, 1.3], ev: 15, hz: 7, events: [...ALL, 'garbage'], intro: [],
    text: ['狗狗吃了巧克力，獸醫院的急診在等。', '醫生：「送來得及時，沒事了。」', '醫生說下次要更快一點。（狗狗還是沒事）'] },
  { id: '5-4', title: '老婆快生了！', dest: 'hospital', segs: [['alley', 500], ['street', 900], ['avenue', 1400], ['street', 800]], time: 'night', limit: 197, star: [24, 43],
    dens: [2.8, 1.5], ev: 16, hz: 8, events: [...ALL, 'garbage', 'procession'], intro: [], passenger: 'wife',
    text: ['半夜兩點，老婆：「要生了！」羊水破了，醫院在等你們。', '護理師：「恭喜，是個健康的寶寶！」', '寶寶在計程車上出生了。（母子均安）'] },
];

export const CHAPTERS = [
  { n: 1, name: '巷弄日常' },
  { n: 2, name: '大馬路求生' },
  { n: 3, name: '夜市霓虹' },
  { n: 4, name: '西濱與鄉間' },
  { n: 5, name: '人生大事' },
];

for (const lv of LEVELS) {
  lv.ch = Number(lv.id[0]);
  lv.length = lv.segs.reduce((a, s) => a + s[1], 0);
  if (!lv.star) lv.star = [Math.round(lv.limit * 0.12), Math.round(lv.limit * 0.22)];
}

export function levelById(id) { return LEVELS.find((l) => l.id === id); }

// 機車操控參數（規格第 4 章）。數值改了要同步改規格。
export const TUNING = {
  maxSpeed: 36.1,     // 一般極速 m/s（130 km/h）
  boostSpeed: 13.9,   // 衝刺多加的極速（→180 km/h）
  accel: 11,          // 加速度 m/s²
  boostAccel: 18,     // 衝刺中加速度
  brake: 20,          // 煞車減速度
  latBase: 4.5,       // 橫移上限＝latBase＋latGain×min(1,v/maxSpeed)
  latGain: 4.5,
  latResp: 10,        // 橫向速度追目標的速率
  boostMax: 2,        // 最多存幾次衝刺
  boostTime: 2.5,     // 衝刺持續秒數
  nearGap: 0.6,       // 擦身而過的左右間隙
  closeGap: 0.3,      // 驚險
  nearMinSpeed: 15,   // 擦身而過的最低車速
  nearGain: 0.25,
  closeGain: 0.4,
  crashSpeed: 6,      // 前後接近速度超過這個＝摔車
  crashSlide: 1.8,    // 摔車滑行秒數
  crashFade: 0.6,     // 淡出淡入秒數
  slipResp: 1.5,      // 積水打滑時的轉向反應（規格 5.5）
  slipBrake: 0.4,     // 打滑時煞車剩幾成
  slipAfter: 0.4,     // 離開水面後還滑幾秒
  invuln: 2.0,        // 復位後無敵秒數
  hornCooldown: 0.8,
  hornRange: 35,
  bikeLen: 1.8,
  bikeWid: 0.7,
};

export const STEP = 1 / 120;

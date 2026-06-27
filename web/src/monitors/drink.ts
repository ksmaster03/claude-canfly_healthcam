/**
 * ตรวจการดื่มน้ำแบบหยาบจากท่าทาง (pose) — เตือนเมื่อไม่ได้ดื่มนานเกินกำหนด
 * (พอร์ตจาก monitors/drink.py)
 *
 * หลักการ: ถือว่า "กำลังดื่ม" เมื่อข้อมือยกเข้าใกล้ปาก (ยกแก้ว/ขวดขึ้นจิบ)
 * ค้างไว้ครู่หนึ่ง เมื่อพบการดื่มจะรีเซ็ตตัวจับเวลา ถ้าไม่พบการดื่มเกิน
 * remindAfter วินาที = สมควรเตือนให้ดื่มน้ำ
 *
 * ใช้ pose landmarks ของ MediaPipe:
 *   ปาก = mouth_left(9), mouth_right(10) | ข้อมือ = left(15), right(16)
 *   ไหล่ = left(11), right(12) ใช้เป็นสเกล normalize ระยะ
 *
 * หมายเหตุ: เป็นการเดาจากท่าทาง อาจไม่จับทุกครั้งหรือจับผิดบ้าง
 * ใช้เป็นตัวช่วยเตือน ไม่ใช่การวัดแม่นยำ
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

const MOUTH_L = 9;
const MOUTH_R = 10;
const L_WRIST = 15;
const R_WRIST = 16;
const L_SHOULDER = 11;
const R_SHOULDER = 12;

const _NEAR_RATIO = 0.85; // ข้อมือใกล้ปากภายในกี่เท่าของช่วงไหล่ ถือว่าจ่อปาก
const _HOLD_SECONDS = 0.6; // ต้องจ่อค้างนานเท่านี้ถึงนับว่าดื่ม (กันการแกว่งผ่าน)
const _DEBOUNCE = 30.0; // จิบรวดเดียวกันไม่นับซ้ำภายในกี่วินาที

export class DrinkMonitor {
  lastDrink: number;
  drinkCount = 0;
  drinking = false; // กำลังจ่อปากอยู่ไหม (ไว้โชว์สถานะ)

  private remindAfter: number;
  private nearStart: number | null = null;

  constructor(remindAfterSeconds: number, startTime: number) {
    this.remindAfter = remindAfterSeconds;
    this.lastDrink = startTime; // เริ่มนับจากตอนเปิดโปรแกรม
  }

  update(lm: NormalizedLandmark[], _w: number, _h: number, tSec: number): void {
    const ml = lm[MOUTH_L];
    const mr = lm[MOUTH_R];
    const ls = lm[L_SHOULDER];
    const rs = lm[R_SHOULDER];
    const wrists = [lm[L_WRIST], lm[R_WRIST]];
    if (!ml || !mr || !ls || !rs || !wrists[0] || !wrists[1]) return;

    const shoulderW = Math.abs(ls.x - rs.x);
    if (shoulderW < 1e-3) return;
    const mouthX = (ml.x + mr.x) / 2.0;
    const mouthY = (ml.y + mr.y) / 2.0;

    // ใช้เฉพาะข้อมือที่มองเห็นพอควร แล้วหาค่าที่ใกล้ปากที่สุด
    const visible = wrists.filter((p) => (p.visibility ?? 1) >= 0.3);
    if (visible.length === 0) {
      this.drinking = false;
      this.nearStart = null;
      return;
    }
    let nearest = Infinity;
    for (const p of visible) {
      const d =
        Math.sqrt((p.x - mouthX) ** 2 + (p.y - mouthY) ** 2) / shoulderW;
      if (d < nearest) nearest = d;
    }

    this.drinking = nearest < _NEAR_RATIO;
    if (this.drinking) {
      if (this.nearStart === null) {
        this.nearStart = tSec;
      } else if (tSec - this.nearStart >= _HOLD_SECONDS) {
        // จ่อปากค้างพอแล้ว = นับเป็นการดื่ม + รีเซ็ตตัวจับเวลา
        if (tSec - this.lastDrink > _DEBOUNCE) {
          this.drinkCount += 1;
        }
        this.lastDrink = tSec;
      }
    } else {
      this.nearStart = null;
    }
  }

  secondsSinceDrink(now: number): number {
    return now - this.lastDrink;
  }

  due(now: number): boolean {
    return this.secondsSinceDrink(now) >= this.remindAfter;
  }
}

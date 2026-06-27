/**
 * ตรวจท่านั่ง (สำหรับกล้องที่มองด้านหน้า เช่นเว็บแคมโน้ตบุ๊ก) — พอร์ตจาก monitors/posture.py
 *
 * วัด 2 อย่างจาก pose landmarks:
 *   1) ไหล่เอียง (shoulder tilt) — ไหล่สองข้างควรอยู่ระดับเดียวกัน
 *   2) คอยื่น/หลังค่อม — เวลานั่งหลังค่อมโน้มเข้าหาจอ จมูกจะเข้าใกล้แนวไหล่
 *      เราวัดระยะแนวตั้ง จมูก->แนวไหล่ แล้ว normalize ด้วยความกว้างไหล่
 *      (กันผลจากการที่ผู้ใช้นั่งใกล้/ไกลกล้องต่างกัน) เทียบกับค่า baseline
 *      ที่ผู้ใช้ calibrate ตอนนั่งท่าตรง
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

const NOSE = 0;
const L_SHOULDER = 11;
const R_SHOULDER = 12;

const _TILT_LIMIT_DEG = 7.0; // ไหล่เอียงเกินกี่องศาถือว่าไม่ดี
const _SLOUCH_DROP = 0.15; // ระยะคอยุบลงกี่ % จาก baseline ถือว่าหลังค่อม

export class PostureMonitor {
  baselineRatio: number | null = null;
  tiltDeg = 0.0;
  slouch = false;
  status: string = "calibrate"; // calibrate | good | bad

  /** เรียกตอนผู้ใช้นั่งท่าตรงดี เพื่อจำค่ามาตรฐาน */
  calibrate(lm: NormalizedLandmark[], w: number, h: number): boolean {
    const ratio = this.neckRatio(lm, w, h);
    if (ratio) {
      this.baselineRatio = ratio;
      return true;
    }
    return false;
  }

  private neckRatio(lm: NormalizedLandmark[], w: number, h: number): number | null {
    const nose = lm[NOSE];
    const ls = lm[L_SHOULDER];
    const rs = lm[R_SHOULDER];
    // ต้องเห็นจุดทั้งสามชัดพอ
    if (Math.min(nose.visibility ?? 1, ls.visibility ?? 1, rs.visibility ?? 1) < 0.5) {
      return null;
    }
    const shoulderWidth = Math.abs(ls.x - rs.x);
    if (shoulderWidth < 1e-3) {
      return null;
    }
    const shoulderMidY = (ls.y + rs.y) / 2.0;
    return (shoulderMidY - nose.y) / shoulderWidth;
  }

  update(lm: NormalizedLandmark[], w: number, h: number): string {
    const ls = lm[L_SHOULDER];
    const rs = lm[R_SHOULDER];

    // มุมเอียงไหล่ (shoulder tilt)
    const dx = (rs.x - ls.x) * w;
    const dy = (rs.y - ls.y) * h;
    const tilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    this.tiltDeg = tilt > 90 ? 180 - tilt : tilt;

    // ตรวจหลังค่อมเทียบ baseline
    const ratio = this.neckRatio(lm, w, h);
    if (ratio && this.baselineRatio) {
      const drop = (this.baselineRatio - ratio) / this.baselineRatio;
      this.slouch = drop > _SLOUCH_DROP;
    } else {
      this.slouch = false;
    }

    if (this.baselineRatio === null) {
      this.status = "calibrate";
    } else {
      const good = this.tiltDeg < _TILT_LIMIT_DEG && !this.slouch;
      this.status = good ? "good" : "bad";
    }
    return this.status;
  }
}

/**
 * ตรวจดวงตา: นับการกะพริบ + ตรวจความง่วง (ตาปิดค้าง) — พอร์ตจาก monitors/eyes.py
 *
 * ใช้ค่า EAR (Eye Aspect Ratio) — อัตราส่วนความสูงต่อความกว้างของดวงตา
 * ตาเปิด EAR สูง / ตาหรี่หรือปิด EAR ต่ำ
 *
 * ประโยชน์:
 *   - อัตรากะพริบต่ำผิดปกติ (< ~8 ครั้ง/นาที) = เพ่งจอนาน เสี่ยงตาแห้ง
 *   - ตาปิดค้างนาน = ง่วง/หลับใน (PERCLOS)
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ดัชนี landmark ของ MediaPipe FaceMesh สำหรับจุดรอบดวงตา (6 จุดต่อข้าง)
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

/** ระยะทางแบบยุคลิด (Euclidean distance) ระหว่างจุดสองจุด */
function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** คำนวณค่า EAR จากจุด landmark 6 จุดของดวงตาหนึ่งข้าง */
function eyeAspectRatio(
  landmarks: NormalizedLandmark[],
  idx: number[],
  w: number,
  h: number,
): number {
  // แปลงพิกัด normalized (0..1) เป็นพิกเซลตามขนาดเฟรม
  const pts: [number, number][] = idx.map((i) => [landmarks[i].x * w, landmarks[i].y * h]);
  const [p1, p2, p3, p4, p5, p6] = pts;

  const vertical = dist(p2, p6) + dist(p3, p5); // ความสูงเปลือกตา (สองคู่)
  const horizontal = 2.0 * dist(p1, p4); // ความกว้างหัวตา-หางตา
  return horizontal ? vertical / horizontal : 0.0;
}

export class EyeMonitor {
  ear = 0.0;
  blinkCount = 0;
  drowsy = false;

  private eyeClosed = false;
  private closedStart: number | null = null;
  private blinkTimes: number[] = []; // เก็บเวลากะพริบ 60 วินาทีล่าสุด

  constructor(
    private earThreshold = 0.21, // ต่ำกว่านี้ถือว่าตาปิด
    private drowsySeconds = 1.2, // ปิดค้างนานเกินนี้ = ง่วง
  ) {}

  update(lm: NormalizedLandmark[], w: number, h: number, tSec: number): void {
    const left = eyeAspectRatio(lm, LEFT_EYE, w, h);
    const right = eyeAspectRatio(lm, RIGHT_EYE, w, h);
    this.ear = (left + right) / 2.0;

    if (this.ear < this.earThreshold) {
      // ตาปิดอยู่
      if (!this.eyeClosed) {
        this.eyeClosed = true;
        this.closedStart = tSec;
      } else if (this.closedStart !== null && tSec - this.closedStart >= this.drowsySeconds) {
        this.drowsy = true; // ปิดค้างนานเกินไป
      }
    } else {
      // ตาเปิด
      if (this.eyeClosed && this.closedStart !== null) {
        const closedDur = tSec - this.closedStart;
        // ปิดสั้น ๆ แล้วเปิด = นับเป็นการกะพริบ 1 ครั้ง
        if (closedDur < this.drowsySeconds) {
          this.blinkCount += 1;
          this.blinkTimes.push(tSec);
        }
      }
      this.eyeClosed = false;
      this.drowsy = false;
    }

    // คงไว้เฉพาะการกะพริบในช่วง 60 วินาทีล่าสุด
    while (this.blinkTimes.length && tSec - this.blinkTimes[0] > 60) {
      this.blinkTimes.shift();
    }
  }

  /** จำนวนกะพริบใน 60 วินาทีล่าสุด */
  get blinkRate(): number {
    return this.blinkTimes.length;
  }
}

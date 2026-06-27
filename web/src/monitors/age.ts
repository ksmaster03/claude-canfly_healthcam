/**
 * ประเมินอายุจากใบหน้า (แรงบันดาลใจจาก face-api.js — AgeGenderNet)
 *
 * ใช้ @vladmandic/face-api (fork ที่ maintain + รองรับ TF.js ใหม่) รัน
 * AgeGenderNet บนภาพ crop ใบหน้าที่ตัดจาก MediaPipe landmarks ที่มีอยู่แล้ว
 * (ไม่ต้องโหลด face detector ซ้ำ) อายุเปลี่ยนช้า จึง predict ทุก ๆ ไม่กี่วินาที
 *
 * โหลด TF.js แบบ dynamic import เพื่อไม่ให้ bundle หลักใหญ่ — TF จะถูกโหลด
 * ก็ต่อเมื่อเริ่มใช้งานจริงเท่านั้น
 */
export class AgeMonitor {
  age: number | null = null;
  ready = false;

  private faceapi: typeof import("@vladmandic/face-api") | null = null;
  private busy = false;
  private lastRun = -1e9;

  constructor(private intervalSec = 2) {}

  /** โหลด TF.js + โมเดลครั้งเดียว (เรียกตอนเริ่ม) */
  async load(): Promise<void> {
    if (this.ready) return;
    const faceapi = await import("@vladmandic/face-api");
    await faceapi.nets.ageGenderNet.loadFromUri("/face-api-models");
    this.faceapi = faceapi;
    this.ready = true;
  }

  /** เรียกได้ทุกเฟรม แต่จะ predict จริงทุก intervalSec (async, ไม่บล็อก) */
  update(faceCanvas: HTMLCanvasElement, tSec: number): void {
    if (!this.ready || this.busy || !this.faceapi) return;
    if (tSec - this.lastRun < this.intervalSec) return;
    this.lastRun = tSec;
    this.busy = true;
    this.faceapi.nets.ageGenderNet
      .predictAgeAndGender(faceCanvas)
      .then((r) => {
        const pred = Array.isArray(r) ? r[0] : r; // input เดียว -> ผลเดียว
        if (!pred) return;
        // smooth เล็กน้อยกันค่ากระโดด
        this.age =
          this.age == null ? pred.age : 0.7 * this.age + 0.3 * pred.age;
      })
      .catch(() => {})
      .finally(() => {
        this.busy = false;
      });
  }
}

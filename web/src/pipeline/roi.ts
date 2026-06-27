/**
 * ดึงค่าเฉลี่ย R/G/B ของบริเวณหน้าผาก จากเฟรมวิดีโอ + face landmarks
 * (เทียบเท่า forehead_roi ใน health_cam.py)
 *
 * วาดเฉพาะกล่อง ROI ลง offscreen canvas เล็ก ๆ แล้ว getImageData → เฉลี่ยสี
 * หมายเหตุ: วิดีโอที่โชว์ถูก mirror ด้วย CSS เท่านั้น พิกเซลจริงไม่ mirror
 * landmark จึงตรงกับพิกเซลที่ drawImage พอดี
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

const SIDES = [67, 297];
const TOP = 10;
const BOTTOM = 9;

export interface RGBMean {
  r: number;
  g: number;
  b: number;
}

export function sampleForeheadRGB(
  video: HTMLVideoElement,
  lm: NormalizedLandmark[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): RGBMean | null {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return null;

  const xs = SIDES.map((i) => lm[i].x * W);
  let x1 = Math.min(...xs);
  let x2 = Math.max(...xs);
  let y1 = lm[TOP].y * H;
  let y2 = lm[BOTTOM].y * H;

  // หดขอบเข้า กันเส้นผม/คิ้ว
  const padX = (x2 - x1) * 0.15;
  const padY = (y2 - y1) * 0.2;
  x1 = Math.max(0, Math.floor(x1 + padX));
  x2 = Math.min(W, Math.floor(x2 - padX));
  y1 = Math.max(0, Math.floor(y1 + padY));
  y2 = Math.min(H, Math.floor(y2 - padY));

  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 10 || h < 10) return null;

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, x1, y1, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let r = 0, g = 0, b = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / n, g: g / n, b: b / n };
}

/** ตัดภาพใบหน้าทั้งหน้า (จาก min/max ของ landmarks) ลง canvas 224x224 สำหรับโมเดลวัดอายุ */
export function cropFaceToCanvas(
  video: HTMLVideoElement,
  lm: NormalizedLandmark[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  margin = 0.2
): boolean {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) return false;

  let minx = 1, miny = 1, maxx = 0, maxy = 0;
  for (const p of lm) {
    if (p.x < minx) minx = p.x;
    if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.y > maxy) maxy = p.y;
  }
  let x1 = minx * W, y1 = miny * H, x2 = maxx * W, y2 = maxy * H;
  const mw = (x2 - x1) * margin;
  const mh = (y2 - y1) * margin;
  x1 = Math.max(0, Math.floor(x1 - mw));
  y1 = Math.max(0, Math.floor(y1 - mh));
  x2 = Math.min(W, Math.floor(x2 + mw));
  y2 = Math.min(H, Math.floor(y2 + mh));
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 20 || h < 20) return false;

  canvas.width = 224;
  canvas.height = 224;
  ctx.drawImage(video, x1, y1, w, h, 0, 0, 224, 224);
  return true;
}

/** กล่อง ROI (พิกัดพิกเซลในวิดีโอ) ไว้วาดกรอบบน overlay */
export function foreheadBox(
  video: HTMLVideoElement,
  lm: NormalizedLandmark[]
): { x: number; y: number; w: number; h: number } | null {
  const W = video.videoWidth;
  const H = video.videoHeight;
  const xs = SIDES.map((i) => lm[i].x * W);
  let x1 = Math.min(...xs);
  let x2 = Math.max(...xs);
  let y1 = lm[TOP].y * H;
  let y2 = lm[BOTTOM].y * H;
  const padX = (x2 - x1) * 0.15;
  const padY = (y2 - y1) * 0.2;
  x1 += padX; x2 -= padX; y1 += padY; y2 -= padY;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 10 || h < 10) return null;
  return { x: x1, y: y1, w, h };
}

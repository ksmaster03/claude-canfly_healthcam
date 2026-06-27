/**
 * Emotion — ตรวจจับอารมณ์/สีหน้า (mood) จาก MediaPipe blendshapes (พอร์ตจาก monitors/emotion.py)
 *
 * แนวคิดได้แรงบันดาลใจจาก face-api.js (FaceExpressionNet ที่แยก 7 อารมณ์)
 * แต่แทนที่จะใช้โมเดลแยกแบบ TensorFlow.js เราใช้ "blendshapes" 52 ค่าที่
 * โมเดล face_landmarker.task ของ MediaPipe ให้มาอยู่แล้ว (เปิด flag
 * outputFaceBlendshapes=true) — เป็นคะแนน 0..1 ของกล้ามเนื้อใบหน้าแต่ละจุด
 * เช่น mouthSmile, browDown, jawOpen แล้วแมปเป็นอารมณ์ด้วยกฎที่อ่านเข้าใจได้
 *
 * ใช้คู่กับ StressMonitor (HRV) ได้ดี: stress = สัญญาณทางสรีระ,
 * emotion = สัญญาณจากสีหน้า → เห็นภาพ "สภาพจิตใจ" รอบด้านขึ้น
 *
 * ⚠️ เป็นการประมาณจากสีหน้า ไม่ใช่การวัดอารมณ์ที่แท้จริงของคน
 */

// อารมณ์ 7 แบบเทียบ face-api.js (happy, sad, angry, fearful, disgusted, surprised, neutral)
const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "fearful", "disgusted"] as const;

// ป้ายอารมณ์ -> เป็นบวก(+)/ลบ(-)/กลาง(0) สำหรับคำนวณ valence (โทนอารมณ์รวม)
const _VALENCE: Record<string, number> = {
  happy: +1.0,
  neutral: 0.0,
  surprised: 0.0,
  sad: -1.0,
  angry: -1.0,
  fearful: -1.0,
  disgusted: -1.0,
};

/** หนึ่ง category จาก MediaPipe FaceLandmarker blendshapes (JS API = camelCase) */
interface Blendshape {
  categoryName: string;
  score: number;
}

export class EmotionMonitor {
  private smoothing: number; // ยิ่งสูงยิ่งนิ่ง (กรองการกระตุก)
  private minScore: number; // ต่ำกว่านี้ถือว่า neutral

  scores: Record<string, number>;
  emotion: string;
  valence: number; // -1..+1 (ลบ=แย่ บวก=ดี) ไว้ดูแนวโน้ม mood

  constructor(smoothing = 0.6, minScore = 0.2) {
    this.smoothing = smoothing;
    this.minScore = minScore;
    this.scores = {};
    for (const e of EMOTIONS) this.scores[e] = 0.0;
    this.emotion = "neutral";
    this.valence = 0.0;
  }

  /** blendshapes = list ของ category ที่มี .categoryName และ .score */
  update(blendshapes: Blendshape[]): void {
    const b: Record<string, number> = {};
    for (const c of blendshapes) b[c.categoryName] = Number(c.score);

    const avg = (...names: string[]): number => {
      const vals = names.map((n) => (n in b ? b[n] : 0.0));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0.0;
    };

    // แมป blendshapes -> คะแนนดิบของแต่ละอารมณ์ (กฎที่ปรับจูนได้)
    const raw: Record<string, number> = {
      happy: avg("mouthSmileLeft", "mouthSmileRight"),
      surprised:
        0.5 * avg("browInnerUp") +
        0.25 * avg("eyeWideLeft", "eyeWideRight") +
        0.25 * avg("jawOpen"),
      angry:
        0.6 * avg("browDownLeft", "browDownRight") +
        0.4 * avg("mouthPressLeft", "mouthPressRight"),
      sad:
        0.5 * avg("mouthFrownLeft", "mouthFrownRight") +
        0.3 * avg("browInnerUp") +
        0.2 * avg("mouthShrugLower"),
      disgusted:
        0.6 * avg("noseSneerLeft", "noseSneerRight") +
        0.4 * avg("mouthUpperUpLeft", "mouthUpperUpRight"),
      fearful:
        0.4 * avg("eyeWideLeft", "eyeWideRight") +
        0.3 * avg("browInnerUp") +
        0.3 * avg("mouthStretchLeft", "mouthStretchRight"),
    };

    // neutral สูงเมื่อไม่มีอารมณ์ใดเด่น
    const rawVals = Object.values(raw);
    const strongest = rawVals.length ? Math.max(...rawVals) : 0.0;
    raw["neutral"] = Math.max(0.0, 1.0 - 1.6 * strongest);

    // smooth ทุกอารมณ์ (EMA) กันค่ากระตุกเฟรมต่อเฟรม
    for (const emo of EMOTIONS) {
      const next = emo in raw ? raw[emo] : 0.0;
      this.scores[emo] = this.smoothing * this.scores[emo] + (1 - this.smoothing) * next;
    }

    // อารมณ์ที่คะแนนสูงสุด (ถ้าอารมณ์ที่ไม่ใช่ neutral ยังอ่อนเกินไป -> neutral)
    const ranked = Object.entries(this.scores).sort((a, b2) => b2[1] - a[1]);
    let top = ranked[0][0];
    const topScore = ranked[0][1];
    if (top !== "neutral" && topScore < this.minScore) top = "neutral";
    this.emotion = top;

    // valence = โทนรวม (ถ่วงด้วยคะแนน) ไว้ทำกราฟ mood ภายหลัง
    const total = Object.values(this.scores).reduce((s, v) => s + v, 0) || 1.0;
    let weighted = 0.0;
    for (const [e, s] of Object.entries(this.scores)) weighted += _VALENCE[e] * s;
    this.valence = weighted / total;
  }
}

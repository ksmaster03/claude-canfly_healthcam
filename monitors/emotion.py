"""
ตรวจจับอารมณ์/สีหน้า (mood) จาก MediaPipe blendshapes

แนวคิดได้แรงบันดาลใจจาก face-api.js (FaceExpressionNet ที่แยก 7 อารมณ์)
แต่แทนที่จะใช้โมเดลแยกแบบ TensorFlow.js เราใช้ "blendshapes" 52 ค่าที่
โมเดล face_landmarker.task ของ MediaPipe ให้มาอยู่แล้ว (เปิด flag
output_face_blendshapes=True) — เป็นคะแนน 0..1 ของกล้ามเนื้อใบหน้าแต่ละจุด
เช่น mouthSmile, browDown, jawOpen แล้วแมปเป็นอารมณ์ด้วยกฎที่อ่านเข้าใจได้

ใช้คู่กับ StressMonitor (HRV) ได้ดี: stress = สัญญาณทางสรีระ,
emotion = สัญญาณจากสีหน้า → เห็นภาพ "สภาพจิตใจ" รอบด้านขึ้น

⚠️ เป็นการประมาณจากสีหน้า ไม่ใช่การวัดอารมณ์ที่แท้จริงของคน
"""

# อารมณ์ 7 แบบเทียบ face-api.js (happy, sad, angry, fearful, disgusted, surprised, neutral)
EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "fearful", "disgusted"]

# ป้ายอารมณ์ -> เป็นบวก(+)/ลบ(-)/กลาง(0) สำหรับคำนวณ valence (โทนอารมณ์รวม)
_VALENCE = {"happy": +1.0, "neutral": 0.0, "surprised": 0.0,
            "sad": -1.0, "angry": -1.0, "fearful": -1.0, "disgusted": -1.0}


class EmotionMonitor:
    def __init__(self, smoothing: float = 0.6, min_score: float = 0.20):
        self.smoothing = smoothing      # ยิ่งสูงยิ่งนิ่ง (กรองการกระตุก)
        self.min_score = min_score      # ต่ำกว่านี้ถือว่า neutral
        self.scores: dict[str, float] = {e: 0.0 for e in EMOTIONS}
        self.emotion: str = "neutral"
        self.valence: float = 0.0       # -1..+1 (ลบ=แย่ บวก=ดี) ไว้ดูแนวโน้ม mood

    def update(self, blendshapes) -> None:
        """blendshapes = list ของ category ที่มี .category_name และ .score"""
        b = {c.category_name: float(c.score) for c in blendshapes}

        def avg(*names):
            vals = [b.get(n, 0.0) for n in names]
            return sum(vals) / len(vals) if vals else 0.0

        # แมป blendshapes -> คะแนนดิบของแต่ละอารมณ์ (กฎที่ปรับจูนได้)
        raw = {
            "happy":     avg("mouthSmileLeft", "mouthSmileRight"),
            "surprised": 0.5 * avg("browInnerUp")
                         + 0.25 * avg("eyeWideLeft", "eyeWideRight")
                         + 0.25 * avg("jawOpen"),
            "angry":     0.6 * avg("browDownLeft", "browDownRight")
                         + 0.4 * avg("mouthPressLeft", "mouthPressRight"),
            "sad":       0.5 * avg("mouthFrownLeft", "mouthFrownRight")
                         + 0.3 * avg("browInnerUp")
                         + 0.2 * avg("mouthShrugLower"),
            "disgusted": 0.6 * avg("noseSneerLeft", "noseSneerRight")
                         + 0.4 * avg("mouthUpperUpLeft", "mouthUpperUpRight"),
            "fearful":   0.4 * avg("eyeWideLeft", "eyeWideRight")
                         + 0.3 * avg("browInnerUp")
                         + 0.3 * avg("mouthStretchLeft", "mouthStretchRight"),
        }
        # neutral สูงเมื่อไม่มีอารมณ์ใดเด่น
        strongest = max(raw.values()) if raw else 0.0
        raw["neutral"] = max(0.0, 1.0 - 1.6 * strongest)

        # smooth ทุกอารมณ์ (EMA) กันค่ากระตุกเฟรมต่อเฟรม
        for emo in EMOTIONS:
            new = raw.get(emo, 0.0)
            self.scores[emo] = (self.smoothing * self.scores[emo]
                                + (1 - self.smoothing) * new)

        # อารมณ์ที่คะแนนสูงสุด (ถ้าอารมณ์ที่ไม่ใช่ neutral ยังอ่อนเกินไป -> neutral)
        ranked = sorted(self.scores.items(), key=lambda kv: kv[1], reverse=True)
        top, top_score = ranked[0]
        if top != "neutral" and top_score < self.min_score:
            top = "neutral"
        self.emotion = top

        # valence = โทนรวม (ถ่วงด้วยคะแนน) ไว้ทำกราฟ mood ภายหลัง
        total = sum(self.scores.values()) or 1.0
        self.valence = sum(_VALENCE[e] * s for e, s in self.scores.items()) / total

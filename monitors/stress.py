"""
ประเมินความเครียดจาก HRV (Heart Rate Variability)

หลักการทางสรีรวิทยา: ระยะห่างระหว่างจังหวะหัวใจแต่ละครั้ง (inter-beat
interval, IBI) ไม่เท่ากันเป๊ะ ความแปรปรวนนี้ถูกควบคุมโดยระบบประสาท
อัตโนมัติ — ตอนผ่อนคลายระบบ parasympathetic เด่น HRV จะ "สูง"
ตอนเครียดระบบ sympathetic เด่น HRV จะ "ต่ำ"

เราดึงคลื่นชีพจรที่ rPPG กรองไว้แล้ว -> หา peak แต่ละจังหวะ -> คำนวณ IBI
-> วัด RMSSD (ตัวชี้วัด HRV ระยะสั้นที่นิยมที่สุด) -> แปลงเป็นคะแนนเครียด

⚠️ rPPG-HRV หยาบกว่าการวัดด้วยสายรัดอก/ปลายนิ้ว ใช้เป็น "แนวโน้ม"
   ไม่ใช่ค่าทางการแพทย์
"""
import numpy as np
from scipy.signal import find_peaks

# ช่วง RMSSD (ms) ที่ใช้ map เป็นคะแนน: ต่ำ=เครียด สูง=ผ่อนคลาย
_RMSSD_STRESSED = 15.0
_RMSSD_RELAXED = 70.0


class StressMonitor:
    def __init__(self):
        self.rmssd: float | None = None     # ms
        self.sdnn: float | None = None      # ms
        self.score: float | None = None     # 0-100 (สูง = เครียดมาก)
        self.label: str = "—"

    def update(self, filtered, fs) -> None:
        """รับคลื่นชีพจรที่กรองแล้ว (rppg.filtered) + fs (rppg.fs)"""
        if filtered is None or fs is None or len(filtered) < fs * 4:
            return

        # หา peak ของชีพจร: ห่างกันอย่างน้อย 0.33s = ไม่เกิน 180 bpm
        min_dist = max(1, int(0.33 * fs))
        peaks, _ = find_peaks(filtered, distance=min_dist)
        if len(peaks) < 4:
            return

        ibi = np.diff(peaks) / fs * 1000.0          # IBI หน่วย ms
        ibi = ibi[(ibi > 300) & (ibi < 2000)]       # กรองค่าผิดปกติ (30-200 bpm)
        if len(ibi) < 3:
            return

        successive = np.diff(ibi)
        self.rmssd = float(np.sqrt(np.mean(successive ** 2)))
        self.sdnn = float(np.std(ibi))

        # map RMSSD -> คะแนนเครียด 0-100 (RMSSD ต่ำ -> คะแนนสูง)
        raw = np.clip(
            (_RMSSD_RELAXED - self.rmssd) / (_RMSSD_RELAXED - _RMSSD_STRESSED),
            0.0, 1.0) * 100.0
        # smooth กันค่ากระโดด (HRV จากหน้าต่างสั้น ๆ ผันผวนสูง)
        self.score = raw if self.score is None else 0.8 * self.score + 0.2 * raw

        if self.score < 33:
            self.label = "relaxed"
        elif self.score < 66:
            self.label = "moderate"
        else:
            self.label = "HIGH"

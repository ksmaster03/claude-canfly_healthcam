"""
ตรวจท่านั่ง (สำหรับกล้องที่มองด้านหน้า เช่นเว็บแคมโน้ตบุ๊ก)

วัด 2 อย่างจาก pose landmarks:
  1) ไหล่เอียง (shoulder tilt) — ไหล่สองข้างควรอยู่ระดับเดียวกัน
  2) คอยื่น/หลังค่อม — เวลานั่งหลังค่อมโน้มเข้าหาจอ จมูกจะเข้าใกล้แนวไหล่
     เราวัดระยะแนวตั้ง จมูก->แนวไหล่ แล้ว normalize ด้วยความกว้างไหล่
     (กันผลจากการที่ผู้ใช้นั่งใกล้/ไกลกล้องต่างกัน) เทียบกับค่า baseline
     ที่ผู้ใช้ calibrate ตอนนั่งท่าตรง
"""
import numpy as np

NOSE = 0
L_SHOULDER = 11
R_SHOULDER = 12

_TILT_LIMIT_DEG = 7.0    # ไหล่เอียงเกินกี่องศาถือว่าไม่ดี
_SLOUCH_DROP = 0.15      # ระยะคอยุบลงกี่ % จาก baseline ถือว่าหลังค่อม


class PostureMonitor:
    def __init__(self):
        self.baseline_ratio: float | None = None
        self.tilt_deg: float = 0.0
        self.slouch: bool = False
        self.status: str = "calibrate"   # calibrate | good | bad

    def calibrate(self, landmarks, w, h) -> bool:
        """เรียกตอนผู้ใช้นั่งท่าตรงดี เพื่อจำค่ามาตรฐาน"""
        ratio = self._neck_ratio(landmarks, w, h)
        if ratio:
            self.baseline_ratio = ratio
            return True
        return False

    def _neck_ratio(self, landmarks, w, h) -> float | None:
        nose, ls, rs = landmarks[NOSE], landmarks[L_SHOULDER], landmarks[R_SHOULDER]
        # ต้องเห็นจุดทั้งสามชัดพอ
        if min(nose.visibility, ls.visibility, rs.visibility) < 0.5:
            return None
        shoulder_width = abs(ls.x - rs.x)
        if shoulder_width < 1e-3:
            return None
        shoulder_mid_y = (ls.y + rs.y) / 2.0
        return (shoulder_mid_y - nose.y) / shoulder_width

    def update(self, landmarks, w, h) -> str:
        ls, rs = landmarks[L_SHOULDER], landmarks[R_SHOULDER]

        # มุมเอียงไหล่
        dx = (rs.x - ls.x) * w
        dy = (rs.y - ls.y) * h
        tilt = abs(np.degrees(np.arctan2(dy, dx)))
        self.tilt_deg = 180 - tilt if tilt > 90 else tilt

        # ตรวจหลังค่อมเทียบ baseline
        ratio = self._neck_ratio(landmarks, w, h)
        if ratio and self.baseline_ratio:
            drop = (self.baseline_ratio - ratio) / self.baseline_ratio
            self.slouch = drop > _SLOUCH_DROP
        else:
            self.slouch = False

        if self.baseline_ratio is None:
            self.status = "calibrate"
        else:
            good = (self.tilt_deg < _TILT_LIMIT_DEG) and (not self.slouch)
            self.status = "good" if good else "bad"
        return self.status

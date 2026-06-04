"""
ตรวจการดื่มน้ำแบบหยาบจากท่าทาง (pose) — เตือนเมื่อไม่ได้ดื่มนานเกินกำหนด

หลักการ: ถือว่า "กำลังดื่ม" เมื่อข้อมือยกเข้าใกล้ปาก (ยกแก้ว/ขวดขึ้นจิบ)
ค้างไว้ครู่หนึ่ง เมื่อพบการดื่มจะรีเซ็ตตัวจับเวลา ถ้าไม่พบการดื่มเกิน
remind_after วินาที = สมควรเตือนให้ดื่มน้ำ

ใช้ pose landmarks ของ MediaPipe:
  ปาก = mouth_left(9), mouth_right(10) | ข้อมือ = left(15), right(16)
  ไหล่ = left(11), right(12) ใช้เป็นสเกล normalize ระยะ

หมายเหตุ: เป็นการเดาจากท่าทาง อาจไม่จับทุกครั้งหรือจับผิดบ้าง
ใช้เป็นตัวช่วยเตือน ไม่ใช่การวัดแม่นยำ
"""
MOUTH_L, MOUTH_R = 9, 10
L_WRIST, R_WRIST = 15, 16
L_SHOULDER, R_SHOULDER = 11, 12

_NEAR_RATIO = 0.85      # ข้อมือใกล้ปากภายในกี่เท่าของช่วงไหล่ ถือว่าจ่อปาก
_HOLD_SECONDS = 0.6     # ต้องจ่อค้างนานเท่านี้ถึงนับว่าดื่ม (กันการแกว่งผ่าน)
_DEBOUNCE = 30.0        # จิบรวดเดียวกันไม่นับซ้ำภายในกี่วินาที


class DrinkMonitor:
    def __init__(self, remind_after_seconds: float, start_time: float):
        self.remind_after = remind_after_seconds
        self.last_drink = start_time      # เริ่มนับจากตอนเปิดโปรแกรม
        self.drink_count = 0
        self.drinking = False             # กำลังจ่อปากอยู่ไหม (ไว้โชว์สถานะ)
        self._near_start: float | None = None

    def update(self, plm, w, h, timestamp: float) -> None:
        try:
            ml, mr = plm[MOUTH_L], plm[MOUTH_R]
            ls, rs = plm[L_SHOULDER], plm[R_SHOULDER]
            wrists = [plm[L_WRIST], plm[R_WRIST]]
        except Exception:
            return

        shoulder_w = abs(ls.x - rs.x)
        if shoulder_w < 1e-3:
            return
        mouth_x = (ml.x + mr.x) / 2.0
        mouth_y = (ml.y + mr.y) / 2.0

        # ใช้เฉพาะข้อมือที่มองเห็นพอควร แล้วหาค่าที่ใกล้ปากที่สุด
        visible = [p for p in wrists if getattr(p, "visibility", 1.0) >= 0.3]
        if not visible:
            self.drinking = False
            self._near_start = None
            return
        nearest = min(
            ((p.x - mouth_x) ** 2 + (p.y - mouth_y) ** 2) ** 0.5 / shoulder_w
            for p in visible)

        self.drinking = nearest < _NEAR_RATIO
        if self.drinking:
            if self._near_start is None:
                self._near_start = timestamp
            elif timestamp - self._near_start >= _HOLD_SECONDS:
                # จ่อปากค้างพอแล้ว = นับเป็นการดื่ม + รีเซ็ตตัวจับเวลา
                if timestamp - self.last_drink > _DEBOUNCE:
                    self.drink_count += 1
                self.last_drink = timestamp
        else:
            self._near_start = None

    def seconds_since_drink(self, now: float) -> float:
        return now - self.last_drink

    def due(self, now: float) -> bool:
        return self.seconds_since_drink(now) >= self.remind_after

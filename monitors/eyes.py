"""
ตรวจดวงตา: นับการกะพริบ + ตรวจความง่วง (ตาปิดค้าง)

ใช้ค่า EAR (Eye Aspect Ratio) — อัตราส่วนความสูงต่อความกว้างของดวงตา
ตาเปิด EAR สูง / ตาหรี่หรือปิด EAR ต่ำ

ประโยชน์:
  - อัตรากะพริบต่ำผิดปกติ (< ~8 ครั้ง/นาที) = เพ่งจอนาน เสี่ยงตาแห้ง
  - ตาปิดค้างนาน = ง่วง/หลับใน (PERCLOS)
"""
from collections import deque

import numpy as np

# ดัชนี landmark ของ MediaPipe FaceMesh สำหรับจุดรอบดวงตา (6 จุดต่อข้าง)
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]


def _eye_aspect_ratio(landmarks, idx, w, h) -> float:
    pts = [(landmarks[i].x * w, landmarks[i].y * h) for i in idx]
    p1, p2, p3, p4, p5, p6 = pts

    def dist(a, b):
        return float(np.hypot(a[0] - b[0], a[1] - b[1]))

    vertical = dist(p2, p6) + dist(p3, p5)   # ความสูงเปลือกตา (สองคู่)
    horizontal = 2.0 * dist(p1, p4)           # ความกว้างหัวตา-หางตา
    return vertical / horizontal if horizontal else 0.0


class EyeMonitor:
    def __init__(self, ear_threshold: float = 0.21, drowsy_seconds: float = 1.2):
        self.ear_threshold = ear_threshold     # ต่ำกว่านี้ถือว่าตาปิด
        self.drowsy_seconds = drowsy_seconds   # ปิดค้างนานเกินนี้ = ง่วง
        self.ear: float = 0.0
        self.blink_count: int = 0
        self.drowsy: bool = False

        self._eye_closed = False
        self._closed_start: float | None = None
        self._blink_times: deque[float] = deque()  # เก็บเวลากะพริบ 60 วินาทีล่าสุด

    def update(self, landmarks, w, h, timestamp: float) -> None:
        left = _eye_aspect_ratio(landmarks, LEFT_EYE, w, h)
        right = _eye_aspect_ratio(landmarks, RIGHT_EYE, w, h)
        self.ear = (left + right) / 2.0

        if self.ear < self.ear_threshold:
            # ตาปิดอยู่
            if not self._eye_closed:
                self._eye_closed = True
                self._closed_start = timestamp
            elif timestamp - self._closed_start >= self.drowsy_seconds:
                self.drowsy = True  # ปิดค้างนานเกินไป
        else:
            # ตาเปิด
            if self._eye_closed and self._closed_start is not None:
                closed_dur = timestamp - self._closed_start
                # ปิดสั้น ๆ แล้วเปิด = นับเป็นการกะพริบ 1 ครั้ง
                if closed_dur < self.drowsy_seconds:
                    self.blink_count += 1
                    self._blink_times.append(timestamp)
            self._eye_closed = False
            self.drowsy = False

        # คงไว้เฉพาะการกะพริบในช่วง 60 วินาทีล่าสุด
        while self._blink_times and timestamp - self._blink_times[0] > 60:
            self._blink_times.popleft()

    @property
    def blink_rate(self) -> int:
        """จำนวนครั้งที่กะพริบใน 60 วินาทีที่ผ่านมา"""
        return len(self._blink_times)

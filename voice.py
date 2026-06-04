"""
เล่นเสียงเตือนภาษาไทยแบบไม่บล็อก (non-blocking) พร้อม cooldown กันสแปม

ใช้ winsound (built-in บน Windows, เล่น WAV) แบบ SND_ASYNC จึงไม่หน่วง
ลูปกล้อง แต่ละประเภทเตือนมี cooldown ของตัวเอง เพื่อไม่ให้พูดซ้ำทุกเฟรม
ตอนที่เงื่อนไขยังเป็นจริงต่อเนื่อง (เช่น ง่วงค้างหลายวินาที)
"""
import os
import time

try:
    import winsound   # มีเฉพาะ Windows
except ImportError:
    winsound = None

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSETS = os.path.join(_HERE, "assets")


class VoiceAlerts:
    def __init__(self, enabled: bool = True):
        # ปิดอัตโนมัติถ้าไม่ใช่ Windows หรือไม่มีไฟล์เสียง
        self.enabled = bool(enabled and winsound is not None)
        self._last_played: dict[str, float] = {}

    def available(self, key: str) -> bool:
        return os.path.exists(os.path.join(_ASSETS, key + ".wav"))

    def play(self, key: str, cooldown: float = 15.0) -> bool:
        """เล่นเสียง key (drowsy/move/water) ถ้าพ้น cooldown แล้ว คืน True ถ้าเล่น"""
        if not self.enabled:
            return False
        now = time.time()
        if now - self._last_played.get(key, 0.0) < cooldown:
            return False
        path = os.path.join(_ASSETS, key + ".wav")
        if not os.path.exists(path):
            return False
        try:
            # SND_ASYNC = เล่นแล้วคืนทันที ไม่บล็อก main loop
            winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC)
            self._last_played[key] = now
            return True
        except Exception:
            return False

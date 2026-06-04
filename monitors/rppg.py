"""
rPPG — ประเมินอัตราการเต้นหัวใจจากกล้อง (แบบไม่ต้องแตะตัว)

ใช้อัลกอริทึม POS (Plane-Orthogonal-to-Skin, Wang et al. 2017) ซึ่งเป็น
gold-standard ของ rPPG: รวมสัญญาณทั้ง 3 สี (R,G,B) แล้ว project ลงระนาบ
ที่ตั้งฉากกับการเปลี่ยนแปลงของโทนผิว ทำให้ทนต่อการขยับหน้า/แสงเปลี่ยน
ได้ดีกว่าวิธีดูช่องเขียวอย่างเดียวมาก (วิธีเขียวล้วนมักล็อกความถี่ต่ำผิด ๆ
ทำให้ค่าชีพจรออกมาต่ำเกินจริง)

ขั้นตอน: เก็บค่าเฉลี่ย R,G,B ของ ROI หน้าผากตามเวลา -> POS ได้คลื่นชีพจร
-> bandpass ในย่านชีพจรมนุษย์ -> FFT หาความถี่เด่น -> แปลงเป็น bpm
นอกจากนี้ยังเปิดคลื่นชีพจรที่กรองแล้ว (self.filtered, self.fs) ให้
StressMonitor นำไปคำนวณ HRV ต่อ
"""
from collections import deque

import numpy as np
from scipy.signal import butter, filtfilt

# ย่านชีพจรมนุษย์: 0.75-4.0 Hz = 45-240 ครั้ง/นาที
# (ขยับขอบล่างจาก 0.7 ขึ้นมาเล็กน้อย กันไปจับ component ช้าจากการหายใจ/ขยับ)
_LOW_HZ = 0.75
_HIGH_HZ = 4.0


class RPPGEstimator:
    def __init__(self, window_seconds: float = 10.0, min_seconds: float = 6.0):
        self.window_seconds = window_seconds
        self.min_seconds = min_seconds
        self._times: deque[float] = deque()
        self._r: deque[float] = deque()
        self._g: deque[float] = deque()
        self._b: deque[float] = deque()

        self.bpm: float | None = None
        self.confidence: float = 0.0
        # คลื่นชีพจรที่กรองแล้ว + sampling rate ล่าสุด (ให้ StressMonitor ใช้)
        self.filtered: np.ndarray | None = None
        self.fs: float | None = None

    def update(self, roi_bgr, timestamp: float) -> None:
        """ป้อนภาพ ROI หน้าผาก (BGR) เข้ามาทีละเฟรม"""
        if roi_bgr is None or roi_bgr.size == 0:
            return
        # OpenCV เป็น BGR: ช่อง 0=B, 1=G, 2=R
        self._b.append(float(np.mean(roi_bgr[:, :, 0])))
        self._g.append(float(np.mean(roi_bgr[:, :, 1])))
        self._r.append(float(np.mean(roi_bgr[:, :, 2])))
        self._times.append(timestamp)

        while self._times and (timestamp - self._times[0]) > self.window_seconds:
            self._times.popleft()
            self._r.popleft()
            self._g.popleft()
            self._b.popleft()

    def _pos(self, rgb: np.ndarray, fs: float) -> np.ndarray | None:
        """
        POS algorithm: rgb เป็น (N,3) ของ R,G,B คืนคลื่นชีพจรความยาว N
        ใช้หน้าต่างเลื่อน 1.6 วินาที + overlap-add ตามต้นฉบับ
        """
        n_total = len(rgb)
        win = int(1.6 * fs)
        if win < 2 or n_total < win:
            return None

        signal = np.zeros(n_total)
        chans = rgb.T  # (3, N): แถว 0=R, 1=G, 2=B
        for start in range(0, n_total - win + 1):
            end = start + win
            block = chans[:, start:end]
            mu = block.mean(axis=1, keepdims=True)
            normalized = block / (mu + 1e-9)        # temporal normalization
            s1 = normalized[1] - normalized[2]                       # G - B
            s2 = normalized[1] + normalized[2] - 2 * normalized[0]   # G + B - 2R
            alpha = np.std(s1) / (np.std(s2) + 1e-9)
            pulse = s1 + alpha * s2
            signal[start:end] += pulse - pulse.mean()  # overlap-add
        return signal

    def estimate(self) -> float | None:
        """คืนค่า BPM ถ้าข้อมูลพอ ไม่งั้นคืน None"""
        n = len(self._times)
        if n < 30:
            return None
        duration = self._times[-1] - self._times[0]
        if duration < self.min_seconds:
            return None
        fs = n / duration               # เฟรมเรตจริง (ไม่คงที่)
        if fs < 5:
            return None

        rgb = np.stack(
            [np.asarray(self._r), np.asarray(self._g), np.asarray(self._b)], axis=1)
        pulse = self._pos(rgb, fs)
        if pulse is None:
            return None

        nyq = fs / 2.0
        try:
            b, a = butter(3, [_LOW_HZ / nyq, _HIGH_HZ / nyq], btype="band")
            filtered = filtfilt(b, a, pulse)
        except Exception:
            return None

        self.filtered = filtered
        self.fs = fs

        windowed = filtered * np.hanning(len(filtered))
        spectrum = np.abs(np.fft.rfft(windowed))
        freqs = np.fft.rfftfreq(len(windowed), d=1.0 / fs)
        band = (freqs >= _LOW_HZ) & (freqs <= _HIGH_HZ)
        if not np.any(band):
            return None

        band_power = spectrum[band]
        band_freqs = freqs[band]
        peak_idx = int(np.argmax(band_power))
        bpm = float(band_freqs[peak_idx] * 60.0)

        total = float(np.sum(band_power))
        self.confidence = float(band_power[peak_idx] / total) if total > 0 else 0.0
        self.bpm = bpm if self.bpm is None else (0.8 * self.bpm + 0.2 * bpm)
        return self.bpm

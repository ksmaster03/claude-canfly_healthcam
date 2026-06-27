"""
ทดสอบ pipeline โดยไม่ต้องใช้กล้องจริง:
  1) สร้าง landmarker จากโมเดล + ป้อนภาพสังเคราะห์ (ตรวจว่าไม่ crash)
  2) ทดสอบ rPPG ด้วยสัญญาณไซน์ 1.2 Hz (= 72 bpm) ว่าถอดค่าได้ใกล้เคียง
"""
import os
import numpy as np

os.environ.setdefault("GLOG_minloglevel", "2")

import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

from monitors import RPPGEstimator, StressMonitor, EmotionMonitor

_HERE = os.path.dirname(os.path.abspath(__file__))


def test_landmarkers():
    face_opts = vision.FaceLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(
            model_asset_path=os.path.join(_HERE, "models", "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=1)
    pose_opts = vision.PoseLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(
            model_asset_path=os.path.join(_HERE, "models", "pose_landmarker_lite.task")),
        running_mode=vision.RunningMode.VIDEO, num_poses=1)

    face = vision.FaceLandmarker.create_from_options(face_opts)
    pose = vision.PoseLandmarker.create_from_options(pose_opts)

    img = np.random.randint(0, 255, (720, 1280, 3), dtype=np.uint8)
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=img)
    fr = face.detect_for_video(mp_img, 1)
    pr = pose.detect_for_video(mp_img, 1)
    face.close()
    pose.close()
    print(f"[ok] landmarkers run — faces={len(fr.face_landmarks)} "
          f"poses={len(pr.pose_landmarks)} (0 บนภาพ noise เป็นเรื่องปกติ)")


def _synth_rppg(hz=1.2, jitter_ms=0.0, seconds=12, fs=30.0, seed=0):
    """ป้อนสัญญาณชีพจรปลอมเข้า RPPGEstimator (RGB ครบ ชีพจรเด่นในช่อง G)
    jitter_ms = ใส่ความแปรปรวนของจังหวะ (จำลอง HRV)"""
    est = RPPGEstimator(window_seconds=12, min_seconds=6)
    rng = np.random.default_rng(seed)
    n = int(fs * seconds)
    phase = 0.0
    for i in range(n):
        t = i / fs
        # ความถี่แกว่งเล็กน้อยเพื่อจำลอง HRV
        inst_hz = hz * (1 + (jitter_ms / 1000.0) * np.sin(2 * np.pi * 0.1 * t))
        phase += 2 * np.pi * inst_hz / fs
        p = np.sin(phase)
        r = 180 + 1.0 * p + rng.normal(0, 0.6)
        g = 128 + 6.0 * p + rng.normal(0, 0.6)   # ชีพจรเด่นในช่องเขียว
        b = 120 + 2.0 * p + rng.normal(0, 0.6)
        roi = np.zeros((10, 10, 3), dtype=np.uint8)
        roi[:, :, 0] = int(np.clip(b, 0, 255))
        roi[:, :, 1] = int(np.clip(g, 0, 255))
        roi[:, :, 2] = int(np.clip(r, 0, 255))
        est.update(roi, t)
    return est


def test_rppg():
    """POS ควรถอดชีพจร 72 bpm จากสัญญาณ RGB ปลอมได้"""
    est = _synth_rppg(hz=1.2)
    bpm = est.estimate()
    assert bpm is not None, "rPPG ควรคืนค่าได้เมื่อข้อมูลพอ"
    err = abs(bpm - 72)
    print(f"[ok] rPPG (POS) = {bpm:.1f} bpm (เป้า 72, คลาด {err:.1f}, "
          f"conf {est.confidence*100:.0f}%)")
    assert err < 10, f"คลาดเคลื่อนเกินไป: {bpm}"


def test_stress():
    """StressMonitor ควรคำนวณ HRV/คะแนนเครียดจากคลื่นชีพจรของ rPPG ได้"""
    est = _synth_rppg(hz=1.2, jitter_ms=30)
    est.estimate()                       # เติม est.filtered / est.fs
    stress = StressMonitor()
    stress.update(est.filtered, est.fs)
    assert stress.score is not None, "ควรได้คะแนนความเครียด"
    print(f"[ok] stress = {stress.score:.0f}/100 ({stress.label}), "
          f"RMSSD={stress.rmssd:.0f}ms SDNN={stress.sdnn:.0f}ms")


class _BS:
    """จำลอง category ของ blendshape (มี .category_name และ .score)"""
    def __init__(self, name, score):
        self.category_name = name
        self.score = score


def test_emotion():
    """EmotionMonitor ควรอ่านอารมณ์จาก blendshapes ได้ (ยิ้ม -> happy)"""
    em = EmotionMonitor(smoothing=0.0)   # ปิด smoothing ให้เห็นผลทันที
    # ใบหน้ายิ้มกว้าง
    smile = [_BS("mouthSmileLeft", 0.9), _BS("mouthSmileRight", 0.9)]
    em.update(smile)
    assert em.emotion == "happy", f"คาดว่า happy ได้ {em.emotion}"
    assert em.valence > 0, "ยิ้มควรได้ valence บวก"
    print(f"[ok] emotion(smile) = {em.emotion}, valence={em.valence:+.2f}")

    # ใบหน้าเฉย ๆ (ทุกค่าต่ำ) -> neutral
    em.update([_BS("mouthSmileLeft", 0.02), _BS("jawOpen", 0.01)])
    assert em.emotion == "neutral", f"คาดว่า neutral ได้ {em.emotion}"
    print(f"[ok] emotion(rest)  = {em.emotion}")


if __name__ == "__main__":
    test_landmarkers()
    test_rppg()
    test_stress()
    test_emotion()
    print("\nALL SELFTESTS PASSED")

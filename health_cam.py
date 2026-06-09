"""
AI Health Cam — Wellness dashboard จากเว็บแคมโน้ตบุ๊ก (ประมวลผลในเครื่อง 100%)

รวมการตรวจ:
  - ชีพจร (rPPG) จากหน้าผาก
  - อัตราการกะพริบตา + เตือนตาแห้ง
  - ความง่วง (ตาปิดค้าง)
  - ท่านั่ง (ไหล่เอียง / หลังค่อม)
  - เวลาที่อยู่หน้าจอต่อเนื่อง + เตือนพัก

ใช้ MediaPipe Tasks API (FaceLandmarker + PoseLandmarker) ซึ่งเป็น API ใหม่
ที่ wheel ของ Python 3.14 รองรับ ต้องมีไฟล์โมเดลในโฟลเดอร์ models/

เตือนด้วยเสียงพูดภาษาไทย:
  - ง่วง (ตาปิดค้าง)          -> "ตื่น ๆ ทำงาน"
  - นั่งนานเกิน 2 ชม.         -> "ลุก ๆ ขยับตัวบ้าง"
  - ไม่ดื่มน้ำเกิน 4 ชม.      -> "อย่าลืมดื่มน้ำด้วยนะ"

ปุ่มควบคุม:
  c       = calibrate ท่านั่ง (นั่งตัวตรงแล้วกด)
  r       = รีเซ็ตตัวนับ (กะพริบ + เวลาพัก + ถือว่าเพิ่งดื่มน้ำ)
  1/2/3   = ทดสอบเสียง ง่วง / ลุกขยับ / ดื่มน้ำ
  q / ESC = ออก

การใช้งาน:
  python health_cam.py                  # พัก 2 ชม. / ดื่มน้ำ 4 ชม. (ดีฟอลต์)
  python health_cam.py --break-min 1 --water-min 2   # ไว้เทสต์เร็ว ๆ
  python health_cam.py --no-voice       # ปิดเสียงเตือน
  python health_cam.py --camera 1       # เลือกกล้องตัวที่ 1
"""
import os
import sys
import time
import argparse

os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

# กัน console Windows (cp1252) พังเวลาพิมพ์ภาษาไทย
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

from monitors import (
    RPPGEstimator, EyeMonitor, PostureMonitor, StressMonitor, DrinkMonitor)
from voice import VoiceAlerts

def resource_base() -> str:
    """โฟลเดอร์ฐานสำหรับหาไฟล์ข้อมูล — รองรับทั้งตอนรันเป็น .py และตอน build เป็น .exe
    (PyInstaller จะคลายไฟล์ที่ bundle ไว้ไปที่ sys._MEIPASS)"""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


_HERE = resource_base()
FACE_MODEL = os.path.join(_HERE, "models", "face_landmarker.task")
POSE_MODEL = os.path.join(_HERE, "models", "pose_landmarker_lite.task")

# landmark หน้าผากของ FaceLandmarker (ดัชนีเหมือน FaceMesh เดิม) สำหรับ ROI rPPG
_FOREHEAD_SIDES = (67, 297)   # ซ้าย-ขวาของหน้าผาก
_FOREHEAD_TOP = 10            # กลางบนหน้าผาก
_FOREHEAD_BOTTOM = 9          # ระหว่างคิ้ว (glabella)

# สี (BGR)
GREEN = (80, 220, 100)
RED = (60, 60, 235)
YELLOW = (40, 200, 240)
WHITE = (240, 240, 240)
GREY = (160, 160, 160)
PANEL = (28, 28, 28)


def forehead_roi(frame, landmarks):
    """ตัดภาพสี่เหลี่ยมบริเวณหน้าผากจาก landmarks (คืน roi, (x1,y1,x2,y2))"""
    h, w = frame.shape[:2]
    xs = [landmarks[i].x * w for i in _FOREHEAD_SIDES]
    x1, x2 = int(min(xs)), int(max(xs))
    y_top = int(landmarks[_FOREHEAD_TOP].y * h)
    y_bot = int(landmarks[_FOREHEAD_BOTTOM].y * h)

    # หดขอบเข้าเล็กน้อย กันเส้นผม/คิ้วปนเข้ามา
    pad_x = int((x2 - x1) * 0.15)
    pad_y = int((y_bot - y_top) * 0.20)
    x1, x2 = x1 + pad_x, x2 - pad_x
    y1, y2 = y_top + pad_y, y_bot - pad_y

    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < 10 or y2 - y1 < 10:
        return None, None
    return frame[y1:y2, x1:x2], (x1, y1, x2, y2)


def draw_panel(frame, rows, break_alert):
    """วาดแผงสรุปผลด้านขวาของเฟรม. rows = list ของ (label, value, color)"""
    h, w = frame.shape[:2]
    pw = 320                       # ความกว้างแผง
    x0 = w - pw

    overlay = frame.copy()
    cv2.rectangle(overlay, (x0, 0), (w, h), PANEL, -1)
    cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)

    cv2.putText(frame, "AI HEALTH CAM", (x0 + 18, 38),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, WHITE, 2)
    cv2.line(frame, (x0 + 18, 52), (w - 18, 52), GREY, 1)

    y = 92
    for label, value, color in rows:
        cv2.putText(frame, label, (x0 + 18, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, GREY, 1)
        cv2.putText(frame, value, (x0 + 18, y + 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.72, color, 2)
        y += 64

    # แถบเตือนพักด้านบน
    if break_alert:
        bar = frame.copy()
        cv2.rectangle(bar, (0, 0), (x0, 60), RED, -1)
        cv2.addWeighted(bar, 0.6, frame, 0.4, 0, frame)
        cv2.putText(frame, "TIME TO TAKE A BREAK! (press 'r')", (20, 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, WHITE, 2)

    cv2.putText(frame, "c:calibrate r:reset 1/2/3:test voice q:quit",
                (x0 + 18, h - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.4, GREY, 1)


def build_landmarkers():
    """สร้าง FaceLandmarker + PoseLandmarker แบบโหมดวิดีโอ"""
    for path in (FACE_MODEL, POSE_MODEL):
        if not os.path.exists(path):
            raise SystemExit(
                f"ไม่พบโมเดล: {path}\n"
                "รัน download_models.py ก่อน หรือดู README")

    face_opts = vision.FaceLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=FACE_MODEL),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1)
    pose_opts = vision.PoseLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=POSE_MODEL),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1)
    face = vision.FaceLandmarker.create_from_options(face_opts)
    pose = vision.PoseLandmarker.create_from_options(pose_opts)
    return face, pose


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0, help="ดัชนีกล้อง")
    ap.add_argument("--break-min", type=float, default=120.0,
                    help="เตือนลุกขยับเมื่อนั่งต่อเนื่องเกินกี่นาที (ดีฟอลต์ 2 ชม.)")
    ap.add_argument("--water-min", type=float, default=240.0,
                    help="เตือนดื่มน้ำเมื่อไม่พบการดื่มเกินกี่นาที (ดีฟอลต์ 4 ชม.)")
    ap.add_argument("--no-voice", action="store_true", help="ปิดเสียงเตือน")
    args = ap.parse_args()

    break_seconds = args.break_min * 60.0
    water_seconds = args.water_min * 60.0
    face_landmarker, pose_landmarker = build_landmarkers()
    voice = VoiceAlerts(enabled=not args.no_voice)

    # CAP_DSHOW = backend ที่เปิดเว็บแคมเร็วบน Windows
    cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    if not cap.isOpened():
        raise SystemExit(f"เปิดกล้องตัวที่ {args.camera} ไม่ได้ — ลอง --camera 1")

    rppg = RPPGEstimator()
    eyes = EyeMonitor()
    posture = PostureMonitor()
    stress = StressMonitor()
    drink = DrinkMonitor(water_seconds, time.time())

    present_since: float | None = None
    last_seen = 0.0
    calibrate_request = False
    last_ts_ms = -1                      # Tasks API ต้องการ timestamp ms ที่เพิ่มขึ้นเสมอ

    win = "AI Health Cam"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)        # mirror ให้เหมือนกระจก
        now = time.time()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        ts_ms = max(last_ts_ms + 1, int(now * 1000))   # บังคับให้เพิ่มขึ้นเสมอ
        last_ts_ms = ts_ms

        face_res = face_landmarker.detect_for_video(mp_image, ts_ms)
        pose_res = pose_landmarker.detect_for_video(mp_image, ts_ms)

        face_present = bool(face_res.face_landmarks)

        # ----- เวลาอยู่หน้าจอ / เตือนพัก -----
        if face_present:
            last_seen = now
            if present_since is None:
                present_since = now
        elif present_since is not None and (now - last_seen) > 5.0:
            present_since = None          # ลุกไปพักเกิน 5 วิ -> รีเซ็ต

        h, w = frame.shape[:2]

        # ----- ใบหน้า: rPPG + ดวงตา -----
        hr_bpm = None
        if face_present:
            lm = face_res.face_landmarks[0]
            roi, box = forehead_roi(frame, lm)
            if roi is not None:
                rppg.update(roi, now)
                cv2.rectangle(frame, (box[0], box[1]), (box[2], box[3]), GREEN, 1)
            hr_bpm = rppg.estimate()
            stress.update(rppg.filtered, rppg.fs)   # HRV จากคลื่นชีพจรเดียวกัน
            eyes.update(lm, w, h, now)

        # ----- ลำตัว: ท่านั่ง + ตรวจการดื่มน้ำ -----
        posture_status = posture.status
        if pose_res.pose_landmarks:
            plm = pose_res.pose_landmarks[0]
            if calibrate_request:
                posture.calibrate(plm, w, h)
                calibrate_request = False
            posture_status = posture.update(plm, w, h)
            drink.update(plm, w, h, now)

        # ----- ประกอบข้อมูลลงแผง -----
        rows = []
        if hr_bpm:
            conf = rppg.confidence
            col = GREEN if conf > 0.25 else YELLOW
            rows.append(("HEART RATE", f"{hr_bpm:4.0f} bpm  ({conf*100:2.0f}%)", col))
        else:
            rows.append(("HEART RATE", "measuring...", GREY))

        # ความเครียดจาก HRV
        if stress.score is not None:
            if stress.score < 33:
                scol = GREEN
            elif stress.score < 66:
                scol = YELLOW
            else:
                scol = RED
            rows.append(("STRESS (HRV)",
                         f"{stress.score:3.0f}/100 {stress.label}", scol))
        else:
            rows.append(("STRESS (HRV)", "measuring...", GREY))

        if face_present:
            br = eyes.blink_rate
            col = RED if br < 8 else GREEN     # <8/นาที = เพ่งจอ เสี่ยงตาแห้ง
            note = " LOW!" if br < 8 else ""
            rows.append(("BLINK RATE", f"{br:2d}/min{note}", col))
        else:
            rows.append(("BLINK RATE", "no face", GREY))

        if face_present:
            rows.append(("ALERTNESS", "DROWSY!" if eyes.drowsy else "awake",
                         RED if eyes.drowsy else GREEN))
            if eyes.drowsy:
                voice.play("drowsy", cooldown=10)   # พูด "ตื่น ๆ ทำงาน"
        else:
            rows.append(("ALERTNESS", "no face", GREY))

        if posture_status == "good":
            rows.append(("POSTURE", f"good  ({posture.tilt_deg:.0f} deg)", GREEN))
        elif posture_status == "bad":
            issue = "slouch" if posture.slouch else "tilt"
            rows.append(("POSTURE", f"FIX {issue} ({posture.tilt_deg:.0f} deg)", RED))
        else:
            rows.append(("POSTURE", "press 'c' to set", YELLOW))

        break_alert = False
        if present_since is not None:
            elapsed = now - present_since
            mm, ss = divmod(int(elapsed), 60)
            break_alert = elapsed >= break_seconds
            rows.append(("SCREEN TIME", f"{mm:02d}:{ss:02d}",
                         RED if break_alert else WHITE))
            if break_alert:
                voice.play("move", cooldown=300)    # พูด "ลุก ๆ ขยับตัวบ้าง"
        else:
            rows.append(("SCREEN TIME", "away", GREY))

        # ----- ดื่มน้ำ -----
        secs = drink.seconds_since_drink(now)
        hh, rem = divmod(int(secs), 3600)
        water_due = drink.due(now)
        if drink.drinking:
            rows.append(("WATER", "drinking :)", GREEN))
        elif water_due:
            rows.append(("WATER", f"{hh}h{rem // 60:02d}m DRINK!", RED))
            voice.play("water", cooldown=300)        # พูด "อย่าลืมดื่มน้ำด้วยนะ"
        else:
            rows.append(("WATER", f"last {hh}h{rem // 60:02d}m ago", WHITE))

        draw_panel(frame, rows, break_alert)
        cv2.imshow(win, frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("c"):
            calibrate_request = True
        elif key == ord("r"):
            eyes.blink_count = 0
            present_since = now
            drink.last_drink = now            # นับว่าเพิ่งดื่มน้ำ/รีเซ็ตทุกตัวจับเวลา
        # ปุ่มทดสอบเสียง (ไม่ต้องรอเงื่อนไขจริง): 1=ง่วง 2=ลุกขยับ 3=ดื่มน้ำ
        elif key == ord("1"):
            voice.play("drowsy", cooldown=0)
        elif key == ord("2"):
            voice.play("move", cooldown=0)
        elif key == ord("3"):
            voice.play("water", cooldown=0)

    cap.release()
    cv2.destroyAllWindows()
    face_landmarker.close()
    pose_landmarker.close()


if __name__ == "__main__":
    main()

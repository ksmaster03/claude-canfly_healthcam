"""โหลดไฟล์โมเดล MediaPipe Tasks ที่จำเป็น (รันครั้งเดียว)"""
import os
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = {
    "face_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
    "pose_landmarker_lite.task":
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
}


def main():
    out_dir = os.path.join(_HERE, "models")
    os.makedirs(out_dir, exist_ok=True)
    for name, url in MODELS.items():
        dest = os.path.join(out_dir, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"[skip] {name} มีอยู่แล้ว")
            continue
        print(f"[get ] {name} ...")
        urllib.request.urlretrieve(url, dest)
        print(f"[done] {name} ({os.path.getsize(dest):,} bytes)")


if __name__ == "__main__":
    main()

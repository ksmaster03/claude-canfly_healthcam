"""
สังเคราะห์ประโยคเตือนเป็นไฟล์เสียง WAV ภาษาไทย (รันครั้งเดียว, ต้องต่อเน็ต)

ใช้ edge-tts (เสียง neural ไทยของ Microsoft) ผ่าน `python -m edge_tts`
(เสถียรกว่าการเรียก API ในโค้ดตรง ๆ ที่บางทีคืน NoAudioReceived)
ได้ mp3 แล้วแปลงเป็น WAV PCM ด้วย ffmpeg ให้ winsound เล่นได้ตอนรันจริง
"""
import os
import sys
import subprocess

VOICE = "th-TH-PremwadeeNeural"   # เสียงผู้หญิงไทย ฟังชัด เป็นธรรมชาติ

PHRASES = {
    "drowsy": "ตื่น ๆ ทำงาน",          # เตือนเมื่อง่วง
    "move": "ลุก ๆ ขยับตัวบ้าง",        # เตือนเมื่อนั่งนานเกินไป
    "water": "อย่าลืมดื่มน้ำด้วยนะ",     # เตือนเมื่อไม่ได้ดื่มน้ำนาน
}

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSETS = os.path.join(_HERE, "assets")


def _gen(name: str, text: str) -> None:
    mp3 = os.path.join(_ASSETS, name + ".mp3")
    wav = os.path.join(_ASSETS, name + ".wav")
    # 1) สังเคราะห์เสียงเป็น mp3
    subprocess.run(
        [sys.executable, "-m", "edge_tts", "--voice", VOICE,
         "--text", text, "--write-media", mp3],
        check=True, capture_output=True)
    # 2) แปลงเป็น WAV PCM 16-bit 22050Hz mono ให้ winsound เล่นได้
    subprocess.run(
        ["ffmpeg", "-y", "-i", mp3, "-ar", "22050", "-ac", "1",
         "-sample_fmt", "s16", wav],
        check=True, capture_output=True)
    os.remove(mp3)
    print(f"[done] {name}.wav ({os.path.getsize(wav):,} bytes)  <- \"{text}\"")


def main() -> None:
    os.makedirs(_ASSETS, exist_ok=True)
    for name, text in PHRASES.items():
        _gen(name, text)


if __name__ == "__main__":
    main()

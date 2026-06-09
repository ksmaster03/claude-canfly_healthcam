# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec สำหรับ build AI Health Cam เป็น .exe (โหมด onedir)

วิธี build:
    pyinstaller build_exe.spec --noconfirm

ผลลัพธ์อยู่ที่ dist\AIHealthCam\AIHealthCam.exe
(โฟลเดอร์ทั้งก้อนพกพาได้ ก๊อปไปรันบนโน้ตบุ๊ก Windows 64-bit เครื่องอื่นได้เลย
โดยไม่ต้องลง Python)
"""
from PyInstaller.utils.hooks import collect_all

# bundle ไฟล์โมเดล + เสียง เข้าไปในแอป
datas = [("models", "models"), ("assets", "assets")]
binaries = []
hiddenimports = []

# MediaPipe มีไฟล์ data/graph ภายในเยอะ ต้อง collect ให้ครบ
for pkg in ("mediapipe",):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

a = Analysis(
    ["health_cam.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AIHealthCam",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,           # ซ่อนหน้าต่าง console (เวอร์ชันปล่อยจริง)
    disable_windowed_traceback=False,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="AIHealthCam",
)

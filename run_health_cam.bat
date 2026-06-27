@echo off
REM AI Health Cam — ตัวเปิดแอป (มี console ไว้ดู log / ส่ง args ได้)
REM รันผ่าน Python 3.14 ที่มีลายเซ็น Smart App Control จึงไม่บล็อก
REM ตัวอย่าง: run_health_cam.bat --break-min 1 --water-min 2
cd /d "%~dp0"
py -3.14 health_cam.py %*

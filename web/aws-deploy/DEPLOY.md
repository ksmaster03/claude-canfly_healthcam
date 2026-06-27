# Deploy — AI Health Cam web

ปล่อยขึ้น **AWS S3 (static website) + Cloudflare** ที่ `aicam.toptierdigital.space`
(สแตกเดียวกับเว็บอื่นในเครือ: acct 265411103824, ap-southeast-7, SSL Flexible)

## ทำไม static + Cloudflare ใช้ได้
- แอปเป็น **client-side ล้วน** — ไม่มี backend → โฮสต์เป็นไฟล์นิ่งได้
- กล้อง (getUserMedia) ต้องการ **secure context** → Cloudflare ให้ HTTPS ที่ขอบ
  (visitor↔CF เป็น HTTPS แม้ origin เป็น Flexible) ดังนั้นกล้องทำงานได้
- MediaPipe ใช้ WASM แบบ single-thread ได้ → ไม่ต้องตั้ง COOP/COEP

## ขั้นตอน

```powershell
# 1) build + ขึ้น S3 (สร้าง bucket + website + policy + sync ให้อัตโนมัติ)
powershell -ExecutionPolicy Bypass -File aws-deploy\deploy.ps1

# 2) Cloudflare (ทำครั้งเดียว): เพิ่ม DNS record
#    Type=CNAME  Name=aicam  Target=aicam.toptierdigital.space.s3-website.ap-southeast-7.amazonaws.com
#    Proxy=ON (ส้ม)   SSL/TLS mode = Flexible
```

เปิด: **https://aicam.toptierdigital.space**

redeploy ครั้งถัดไป: `deploy.ps1` ซ้ำได้เลย (idempotent)

## ค่าใช้จ่าย
S3 static เล็กมาก — ค่าเก็บ + transfer ราว **< 1 USD/เดือน** (Cloudflare cache ช่วยลด egress)

## หมายเหตุ
- โมเดล/wasm รวม ~22MB โหลดครั้งแรก แล้ว Cloudflare cache ให้
- ถ้าจะกันไม่ให้ใครเข้าถึง S3 endpoint ตรง ๆ ปรับเป็น Cloudflare-only ได้ภายหลัง

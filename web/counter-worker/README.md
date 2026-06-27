# aicam-counter — visitor counter (Cloudflare Worker, ของเราเอง)

เก็บสถิติผู้ใช้บน **Cloudflare KV** (storage ของเราเอง ไม่พึ่ง third-party)
ฝั่งเว็บจะนับ "ผู้ใช้ไม่ซ้ำ" (เพิ่ม 1 ครั้งต่อเบราว์เซอร์ ผ่าน localStorage)

## Deploy (ครั้งเดียว)

```powershell
cd web\counter-worker

# 1) ยืนยันตัวตน Cloudflare (เปิด browser) — หรือ set $env:CLOUDFLARE_API_TOKEN
wrangler login

# 2) สร้าง KV namespace แล้วก๊อป id ไปใส่ wrangler.toml (แทน PUT_KV_ID_HERE)
wrangler kv namespace create COUNTER

# 3) deploy -> ได้ URL เช่น https://aicam-counter.<subdomain>.workers.dev
wrangler deploy
```

## เชื่อมกับเว็บ

สร้างไฟล์ `web/.env`:
```
VITE_COUNTER_URL=https://aicam-counter.<subdomain>.workers.dev
```
แล้ว build + redeploy เว็บใหม่ (`aws-deploy\deploy.ps1`) — ฝั่งหน้าเว็บจะสลับจาก
free service มาใช้ Worker ของเราเองอัตโนมัติ

## Endpoints
- `GET /hit` → เพิ่ม 1 แล้วคืน `{ "count": N }`
- `GET /get` → คืน `{ "count": N }` (ไม่เพิ่ม)

## อยากเก็บเป็นไฟล์ stats.json จริง ๆ (R2)
ผูก R2 bucket ใน wrangler.toml แล้วใน worker เขียน
`env.STATS.put("stats.json", JSON.stringify({count}))` — ได้ไฟล์ข้อความจริงใน
object storage ที่ดาวน์โหลด/อ่านได้

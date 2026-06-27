# AI Health Cam — Web App Plan

แผนพัฒนา AI Health Cam จาก desktop (Python) → **web app ที่รันในเบราว์เซอร์ 100%**
(client-side) โดยคงจุดขายหลัก **"ประมวลผลในเครื่อง ภาพไม่ออกไปไหน"** ไว้

> Decisions (เคาะแล้ว): Browser-only · React + Vite + Tailwind · ครบทุกฟีเจอร์ใน MVP · โค้ดอยู่ `web/` ใน repo เดิม

---

## 1. สถาปัตยกรรม (ทุกอย่างทำงานในเบราว์เซอร์)

```
Browser (ไม่มี backend, ไม่อัปโหลดภาพ)
 ├─ getUserMedia → <video>            (ขอกล้อง, ต้องเป็น HTTPS/localhost)
 ├─ MediaPipe tasks-vision (WASM/WebGL)
 │    ├─ FaceLandmarker (+ blendshapes)   ← โมเดล .task ตัวเดิม
 │    └─ PoseLandmarker
 ├─ ลูปต่อเฟรม (requestAnimationFrame)
 │    ├─ detectForVideo(face) → landmarks + blendshapes
 │    ├─ detectForVideo(pose) → pose landmarks   (throttle ทุก 2-3 เฟรม)
 │    ├─ sample ROI หน้าผาก จาก offscreen canvas (getImageData) → ค่าเฉลี่ย R/G/B
 │    └─ ป้อนเข้า monitors
 ├─ monitors/ (พอร์ตจาก Python → TypeScript)
 ├─ React dashboard (การ์ด + กราฟ) + เสียงเตือน (<audio> WAV เดิม) + settings
 └─ IndexedDB → log รายวัน + กราฟแนวโน้ม
```

**ทำไม client-side:** รักษา privacy story (ไม่มีเฟรมออกนอกเครื่อง), deploy เป็น static
(ถูก+ง่าย ใช้ S3+Cloudflare ของเดิม), ได้ของแถม = รันบนมือถือ/แท็บเล็ตได้ด้วย

---

## 2. Tech stack

| ส่วน | เลือกใช้ | เหตุผล |
|---|---|---|
| Build/UI | **Vite + React + TypeScript + Tailwind** | ตรงกับโปรเจกต์อื่นของเรา (mbk-pricing, smat) |
| Vision | **@mediapipe/tasks-vision** | API เท่ากับ Python Tasks เป๊ะ ใช้ .task เดิม |
| FFT (rPPG) | **fft.js** (หรือ webfft) | หา dominant frequency ของชีพจร |
| Filter | **fili** (Butterworth + filtfilt ใน JS) | ทำ bandpass คลื่นชีพจรให้ HRV |
| กราฟ | **Recharts** | กราฟแนวโน้มรายวัน |
| State | **Zustand** | store ของค่าล่าสุด เบา |
| i18n | **react-i18next** | TH/EN toggle |
| PWA/Offline | **vite-plugin-pwa** | ติดตั้งเป็นแอป + cache โมเดล/wasm ออฟไลน์ |

---

## 3. การพอร์ตโค้ด (Python → TypeScript)

อัลกอริทึมออกแบบ+ทดสอบใน Python มาแล้ว → พอร์ตด้วยความมั่นใจ คงตรรกะเดิม

| Python | → TS | หมายเหตุการพอร์ต |
|---|---|---|
| `rppg.py` (POS + butter + FFT) | `rppg.ts` | POS เหมือนเป๊ะ; FFT ใช้ fft.js; หา peak ในย่าน 0.75-4Hz |
| `stress.py` (find_peaks → RMSSD) | `stress.ts` | peak = local-max + min distance; RMSSD/SDNN เหมือนเดิม |
| `eyes.py` (EAR) | `eyes.ts` | คณิตเหมือนเดิม (landmark index ชุดเดียวกัน) |
| `posture.py` | `posture.ts` | เหมือนเดิม (ไหล่เอียง/หลังค่อม + calibrate) |
| `emotion.py` (blendshapes) | `emotion.ts` | แมป blendshapes → 7 อารมณ์ เหมือนเดิม |
| `drink.py` | `drink.ts` | ข้อมือ→ปาก เหมือนเดิม |
| `voice.py` (winsound) | `voice.ts` | `HTMLAudioElement` + cooldown; **ใช้ assets/*.wav เดิม** |

**ใช้ของเดิมซ้ำได้เลย:** ไฟล์โมเดล `models/*.task`, เสียง `assets/*.wav`, และตรรกะทั้งหมด

---

## 4. ความท้าทาย/ความเสี่ยงเฉพาะเว็บ (+ วิธีรับมือ)

1. **Performance** — รัน 2 landmarker/เฟรมบน WASM หนัก → ใช้ GPU delegate, รัน pose ถี่น้อยกว่า face (ทุก 2-3 เฟรม), เป้า 20-30fps
2. **rPPG ในเบราว์เซอร์** — วาดเฟรมลง offscreen canvas แล้ว `getImageData` เฉพาะกล่องหน้าผาก (เล็ก) → เฉลี่ย RGB; timestamp ใช้ `performance.now()` (ต้องเพิ่มขึ้นเสมอเหมือน Python)
3. **Filter/FFT ให้ตรง Python** — เขียน vitest พอร์ต selftest (สัญญาณ 72bpm) เทียบผลกับ Python ให้คลาด < ~3bpm
4. **HTTPS** — getUserMedia ต้องใช้ HTTPS → deploy บน Cloudflare (มี SSL)
5. **โหลดโมเดล** — วาง .task + wasm ใน `public/`; โหลดผ่าน `FilesetResolver`; cache ด้วย service worker (PWA) ~10MB ครั้งแรก
6. **Permission** — ต้องมีปุ่ม "เริ่ม" (user gesture) ก่อนเปิดกล้อง

---

## 5. แผนเป็นเฟส (ทำทีละก้อน ทดสอบได้จริงทุกเฟส)

| เฟส | งาน | ส่งมอบ |
|---|---|---|
| **0. Scaffold + กล้อง** | Vite/React/TS/Tailwind ใน `web/`; getUserMedia + ปุ่ม Start/Stop; โหลด FaceLandmarker (WASM,GPU) วาด face mesh | เห็น face mesh ในเบราว์เซอร์ = พิสูจน์ว่า WASM รันได้ |
| **1. rPPG (เสี่ยงสุด/คุ้มสุด)** | ROI หน้าผาก → POS + FFT → BPM + confidence; vitest 72bpm | การ์ด Heart Rate เรียลไทม์ |
| **2. Face monitors** | `eyes.ts` (blink/drowsy), `emotion.ts` (mood) | การ์ด Blink / Drowsy / Mood |
| **3. Pose monitors** | เพิ่ม PoseLandmarker (throttle), `posture.ts`, `drink.ts` | การ์ด Posture / Hydration |
| **4. Stress + screen-time** | `stress.ts` (HRV, fili bandpass), present timer/break | การ์ด Stress + เตือนพัก |
| **5. Dashboard UI + เสียง + settings** | layout การ์ด+วิดีโอ, dark mode, TH/EN; เสียง WAV + cooldown + mute; ตั้ง threshold/calibrate/เลือกกล้อง | UI ครบเทียบเท่า desktop |
| **6. Log + กราฟ** | บันทึกลง IndexedDB; Recharts ดูแนวโน้มรายวัน (HR/stress/mood/posture/น้ำ) | หน้า History/Trends |
| **7. PWA + deploy** | vite-plugin-pwa (ติดตั้งได้+ออฟไลน์); build → S3+Cloudflare | URL ใช้งานจริง + ติดตั้งเป็นแอปได้ |

**จุดพิสูจน์:** เฟส 0-1 คือด่านวัดใจ — ถ้า rPPG ทำงานในเบราว์เซอร์ได้ ที่เหลือคือพอร์ตตรง ๆ

---

## 6. โครงไฟล์ที่จะสร้าง

```
web/
├── index.html
├── package.json  vite.config.ts  tailwind.config.js  tsconfig.json
├── public/
│   ├── models/   (.task — ก๊อปจาก ../models)
│   ├── wasm/     (mediapipe wasm fileset)
│   └── audio/    (.wav — ก๊อปจาก ../assets)
├── src/
│   ├── main.tsx  App.tsx
│   ├── pipeline/        (camera + landmarkers + loop)
│   ├── monitors/        rppg.ts stress.ts eyes.ts posture.ts emotion.ts drink.ts voice.ts
│   ├── components/      Dashboard, MetricCard, VideoPanel, TrendsChart, Settings
│   ├── store/           (zustand)
│   └── i18n/
└── tests/               (vitest: rppg, emotion, stress)
```

---

## 7. Deploy (เฟส 7)

- Build static → **AWS S3 website + Cloudflare** (สแตกเดิม acct 265411103824, ap-se-7, SSL Flexible)
- โดเมนเสนอ: `healthcam.toptierdigital.space`
- PWA: ติดตั้งลงเครื่อง/มือถือได้ ทำงานออฟไลน์หลังโหลดครั้งแรก

---

## 8. สิ่งที่ได้เพิ่มจากเดิม (web unlocks)

- รันบน **มือถือ/แท็บเล็ต** ได้ (desktop exe ทำไม่ได้)
- **ติดตั้งเป็นแอป (PWA)** — ตอบโจทย์ roadmap "system-tray/background"
- **กราฟแนวโน้มรายวัน** ทำง่ายในเว็บ (Recharts) — roadmap เดิม
- **ไม่ติด Smart App Control** — เบราว์เซอร์รันได้เลย ไม่ต้อง sign exe
- แชร์ได้แค่ส่งลิงก์ (ไม่ต้องส่งไฟล์ 320MB)
```

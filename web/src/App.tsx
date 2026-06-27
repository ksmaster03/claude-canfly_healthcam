import { useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  PoseLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import {
  createFaceLandmarker,
  createPoseLandmarker,
} from "./pipeline/landmarkers";
import { sampleForeheadRGB, cropFaceToCanvas } from "./pipeline/roi";
import { RPPGEstimator } from "./monitors/rppg";
import { AgeMonitor } from "./monitors/age";
import { EyeMonitor } from "./monitors/eyes";
import { EmotionMonitor } from "./monitors/emotion";
import { PostureMonitor } from "./monitors/posture";
import { DrinkMonitor } from "./monitors/drink";
import { StressMonitor } from "./monitors/stress";
import { VoiceAlerts } from "./monitors/voice";
import type { Tone } from "./components/MetricCard";

const BREAK_SECONDS = 120 * 60; // เตือนลุกเมื่อนั่งต่อเนื่องเกิน 2 ชม.
const WATER_SECONDS = 240 * 60; // เตือนดื่มน้ำเมื่อไม่ดื่มเกิน 4 ชม.

const MOOD_TH: Record<string, string> = {
  neutral: "เฉย ๆ",
  happy: "มีความสุข",
  sad: "เศร้า",
  angry: "โกรธ",
  surprised: "ประหลาดใจ",
  fearful: "กลัว",
  disgusted: "รังเกียจ",
};

interface Monitors {
  rppg: RPPGEstimator;
  eyes: EyeMonitor;
  emotion: EmotionMonitor;
  posture: PostureMonitor;
  drink: DrinkMonitor;
  stress: StressMonitor;
}

interface Metrics {
  faceFound: boolean;
  age: number | null;
  hr: number | null;
  hrConf: number;
  stress: number | null;
  stressLabel: string;
  mood: string;
  moodValence: number;
  blink: number;
  drowsy: boolean;
  posture: string;
  tilt: number;
  slouch: boolean;
  screen: string;
  breakAlert: boolean;
  water: string;
  waterDue: boolean;
  drinking: boolean;
}

const EMPTY: Metrics = {
  faceFound: false,
  age: null,
  hr: null,
  hrConf: 0,
  stress: null,
  stressLabel: "",
  mood: "neutral",
  moodValence: 0,
  blink: 0,
  drowsy: false,
  posture: "calibrate",
  tilt: 0,
  slouch: false,
  screen: "—",
  breakAlert: false,
  water: "—",
  waterDue: false,
  drinking: false,
};

const pad = (n: number) => String(n).padStart(2, "0");

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const monRef = useRef<Monitors | null>(null);
  const voiceRef = useRef(new VoiceAlerts(true));
  const ageRef = useRef(new AgeMonitor());
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const ageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const presentSinceRef = useRef<number | null>(null);
  const lastSeenRef = useRef(0);
  const calibrateRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("พร้อมเริ่ม");
  const [fps, setFps] = useState(0);
  const [muted, setMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [m, setM] = useState<Metrics>(EMPTY);

  async function start() {
    try {
      setStatus("กำลังโหลดโมเดล…");
      if (!faceRef.current) faceRef.current = await createFaceLandmarker();
      if (!poseRef.current) poseRef.current = await createPoseLandmarker();

      monRef.current = {
        rppg: new RPPGEstimator(),
        eyes: new EyeMonitor(),
        emotion: new EmotionMonitor(),
        posture: new PostureMonitor(),
        drink: new DrinkMonitor(WATER_SECONDS, performance.now() / 1000),
        stress: new StressMonitor(),
      };
      offRef.current = document.createElement("canvas");
      ageCanvasRef.current = document.createElement("canvas");
      presentSinceRef.current = null;
      void ageRef.current.load(); // โหลด TF.js + โมเดลอายุเบื้องหลัง (ไม่บล็อกกล้อง)

      setStatus("กำลังขอสิทธิ์กล้อง…");
      await openStream(facingMode);

      setRunning(true);
      setStatus("กำลังทำงาน");
    } catch (e) {
      setStatus("ผิดพลาด: " + (e as Error).message);
    }
  }

  function stop() {
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    setRunning(false);
    setM(EMPTY);
    setStatus("หยุดแล้ว");
  }

  /** เปิดสตรีมกล้องตาม facingMode (user=หน้า, environment=หลัง) */
  async function openStream(fm: "user" | "environment") {
    const video = videoRef.current!;
    (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: fm, width: { ideal: 720 }, height: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  }

  /** สลับกล้องหน้า/หลัง */
  async function switchCamera() {
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    if (running) {
      try {
        await openStream(next);
      } catch {
        setStatus("สลับกล้องไม่ได้ (อุปกรณ์อาจมีกล้องเดียว)");
      }
    }
  }

  useEffect(() => {
    voiceRef.current.enabled = !muted;
  }, [muted]);

  // ลูปประมวลผลต่อเฟรม
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastTs = -1;
    let frame = 0;
    let frames = 0;
    let fpsT0 = performance.now();
    let lastUi = 0;
    let lastPose: ReturnType<PoseLandmarker["detectForVideo"]> | null = null;

    const ctx = canvasRef.current!.getContext("2d")!;
    const draw = new DrawingUtils(ctx);
    const offctx = offRef.current!.getContext("2d", {
      willReadFrequently: true,
    })!;
    const agectx = ageCanvasRef.current!.getContext("2d")!;

    const tick = () => {
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const face = faceRef.current!;
      const pose = poseRef.current!;
      const mon = monRef.current!;

      if (video.readyState >= 2) {
        const W = video.videoWidth;
        const H = video.videoHeight;
        canvas.width = W;
        canvas.height = H;

        let ts = performance.now();
        if (ts <= lastTs) ts = lastTs + 1;
        lastTs = ts;
        const tSec = ts / 1000;

        const fres = face.detectForVideo(video, ts);
        if (frame % 2 === 0) lastPose = pose.detectForVideo(video, ts); // throttle pose
        frame++;

        ctx.clearRect(0, 0, W, H);
        let facePresent = false;
        const fl = fres.faceLandmarks?.[0];
        if (fl) {
          facePresent = true;
          draw.drawConnectors(fl, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
            color: "#22d3ee22",
            lineWidth: 0.5,
          });
          draw.drawConnectors(fl, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
            color: "#0891b2",
            lineWidth: 2,
          });
          const roi = sampleForeheadRGB(video, fl, offRef.current!, offctx);
          if (roi) mon.rppg.update(roi.r, roi.g, roi.b, tSec);
          mon.eyes.update(fl, W, H, tSec);
          const bs = fres.faceBlendshapes?.[0];
          if (bs) mon.emotion.update(bs.categories);
          // วัดอายุ (crop ใบหน้า -> AgeGenderNet, predict ทุก ~2 วิ)
          if (cropFaceToCanvas(video, fl, ageCanvasRef.current!, agectx)) {
            ageRef.current.update(ageCanvasRef.current!, tSec);
          }
        }

        const pl = lastPose?.landmarks?.[0];
        if (pl) {
          if (calibrateRef.current) {
            mon.posture.calibrate(pl, W, H);
            calibrateRef.current = false;
          }
          mon.posture.update(pl, W, H);
          mon.drink.update(pl, W, H, tSec);
        }

        // เวลาอยู่หน้าจอ
        if (facePresent) {
          lastSeenRef.current = tSec;
          if (presentSinceRef.current == null) presentSinceRef.current = tSec;
        } else if (
          presentSinceRef.current != null &&
          tSec - lastSeenRef.current > 5
        ) {
          presentSinceRef.current = null;
        }

        const now = performance.now();
        if (now - lastUi > 350) {
          lastUi = now;
          const hr = mon.rppg.estimate();
          mon.stress.update(mon.rppg.filtered, mon.rppg.fs);

          let screen = "ไม่อยู่หน้าจอ";
          let breakAlert = false;
          if (presentSinceRef.current != null) {
            const el = tSec - presentSinceRef.current;
            breakAlert = el >= BREAK_SECONDS;
            screen = `${pad(Math.floor(el / 60))}:${pad(Math.floor(el % 60))}`;
            if (breakAlert) voiceRef.current.play("move", 300);
          }
          if (facePresent && mon.eyes.drowsy) voiceRef.current.play("drowsy", 10);

          const secs = mon.drink.secondsSinceDrink(tSec);
          const waterDue = mon.drink.due(tSec);
          if (waterDue) voiceRef.current.play("water", 300);
          const hh = Math.floor(secs / 3600);
          const mins = Math.floor((secs % 3600) / 60);

          setM({
            faceFound: facePresent,
            age: ageRef.current.age,
            hr,
            hrConf: mon.rppg.confidence,
            stress: mon.stress.score,
            stressLabel: mon.stress.label,
            mood: mon.emotion.emotion,
            moodValence: mon.emotion.valence,
            blink: mon.eyes.blinkRate,
            drowsy: mon.eyes.drowsy,
            posture: mon.posture.status,
            tilt: mon.posture.tiltDeg,
            slouch: mon.posture.slouch,
            screen,
            breakAlert,
            water: mon.drink.drinking ? "กำลังดื่ม :)" : `${hh}ชม. ${pad(mins)}น.`,
            waterDue,
            drinking: mon.drink.drinking,
          });
        }

        frames++;
        if (now - fpsT0 > 500) {
          setFps(Math.round((frames * 1000) / (now - fpsT0)));
          frames = 0;
          fpsT0 = now;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  useEffect(() => () => stop(), []);

  // ----- tone ของแต่ละค่า -----
  const hrTone: Tone = m.hr == null ? "muted" : m.hrConf > 0.25 ? "good" : "warn";
  const stressTone: Tone =
    m.stress == null ? "muted" : m.stress < 33 ? "good" : m.stress < 66 ? "warn" : "bad";
  const moodTone: Tone = !m.faceFound
    ? "muted"
    : m.moodValence > 0.08
    ? "good"
    : m.moodValence < -0.08
    ? "bad"
    : "neutral";

  // การ์ดข้อมูล (ชิป) ที่จะซ้อนบนภาพกล้อง
  const chips: { label: string; value: string; tone: Tone }[] = [
    { label: "หัวใจ", value: m.hr == null ? "วัด…" : `${Math.round(m.hr)} bpm`, tone: hrTone },
    { label: "เครียด", value: m.stress == null ? "วัด…" : `${Math.round(m.stress)}`, tone: stressTone },
    { label: "อารมณ์", value: m.faceFound ? MOOD_TH[m.mood] ?? m.mood : "—", tone: moodTone },
    { label: "อายุ", value: m.age == null ? "—" : `${Math.round(m.age)} ปี`, tone: "neutral" },
    { label: "กะพริบ", value: m.faceFound ? `${m.blink}/น.` : "—", tone: !m.faceFound ? "muted" : m.blink < 8 ? "bad" : "good" },
    { label: "ตื่นตัว", value: !m.faceFound ? "—" : m.drowsy ? "ง่วง!" : "ตื่นตัว", tone: !m.faceFound ? "muted" : m.drowsy ? "bad" : "good" },
    { label: "ท่านั่ง", value: m.posture === "good" ? "ดี" : m.posture === "bad" ? (m.slouch ? "หลังค่อม" : "ไหล่เอียง") : "ตั้งท่า", tone: m.posture === "good" ? "good" : m.posture === "bad" ? "bad" : "warn" },
    { label: "เวลาจอ", value: m.screen, tone: m.breakAlert ? "bad" : "neutral" },
    { label: "ดื่มน้ำ", value: m.drinking ? "ดื่ม :)" : m.water, tone: m.drinking ? "good" : m.waterDue ? "bad" : "neutral" },
  ];

  const chipColor: Record<Tone, string> = {
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-rose-300",
    neutral: "text-white",
    muted: "text-white/50",
  };
  const mirror = facingMode === "user"; // กล้องหน้า mirror เหมือนกระจก, กล้องหลังไม่ต้อง

  return (
    <div className="relative w-full h-[100dvh] bg-slate-100 sm:flex sm:justify-center sm:items-start sm:py-4">
      {/* กรอบแบบมือถือแนวตั้ง — มือถือเต็มจอ, เดสก์ท็อปเป็นกรอบ 9:16 ตรงกลาง */}
      <div className="relative w-full h-full overflow-hidden bg-slate-900 sm:h-[88vh] sm:max-h-[900px] sm:w-auto sm:aspect-[9/16] sm:rounded-[2rem] sm:shadow-2xl sm:ring-1 sm:ring-slate-300">
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover ${mirror ? "-scale-x-100" : ""}`}
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full object-cover ${mirror ? "-scale-x-100" : ""}`}
        />

        {/* แถบบน: ชื่อ + สถานะ + ปุ่มเสียง/สลับกล้อง */}
        <div className="absolute top-0 inset-x-0 p-3 flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent">
          <div className="text-white drop-shadow">
            <div className="font-bold leading-tight">AI Health Cam</div>
            <div className="text-[11px] text-white/75">
              {running
                ? `${fps} fps • ${m.faceFound ? "พบใบหน้า" : "ไม่พบใบหน้า"}`
                : status}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMuted((v) => !v)}
              className="w-10 h-10 grid place-items-center rounded-full bg-black/40 text-white text-lg backdrop-blur active:scale-95"
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button
              onClick={switchCamera}
              title="สลับกล้องหน้า/หลัง"
              className="w-10 h-10 grid place-items-center rounded-full bg-black/40 text-white text-lg backdrop-blur active:scale-95"
            >
              🔄
            </button>
          </div>
        </div>

        {/* เตือนพัก */}
        {m.breakAlert && (
          <div className="absolute top-16 inset-x-3 rounded-lg bg-rose-500/90 text-white text-center py-2 text-sm font-semibold">
            ถึงเวลาลุกขยับตัวแล้ว!
          </div>
        )}

        {/* ยังไม่เริ่ม: ปุ่มกลางจอ */}
        {!running && (
          <div className="absolute inset-0 grid place-items-center">
            <button
              onClick={start}
              className="px-10 py-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-white text-lg font-bold shadow-lg active:scale-95"
            >
              ▶ เริ่ม
            </button>
          </div>
        )}

        {/* แถบล่าง: ข้อมูลซ้อนบนภาพ + ปุ่มควบคุม */}
        {running && (
          <div className="absolute bottom-0 inset-x-0 p-3 pt-12 bg-gradient-to-t from-black/75 via-black/40 to-transparent">
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {chips.map((c) => (
                <div key={c.label} className="rounded-xl bg-black/40 backdrop-blur px-2.5 py-1.5">
                  <div className="text-[10px] text-white/60 leading-none mb-0.5">{c.label}</div>
                  <div className={`text-sm font-bold leading-tight tabular-nums ${chipColor[c.tone]}`}>
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={stop}
                className="flex-1 py-2.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-semibold active:scale-95"
              >
                หยุด
              </button>
              <button
                onClick={() => (calibrateRef.current = true)}
                className="px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-medium backdrop-blur active:scale-95"
              >
                ตั้งท่านั่ง
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

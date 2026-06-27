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
import { sampleForeheadRGB } from "./pipeline/roi";
import { RPPGEstimator } from "./monitors/rppg";
import { EyeMonitor } from "./monitors/eyes";
import { EmotionMonitor } from "./monitors/emotion";
import { PostureMonitor } from "./monitors/posture";
import { DrinkMonitor } from "./monitors/drink";
import { StressMonitor } from "./monitors/stress";
import { VoiceAlerts } from "./monitors/voice";
import { MetricCard, type Tone } from "./components/MetricCard";

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
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const presentSinceRef = useRef<number | null>(null);
  const lastSeenRef = useRef(0);
  const calibrateRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("พร้อมเริ่ม");
  const [fps, setFps] = useState(0);
  const [muted, setMuted] = useState(false);
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
      presentSinceRef.current = null;

      setStatus("กำลังขอสิทธิ์กล้อง…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

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

  // ----- คำนวณ tone/ข้อความของแต่ละการ์ด -----
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

  return (
    <div className="min-h-full mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <header className="text-center mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          AI Health Cam
        </h1>
        <p className="text-sm text-slate-500">
          ตรวจสุขภาพจากเว็บแคม • ประมวลผลในเบราว์เซอร์ 100% • ภาพไม่ออกจากเครื่อง
        </p>
      </header>

      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 ring-1 ring-slate-300 shadow">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        {!running && (
          <div className="absolute inset-0 grid place-items-center text-slate-300">
            กด “เริ่ม” เพื่อเปิดกล้อง
          </div>
        )}
        {m.breakAlert && (
          <div className="absolute top-0 inset-x-0 bg-rose-500/90 text-white text-center py-2 font-semibold">
            ถึงเวลาลุกขยับตัวแล้ว!
          </div>
        )}
      </div>

      {/* แถบควบคุม */}
      <div className="flex flex-wrap items-center gap-3 mt-4">
        {!running ? (
          <button
            onClick={start}
            className="px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition"
          >
            เริ่ม
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition"
          >
            หยุด
          </button>
        )}
        <button
          onClick={() => (calibrateRef.current = true)}
          disabled={!running}
          className="px-4 py-2.5 rounded-lg bg-slate-200 hover:bg-slate-300 disabled:opacity-40 text-slate-700 font-medium transition"
        >
          ตั้งท่านั่ง (calibrate)
        </button>
        <button
          onClick={() => setMuted((v) => !v)}
          className="px-4 py-2.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition"
        >
          {muted ? "🔇 เสียงปิด" : "🔊 เสียงเปิด"}
        </button>
        <span className="text-sm text-slate-500 ml-auto">
          {status}
          {running && (
            <>
              {" "}• {fps} fps •{" "}
              <span className={m.faceFound ? "text-emerald-600" : "text-amber-600"}>
                {m.faceFound ? "พบใบหน้า" : "ไม่พบใบหน้า"}
              </span>
            </>
          )}
        </span>
      </div>

      {/* การ์ดตรวจวัด */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-5">
        <MetricCard
          label="หัวใจ (Heart Rate)"
          value={m.hr == null ? "กำลังวัด…" : `${Math.round(m.hr)} bpm`}
          sub={m.hr == null ? "นั่งนิ่ง ~10 วิ" : `ความมั่นใจ ${Math.round(m.hrConf * 100)}%`}
          tone={hrTone}
        />
        <MetricCard
          label="ความเครียด (HRV)"
          value={m.stress == null ? "กำลังวัด…" : `${Math.round(m.stress)}/100`}
          sub={m.stress == null ? "" : m.stressLabel}
          tone={stressTone}
        />
        <MetricCard
          label="อารมณ์ (Mood)"
          value={m.faceFound ? MOOD_TH[m.mood] ?? m.mood : "—"}
          tone={moodTone}
        />
        <MetricCard
          label="กะพริบตา"
          value={m.faceFound ? `${m.blink}/นาที` : "—"}
          sub={m.faceFound && m.blink < 8 ? "ต่ำ — เสี่ยงตาแห้ง" : ""}
          tone={!m.faceFound ? "muted" : m.blink < 8 ? "bad" : "good"}
        />
        <MetricCard
          label="ความตื่นตัว"
          value={!m.faceFound ? "—" : m.drowsy ? "ง่วง!" : "ตื่นตัว"}
          tone={!m.faceFound ? "muted" : m.drowsy ? "bad" : "good"}
        />
        <MetricCard
          label="ท่านั่ง"
          value={
            m.posture === "good"
              ? "ดี"
              : m.posture === "bad"
              ? m.slouch
                ? "หลังค่อม"
                : "ไหล่เอียง"
              : "กดปุ่มตั้งท่า"
          }
          sub={m.posture !== "calibrate" ? `เอียง ${Math.round(m.tilt)}°` : ""}
          tone={m.posture === "good" ? "good" : m.posture === "bad" ? "bad" : "warn"}
        />
        <MetricCard
          label="เวลาหน้าจอ"
          value={m.screen}
          tone={m.breakAlert ? "bad" : "neutral"}
        />
        <MetricCard
          label="ดื่มน้ำ"
          value={m.water}
          tone={m.drinking ? "good" : m.waterDue ? "bad" : "neutral"}
        />
      </div>

      <p className="text-center text-xs text-slate-400 mt-6">
        เครื่องมือ wellness เพื่อดูแนวโน้ม ไม่ใช่อุปกรณ์การแพทย์ • เปิดบนมือถือได้ (ต้องเป็น HTTPS)
      </p>
    </div>
  );
}

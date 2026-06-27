import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { createFaceLandmarker } from "./pipeline/landmarkers";

/**
 * Phase 0 — พิสูจน์ว่า MediaPipe (WASM) ทำงานในเบราว์เซอร์:
 * เปิดกล้อง → ตรวจ FaceLandmarker ต่อเฟรม → วาด face mesh ทับวิดีโอ + โชว์ FPS
 * เฟสถัดไปจะต่อ monitors (rPPG/mood/...) เข้ากับลูปนี้
 */
export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<FaceLandmarker | null>(null);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("พร้อมเริ่ม");
  const [fps, setFps] = useState(0);
  const [faceFound, setFaceFound] = useState(false);

  async function start() {
    try {
      setStatus("กำลังโหลดโมเดล…");
      if (!faceRef.current) faceRef.current = await createFaceLandmarker();

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
    setFaceFound(false);
    setStatus("หยุดแล้ว");
  }

  // ลูปประมวลผลต่อเฟรม — ผูกกับสถานะ running
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastTs = -1;
    let frames = 0;
    let fpsT0 = performance.now();
    const ctx = canvasRef.current!.getContext("2d")!;
    const draw = new DrawingUtils(ctx);

    const tick = () => {
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const face = faceRef.current!;
      if (video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // timestamp ต้องเพิ่มขึ้นเสมอ (เงื่อนไขของ detectForVideo)
        let ts = performance.now();
        if (ts <= lastTs) ts = lastTs + 1;
        lastTs = ts;

        const res = face.detectForVideo(video, ts);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const found = !!res.faceLandmarks?.length;
        if (found) {
          const lm = res.faceLandmarks[0];
          draw.drawConnectors(
            lm,
            FaceLandmarker.FACE_LANDMARKS_TESSELATION,
            { color: "#22d3ee33", lineWidth: 0.5 }
          );
          draw.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
            color: "#22d3ee",
            lineWidth: 2,
          });
        }
        setFaceFound((prev) => (prev !== found ? found : prev));

        frames++;
        const now = performance.now();
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

  // หยุดกล้องเมื่อปิดหน้า
  useEffect(() => () => stop(), []);

  return (
    <div className="min-h-full flex flex-col items-center gap-5 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">AI Health Cam</h1>
        <p className="text-sm text-slate-400">
          ตรวจสุขภาพจากเว็บแคม • ประมวลผลในเบราว์เซอร์ 100% • ภาพไม่ออกจากเครื่อง
        </p>
      </header>

      <div className="relative w-full max-w-3xl aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-slate-700">
        {/* mirror ให้เหมือนกระจก */}
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
          <div className="absolute inset-0 grid place-items-center text-slate-400">
            กด“เริ่ม” เพื่อเปิดกล้อง
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {!running ? (
          <button
            onClick={start}
            className="px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold transition"
          >
            เริ่ม
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-5 py-2.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-semibold transition"
          >
            หยุด
          </button>
        )}
        <span className="text-sm text-slate-400">
          สถานะ: <b className="text-slate-200">{status}</b>
          {running && (
            <>
              {" "}• {fps} fps •{" "}
              <span className={faceFound ? "text-emerald-400" : "text-amber-400"}>
                {faceFound ? "พบใบหน้า" : "ไม่พบใบหน้า"}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

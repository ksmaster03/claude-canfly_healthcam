import { describe, it, expect } from "vitest";
import { RPPGEstimator } from "../src/monitors/rppg";
import { StressMonitor } from "../src/monitors/stress";
import { EmotionMonitor } from "../src/monitors/emotion";

/** ป้อนสัญญาณชีพจรปลอม (RGB ครบ ชีพจรเด่นในช่อง G) */
function synth(hz = 1.2, seconds = 12, fs = 30): RPPGEstimator {
  const est = new RPPGEstimator(12, 6);
  let phase = 0;
  const noise = () => (Math.random() - 0.5) * 1.2;
  for (let i = 0; i < fs * seconds; i++) {
    const t = i / fs;
    phase += (2 * Math.PI * hz) / fs;
    const p = Math.sin(phase);
    est.update(180 + 1 * p + noise(), 128 + 6 * p + noise(), 120 + 2 * p + noise(), t);
  }
  return est;
}

describe("rPPG (POS)", () => {
  it("ถอดสัญญาณ ~72 bpm ได้", () => {
    const est = synth(1.2);
    const bpm = est.estimate();
    expect(bpm).not.toBeNull();
    expect(Math.abs((bpm as number) - 72)).toBeLessThan(8);
  });
});

describe("StressMonitor (HRV)", () => {
  it("คำนวณคะแนนความเครียดจากคลื่นชีพจรได้", () => {
    const est = synth(1.2);
    est.estimate(); // เติม filtered/fs
    const stress = new StressMonitor();
    stress.update(est.filtered, est.fs);
    expect(stress.score).not.toBeNull();
  });
});

describe("EmotionMonitor", () => {
  it("ยิ้ม -> happy, เฉย -> neutral", () => {
    const em = new EmotionMonitor(0); // ปิด smoothing
    em.update([
      { categoryName: "mouthSmileLeft", score: 0.9 },
      { categoryName: "mouthSmileRight", score: 0.9 },
    ]);
    expect(em.emotion).toBe("happy");
    expect(em.valence).toBeGreaterThan(0);

    em.update([{ categoryName: "mouthSmileLeft", score: 0.02 }]);
    expect(em.emotion).toBe("neutral");
  });
});

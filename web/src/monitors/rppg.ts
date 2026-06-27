/**
 * rPPG — วัดอัตราการเต้นหัวใจจากกล้อง (พอร์ตจาก monitors/rppg.py)
 *
 * ใช้อัลกอริทึม POS (Plane-Orthogonal-to-Skin, Wang 2017): รวมสัญญาณ R/G/B
 * ของ ROI หน้าผาก แล้ว project ลงระนาบตั้งฉากกับโทนผิว → คลื่นชีพจร
 * จากนั้น bandpass (ทำผ่าน FFT/IFFT แทน scipy.filtfilt) → หา peak ใน FFT
 *
 * เปิด this.filtered / this.fs (คลื่นชีพจรที่กรองแล้ว) ให้ StressMonitor (HRV)
 * นำไปใช้ในเฟสถัดไป
 */
import FFT from "fft.js";

const LOW_HZ = 0.75; // 45 bpm
const HIGH_HZ = 4.0; // 240 bpm

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function std(a: number[]): number {
  const n = a.length;
  if (!n) return 0;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const varr = a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(varr);
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** bandpass แบบ zero-phase: FFT → ตัด bin นอกย่าน → IFFT (แทน filtfilt) */
function bandpassTime(signal: number[], fs: number, low: number, high: number): Float64Array {
  const N = nextPow2(signal.length);
  const fft = new FFT(N);
  const input = new Array(N).fill(0);
  for (let i = 0; i < signal.length; i++) input[i] = signal[i];
  const spec = fft.createComplexArray();
  fft.realTransform(spec, input);
  fft.completeSpectrum(spec);
  for (let k = 0; k < N; k++) {
    const f = (k <= N / 2 ? k : k - N) * (fs / N); // ความถี่แบบมีเครื่องหมาย
    const af = Math.abs(f);
    if (af < low || af > high) {
      spec[2 * k] = 0;
      spec[2 * k + 1] = 0;
    }
  }
  const out = fft.createComplexArray();
  fft.inverseTransform(out, spec);
  const res = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) res[i] = out[2 * i]; // เอาเฉพาะส่วนจริง
  return res;
}

export class RPPGEstimator {
  private times: number[] = [];
  private r: number[] = [];
  private g: number[] = [];
  private b: number[] = [];

  bpm: number | null = null;
  confidence = 0;
  filtered: Float64Array | null = null;
  fs: number | null = null;

  constructor(private windowSeconds = 10, private minSeconds = 6) {}

  /** ป้อนค่าเฉลี่ย R/G/B ของ ROI หน้าผาก + เวลา (วินาที) */
  update(rMean: number, gMean: number, bMean: number, tSec: number): void {
    this.r.push(rMean);
    this.g.push(gMean);
    this.b.push(bMean);
    this.times.push(tSec);
    while (this.times.length && tSec - this.times[0] > this.windowSeconds) {
      this.times.shift();
      this.r.shift();
      this.g.shift();
      this.b.shift();
    }
  }

  /** POS: คืนคลื่นชีพจรความยาวเท่าจำนวนเฟรม (หน้าต่างเลื่อน 1.6s + overlap-add) */
  private pos(fs: number): number[] | null {
    const n = this.times.length;
    const win = Math.floor(1.6 * fs);
    if (win < 2 || n < win) return null;

    const signal = new Array(n).fill(0);
    for (let start = 0; start <= n - win; start++) {
      let mr = 0, mg = 0, mb = 0;
      for (let i = start; i < start + win; i++) {
        mr += this.r[i];
        mg += this.g[i];
        mb += this.b[i];
      }
      mr /= win; mg /= win; mb /= win;

      const s1 = new Array(win);
      const s2 = new Array(win);
      for (let i = 0; i < win; i++) {
        const cr = this.r[start + i] / (mr + 1e-9);
        const cg = this.g[start + i] / (mg + 1e-9);
        const cb = this.b[start + i] / (mb + 1e-9);
        s1[i] = cg - cb;
        s2[i] = cg + cb - 2 * cr;
      }
      const alpha = std(s1) / (std(s2) + 1e-9);
      let hmean = 0;
      const h = new Array(win);
      for (let i = 0; i < win; i++) {
        h[i] = s1[i] + alpha * s2[i];
        hmean += h[i];
      }
      hmean /= win;
      for (let i = 0; i < win; i++) signal[start + i] += h[i] - hmean; // overlap-add
    }
    return signal;
  }

  estimate(): number | null {
    const n = this.times.length;
    if (n < 30) return null;
    const duration = this.times[n - 1] - this.times[0];
    if (duration < this.minSeconds) return null;
    const fs = n / duration;
    if (fs < 5) return null;

    const pulse = this.pos(fs);
    if (!pulse) return null;

    // bandpass = เทียบเท่า filtfilt; เก็บไว้ให้ HRV ใช้ต่อ
    const filtered = bandpassTime(pulse, fs, LOW_HZ, HIGH_HZ);
    this.filtered = filtered;
    this.fs = fs;

    // FFT บนสัญญาณที่กรอง + Hann window → หา peak ในย่านชีพจร
    const w = hann(filtered.length);
    const windowed = Array.from(filtered, (v, i) => v * w[i]);
    const N = nextPow2(windowed.length);
    const fft = new FFT(N);
    const input = new Array(N).fill(0);
    for (let i = 0; i < windowed.length; i++) input[i] = windowed[i];
    const spec = fft.createComplexArray();
    fft.realTransform(spec, input);
    fft.completeSpectrum(spec);

    let peakIdx = -1;
    let peakVal = -1;
    let total = 0;
    for (let k = 0; k <= N / 2; k++) {
      const freq = (k * fs) / N;
      if (freq < LOW_HZ || freq > HIGH_HZ) continue;
      const mag = Math.hypot(spec[2 * k], spec[2 * k + 1]);
      total += mag;
      if (mag > peakVal) {
        peakVal = mag;
        peakIdx = k;
      }
    }
    if (peakIdx < 0) return null;

    const bpm = ((peakIdx * fs) / N) * 60;
    this.confidence = total > 0 ? peakVal / total : 0;
    this.bpm = this.bpm == null ? bpm : 0.8 * this.bpm + 0.2 * bpm;
    return this.bpm;
  }
}

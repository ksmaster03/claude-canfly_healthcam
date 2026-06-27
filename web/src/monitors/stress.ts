/**
 * Stress — ประเมินความเครียดจาก HRV (Heart Rate Variability)
 * (พอร์ตจาก monitors/stress.py)
 *
 * หลักการทางสรีรวิทยา: ระยะห่างระหว่างจังหวะหัวใจแต่ละครั้ง (inter-beat
 * interval, IBI) ไม่เท่ากันเป๊ะ ความแปรปรวนนี้ถูกควบคุมโดยระบบประสาท
 * อัตโนมัติ — ตอนผ่อนคลายระบบ parasympathetic เด่น HRV จะ "สูง"
 * ตอนเครียดระบบ sympathetic เด่น HRV จะ "ต่ำ"
 *
 * เราดึงคลื่นชีพจรที่ rPPG กรองไว้แล้ว -> หา peak แต่ละจังหวะ -> คำนวณ IBI
 * -> วัด RMSSD (ตัวชี้วัด HRV ระยะสั้นที่นิยมที่สุด) -> แปลงเป็นคะแนนเครียด
 *
 * ⚠️ rPPG-HRV หยาบกว่าการวัดด้วยสายรัดอก/ปลายนิ้ว ใช้เป็น "แนวโน้ม"
 *    ไม่ใช่ค่าทางการแพทย์
 */

// ช่วง RMSSD (ms) ที่ใช้ map เป็นคะแนน: ต่ำ=เครียด สูง=ผ่อนคลาย
const _RMSSD_STRESSED = 15.0;
const _RMSSD_RELAXED = 70.0;

/** clip ค่าให้อยู่ในช่วง [lo, hi] (เทียบเท่า np.clip) */
function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** population std (ddof=0) — เทียบเท่า np.std */
function populationStd(a: number[]): number {
  const n = a.length;
  if (!n) return 0;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const varr = a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(varr);
}

/**
 * หา local maxima ของสัญญาณ พร้อมบังคับระยะห่างขั้นต่ำ minDistance (จำนวน sample)
 * เทียบเท่า scipy.signal.find_peaks(signal, distance=minDistance):
 * เมื่อ peak สองตัวอยู่ใกล้กันเกิน minDistance ให้เก็บตัวที่ค่าสูงกว่า
 */
export function findPeaks(signal: Float64Array, minDistance: number): number[] {
  const n = signal.length;

  // 1) หา local maxima ทั้งหมด (จุดที่สูงกว่าเพื่อนบ้านทั้งสองข้าง)
  //    จัดการช่วงค่าเท่ากันแบบ plateau ด้วยการเก็บ index กึ่งกลาง
  const candidates: number[] = [];
  let i = 1;
  while (i < n - 1) {
    if (signal[i - 1] < signal[i]) {
      // ขาขึ้น — มองหาจุดสูงสุดของ plateau (ค่าเท่ากันต่อเนื่อง)
      let ahead = i + 1;
      while (ahead < n - 1 && signal[ahead] === signal[i]) ahead++;
      if (signal[ahead] < signal[i]) {
        // ขาลงหลัง plateau -> เป็น peak; เก็บ index กึ่งกลางของ plateau
        const left = i;
        const right = ahead - 1;
        candidates.push((left + right) >> 1);
        i = ahead;
        continue;
      }
      i = ahead;
    } else {
      i++;
    }
  }

  if (minDistance <= 1 || candidates.length === 0) return candidates;

  // 2) บังคับระยะห่างขั้นต่ำ: ไล่จาก peak ที่ค่าสูงสุดก่อน แล้วตัดเพื่อนบ้านที่ใกล้เกินไป
  //    (พฤติกรรมเดียวกับ scipy._select_by_peak_distance)
  const order = candidates
    .map((_, idx) => idx)
    .sort((a, b) => signal[candidates[a]] - signal[candidates[b]]); // ค่าน้อย -> มาก
  const keep = new Array<boolean>(candidates.length).fill(true);

  for (let k = order.length - 1; k >= 0; k--) {
    const j = order[k]; // priority สูงสุด (ค่ามากสุด) ก่อน
    if (!keep[j]) continue;

    // ตัดเพื่อนบ้านทางซ้ายที่อยู่ใกล้เกิน minDistance
    let left = j - 1;
    while (left >= 0 && candidates[j] - candidates[left] < minDistance) {
      keep[left] = false;
      left--;
    }
    // ตัดเพื่อนบ้านทางขวาที่อยู่ใกล้เกิน minDistance
    let right = j + 1;
    while (right < candidates.length && candidates[right] - candidates[j] < minDistance) {
      keep[right] = false;
      right++;
    }
  }

  const result: number[] = [];
  for (let idx = 0; idx < candidates.length; idx++) {
    if (keep[idx]) result.push(candidates[idx]);
  }
  return result;
}

export class StressMonitor {
  rmssd: number | null = null; // ms
  sdnn: number | null = null; // ms
  score: number | null = null; // 0-100 (สูง = เครียดมาก)
  label = "—";

  /** รับคลื่นชีพจรที่กรองแล้ว (rppg.filtered) + fs (rppg.fs) */
  update(filtered: Float64Array | null, fs: number | null): void {
    if (filtered === null || fs === null || filtered.length < fs * 4) {
      return;
    }

    // หา peak ของชีพจร: ห่างกันอย่างน้อย 0.33s = ไม่เกิน 180 bpm
    const minDist = Math.max(1, Math.round(0.33 * fs));
    const peaks = findPeaks(filtered, minDist);
    if (peaks.length < 4) {
      return;
    }

    // IBI หน่วย ms = diff(peakIndices)/fs*1000 แล้วกรองค่าผิดปกติ (30-200 bpm)
    const ibi: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const v = ((peaks[i] - peaks[i - 1]) / fs) * 1000.0;
      if (v > 300 && v < 2000) ibi.push(v);
    }
    if (ibi.length < 3) {
      return;
    }

    // RMSSD = sqrt(mean(diff(ibi)^2)); SDNN = population std ของ IBI
    let sumSq = 0;
    for (let i = 1; i < ibi.length; i++) {
      const d = ibi[i] - ibi[i - 1];
      sumSq += d * d;
    }
    this.rmssd = Math.sqrt(sumSq / (ibi.length - 1));
    this.sdnn = populationStd(ibi);

    // map RMSSD -> คะแนนเครียด 0-100 (RMSSD ต่ำ -> คะแนนสูง)
    const raw =
      clip(
        (_RMSSD_RELAXED - this.rmssd) / (_RMSSD_RELAXED - _RMSSD_STRESSED),
        0.0,
        1.0
      ) * 100.0;
    // smooth กันค่ากระโดด (HRV จากหน้าต่างสั้น ๆ ผันผวนสูง)
    this.score = this.score === null ? raw : 0.8 * this.score + 0.2 * raw;

    if (this.score < 33) {
      this.label = "relaxed";
    } else if (this.score < 66) {
      this.label = "moderate";
    } else {
      this.label = "HIGH";
    }
  }
}

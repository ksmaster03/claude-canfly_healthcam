/**
 * เล่นเสียงเตือนภาษาไทยในเบราว์เซอร์ (พอร์ตจาก voice.py)
 *
 * ใช้ไฟล์ WAV เดิม (สังเคราะห์ด้วย edge-tts) ที่ /audio/<key>.wav
 * เล่นด้วย HTMLAudioElement + cooldown กันพูดซ้ำทุกเฟรม
 * (autoplay ทำงานได้เพราะแอปเริ่มหลังผู้ใช้กดปุ่ม "เริ่ม" = user gesture)
 */
export type VoiceKey = "drowsy" | "move" | "water";

export class VoiceAlerts {
  enabled: boolean;
  private lastPlayed: Record<string, number> = {};
  private cache: Record<string, HTMLAudioElement> = {};

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** เล่นเสียง key ถ้าพ้น cooldown (วินาที) แล้ว */
  play(key: VoiceKey, cooldownSec: number): void {
    if (!this.enabled) return;
    const now = performance.now() / 1000;
    if (now - (this.lastPlayed[key] ?? -1e9) < cooldownSec) return;
    this.lastPlayed[key] = now;

    let audio = this.cache[key];
    if (!audio) {
      audio = new Audio(`/audio/${key}.wav`);
      this.cache[key] = audio;
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* เบราว์เซอร์อาจบล็อกถ้ายังไม่มี user gesture — ข้ามไป */
    });
  }
}

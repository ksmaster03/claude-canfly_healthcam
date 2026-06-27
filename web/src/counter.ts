/**
 * ตัวนับผู้ใช้งาน (visitor counter)
 *
 * นับ "ผู้ใช้ไม่ซ้ำ" โดยเพิ่มเลข 1 ครั้งต่อเบราว์เซอร์ (จำด้วย localStorage)
 * ค่าถูกเก็บที่ backend กลาง — ส่งออกไปแค่สัญญาณ "+1" ไม่มีข้อมูลผู้ใช้ใด ๆ
 *
 * ดีฟอลต์ใช้บริการฟรี abacus (keyless, มี CORS) เพื่อให้ใช้งานได้ทันที
 * ถ้าตั้ง VITE_COUNTER_URL (Cloudflare Worker ของเราเอง ดู counter-worker/)
 * จะสลับไปใช้ของเราเองอัตโนมัติ
 */
const OWN = (import.meta.env as Record<string, string | undefined>).VITE_COUNTER_URL?.replace(
  /\/$/,
  ""
);
const NS = "aicam-toptierdigital";
const KEY = "visits";

function endpoint(action: "hit" | "get"): string {
  if (OWN) return `${OWN}/${action}`;
  return `https://abacus.jasoncameron.dev/${action}/${NS}/${KEY}`;
}

export async function fetchVisitorCount(): Promise<number | null> {
  const firstTime = !localStorage.getItem("aicam_counted");
  try {
    const res = await fetch(endpoint(firstTime ? "hit" : "get"));
    if (!res.ok) throw new Error(String(res.status));
    const data: { value?: number; count?: number } = await res.json();
    if (firstTime) localStorage.setItem("aicam_counted", "1");
    return data.value ?? data.count ?? null;
  } catch {
    return null; // ถ้าเรียกไม่ได้ ไม่ต้องแสดงตัวนับ
  }
}

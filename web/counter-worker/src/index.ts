/**
 * Cloudflare Worker — visitor counter (เก็บสถิติบน Cloudflare KV ของเราเอง)
 *
 *   GET /hit  -> เพิ่ม 1 แล้วคืน { count }
 *   GET /get  -> คืน { count } เฉย ๆ (ไม่เพิ่ม)
 *
 * ค่าเก็บเป็นข้อความใน KV key "count" (เทียบเท่าไฟล์ข้อความเก็บตัวเลข)
 * ไม่มีข้อมูลผู้ใช้ใด ๆ — เก็บแค่จำนวนครั้งเท่านั้น
 *
 * อยากเก็บเป็น "ไฟล์ stats.json จริง ๆ" ก็เปลี่ยนไปผูก R2 แล้ว
 * env.STATS.put("stats.json", JSON.stringify({count})) ได้ (ดู README)
 */
export interface Env {
  COUNTER: KVNamespace;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const path = new URL(req.url).pathname;
    let count = parseInt((await env.COUNTER.get("count")) ?? "0", 10) || 0;

    if (path.endsWith("/hit")) {
      count += 1;
      await env.COUNTER.put("count", String(count));
    }

    return new Response(JSON.stringify({ count, value: count }), {
      headers: { "content-type": "application/json", ...CORS },
    });
  },
};

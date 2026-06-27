/**
 * ก๊อปไฟล์ที่ต้องโฮสต์เองเข้า public/ (รันหลัง npm install)
 *   - โมเดล .task        จาก ../models
 *   - เสียงเตือน .wav     จาก ../assets
 *   - MediaPipe WASM      จาก node_modules/@mediapipe/tasks-vision/wasm
 *
 * ใช้: node scripts/copy-assets.mjs
 */
import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const repo = join(web, "..");

function copyFiles(srcDir, dstDir, exts) {
  if (!existsSync(srcDir)) {
    console.warn(`[skip] ไม่พบ ${srcDir}`);
    return;
  }
  mkdirSync(dstDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (exts.some((e) => f.endsWith(e))) {
      cpSync(join(srcDir, f), join(dstDir, f));
      console.log(`[copy] ${f}`);
    }
  }
}

// โมเดล + เสียง จากโปรเจกต์ desktop เดิม
copyFiles(join(repo, "models"), join(web, "public/models"), [".task"]);
copyFiles(join(repo, "assets"), join(web, "public/audio"), [".wav"]);

// WASM fileset ของ MediaPipe
const wasmSrc = join(web, "node_modules/@mediapipe/tasks-vision/wasm");
if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, join(web, "public/wasm"), { recursive: true });
  console.log("[copy] wasm/ (MediaPipe fileset)");
} else {
  console.warn("[skip] ไม่พบ wasm — รัน npm install ก่อน");
}

// โมเดลวัดอายุ (AgeGenderNet ของ face-api fork)
const ageSrc = join(web, "node_modules/@vladmandic/face-api/model");
copyFiles(ageSrc, join(web, "public/face-api-models"), [
  "age_gender_model-weights_manifest.json",
  "age_gender_model.bin",
]);

console.log("เสร็จสิ้น: public/ พร้อมใช้งาน");

/**
 * โหลดโมเดล MediaPipe Tasks (FaceLandmarker / PoseLandmarker) แบบรันในเบราว์เซอร์
 *
 * WASM fileset และไฟล์โมเดล .task โฮสต์เองใน public/ (ไม่พึ่ง CDN) เพื่อให้
 * ทำงานออฟไลน์ได้และคงสัญญา "ประมวลผลในเครื่อง ไม่ส่งข้อมูลออก"
 */
import {
  FilesetResolver,
  FaceLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

const WASM_PATH = "/wasm";

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null =
  null;

function vision() {
  if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH);
  return filesetPromise;
}

export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  return FaceLandmarker.createFromOptions(await vision(), {
    baseOptions: {
      modelAssetPath: "/models/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true, // เปิดไว้ใช้ตรวจอารมณ์ (mood) ในเฟสถัดไป
  });
}

export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(await vision(), {
    baseOptions: {
      modelAssetPath: "/models/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

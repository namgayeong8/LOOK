// 얼굴 방향(고개 제스처) 인식 모듈
// MediaPipe Face Landmarker(tasks-vision)로 최대 2명의 얼굴 랜드마크를 추적하고,
// 코/얼굴 경계 랜드마크의 상대 위치로 Yaw(좌우)·Pitch(상하)를 계산해
// up / down / left / right / center 를 판별한다.
//
// 2인 모드: 화면 x좌표로 얼굴을 정렬해 가장 왼쪽=slot0(P1), 가장 오른쪽=slot1(P2).
// 1인 모드 호환: this.direction / this.faceFound 는 slot0(가장 왼쪽 얼굴)에 매핑.
//
// ▸ 좌우가 반대로 느껴지면  INVERT_YAW  를,
//   상하가 반대로 느껴지면  INVERT_PITCH 를 true 로 바꾸세요.
// ▸ 너무 예민하거나 둔하면 YAW_TH / PITCH_TH 값을 조절하세요.

import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ---- 튜닝 상수 -------------------------------------------------
const YAW_TH = 0.10;   // 좌우 판별 임계값 (얼굴폭 대비 코 이동 비율)
const PITCH_TH = 0.10; // 상하 판별 임계값 (얼굴높이 대비 코 이동 비율)
const INVERT_YAW = false;
const INVERT_PITCH = false;
const SMOOTH = 0.35;   // 지수 평활 계수(0~1). 클수록 반응 빠르고 떨림 많음.
// 주요 랜드마크 인덱스 (MediaPipe FaceMesh)
const NOSE = 1, FOREHEAD = 10, CHIN = 152, EDGE_A = 234, EDGE_B = 454;
const MAX_FACES = 2;
// ---------------------------------------------------------------

function newSlot() {
  return { yaw: 0, pitch: 0, baseYaw: 0, basePitch: 0, found: false, direction: "center" };
}

export class FaceController {
  constructor() {
    this.landmarker = null;
    this.video = null;
    this.running = false;
    this._lastTs = -1;

    // 슬롯 0 = 가장 왼쪽 얼굴(P1), 슬롯 1 = 가장 오른쪽 얼굴(P2)
    this.slots = [newSlot(), newSlot()];

    // 1인 모드 호환용(= slot0)
    this.direction = "center";
    this.faceFound = false;
  }

  async init(video) {
    this.video = video;
    const resolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    const make = (delegate) =>
      FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate,
        },
        runningMode: "VIDEO",
        numFaces: MAX_FACES, // 2인 동시 추적(1인 모드는 왼쪽 얼굴만 사용)
      });
    // 일부 브라우저/GPU에서 GPU 델리게이트가 결과를 못 내는 경우 CPU로 대체
    try {
      this.landmarker = await make("GPU");
    } catch (e) {
      console.warn("[FaceController] GPU delegate 실패 → CPU 대체", e);
      this.landmarker = await make("CPU");
    }
  }

  // 검출에 사용할 비디오 교체(플레이 화면의 '보이는' 비디오로 전환)
  setVideo(video) {
    if (video) this.video = video;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
  }

  // 현재 자세를 각 슬롯의 '정면(중앙)'으로 보정
  calibrate() {
    for (const s of this.slots) {
      s.baseYaw = s.yaw;
      s.basePitch = s.pitch;
    }
  }

  // 2인 모드용: 플레이어 i(0=P1 왼쪽, 1=P2 오른쪽)의 상태
  getPlayer(i) {
    const s = this.slots[i] || newSlot();
    return { found: s.found, direction: s.found ? s.direction : "center" };
  }

  _loop() {
    if (!this.running) return;
    const v = this.video;
    if (v && v.readyState >= 2 && this.landmarker) {
      const ts = performance.now();
      if (ts !== this._lastTs) {
        this._lastTs = ts;
        const res = this.landmarker.detectForVideo(v, ts);
        this._process(res);
      }
    }
    requestAnimationFrame(() => this._loop());
  }

  _process(res) {
    const faces = res.faceLandmarks || [];
    // 얼굴별 지표 계산 후 화면 x좌표로 정렬(왼쪽→오른쪽)
    const metrics = faces.map((lms) => this._metric(lms));
    metrics.sort((a, b) => a.cx - b.cx);

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const m = metrics[i];
      if (!m) {
        slot.found = false;
        slot.direction = "center";
        continue;
      }
      slot.found = true;
      slot.yaw += (m.yawRaw - slot.yaw) * SMOOTH;
      slot.pitch += (m.pitchRaw - slot.pitch) * SMOOTH;
      slot.direction = this._dir(slot);
    }

    // 1인 모드 호환(= 가장 왼쪽 얼굴)
    this.faceFound = this.slots[0].found;
    this.direction = this.slots[0].direction;
  }

  // 한 얼굴의 yaw/pitch 원지표 + 중심 x(정렬용) 계산 (거울 좌표계)
  _metric(lms) {
    const mx = (i) => 1 - lms[i].x;
    const y = (i) => lms[i].y;
    const eA = mx(EDGE_A), eB = mx(EDGE_B);
    const left = Math.min(eA, eB), right = Math.max(eA, eB);
    const faceW = Math.max(1e-4, right - left);
    const faceH = Math.max(1e-4, y(CHIN) - y(FOREHEAD));
    return {
      cx: (left + right) / 2,                       // 화면 중심 x(정렬 기준)
      yawRaw: (mx(NOSE) - left) / faceW - 0.5,       // 코가 오른쪽이면 +
      pitchRaw: (y(NOSE) - y(FOREHEAD)) / faceH - 0.5, // 코가 아래면 +
    };
  }

  // 슬롯의 평활 지표 → 방향 판별
  _dir(slot) {
    let dx = slot.yaw - slot.baseYaw;
    let dy = slot.pitch - slot.basePitch;
    if (INVERT_YAW) dx = -dx;
    if (INVERT_PITCH) dy = -dy;
    const nx = dx / YAW_TH, ny = dy / PITCH_TH;
    if (Math.max(Math.abs(nx), Math.abs(ny)) < 1) return "center";
    if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? "right" : "left";
    return ny > 0 ? "down" : "up";
  }
}

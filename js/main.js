// 게임 메인: 화면 전환, 카메라, 40초 타이머, 점수, 고개 선택(dwell) 로직
import { FaceController } from "./faceControl.js";
import {
  pickTargetShape,
  generateRound,
  shapeSVG,
  shapeSVGHex,
  SHAPES,
  DIRECTIONS,
} from "./questions.js";
import {
  resumeAudio,
  playSpawn,
  playCorrect,
  playWrong,
  playEnd,
  startBGM,
  stopBGM,
  setBgmEnergy,
  playShuffleStart,
  playCurtainClose,
  playCurtainOpen,
  playSwapTick,
  playShutter,
  playCountBeep,
  playCountGo,
} from "./sound.js";
import {
  addScore,
  renameEntry,
  bestScore,
  getLastName,
  setLastName,
} from "./leaderboard.js";

// ---- 설정 ----
const GAME_TIME = 40;      // 제한 시간(초)
// 응시(dwell) 유지 시간: 게임 후반으로 갈수록 짧아져 더 빠른 반응을 요구한다.
// 경과 시간(초) 구간별 목표 유지 시간(ms):
//   0~10초 : 0.35초 / 10~20초 : 0.27초 / 20~40초 : 0.20초
// 얼굴 인식·방향 판정·노이즈 필터링(faceControl.js의 SMOOTH)은 그대로 두고,
// 오직 '확정에 필요한 유지 시간'만 조절한다.
// 각 구간 값은 유지하되, 경계 부근 약 1초는 선형 보간으로 '자연스럽게' 전환한다.
const DWELL_CURVE = [
  [0, 350], [9.5, 350],     // 0~10초 : 0.35초
  [10.5, 270], [19.5, 270], // 10~20초: 0.27초
  [20.5, 200], [40, 200],   // 20~40초: 0.20초
];
function dwellMs(elapsed) {
  const pts = DWELL_CURVE;
  let ms = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (elapsed <= t1) {
      const r = Math.max(0, Math.min(1, (elapsed - t0) / (t1 - t0)));
      ms = v0 + (v1 - v0) * r; // 선형 보간
      break;
    }
  }
  return ms;
}

// 콤보 점수표: 정답 시 '증가 후 콤보 수'에 따라 획득 점수 결정
function comboPoints(c) {
  if (c >= 15) return 200;
  if (c >= 10) return 100;
  if (c >= 5) return 50;
  return c * 10; // 1~4 → 10,20,30,40
}
const RESULT_HOLD = 350;   // 정답/오답 결과 표시 유지 시간(ms)
// 난이도 곡선: 경과 시간(초) → 다음 문제 등장 전 '빈 화면 대기'(ms).
// 시간이 갈수록 짧아져 점진적으로 빨라진다. 사이 구간은 선형 보간으로 부드럽게.
const DIFFICULTY_CURVE = [
  [0, 1200], [6.5, 1200],   // 0~7초  : 약 1.2초
  [7, 800], [9.5, 800],     // 7~10초 : 약 0.8초
  [10, 400], [19.5, 400],   // 10~20초: 약 0.4초
  [20, 300], [29.5, 300],   // 20~30초: 약 0.3초
  [30, 250], [40, 250],     // 30~40초: 약 0.25초
];
const WAIT_JITTER = 60;    // 대기 시간 ±무작위 흔들림(ms) — 기계적이지 않게

// 특별 등장(Pop Event): 40초 동안 약 4회만, 게임 전체에 분산되게 발생
const POP_EVENTS = 4;         // 목표 발생 횟수
const POP_START = 6;          // 이 시각(초) 이전에는 발생 안 함(시작 직후 방지)
const POP_END = 37;           // 이 시각(초) 이후에는 발생 안 함(종료 직전 방지)
const POP_MIN_GAP = 5;        // 최소 문제 간격(연속 발생 방지)

// Shuffle Round(기억+순발력 특별 이벤트): 40초 동안 약 2회, 비연속, 자연 분산
const SHUFFLE_EVENTS = 2;
const SHUFFLE_START = 9;      // 시작 직후 방지
const SHUFFLE_END = 30;       // 라운드가 40초 안에 끝나도록 여유
const SHUFFLE_MIN_GAP = 4;    // 최소 문제 간격(연속/근접 방지)
const SHUFFLE_INTRO_MS = 2000;      // 첫 번째 Shuffle Round 안내 표시 시간(충분한 설명)
const SHUFFLE_INTRO_SHORT_MS = 1000; // 두 번째 이후 안내 표시 시간(빠른 진행)
const SHUFFLE_SHOW_MS = 800;  // 도형 노출(기억) 시간
const SHUFFLE_SWAP_MS = 2000; // 셔플(교환) 총 시간
const SHUFFLE_SWAPS = 10;     // 교환 횟수(↑) → 간격 200ms(약 20% 빠름)·난이도 소폭 상승

// Curtain Flicker Round(순간 집중력·순발력 특별 이벤트): 40초 동안 약 2회, 비연속, 자연 분산.
// 문제가 정상 배치된 뒤, 4개의 커튼이 '각각 독립적·랜덤'하게 빠르게 여닫히며
// 플레이어가 정답을 선택할 때까지 무한 반복된다(선택 순간 멈추고 모두 열림).
const FLICKER_EVENTS = 2;
const FLICKER_START = 8;       // 시작 직후 방지
const FLICKER_END = 34;        // 종료 직전 방지
const FLICKER_MIN_GAP = 4;     // 최소 문제 간격(연속/근접 방지)
const FLICKER_DURATION_MS = 1000; // 깜빡임 지속 시간(약 1초)
const FLICKER_MIN_MS = 150;    // 각 커튼 토글 최소 간격
const FLICKER_MAX_MS = 250;    // 각 커튼 토글 최대 간격(평균 0.15~0.25초)

// 게임 상태(State): waiting → (spawn) → playing → result → waiting …
const STATE = { WAITING: "waiting", PLAYING: "playing", RESULT: "result" };

// ---- 상태 ----
const face = new FaceController();
let stream = null;
let question = null;
let targetShape = null; // 게임 시작 시 1회 선택, 40초 동안 고정
let phase = STATE.WAITING;
let phaseTimer = null;  // 상태 전환용 setTimeout 핸들
let popTimes = [];      // 특별 등장 예정 시각(초) 목록
let popIdx = 0;         // 다음 Pop 이벤트 인덱스
let qSinceLastPop = 0;  // 마지막 Pop 이후 지난 문제 수
// Shuffle Round 상태
let shuffleTimes = [], shuffleIdx = 0, qSinceLastShuffle = 0;
let shuffleActive = false;      // 셔플 선택(입력) 단계인지
let cellBox = {}, boxCell = {}; // 셀↔박스(home 방향) 매핑
let homeCenter = {};            // 각 셀의 화면 중심 좌표
// Curtain Flicker Round 상태
let flickerTimes = [], flickerIdx = 0, qSinceLastFlicker = 0;
let flickerActive = false;      // 커튼이 깜빡이는 중인지
let flickerTimers = [];         // 커튼별 토글/종료 타이머 핸들(정리용)
let score = 0, hits = 0, attempts = 0, combo = 0, maxCombo = 0;
let currentEntryId = null; // 방금 저장한 리더보드 기록 id
let timeLeft = GAME_TIME;
let timerId = null;
let rafId = null;

let hoverDir = "center";
let hoverStart = 0;
let locked = false; // 선택 후 center로 돌아올 때까지 잠금

const randRange = (a, b) => a + Math.random() * (b - a);

// ---- DOM ----
const $ = (s) => document.querySelector(s);
const screens = {
  start:  $("#screen-start"),
  camera: $("#screen-camera"),
  howto:  $("#screen-howto"),
  headtest: $("#screen-headtest"),
  play:   $("#screen-play"),
  result: $("#screen-result"),
  play2:  $("#screen-play2"),
  result2: $("#screen-result2"),
};
const el = {
  camVideo: $("#cam-video"),
  playVideo: $("#play-video"),
  camStatus: $("#cam-status"),
  camError: $("#cam-error"),
  btnGrant: $("#btn-grant"),
  btnToHowto: $("#btn-to-howto"),
  timer: $("#timer"),
  score: $("#score"),
  combo: $("#combo"),
  comboPopup: $("#combo-popup"),
  hits: $("#hits"),
  targetShape: $("#target-shape"),
  targetLabel: $("#target-label"),
  dirIndicator: $("#dir-indicator"),
  feedback: $("#feedback"),
  shuffleBanner: $("#shuffle-banner"),
  shuffleIntro: $("#shuffle-intro"),
  countdown: $("#countdown"),
  countdownNum: $("#countdown-num"),
  finalScore: $("#final-score"),
  finalCombo: $("#final-combo"),
  finalAcc: $("#final-acc"),
  newHigh: $("#new-high"),
  nickname: $("#nickname"),
  lbBody: $("#lb-body"),
};

function show(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// ---- 모드 선택 & 화면 전환 버튼 ----
let selectedMode = 1; // 1 = 1인, 2 = 2인 대전
$("#btn-1p").addEventListener("click", () => { selectedMode = 1; show("camera"); });
$("#btn-2p").addEventListener("click", () => { selectedMode = 2; show("camera"); });
el.btnGrant.addEventListener("click", requestCamera);
el.btnToHowto.addEventListener("click", () => show("howto"));
$("#btn-start-game").addEventListener("click", startHeadTest);
$("#btn-replay").addEventListener("click", startGame);
$("#btn-home").addEventListener("click", () => show("start"));
$("#btn-replay2").addEventListener("click", battleStart);
$("#btn-home2").addEventListener("click", () => show("start"));

// 닉네임 입력 → 방금 저장한 기록 이름 실시간 갱신(빈 값이면 Player)
el.nickname.addEventListener("input", () => {
  if (!currentEntryId) return;
  setLastName(el.nickname.value.trim());
  const list = renameEntry(currentEntryId, el.nickname.value);
  renderLeaderboard(list, currentEntryId);
});

// ---- 카메라 권한 요청 + 모델 로드 ----
async function requestCamera() {
  el.camError.hidden = true;
  el.camStatus.textContent = "카메라 권한 요청 중…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    el.camVideo.srcObject = stream;
    el.camStatus.textContent = "얼굴 인식 모델을 불러오는 중…";
    el.btnGrant.hidden = true;

    await face.init(el.camVideo);
    el.camStatus.textContent = "준비 완료! 얼굴을 화면 중앙에 두세요.";
    el.btnToHowto.hidden = false;
  } catch (err) {
    console.error(err);
    el.btnGrant.hidden = false;
    el.camError.hidden = false;
    el.camError.textContent =
      "카메라를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요. (" +
      (err && err.name ? err.name : "오류") + ")";
    el.camStatus.textContent = "권한이 필요합니다.";
  }
}

/* ============================================================
   고개 테스트 (게임 시작 전 1회) — 위→오른쪽→아래→왼쪽 순서로
   각 방향을 약 0.4초 유지하면 인식 완료 → 자동 진행 → 게임 시작.
   게임과 동일한 얼굴 인식 기준(FaceController)을 사용한다.
   ============================================================ */
const HT_STEPS = ["up", "right", "down", "left"];
const HT_HOLD_MS = 400;   // 해당 방향 유지 인정 시간
const HT_LABELS = {
  up: "위를 바라보세요.",
  right: "오른쪽을 바라보세요.",
  down: "아래를 바라보세요.",
  left: "왼쪽을 바라보세요.",
};
const HT_ARROWS = { up: "▲", right: "▶", down: "▼", left: "◀" };

const ht = {
  video: $("#ht-video"),
  arrow: $("#ht-arrow"),
  guide: $("#ht-guide"),
  check: $("#ht-check"),
  ring: $("#ht-ring"),
  stage: $("#ht-stage"),
  progress: $("#ht-progress"),
  hint: $("#ht-hint"),
};

let htStep = 0;
let htHoldStart = 0;
let htRaf = null;
let htDone = false;   // 완료(전 단계 끝)됨
let htReady = false;  // 보정 완료 후 입력 허용

function startHeadTest() {
  if (!stream) { show("camera"); return; }
  resumeAudio(); // 사용자 클릭 시점에 오디오 활성화

  ht.video.srcObject = stream;
  // 검출은 '보이는' 비디오로 (숨겨진 비디오는 Chrome에서 프레임 정지 가능)
  face.setVideo(ht.video);
  ht.video.play().catch(() => {});

  htStep = 0;
  htHoldStart = 0;
  htDone = false;
  htReady = false;
  renderHeadTestStep();

  show("headtest");
  face.start();
  // 정면을 볼 시간을 준 뒤 보정 → 이후부터 방향 인식 시작
  setTimeout(() => { face.calibrate(); htReady = true; }, 800);

  cancelAnimationFrame(htRaf);
  htLoop();
}

// 현재 단계의 화살표/문구/진행 표시 갱신
function renderHeadTestStep() {
  const dir = HT_STEPS[htStep];
  ht.stage.classList.remove("done", "finished");
  ht.check.classList.remove("show");
  ht.arrow.textContent = HT_ARROWS[dir];
  ht.arrow.dataset.dir = dir;
  ht.guide.textContent = HT_LABELS[dir];
  ht.ring.style.background = "transparent";
  renderHeadTestProgress();
}

// 진행 표시: ● 완료/현재/대기 점 + "n / 4"
function renderHeadTestProgress() {
  const dots = HT_STEPS.map((_, i) => {
    const cls = i < htStep ? "done" : i === htStep ? "active" : "";
    return `<span class="ht-dot ${cls}"></span>`;
  }).join("");
  ht.progress.innerHTML = dots +
    `<span class="ht-count">${Math.min(htStep + 1, HT_STEPS.length)} / ${HT_STEPS.length}</span>`;
}

function htLoop() {
  if (htDone) return;

  const found = face.faceFound;
  const dir = found ? face.direction : "center";
  const target = HT_STEPS[htStep];

  // 얼굴이 화면 밖으로 나가면 진행되지 않음(안내 표시)
  ht.hint.hidden = found;

  if (htReady && found && dir === target) {
    if (!htHoldStart) htHoldStart = performance.now();
    const held = performance.now() - htHoldStart;
    const ratio = Math.min(1, held / HT_HOLD_MS);
    ht.ring.style.background =
      `conic-gradient(var(--lime) ${ratio * 360}deg, rgba(255,255,255,0.14) 0)`;
    if (held >= HT_HOLD_MS) { headTestStepDone(); return; }
  } else {
    htHoldStart = 0;
    ht.ring.style.background = "transparent";
  }

  htRaf = requestAnimationFrame(htLoop);
}

// 한 방향 인식 완료 → 체크 표시 후 다음 단계(또는 완료)로 자동 진행
function headTestStepDone() {
  cancelAnimationFrame(htRaf);
  htHoldStart = 0;
  ht.hint.hidden = true;
  ht.stage.classList.add("done");
  ht.check.classList.add("show");
  ht.guide.textContent = "✅ 인식 완료";
  ht.ring.style.background = "transparent";
  playCorrect();

  setTimeout(() => {
    htStep++;
    if (htStep >= HT_STEPS.length) {
      finishHeadTest();
    } else {
      renderHeadTestStep();
      htLoop();
    }
  }, 650);
}

// 모든 방향 완료 → 축하 표시 후 약 1초 뒤 게임 시작
function finishHeadTest() {
  htDone = true;
  cancelAnimationFrame(htRaf);
  ht.hint.hidden = true;
  ht.check.classList.remove("show");
  ht.progress.innerHTML = HT_STEPS.map(() => `<span class="ht-dot done"></span>`).join("") +
    `<span class="ht-count">${HT_STEPS.length} / ${HT_STEPS.length}</span>`;
  ht.stage.classList.remove("done");
  ht.stage.classList.add("finished");
  ht.arrow.dataset.dir = "done";
  ht.arrow.textContent = "🎉";
  ht.guide.innerHTML = "고개 테스트 완료!<br>잠시 후 게임을 시작합니다.";
  playCorrect();

  // 🎉 완료 메시지를 약 1초 보여준 뒤 → 3·2·1·GO! 카운트다운 → 게임 시작
  setTimeout(() => {
    startCountdown(() => {
      if (selectedMode === 2) battleStart(); else startGame();
    });
  }, 1000);
}

/* ============================================================
   게임 시작 카운트다운 (3 → 2 → 1 → GO!)
   숫자는 각 1초, GO!는 0.8초 표시. Pop + Fade In/Out 애니메이션.
   카운트다운 중에는 얼굴 입력을 받지 않으며(게임 미시작),
   GO!가 사라지는 순간 onDone()이 호출되어 첫 문제 생성 + 40초 타이머가 시작된다.
   ============================================================ */
const COUNTDOWN_SEQ = [
  { text: "3",   cls: "count", ms: 1000, sound: playCountBeep },
  { text: "2",   cls: "count", ms: 1000, sound: playCountBeep },
  { text: "1",   cls: "count", ms: 1000, sound: playCountBeep },
  { text: "GO!", cls: "go",    ms: 800,  sound: playCountGo },
];

function startCountdown(onDone) {
  el.countdown.hidden = false;
  let i = 0;
  const step = () => {
    if (i >= COUNTDOWN_SEQ.length) {
      el.countdown.hidden = true;
      el.countdownNum.className = "countdown-num";
      onDone();
      return;
    }
    const s = COUNTDOWN_SEQ[i];
    el.countdownNum.textContent = s.text;
    el.countdownNum.className = "countdown-num " + s.cls;
    void el.countdownNum.offsetWidth;         // 리플로우로 애니메이션 재시작
    el.countdownNum.classList.add("play");
    s.sound();
    i++;
    setTimeout(step, s.ms);
  };
  step();
}

// ---- 게임 시작 ----
function startGame() {
  if (!stream) { show("camera"); return; }

  resumeAudio(); // 사용자 클릭 시점에 오디오 활성화

  el.playVideo.srcObject = stream;
  // 검출은 '보이는' 플레이 비디오로 (숨겨진 카메라 화면 비디오는 Chrome에서 프레임 정지 가능)
  face.setVideo(el.playVideo);
  el.playVideo.play().catch(() => {});
  score = 0; hits = 0; attempts = 0; combo = 0; maxCombo = 0; timeLeft = GAME_TIME;
  el.score.textContent = "0";
  el.hits.textContent = "0";
  el.combo.textContent = "0";
  el.timer.textContent = String(GAME_TIME);
  locked = true; // 첫 프레임에 오작동 방지
  hoverDir = "center";

  // 목표 도형(모형)은 게임 시작 시 단 한 번만 랜덤 선택 → 40초 동안 고정
  targetShape = pickTargetShape();
  renderTarget();

  // 특별 등장(Pop Event) 시각 계획 → 게임 전체에 자연 분산
  popTimes = planPopEvents();
  popIdx = 0;
  qSinceLastPop = POP_MIN_GAP; // 첫 이벤트가 시각 조건만 맞으면 발생 가능

  // Shuffle Round 시각 계획
  shuffleTimes = planEvents(SHUFFLE_EVENTS, SHUFFLE_START, SHUFFLE_END);
  shuffleIdx = 0;
  qSinceLastShuffle = SHUFFLE_MIN_GAP;
  shuffleActive = false;
  resetShuffleVisuals();

  // Curtain Flicker Round 시각 계획
  flickerTimes = planEvents(FLICKER_EVENTS, FLICKER_START, FLICKER_END);
  flickerIdx = 0;
  qSinceLastFlicker = FLICKER_MIN_GAP;
  resetFlickerVisuals();

  show("play");
  face.start();
  // 화면 전환 후 잠시 뒤 정면 보정
  setTimeout(() => { face.calibrate(); }, 800);

  // 밝게 BGM 시작(loop)
  startBGM();
  setBgmEnergy(0);

  // Waiting 상태로 시작 → 잠시 후 첫 도형 등장(Spawn)
  clearTimeout(phaseTimer);
  scheduleSpawn();

  clearInterval(timerId);
  timerId = setInterval(() => {
    timeLeft--;
    el.timer.textContent = String(Math.max(0, timeLeft));
    // 진행될수록 BGM 레이어가 쌓여 점점 신나게(에너지 상승)
    setBgmEnergy(GAME_TIME - timeLeft);
    if (timeLeft <= 0) endGame();
  }, 1000);

  cancelAnimationFrame(rafId);
  gameLoop();
}

// ---- 목표 표시(게임당 1회) : 색은 무관하므로 중립색으로 렌더 ----
function renderTarget() {
  el.targetShape.innerHTML = shapeSVGHex(targetShape, "#1b1b2e");
  el.targetLabel.textContent = SHAPES[targetShape].name; // 도형 이름만
}

// ---- [Waiting] 4개 칸을 모두 빈 상태로 만들고, 잠시 후 Spawn 예약 ----
function scheduleSpawn() {
  phase = STATE.WAITING;
  resetFlickerVisuals(); // 남은 커튼/타이머 정리
  clearBoard();
  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(spawn, spawnDelay(GAME_TIME - timeLeft));
}

// 경과 시간에 따른 대기 시간(ms). 난이도 곡선을 선형 보간해 점진적으로 짧아진다.
function spawnDelay(elapsed) {
  const pts = DIFFICULTY_CURVE;
  let ms = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (elapsed <= t1) {
      const r = Math.max(0, Math.min(1, (elapsed - t0) / (t1 - t0)));
      ms = v0 + (v1 - v0) * r; // 선형 보간
      break;
    }
  }
  return ms + randRange(-WAIT_JITTER, WAIT_JITTER); // 약간의 흔들림
}

// 1인 보드의 해당 방향 옵션 요소
function optionEl(dir) {
  return document.querySelector(`#screen-play .option[data-dir="${dir}"]`);
}

// 4개 보기 도형을 보드에 렌더(공통)
function renderOptions(q) {
  for (const dir of DIRECTIONS) {
    const opt = q.options[dir];
    const node = optionEl(dir);
    node.classList.remove("hover", "correct", "wrong", "pop-in");
    node.innerHTML = shapeSVG(opt.shape, opt.color) + '<span class="ring"></span>';
  }
}

// ---- [Spawn → Playing] 도형 4개 등장, 입력 가능 상태로 ----
// 라운드 종류: 일반 / 특별 Pop(~4회) / Shuffle Round(~2회)
function spawn() {
  const elapsed = GAME_TIME - timeLeft;

  // Shuffle Round 판정(우선)
  qSinceLastShuffle++;
  const isShuffle =
    shuffleIdx < shuffleTimes.length &&
    elapsed >= shuffleTimes[shuffleIdx] &&
    elapsed <= SHUFFLE_END &&
    qSinceLastShuffle >= SHUFFLE_MIN_GAP;
  if (isShuffle) {
    shuffleIdx++;
    qSinceLastShuffle = 0;
    startShuffleRound();
    return;
  }

  question = generateRound(targetShape); // 목표는 고정, 위치·색만 랜덤

  // Curtain Flicker Round 판정(Pop보다 우선, 서로 겹치지 않게)
  qSinceLastFlicker++;
  const isFlicker =
    flickerIdx < flickerTimes.length &&
    elapsed >= flickerTimes[flickerIdx] &&
    elapsed <= FLICKER_END &&
    qSinceLastFlicker >= FLICKER_MIN_GAP;
  if (isFlicker) { flickerIdx++; qSinceLastFlicker = 0; }

  qSinceLastPop++;
  const isPop =
    !isFlicker &&
    popIdx < popTimes.length &&
    elapsed >= popTimes[popIdx] &&
    elapsed <= POP_END &&
    qSinceLastPop >= POP_MIN_GAP;
  if (isPop) { popIdx++; qSinceLastPop = 0; }

  renderOptions(question);

  if (isFlicker) {
    // 특별 Curtain Flicker 등장: 도형 배치 후 커튼이 빠르게 깜빡임
    startCurtainFlicker();
  } else if (isPop) {
    // 특별 Pop 등장: 스케일 애니메이션 + Pop/Tick 효과음
    for (const dir of DIRECTIONS) {
      const node = optionEl(dir);
      void node.offsetWidth;        // 리플로우로 애니메이션 재시작
      node.classList.add("pop-in");
    }
    playSpawn();
  }
  // 일반 등장은 애니메이션/효과음 없음(특별함을 유지)

  hoverDir = "center";
  locked = true;         // 등장 직후에는 중앙 복귀 후에만 선택 가능
  phase = STATE.PLAYING; // 입력 가능
}

// ---- 4개 칸을 빈 상태로(도형 제거) ----
function clearBoard() {
  for (const dir of DIRECTIONS) {
    const node = document.querySelector(`.option[data-dir="${dir}"]`);
    node.innerHTML = "";
    node.classList.remove("hover", "correct", "wrong", "pop-in");
  }
}

// ---- 특별 이벤트 시각 계획: [start, end]를 n등분해 각 구간 가운데 60%에서 1회 ----
// (자연 분산 + 구간 경계에 몰리지 않아 간격 확보). 오름차순 반환.
function planEvents(n, start, end) {
  const seg = (end - start) / n;
  const times = [];
  for (let i = 0; i < n; i++) {
    const a = start + i * seg;
    const lo = a + 0.2 * seg, hi = a + 0.8 * seg;
    times.push(lo + Math.random() * (hi - lo));
  }
  return times;
}
function planPopEvents() { return planEvents(POP_EVENTS, POP_START, POP_END); }

// ---- 게임 루프: 고개 방향 → 하이라이트 → dwell 선택 ----
function gameLoop() {
  const dir = face.faceFound ? face.direction : "center";

  // 중앙 방향 표시기
  el.dirIndicator.dataset.dir = dir;

  // 입력은 Playing 상태에서만 처리
  if (phase !== STATE.PLAYING) {
    rafId = requestAnimationFrame(gameLoop);
    return;
  }

  // Shuffle Round 선택 단계는 별도 처리(셀↔박스 매핑)
  if (shuffleActive) {
    handleShuffleInput(dir);
    rafId = requestAnimationFrame(gameLoop);
    return;
  }

  // 방향이 바뀌면 dwell 타이머 리셋
  if (dir !== hoverDir) {
    clearHover();
    hoverDir = dir;
    hoverStart = performance.now();
  }

  if (dir === "center") {
    locked = false; // 중앙 복귀 → 잠금 해제
  } else if (!locked && DIRECTIONS.includes(dir)) {
    const node = document.querySelector(`.option[data-dir="${dir}"]`);
    node.classList.add("hover");
    const need = dwellMs(GAME_TIME - timeLeft);
    const held = performance.now() - hoverStart;
    const ratio = Math.min(1, held / need);
    const ring = node.querySelector(".ring");
    if (ring) ring.style.width = ratio * 60 + "%";

    if (held >= need) {
      confirmSelection(dir);
    }
  }

  rafId = requestAnimationFrame(gameLoop);
}

function clearHover() {
  document.querySelectorAll(".option").forEach((n) => {
    n.classList.remove("hover");
    const ring = n.querySelector(".ring");
    if (ring) ring.style.width = "0%";
  });
}

// ---- [Result] 선택 확정 & 정답 판별 → 결과 표시 후 다음 문제 준비 ----
function confirmSelection(dir) {
  phase = STATE.RESULT; // 입력 잠금
  locked = true;
  if (flickerActive) endCurtainFlicker(); // 답하면 커튼을 모두 열어 결과 확인
  attempts++;
  const node = document.querySelector(`.option[data-dir="${dir}"]`);
  const correct = dir === question.correctDir;

  if (correct) {
    hits++;
    combo++;                          // 콤보 +1
    if (combo > maxCombo) maxCombo = combo;
    const gained = comboPoints(combo);
    score += gained;                  // 콤보에 따른 점수 합산
    node.classList.add("correct");
    feedback("정답! +" + gained, true);
    comboPopup("COMBO x" + combo, "pop");
    playCorrect();
  } else {
    combo = 0;                        // 오답 → 콤보 초기화
    node.classList.add("wrong");
    // 정답 위치도 표시
    document.querySelector(`.option[data-dir="${question.correctDir}"]`)
      .classList.add("correct");
    feedback("오답!", false);
    comboPopup("COMBO BREAK", "break");
    playWrong();
  }
  el.score.textContent = String(score);
  el.combo.textContent = String(combo);
  el.hits.textContent = String(hits);

  clearHover();
  // 결과를 잠시 유지한 뒤 → 빈 화면(Waiting) → 다음 도형(Spawn)
  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    if (timeLeft > 0) scheduleSpawn();
  }, RESULT_HOLD);
}

function feedback(text, good) {
  el.feedback.textContent = text;
  el.feedback.className = "feedback show " + (good ? "good" : "bad");
  setTimeout(() => { el.feedback.className = "feedback"; }, 700);
}

// Shuffle Round 시작 안내 오버레이 (1인·2인 공용, Fade In/Out)
function showShuffleIntro() { el.shuffleIntro.classList.add("show"); }
function hideShuffleIntro() { el.shuffleIntro.classList.remove("show"); }

// 셔플 배너에 문구를 표시(애니메이션 재시작). hideMs가 있으면 그 뒤 자동으로 숨김.
function flashBanner(bannerEl, text, hideMs) {
  bannerEl.textContent = text;
  bannerEl.classList.remove("show");
  void bannerEl.offsetWidth; // 리플로우로 애니메이션 재시작
  bannerEl.classList.add("show");
  if (hideMs) {
    setTimeout(() => {
      if (bannerEl.textContent === text) bannerEl.classList.remove("show");
    }, hideMs);
  }
}

// 콤보 팝업: "COMBO xN"(pop) 또는 "COMBO BREAK"(break, ~0.6초)
function comboPopup(text, type) {
  el.comboPopup.textContent = text;
  el.comboPopup.className = "combo-popup"; // 초기화
  void el.comboPopup.offsetWidth;          // 리플로우로 애니메이션 재시작
  el.comboPopup.classList.add(type);       // "pop" | "break"
}

// ---- 게임 종료 ----
function endGame() {
  clearInterval(timerId);
  clearTimeout(phaseTimer);
  cancelAnimationFrame(rafId);
  face.stop();
  phase = STATE.WAITING;
  shuffleActive = false;
  resetShuffleVisuals();
  resetFlickerVisuals();
  clearBoard();
  stopBGM();   // BGM 자연스럽게 Fade Out
  playEnd();   // Finish 효과음

  const acc = attempts ? Math.round((hits / attempts) * 100) : 0;
  el.finalScore.textContent = String(score);
  el.finalCombo.textContent = String(maxCombo);
  el.finalAcc.textContent = acc + "%";

  // 리더보드 저장(LocalStorage) — 새 기록 여부는 저장 전 최고점과 비교
  const prevBest = bestScore();
  const defaultName = getLastName() || "Player";
  const { entry, list } = addScore({ name: defaultName, score, combo: maxCombo, acc });
  currentEntryId = entry.id;
  renderLeaderboard(list, currentEntryId);

  // 닉네임 입력칸: 마지막 이름 채우기(없으면 비움 → placeholder "Player")
  el.nickname.value = getLastName();

  // NEW HIGH SCORE 연출
  el.newHigh.classList.remove("show");
  if (score > prevBest) {
    void el.newHigh.offsetWidth;
    el.newHigh.classList.add("show");
  }

  show("result");
}

// 리더보드 Top 10 렌더 (currentId = 이번 판 기록 강조)
function renderLeaderboard(list, currentId) {
  const top = list.slice(0, 10);
  if (!top.length) {
    el.lbBody.innerHTML = '<div class="lb-empty">아직 기록이 없어요</div>';
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  el.lbBody.innerHTML = top.map((e, i) => {
    const rankCls = i < 3 ? `rank-${i + 1}` : "";
    const me = e.id === currentId ? "me" : "";
    const rank = i < 3 ? medals[i] : String(i + 1);
    const d = new Date(e.ts);
    const date = `${d.getMonth() + 1}/${d.getDate()}`;
    return `<div class="lb-row ${rankCls} ${me}">` +
      `<span class="lb-rank">${rank}</span>` +
      `<span class="lb-name">${escapeHtml(e.name)}</span>` +
      `<span class="lb-score">${e.score}</span>` +
      `<span class="lb-combo">${e.combo}</span>` +
      `<span class="lb-date">${date}</span>` +
    `</div>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   Shuffle Round (기억 + 순발력 특별 이벤트, 1인 모드)
   배너 → 도형 노출(기억) → 커튼 닫힘 → 셔플(교환) → 선택 → 커튼 열림/판정
   ============================================================ */

// 1) 시작: 안내 오버레이 — 보드는 비운 채 규칙 안내 + 효과음
//    첫 번째 라운드는 충분한 설명(2초), 두 번째 이후는 빠른 진행(1초)
function startShuffleRound() {
  clearBoard();          // 도형은 안내 후에 등장
  resetShuffleMapping();
  phase = STATE.RESULT;  // 입력 차단
  hoverDir = "center";
  showShuffleIntro();
  playShuffleStart();

  // shuffleIdx는 startShuffleRound 호출 직전에 증가하므로 첫 라운드에서 1
  const introMs = shuffleIdx <= 1 ? SHUFFLE_INTRO_MS : SHUFFLE_INTRO_SHORT_MS;

  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    hideShuffleIntro();  // Fade Out
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(shuffleRevealShapes, 450); // 페이드아웃 후 도형 등장
  }, introMs);
}

// 2) 도형 등장(기억 0.8초) → 3) 커튼 닫힘 → 셔플
function shuffleRevealShapes() {
  question = generateRound(targetShape);
  renderOptions(question);
  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    closeCurtains();
    playCurtainClose();
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(shuffleRunSwaps, 350);
  }, SHUFFLE_SHOW_MS);
}

// 4) 셔플: 2초간 여러 번 위치 교환
function shuffleRunSwaps() {
  captureHomeCenters();
  for (const dir of DIRECTIONS) optionEl(dir).classList.add("shuffling");

  const interval = SHUFFLE_SWAP_MS / SHUFFLE_SWAPS;
  let i = 0;
  const step = () => {
    if (i >= SHUFFLE_SWAPS) {
      startShuffleInput();
      return;
    }
    swapTwoRandom();
    playSwapTick();
    i++;
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(step, interval);
  };
  step();
}

// 5) 셔플 종료 → 입력 허용(커튼은 닫힌 상태)
function startShuffleInput() {
  shuffleActive = true;
  hoverDir = "center";
  locked = true;         // 중앙 복귀 후 선택 가능
  flashBanner(el.shuffleBanner, "기억한 위치를 선택하세요!", 1400);
  phase = STATE.PLAYING; // 입력 허용
}

// 셔플 선택 처리(셀↔박스 매핑 기반)
function handleShuffleInput(dir) {
  if (dir !== hoverDir) {
    clearHover();
    hoverDir = dir;
    hoverStart = performance.now();
  }
  if (dir === "center") { locked = false; return; }
  if (locked || !DIRECTIONS.includes(dir)) return;

  const node = optionEl(cellBox[dir]); // 현재 그 셀에 있는 박스
  node.classList.add("hover");
  const need = dwellMs(GAME_TIME - timeLeft);
  const held = performance.now() - hoverStart;
  const ring = node.querySelector(".ring");
  if (ring) ring.style.width = Math.min(1, held / need) * 60 + "%";
  if (held >= need) confirmShuffle(dir);
}

// 6) 선택 확정 → 커튼 열림 + 판정(점수/콤보는 일반과 동일)
function confirmShuffle(dir) {
  phase = STATE.RESULT;
  shuffleActive = false;
  locked = true;
  attempts++;

  const selectedHome = cellBox[dir];                 // 선택한 셀에 있던 박스(원래 방향)
  const correct = selectedHome === question.correctDir;
  const selNode = optionEl(selectedHome);
  const correctNode = optionEl(question.correctDir);

  openCurtains();
  playCurtainOpen();

  if (correct) {
    hits++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    const gained = comboPoints(combo);
    score += gained;
    selNode.classList.add("correct");
    feedback("정답! +" + gained, true);
    comboPopup("COMBO x" + combo, "pop");
    playCorrect();
  } else {
    combo = 0;
    selNode.classList.add("wrong");
    correctNode.classList.add("correct"); // 정답 위치 표시
    feedback("오답!", false);
    comboPopup("COMBO BREAK", "break");
    playWrong();
  }
  el.score.textContent = String(score);
  el.combo.textContent = String(combo);
  el.hits.textContent = String(hits);

  clearHover();
  clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => {
    if (timeLeft > 0) { resetShuffleVisuals(); scheduleSpawn(); }
  }, RESULT_HOLD + 400);
}

// --- 셔플 헬퍼 ---
function resetShuffleMapping() {
  for (const dir of DIRECTIONS) { boxCell[dir] = dir; cellBox[dir] = dir; }
}
function captureHomeCenters() {
  for (const dir of DIRECTIONS) optionEl(dir).style.transform = ""; // 원위치에서 측정
  for (const dir of DIRECTIONS) {
    const r = optionEl(dir).getBoundingClientRect();
    homeCenter[dir] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}
function applyShuffleTransforms() {
  for (const dir of DIRECTIONS) { // dir = 박스의 home
    const cell = boxCell[dir];
    const dx = homeCenter[cell].x - homeCenter[dir].x;
    const dy = homeCenter[cell].y - homeCenter[dir].y;
    optionEl(dir).style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
function swapTwoRandom() {
  const c1 = DIRECTIONS[Math.floor(Math.random() * 4)];
  let c2;
  do { c2 = DIRECTIONS[Math.floor(Math.random() * 4)]; } while (c2 === c1);
  const b1 = cellBox[c1], b2 = cellBox[c2];
  cellBox[c1] = b2; cellBox[c2] = b1;
  boxCell[b1] = c2; boxCell[b2] = c1;
  applyShuffleTransforms();
}
function closeCurtains() {
  for (const dir of DIRECTIONS) {
    const node = optionEl(dir);
    if (node.querySelector(".curtain")) continue;
    const c = document.createElement("div");
    c.className = "curtain";
    node.appendChild(c);
  }
}
function openCurtains() {
  document.querySelectorAll("#screen-play .curtain").forEach((c) => c.classList.add("open"));
}
function resetShuffleVisuals() {
  for (const dir of DIRECTIONS) {
    const node = optionEl(dir);
    if (!node) continue;
    node.classList.remove("shuffling");
    node.style.transform = "";
    node.querySelectorAll(".curtain").forEach((c) => c.remove());
  }
  if (el.shuffleBanner) el.shuffleBanner.classList.remove("show");
  hideShuffleIntro();
}

/* ============================================================
   Curtain Flicker Round (순간 집중력·순발력 특별 이벤트, 1인 모드)
   도형이 정상 배치된 뒤, 4개의 커튼이 각각 독립적·랜덤하게 빠르게 여닫힌다.
   선택 전까지 무한 반복 → 순간순간 보이는 도형으로 정답 판단 → 선택 시 멈추고 모두 열림.
   ============================================================ */
function startCurtainFlicker() {
  resetFlickerVisuals();
  flickerActive = true;
  flashBanner(el.shuffleBanner, "👁 순간 집중! 커튼을 노려보세요", 1200);

  for (const dir of DIRECTIONS) {
    const node = optionEl(dir);
    const c = document.createElement("div");
    c.className = "curtain flicker"; // 닫힘(가림) 상태로 시작
    node.appendChild(c);
    scheduleCurtainToggle(c); // 각 커튼 독립 시작(랜덤 초기 위상)
  }
  playCurtainClose();
  // 자동 종료 없음 → 플레이어가 정답을 선택할 때까지 무한 반복(endCurtainFlicker는 선택 시 호출)
}

// 한 커튼을 랜덤 간격(0.15~0.25초)으로 계속 여닫는다(각자 독립).
// 플레이어가 선택할 때까지(flickerActive) 멈추지 않고 반복한다.
function scheduleCurtainToggle(curtain) {
  const tick = () => {
    if (!flickerActive) return;
    curtain.classList.toggle("up");
    if (curtain.classList.contains("up")) playShutter(); // 열리는 순간 셔터음
    flickerTimers.push(setTimeout(tick, randRange(FLICKER_MIN_MS, FLICKER_MAX_MS)));
  };
  // 초기 위상도 랜덤 → 4개가 동시에 움직이지 않도록
  flickerTimers.push(setTimeout(tick, randRange(0, FLICKER_MAX_MS)));
}

// 깜빡임 종료: 타이머 정리 + 모든 커튼을 열고(슬라이드 업) 제거 → 일반 플레이로
function endCurtainFlicker() {
  if (!flickerActive) return;
  flickerActive = false;
  flickerTimers.forEach(clearTimeout);
  flickerTimers = [];
  const curtains = document.querySelectorAll("#screen-play .curtain.flicker");
  curtains.forEach((c) => c.classList.add("up"));
  playCurtainOpen();
  setTimeout(() => curtains.forEach((c) => c.remove()), 150);
}

// 남은 커튼/타이머를 즉시 정리(라운드 전환·종료 시)
function resetFlickerVisuals() {
  flickerActive = false;
  flickerTimers.forEach(clearTimeout);
  flickerTimers = [];
  document.querySelectorAll("#screen-play .curtain.flicker").forEach((c) => c.remove());
}

/* ============================================================
   2인 대전 모드 (Battle Mode)
   - 공통 로직 재사용: comboPoints / spawnDelay / planPopEvents /
     generateRound / shapeSVG / 사운드 / FaceController(2얼굴)
   - 목표 도형·보기는 두 플레이어 공유(동일), 답은 각자 독립
   - 같은 문제를 '더 빨리' 맞춘 사람이 콤보를 얻음
   ============================================================ */
const BATTLE_ANSWER_MS = 3500; // 한 문제당 최대 응답 시간(둘 다 답하면 즉시 넘어감)

// 2인 플레이 화면 DOM 캐시
const p2dom = {
  timer: $("#timer2"),
  targetShape: $("#target-shape2"),
  targetLabel: $("#target-label2"),
  video: $("#play-video2"),
  rP1: $("#r-p1-score"),
  rP2: $("#r-p2-score"),
  winner: $("#winner-text"),
  shuffleBanner: $("#shuffle-banner2"),
};
// 각 플레이어 보드 DOM (0=P1 왼쪽, 1=P2 오른쪽)
const boards2 = ["board-p1", "board-p2"].map((id, i) => {
  const root = document.getElementById(id);
  const options = {};
  DIRECTIONS.forEach((d) => { options[d] = root.querySelector(`.option[data-dir="${d}"]`); });
  return {
    root,
    options,
    indicator: root.querySelector(".dir-indicator"),
    feedback: document.getElementById(i === 0 ? "feedback-p1" : "feedback-p2"),
    popup: document.getElementById(i === 0 ? "combo-popup-p1" : "combo-popup-p2"),
    scoreEl: document.getElementById(i === 0 ? "p1-score" : "p2-score"),
    comboEl: document.getElementById(i === 0 ? "p1-combo" : "p2-combo"),
  };
});

function newPlayer() {
  return { score: 0, combo: 0, answered: false, hoverDir: "center", hoverStart: 0, locked: true };
}

const battle = {
  targetShape: null,
  question: null,
  phase: STATE.WAITING,
  timeLeft: GAME_TIME,
  timerId: null,
  phaseTimer: null,
  raf: null,
  answerDeadline: 0,
  firstCorrectDone: false,
  popTimes: [], popIdx: 0, qSinceLastPop: 0,
  // Shuffle Round(공유): 두 보드에 동일 시퀀스 적용, 선택/판정은 각자 독립
  shuffleTimes: [], shuffleIdx: 0, qSinceLastShuffle: 0, shuffleActive: false,
  cellBox: {}, boxCell: {}, homeCenters: [{}, {}],
  // Curtain Flicker Round(공유): 두 보드 각각 4개 커튼이 독립적으로 깜빡임
  flickerTimes: [], flickerIdx: 0, qSinceLastFlicker: 0, flickerActive: false, flickerTimers: [],
  players: [newPlayer(), newPlayer()],
};

function battleStart() {
  if (!stream) { show("camera"); return; }
  resumeAudio();

  p2dom.video.srcObject = stream;
  face.setVideo(p2dom.video); // 검출을 보이는 2인 화면 비디오로
  p2dom.video.play().catch(() => {});
  battle.targetShape = pickTargetShape();
  renderTarget2();
  battle.players = [newPlayer(), newPlayer()];
  battle.timeLeft = GAME_TIME;
  battle.phase = STATE.WAITING;
  battle.firstCorrectDone = false;
  battle.popTimes = planPopEvents();
  battle.popIdx = 0;
  battle.qSinceLastPop = POP_MIN_GAP;
  battle.shuffleTimes = planEvents(SHUFFLE_EVENTS, SHUFFLE_START, SHUFFLE_END);
  battle.shuffleIdx = 0;
  battle.qSinceLastShuffle = SHUFFLE_MIN_GAP;
  battle.shuffleActive = false;
  battleResetShuffleVisuals();
  battle.flickerTimes = planEvents(FLICKER_EVENTS, FLICKER_START, FLICKER_END);
  battle.flickerIdx = 0;
  battle.qSinceLastFlicker = FLICKER_MIN_GAP;
  battleResetFlickerVisuals();
  updateBattleHud(0); updateBattleHud(1);
  p2dom.timer.textContent = String(GAME_TIME);

  show("play2");
  face.start();
  // 두 명이 정면을 볼 시간을 조금 더 준 뒤 보정
  setTimeout(() => { face.calibrate(); }, 1200);

  startBGM();
  setBgmEnergy(0);

  clearTimeout(battle.phaseTimer);
  battleScheduleSpawn();

  clearInterval(battle.timerId);
  battle.timerId = setInterval(() => {
    battle.timeLeft--;
    p2dom.timer.textContent = String(Math.max(0, battle.timeLeft));
    setBgmEnergy(GAME_TIME - battle.timeLeft);
    if (battle.timeLeft <= 0) battleEnd();
  }, 1000);

  cancelAnimationFrame(battle.raf);
  battleLoop();
}

function renderTarget2() {
  p2dom.targetShape.innerHTML = shapeSVGHex(battle.targetShape, "#1b1b2e");
  p2dom.targetLabel.textContent = SHAPES[battle.targetShape].name;
}

function updateBattleHud(i) {
  boards2[i].scoreEl.textContent = String(battle.players[i].score);
  boards2[i].comboEl.textContent = String(battle.players[i].combo);
}

// [Waiting] 두 보드를 비우고 잠시 후 공유 문제 등장 예약
function battleScheduleSpawn() {
  battle.phase = STATE.WAITING;
  battleResetShuffleVisuals();
  battleResetFlickerVisuals();
  battleClearBoards();
  clearTimeout(battle.phaseTimer);
  battle.phaseTimer = setTimeout(battleSpawn, spawnDelay(GAME_TIME - battle.timeLeft));
}

// [Spawn → Playing] 공유 문제를 두 보드에 동일하게 렌더
function battleSpawn() {
  const elapsed = GAME_TIME - battle.timeLeft;

  // Shuffle Round 판정(우선) — 두 보드 공유
  battle.qSinceLastShuffle++;
  const isShuffle =
    battle.shuffleIdx < battle.shuffleTimes.length &&
    elapsed >= battle.shuffleTimes[battle.shuffleIdx] &&
    elapsed <= SHUFFLE_END &&
    battle.qSinceLastShuffle >= SHUFFLE_MIN_GAP;
  if (isShuffle) {
    battle.shuffleIdx++;
    battle.qSinceLastShuffle = 0;
    battleStartShuffle();
    return;
  }

  battle.question = generateRound(battle.targetShape); // 목표 고정, 위치·색만 랜덤

  // Curtain Flicker Round 판정(Pop보다 우선, 서로 겹치지 않게) — 두 보드 공유
  battle.qSinceLastFlicker++;
  const isFlicker =
    battle.flickerIdx < battle.flickerTimes.length &&
    elapsed >= battle.flickerTimes[battle.flickerIdx] &&
    elapsed <= FLICKER_END &&
    battle.qSinceLastFlicker >= FLICKER_MIN_GAP;
  if (isFlicker) { battle.flickerIdx++; battle.qSinceLastFlicker = 0; }

  battle.qSinceLastPop++;
  const isPop =
    !isFlicker &&
    battle.popIdx < battle.popTimes.length &&
    elapsed >= battle.popTimes[battle.popIdx] &&
    elapsed <= POP_END &&
    battle.qSinceLastPop >= POP_MIN_GAP;
  if (isPop) { battle.popIdx++; battle.qSinceLastPop = 0; }

  for (let i = 0; i < 2; i++) {
    const b = boards2[i];
    for (const dir of DIRECTIONS) {
      const opt = battle.question.options[dir];
      const node = b.options[dir];
      node.classList.remove("hover", "correct", "wrong", "pop-in");
      node.innerHTML = shapeSVG(opt.shape, opt.color) + '<span class="ring"></span>';
    }
    if (isPop) {
      for (const dir of DIRECTIONS) {
        const node = b.options[dir];
        void node.offsetWidth;
        node.classList.add("pop-in");
      }
    }
  }
  if (isPop) playSpawn();

  // 문제별 플레이어 응답 상태 초기화
  battle.firstCorrectDone = false;
  for (const p of battle.players) { p.answered = false; p.hoverDir = "center"; p.locked = true; }
  battle.answerDeadline = performance.now() + BATTLE_ANSWER_MS + (isFlicker ? FLICKER_DURATION_MS : 0);
  battle.phase = STATE.PLAYING;

  // 커튼 깜빡임 시작(도형 배치 후) — 두 보드 각각 4개 커튼이 독립적으로
  if (isFlicker) battleStartCurtainFlicker();
}

function battleClearBoards() {
  for (const b of boards2) {
    for (const dir of DIRECTIONS) {
      b.options[dir].innerHTML = "";
      b.options[dir].classList.remove("hover", "correct", "wrong", "pop-in");
    }
  }
}

// 게임 루프: 두 플레이어의 고개 방향을 각자 처리
function battleLoop() {
  for (let i = 0; i < 2; i++) {
    const p = battle.players[i];
    const b = boards2[i];
    const pf = face.getPlayer(i);
    const dir = pf.found ? pf.direction : "center";
    b.indicator.dataset.dir = dir;

    if (battle.phase !== STATE.PLAYING || p.answered) continue;

    // Shuffle Round 선택 단계는 셀↔박스 매핑으로 처리
    if (battle.shuffleActive) { battleHandleShuffleInput(i, dir); continue; }

    if (dir !== p.hoverDir) {
      clearHoverBoard(b);
      p.hoverDir = dir;
      p.hoverStart = performance.now();
    }
    if (dir === "center") {
      p.locked = false;
    } else if (!p.locked && DIRECTIONS.includes(dir)) {
      const node = b.options[dir];
      node.classList.add("hover");
      const need = dwellMs(GAME_TIME - battle.timeLeft);
      const held = performance.now() - p.hoverStart;
      const ring = node.querySelector(".ring");
      if (ring) ring.style.width = Math.min(1, held / need) * 60 + "%";
      if (held >= need) battleConfirm(i, dir);
    }
  }

  // 문제 제한 시간 초과 → 마무리
  if (battle.phase === STATE.PLAYING && performance.now() > battle.answerDeadline) {
    battleEndQuestion();
  }

  battle.raf = requestAnimationFrame(battleLoop);
}

function clearHoverBoard(b) {
  for (const dir of DIRECTIONS) {
    const node = b.options[dir];
    node.classList.remove("hover");
    const ring = node.querySelector(".ring");
    if (ring) ring.style.width = "0%";
  }
}

// 플레이어 i의 선택 확정 & 판정 (상대에게 영향 없음)
function battleConfirm(i, dir) {
  const p = battle.players[i];
  const b = boards2[i];
  p.answered = true;
  p.locked = true;

  // 셔플 라운드면 선택 방향(셀)에 '현재 있는 박스'로 판정, 해당 보드 커튼 열기
  const selectedDir = battle.shuffleActive ? battle.cellBox[dir] : dir;
  const node = b.options[selectedDir];
  const correct = selectedDir === battle.question.correctDir;
  if (battle.shuffleActive) { battleOpenCurtains(i); playCurtainOpen(); }
  // 커튼 깜빡임 중 답하면 해당 보드 커튼을 열어 결과 확인(상대 보드는 유지)
  if (battle.flickerActive) battleRevealBoardFlicker(i);

  if (correct) {
    if (!battle.firstCorrectDone) {
      // 더 빨리 맞춘 사람 → 콤보 획득
      battle.firstCorrectDone = true;
      p.combo++;
      const gained = comboPoints(p.combo);
      p.score += gained;
      node.classList.add("correct");
      battleFeedback(i, "정답! +" + gained, true);
      battleCombo(i, "COMBO x" + p.combo, "pop");
    } else {
      // 늦은 정답: 소량 점수, 콤보는 유지(초기화 아님)
      p.score += 10;
      node.classList.add("correct");
      battleFeedback(i, "정답! +10", true);
    }
    playCorrect();
  } else {
    p.combo = 0; // 자신의 오답 → 콤보 초기화
    node.classList.add("wrong");
    b.options[battle.question.correctDir].classList.add("correct");
    battleFeedback(i, "오답!", false);
    battleCombo(i, "COMBO BREAK", "break");
    playWrong();
  }
  updateBattleHud(i);
  clearHoverBoard(b);

  // 둘 다 답했으면 즉시 다음 문제 준비
  if (battle.players[0].answered && battle.players[1].answered) battleEndQuestion();
}

// [Result] 문제 종료 → 미응답자 콤보 리셋 → 잠시 후 다음 문제
function battleEndQuestion() {
  if (battle.phase !== STATE.PLAYING) return;
  battle.phase = STATE.RESULT;
  clearTimeout(battle.phaseTimer);

  // 셔플 라운드: 미응답 보드는 커튼 열어 정답 위치 공개
  if (battle.shuffleActive) {
    for (let i = 0; i < 2; i++) {
      if (!battle.players[i].answered) {
        battleOpenCurtains(i);
        boards2[i].options[battle.question.correctDir].classList.add("correct");
      }
    }
    battle.shuffleActive = false;
  }

  // 커튼 깜빡임이 아직 진행 중이면 정리(양쪽 모두 열림)
  if (battle.flickerActive) battleResetFlickerVisuals();

  for (let i = 0; i < 2; i++) {
    const p = battle.players[i];
    if (!p.answered) { // 제한 시간 내 미선택 → 콤보 초기화
      p.combo = 0;
      battleCombo(i, "COMBO BREAK", "break");
      updateBattleHud(i);
    }
  }
  battle.phaseTimer = setTimeout(() => {
    if (battle.timeLeft > 0) battleScheduleSpawn();
  }, RESULT_HOLD);
}

function battleFeedback(i, text, good) {
  const f = boards2[i].feedback;
  f.textContent = text;
  f.className = "feedback show " + (good ? "good" : "bad");
  setTimeout(() => { f.className = "feedback"; }, 700);
}

function battleCombo(i, text, type) {
  const pop = boards2[i].popup;
  pop.textContent = text;
  pop.className = "combo-popup " + (i === 0 ? "p1" : "p2");
  void pop.offsetWidth;
  pop.classList.add(type);
}

function battleEnd() {
  clearInterval(battle.timerId);
  clearTimeout(battle.phaseTimer);
  cancelAnimationFrame(battle.raf);
  face.stop();
  battle.phase = STATE.WAITING;
  battle.shuffleActive = false;
  battleResetShuffleVisuals();
  battleResetFlickerVisuals();
  battleClearBoards();
  stopBGM();
  playEnd();

  const s1 = battle.players[0].score, s2 = battle.players[1].score;
  p2dom.rP1.textContent = String(s1);
  p2dom.rP2.textContent = String(s2);
  p2dom.winner.textContent =
    s1 > s2 ? "🏆 Player 1 승리!" :
    s2 > s1 ? "🏆 Player 2 승리!" : "🤝 무승부!";
  show("result2");
}

/* ---- 2인 Shuffle Round (두 보드 공유 시퀀스, 선택/판정은 각자 독립) ---- */

// 1) 시작: 안내 오버레이 — 보드는 비운 채 규칙 안내 + 효과음
//    첫 번째 라운드는 충분한 설명(2초), 두 번째 이후는 빠른 진행(1초)
function battleStartShuffle() {
  battleClearBoards();
  battleResetShuffleMapping();
  battle.firstCorrectDone = false;
  for (const p of battle.players) { p.answered = false; p.hoverDir = "center"; p.locked = true; }

  battle.phase = STATE.RESULT; // 입력 차단
  showShuffleIntro();
  playShuffleStart();

  // battle.shuffleIdx는 battleStartShuffle 호출 직전에 증가하므로 첫 라운드에서 1
  const introMs = battle.shuffleIdx <= 1 ? SHUFFLE_INTRO_MS : SHUFFLE_INTRO_SHORT_MS;

  clearTimeout(battle.phaseTimer);
  battle.phaseTimer = setTimeout(() => {
    hideShuffleIntro();
    clearTimeout(battle.phaseTimer);
    battle.phaseTimer = setTimeout(battleShuffleRevealShapes, 450);
  }, introMs);
}

// 2) 도형 등장(기억 0.8초, 두 보드 동일) → 3) 커튼 닫힘 → 셔플
function battleShuffleRevealShapes() {
  battle.question = generateRound(battle.targetShape);
  for (let i = 0; i < 2; i++) {
    const b = boards2[i];
    for (const dir of DIRECTIONS) {
      const node = b.options[dir];
      node.classList.remove("hover", "correct", "wrong", "pop-in");
      node.style.transform = "";
      node.innerHTML = shapeSVG(battle.question.options[dir].shape, battle.question.options[dir].color) +
        '<span class="ring"></span>';
    }
  }
  clearTimeout(battle.phaseTimer);
  battle.phaseTimer = setTimeout(() => {
    battleCloseCurtains();
    playCurtainClose();
    clearTimeout(battle.phaseTimer);
    battle.phaseTimer = setTimeout(battleShuffleSwaps, 350);
  }, SHUFFLE_SHOW_MS);
}

// 4) 셔플: 2초간 여러 번 위치 교환(두 보드 동일)
function battleShuffleSwaps() {
  battleCaptureHomeCenters();
  for (let i = 0; i < 2; i++) for (const dir of DIRECTIONS) boards2[i].options[dir].classList.add("shuffling");

  const interval = SHUFFLE_SWAP_MS / SHUFFLE_SWAPS;
  let k = 0;
  const step = () => {
    if (k >= SHUFFLE_SWAPS) { battleStartShuffleInput(); return; }
    battleSwap();
    playSwapTick();
    k++;
    clearTimeout(battle.phaseTimer);
    battle.phaseTimer = setTimeout(step, interval);
  };
  step();
}

// 5) 셔플 종료 → 입력 허용(커튼 닫힌 상태)
function battleStartShuffleInput() {
  battle.shuffleActive = true;
  for (const p of battle.players) { p.answered = false; p.hoverDir = "center"; p.locked = true; }
  battle.answerDeadline = performance.now() + BATTLE_ANSWER_MS + 1500; // 셔플은 여유
  flashBanner(p2dom.shuffleBanner, "기억한 위치를 선택하세요!", 1400);
  battle.phase = STATE.PLAYING;
}

// 셔플 선택 처리(플레이어 i, 셀↔박스 매핑)
function battleHandleShuffleInput(i, dir) {
  const p = battle.players[i];
  const b = boards2[i];
  if (dir !== p.hoverDir) { clearHoverBoard(b); p.hoverDir = dir; p.hoverStart = performance.now(); }
  if (dir === "center") { p.locked = false; return; }
  if (p.locked || !DIRECTIONS.includes(dir)) return;

  const node = b.options[battle.cellBox[dir]]; // 현재 그 셀에 있는 박스
  node.classList.add("hover");
  const need = dwellMs(GAME_TIME - battle.timeLeft);
  const held = performance.now() - p.hoverStart;
  const ring = node.querySelector(".ring");
  if (ring) ring.style.width = Math.min(1, held / need) * 60 + "%";
  if (held >= need) battleConfirm(i, dir);
}

// --- 2인 셔플 헬퍼(두 보드 동일 매핑 적용) ---
function battleResetShuffleMapping() {
  for (const dir of DIRECTIONS) { battle.boxCell[dir] = dir; battle.cellBox[dir] = dir; }
}
function battleCaptureHomeCenters() {
  for (let i = 0; i < 2; i++) for (const dir of DIRECTIONS) boards2[i].options[dir].style.transform = "";
  for (let i = 0; i < 2; i++) {
    battle.homeCenters[i] = {};
    for (const dir of DIRECTIONS) {
      const r = boards2[i].options[dir].getBoundingClientRect();
      battle.homeCenters[i][dir] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
}
function battleApplyTransforms() {
  for (let i = 0; i < 2; i++) {
    const hc = battle.homeCenters[i];
    for (const dir of DIRECTIONS) { // dir = 박스의 home
      const cell = battle.boxCell[dir];
      const dx = hc[cell].x - hc[dir].x, dy = hc[cell].y - hc[dir].y;
      boards2[i].options[dir].style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }
}
function battleSwap() {
  const c1 = DIRECTIONS[Math.floor(Math.random() * 4)];
  let c2;
  do { c2 = DIRECTIONS[Math.floor(Math.random() * 4)]; } while (c2 === c1);
  const b1 = battle.cellBox[c1], b2 = battle.cellBox[c2];
  battle.cellBox[c1] = b2; battle.cellBox[c2] = b1;
  battle.boxCell[b1] = c2; battle.boxCell[b2] = c1;
  battleApplyTransforms();
}
function battleCloseCurtains() {
  for (let i = 0; i < 2; i++) for (const dir of DIRECTIONS) {
    const node = boards2[i].options[dir];
    if (node.querySelector(".curtain")) continue;
    const c = document.createElement("div");
    c.className = "curtain";
    node.appendChild(c);
  }
}
function battleOpenCurtains(i) {
  for (const dir of DIRECTIONS) {
    boards2[i].options[dir].querySelectorAll(".curtain").forEach((c) => c.classList.add("open"));
  }
}
function battleResetShuffleVisuals() {
  for (let i = 0; i < 2; i++) for (const dir of DIRECTIONS) {
    const node = boards2[i].options[dir];
    node.classList.remove("shuffling");
    node.style.transform = "";
    node.querySelectorAll(".curtain").forEach((c) => c.remove());
  }
  if (p2dom.shuffleBanner) p2dom.shuffleBanner.classList.remove("show");
  hideShuffleIntro();
}

/* ---- 2인 Curtain Flicker Round (두 보드 각각 4개 커튼이 독립적으로 깜빡임) ---- */

// 도형 배치 후 호출: 두 보드 8개 커튼을 각자 랜덤 타이밍으로 여닫는다.
function battleStartCurtainFlicker() {
  battleResetFlickerVisuals();
  battle.flickerActive = true;
  flashBanner(p2dom.shuffleBanner, "👁 순간 집중! 커튼을 노려보세요", 1200);

  for (let i = 0; i < 2; i++) {
    for (const dir of DIRECTIONS) {
      const node = boards2[i].options[dir];
      const c = document.createElement("div");
      c.className = "curtain flicker"; // 닫힘(가림) 상태로 시작
      node.appendChild(c);
      battleScheduleCurtainToggle(i, c);
    }
  }
  playCurtainClose();
  // 자동 종료 없음 → 각 보드는 자신이 답할 때까지 무한 반복(둘 다 답하면 battleEndQuestion에서 정리)
}

// 보드 i의 한 커튼을 랜덤 간격으로 여닫는다. 그 보드가 답할 때까지(answered) 멈추지 않고 반복.
function battleScheduleCurtainToggle(i, curtain) {
  const tick = () => {
    if (!battle.flickerActive || battle.players[i].answered) return;
    curtain.classList.toggle("up");
    if (curtain.classList.contains("up")) playShutter();
    battle.flickerTimers.push(setTimeout(tick, randRange(FLICKER_MIN_MS, FLICKER_MAX_MS)));
  };
  battle.flickerTimers.push(setTimeout(tick, randRange(0, FLICKER_MAX_MS)));
}

// 보드 i의 커튼만 열어 결과 확인(상대 보드는 계속 깜빡임 유지)
function battleRevealBoardFlicker(i) {
  const curtains = boards2[i].root.querySelectorAll(".curtain.flicker");
  curtains.forEach((c) => c.classList.add("up"));
  playCurtainOpen();
  setTimeout(() => curtains.forEach((c) => c.remove()), 150);
}

// 남은 커튼/타이머 즉시 정리(라운드 전환·종료 시)
function battleResetFlickerVisuals() {
  battle.flickerActive = false;
  battle.flickerTimers.forEach(clearTimeout);
  battle.flickerTimers = [];
  document.querySelectorAll("#screen-play2 .curtain.flicker").forEach((c) => c.remove());
}

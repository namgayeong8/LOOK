// 사운드 모듈 — Web Audio API로 합성(음원 파일 불필요)
//  · SE(효과음): spawn(Pop) / correct(Ding) / wrong(Buzz) / end(Finish)
//  · BGM: 밝고 신나는 아케이드 그루브. 진행될수록 '레이어'가 쌓여 에너지가 커진다.
//         (긴장감보다 흥·리듬감 중심 / 종료 시 Fade Out)
//  · SE 볼륨과 BGM 볼륨은 각각 독립된 GainNode로 관리한다.
//
//  에너지 단계 (setBgmEnergy(경과초)로 제어, 레이어는 1.2초에 걸쳐 부드럽게 페이드인)
//   0~10초 : core(밝은 통통 리드 + 킥)            — 가볍고 경쾌
//   10~25초: + bass + drum(백비트 스네어/오프비트 하이햇) — 에너지 상승
//   25~35초: + perc(16분 하이햇/클랩)              — 흥분감
//   35~40초: + climax(옥타브 리드/오픈햇/코드 스탭) + 템포 살짝 ↑ — 클라이맥스

let ctx = null;
let seGain = null;   // 효과음 전용 볼륨
let bgmGain = null;  // 배경음악 전용 볼륨(마스터)
let limiter = null;  // 마스터 리미터(피크가 튀어도 Clipping/왜곡 방지)
const layer = {};    // core/bass/drum/perc/climax 레이어별 GainNode

const SE_VOLUME = 2.16;   // 효과음 볼륨(기존 1.08의 2배 — 체감 2배)
const BGM_VOLUME = 0.336; // 배경음악 볼륨(기존 0.168의 2배 — 체감 2배)
const LAYER_KEYS = ["core", "bass", "drum", "perc", "climax"];

// Ducking: 효과음이 재생되는 동안 BGM을 살짝 눌러(줄여) 효과음이 묻히지 않게 한다.
const DUCK_LEVEL = BGM_VOLUME * 0.55; // 효과음 재생 순간의 BGM 목표 볼륨
const DUCK_DOWN = 0.04;   // 눌리는 시간(빠르게)
const DUCK_UP = 0.34;     // 원래대로 복귀하는 시간(부드럽게 Fade)
let bgmFadingOut = false; // 종료 Fade Out 중에는 Ducking 복귀가 페이드를 방해하지 않도록

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    // 마스터 리미터: 볼륨을 키운 뒤에도 피크가 0dBFS를 넘겨 찢어지지 않게 눌러준다.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5; // -1.5dBFS 부근에서 리미팅 시작
    limiter.knee.value = 0;         // 하드 니(리미터처럼 동작)
    limiter.ratio.value = 20;       // 강한 압축비
    limiter.attack.value = 0.003;   // 빠른 어택으로 순간 피크 포착
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    seGain = ctx.createGain();
    seGain.gain.value = SE_VOLUME;
    seGain.connect(limiter);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = BGM_VOLUME;
    bgmGain.connect(limiter);
    for (const k of LAYER_KEYS) {
      const g = ctx.createGain();
      g.gain.value = k === "core" ? 1 : 0; // core만 처음부터 on
      g.connect(bgmGain);
      layer[k] = g;
    }
  }
  return ctx;
}

// 사용자 제스처(버튼 클릭) 시 호출해 오디오 컨텍스트를 깨운다(브라우저 정책).
export function resumeAudio() {
  const c = ac();
  if (c.state === "suspended") c.resume();
}

// 효과음이 seGain으로 나갈 때 BGM을 잠깐 눌렀다가 부드럽게 되돌린다(Ducking).
function duckBgm() {
  if (!bgmPlaying || bgmFadingOut) return;
  const c = ac();
  const now = c.currentTime;
  bgmGain.gain.cancelScheduledValues(now);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, now);            // 현재값에서 시작(급변 방지)
  bgmGain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_DOWN); // 살짝 줄이고
  bgmGain.gain.linearRampToValueAtTime(BGM_VOLUME, now + DUCK_UP);   // 원래대로 Fade
}

// 톤 재생 헬퍼(대상 gain 노드로 라우팅)
function tone(dest, freq, when, dur, type = "sine", peak = 0.2) {
  const c = ac();
  if (dest === seGain) duckBgm();
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// ---------------- 효과음(SE) ----------------
export function playSpawn() {           // 도형 등장: 짧은 Pop/Tick
  tone(seGain, 880, 0, 0.07, "triangle", 0.22);
  tone(seGain, 1320, 0.02, 0.05, "sine", 0.12);
}
export function playCorrect() {          // 정답: 밝은 Ding
  tone(seGain, 1200, 0, 0.12, "sine", 0.22);
  tone(seGain, 1600, 0.09, 0.18, "sine", 0.2);
}
export function playWrong() {            // 오답: 짧은 Buzz
  tone(seGain, 150, 0, 0.22, "square", 0.18);
  tone(seGain, 110, 0.0, 0.22, "sawtooth", 0.12);
}
export function playEnd() {              // 게임 종료: Finish
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => tone(seGain, f, i * 0.11, 0.22, "triangle", 0.2));
}
export function playCountBeep() {        // 카운트다운 3·2·1: 짧고 단단한 비프
  tone(seGain, 680, 0, 0.13, "square", 0.16);
  tone(seGain, 900, 0, 0.09, "sine", 0.1);
}
export function playCountGo() {          // GO!: 상승하는 시작 팡파르
  [523.25, 783.99, 1046.5].forEach((f, i) => tone(seGain, f, i * 0.06, 0.22, "triangle", 0.24));
  tone(seGain, 1318.51, 0.18, 0.28, "sine", 0.18);
}

// ---- Shuffle Round 전용 효과음 ----
// 노이즈를 밴드패스 필터로 쓸어내려 '스와이프' 사운드를 만든다.
function sweep(when, dur, fromF, toF, peak) {
  const c = ac();
  duckBgm(); // sweep은 항상 효과음(seGain)이므로 Ducking
  const t0 = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noise();
  const f = c.createBiquadFilter();
  f.type = "bandpass"; f.Q.value = 1.2;
  f.frequency.setValueAtTime(fromF, t0);
  f.frequency.exponentialRampToValueAtTime(toF, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(seGain);
  s.start(t0); s.stop(t0 + dur + 0.02);
}
export function playShuffleStart() {     // 셔플 라운드 시작: 상승 아르페지오 + 소용돌이
  [440, 660, 880, 1175].forEach((f, i) => tone(seGain, f, i * 0.07, 0.14, "triangle", 0.22));
  sweep(0.0, 0.35, 500, 2600, 0.18);
}
export function playCurtainClose() {     // 커튼 닫힘: 아래로 쓸어내리는 소리
  sweep(0, 0.26, 6000, 400, 0.3);
}
export function playCurtainOpen() {       // 커튼 열림: 위로 쓸어올리는 소리
  sweep(0, 0.26, 400, 6000, 0.3);
  tone(seGain, 1046.5, 0.05, 0.12, "sine", 0.14);
}
export function playSwapTick() {          // 박스 교환 순간: 짧은 whoosh
  perc(seGain, 0, 0.05, "highpass", 4000, 0.16);
}
export function playShutter() {           // Curtain Flicker: 가벼운 셔터 '틱'(짧고 조용하게)
  perc(seGain, 0, 0.025, "highpass", 6500, 0.07);
}

// ---------------- 타악기/노이즈 헬퍼 ----------------
let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    const c = ac();
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.4), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function perc(dest, when, dur, ftype, freq, peak) {
  const c = ac();
  if (dest === seGain) duckBgm(); // 효과음으로 쓰일 때만 Ducking(BGM 드럼은 제외)
  const t0 = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noise();
  const f = c.createBiquadFilter();
  f.type = ftype; f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}
function kick(dest, when, peak) {          // 펀치감 있는 킥(피치 드롭)
  const c = ac();
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t0);
  o.frequency.exponentialRampToValueAtTime(45, t0 + 0.11);
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  o.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + 0.18);
}
function snare(dest, when) {
  perc(dest, when, 0.14, "bandpass", 1900, 0.26);
  const c = ac(), t0 = c.currentTime + when;
  const o = c.createOscillator(), g = c.createGain();
  o.type = "triangle"; o.frequency.value = 180;
  g.gain.setValueAtTime(0.12, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
  o.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + 0.12);
}
const hat = (dest, when, dur, peak) => perc(dest, when, dur, "highpass", 8000, peak);
const clap = (dest, when) => perc(dest, when, 0.1, "bandpass", 1500, 0.2);
function chordStab(dest, chord, when) {
  chord.lead.forEach((f) => tone(dest, f, when, 0.12, "sawtooth", 0.07));
}

// ---------------- 배경음악(BGM) ----------------
// 16스텝(16분음표) 루프. I–V–vi–IV(C–G–Am–F)의 밝은 진행.
const STEPS = 16;
const BASE_STEP = 0.145;   // rate 1.0에서 16분음표(초) ≈ 103 BPM (댄서블)
const PROG = [
  { lead: [261.63, 329.63, 392.00], bass: 130.81 }, // C
  { lead: [293.66, 392.00, 493.88], bass: 98.00 },  // G
  { lead: [329.63, 440.00, 523.25], bass: 110.00 }, // Am
  { lead: [349.23, 440.00, 523.25], bass: 87.31 },  // F
];

let bgmPlaying = false;
let bgmStep = 0;
let bgmRate = 1.0;
let bgmTimer = null;
let nextNoteTime = 0;
let bassOn = false, drumOn = false, percOn = false, climaxOn = false;

function bgmScheduleStep(step, time) {
  const c = ac();
  const rel = time - c.currentTime;
  const chord = PROG[Math.floor(step / 4) % 4];

  // core: 4-on-the-floor 킥 + 통통 튀는 8분 리드(항상)
  if (step % 4 === 0) kick(layer.core, rel, 0.6);
  if (step % 2 === 0) {
    const n = chord.lead[(step / 2) % 3];
    tone(layer.core, n, rel, 0.15, "triangle", 0.26);
  }

  // bass: 8분 베이스 바운스
  if (bassOn && step % 2 === 0) {
    tone(layer.bass, chord.bass, rel, 0.17, "sawtooth", 0.2);
  }

  // drum: 백비트 스네어 + 오프비트 클로즈 하이햇
  if (drumOn) {
    if (step === 4 || step === 12) snare(layer.drum, rel);
    if (step % 4 === 2) hat(layer.drum, rel, 0.03, 0.13);
  }

  // perc: 16분 소프트 하이햇 + 클랩 액센트
  if (percOn) {
    hat(layer.perc, rel, 0.02, 0.05);
    if (step === 7 || step === 15) clap(layer.perc, rel);
  }

  // climax: 옥타브 스파클 리드 + 코드 스탭 + 오픈 하이햇
  if (climaxOn) {
    if (step % 2 === 0) {
      const n = chord.lead[(step / 2) % 3] * 2;
      tone(layer.climax, n, rel, 0.11, "square", 0.1);
    }
    if (step === 0 || step === 8) chordStab(layer.climax, chord, rel);
    if (step === 6 || step === 14) hat(layer.climax, rel, 0.12, 0.11);
  }
}

function bgmScheduler() {
  const c = ac();
  while (nextNoteTime < c.currentTime + 0.1) {   // 100ms 미리 예약(lookahead)
    bgmScheduleStep(bgmStep, nextNoteTime);
    nextNoteTime += BASE_STEP / bgmRate;         // rate↑ → 간격↓ → 템포↑
    bgmStep = (bgmStep + 1) % STEPS;
  }
  bgmTimer = setTimeout(bgmScheduler, 25);
}

// 레이어 gain을 1.2초에 걸쳐 부드럽게 전환(갑작스런 변화 방지)
function rampLayer(node, target) {
  const c = ac();
  node.gain.cancelScheduledValues(c.currentTime);
  node.gain.setValueAtTime(node.gain.value, c.currentTime);
  node.gain.linearRampToValueAtTime(target, c.currentTime + 1.2);
}

// 경과 시간(초)에 따라 템포·레이어(에너지)를 끌어올린다. main에서 매초 호출.
export function setBgmEnergy(elapsedSec) {
  // 템포는 대부분 유지, 후반에만 살짝 상승(흥분감)
  bgmRate = elapsedSec >= 35 ? 1.10 : elapsedSec >= 25 ? 1.05 : 1.0;
  // 레이어 페이드인(한 번 켜지면 유지)
  if (elapsedSec >= 10 && !bassOn) { bassOn = true; rampLayer(layer.bass, 1); }
  if (elapsedSec >= 10 && !drumOn) { drumOn = true; rampLayer(layer.drum, 1); }
  if (elapsedSec >= 25 && !percOn) { percOn = true; rampLayer(layer.perc, 1); }
  if (elapsedSec >= 35 && !climaxOn) { climaxOn = true; rampLayer(layer.climax, 1); }
}

// (하위 호환) 템포만 조절
export function setBgmRate(rate) { bgmRate = rate; }

// BGM 시작(loop). 재시작 시 기존 재생/레이어를 초기화.
export function startBGM() {
  const c = ac();
  if (bgmPlaying) stopBGMImmediate();
  bgmPlaying = true;
  bgmFadingOut = false;
  bgmStep = 0;
  bgmRate = 1.0;
  bassOn = drumOn = percOn = climaxOn = false;
  // 레이어 초기화: core만 on
  const now = c.currentTime;
  for (const k of LAYER_KEYS) {
    layer[k].gain.cancelScheduledValues(now);
    layer[k].gain.setValueAtTime(k === "core" ? 1 : 0, now);
  }
  bgmGain.gain.cancelScheduledValues(now);
  bgmGain.gain.setValueAtTime(BGM_VOLUME, now);
  nextNoteTime = now + 0.05;
  bgmScheduler();
}

function stopBGMImmediate() {
  bgmPlaying = false;
  bgmFadingOut = false;
  clearTimeout(bgmTimer);
  bgmTimer = null;
}

// 자연스러운 Fade Out 후 정지(종료 효과음과 매끄럽게 연결).
export function stopBGM(fadeMs = 900) {
  if (!bgmPlaying) return;
  bgmFadingOut = true; // Fade Out 중에는 효과음 Ducking이 볼륨을 되살리지 않도록
  const c = ac();
  const now = c.currentTime;
  bgmGain.gain.cancelScheduledValues(now);
  bgmGain.gain.setValueAtTime(bgmGain.gain.value, now);
  bgmGain.gain.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
  setTimeout(() => {
    stopBGMImmediate();
    bgmGain.gain.setValueAtTime(BGM_VOLUME, ac().currentTime); // 다음 재생 대비 복원
  }, fadeMs + 60);
}

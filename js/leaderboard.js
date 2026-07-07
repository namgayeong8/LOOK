// 리더보드 저장 모듈 — 브라우저 LocalStorage 사용(새로고침 후에도 유지)
// 정렬: 점수 내림차순, 동점이면 먼저 달성한 기록(ts 작은 것)이 위.

const KEY = "look_leaderboard_v1";
const NAME_KEY = "look_last_name";
const MAX_KEEP = 50; // 저장 상한(표시는 Top 10)

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeAll(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
function sortScores(list) {
  // 점수 높은 순, 동점이면 먼저 달성(ts 오름차순)
  return list.slice().sort((a, b) => b.score - a.score || a.ts - b.ts);
}
function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 정렬된 전체 기록
export function loadScores() { return sortScores(readAll()); }

// 현재 최고 점수(없으면 0)
export function bestScore() {
  const l = readAll();
  return l.length ? Math.max(...l.map((e) => e.score)) : 0;
}

// 기록 추가 → { entry, list(정렬·상한 적용) }
export function addScore({ name, score, combo, acc }) {
  const list = readAll();
  const entry = {
    id: makeId(),
    name: (name && name.trim()) || "Player",
    score: score | 0,
    combo: combo | 0,
    acc: acc | 0,
    ts: Date.now(),
  };
  list.push(entry);
  const sorted = sortScores(list).slice(0, MAX_KEEP);
  writeAll(sorted);
  return { entry, list: sorted };
}

// 방금 저장한 기록의 이름 수정(순서 변화 없음)
export function renameEntry(id, name) {
  const list = readAll();
  const e = list.find((x) => x.id === id);
  if (e) { e.name = (name && name.trim()) || "Player"; writeAll(list); }
  return loadScores();
}

export function getLastName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } }
export function setLastName(n) { try { localStorage.setItem(NAME_KEY, n || ""); } catch {} }

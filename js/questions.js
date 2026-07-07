// 랜덤 문제 생성 모듈
// - 도형 4종(하트/스페이드/다이아몬드/클럽) × 색상 여러 종
// - 목표(target)와, 상/하/좌/우 4개의 보기(options) 생성
// - 보기 중 정확히 하나만 목표와 도형+색이 일치

export const SHAPES = {
  heart:   { name: "하트",     path: "M50 88 L20 58 A18 18 0 0 1 50 34 A18 18 0 0 1 80 58 Z" },
  spade:   { name: "스페이드", path: "M50 12 C50 12 82 44 82 62 A16 16 0 0 1 54 72 L58 88 L42 88 L46 72 A16 16 0 0 1 18 62 C18 44 50 12 50 12 Z" },
  diamond: { name: "다이아",   path: "M50 10 L84 50 L50 90 L16 50 Z" },
  // 클럽: 잘못된 단일 아크 대신 3개의 겹치는 원 + 줄기로 구성(선명·정비율)
  club: {
    name: "클럽",
    body: (hex) =>
      `<circle cx="50" cy="32" r="18" fill="${hex}"/>` +
      `<circle cx="34" cy="58" r="18" fill="${hex}"/>` +
      `<circle cx="66" cy="58" r="18" fill="${hex}"/>` +
      `<path d="M50 56 C50 70 45 82 38 90 L62 90 C55 82 50 70 50 56 Z" fill="${hex}"/>`,
  },
};

export const COLORS = {
  red:    { name: "빨강",    hex: "#ff3b52" },
  black:  { name: "검정",    hex: "#2b2b3a" },
  green:  { name: "연두",    hex: "#7be04b" },
  yellow: { name: "노랑",    hex: "#ffd23f" },
  blue:   { name: "파랑",    hex: "#3a7bff" },
};

const SHAPE_KEYS = Object.keys(SHAPES);
const COLOR_KEYS = Object.keys(COLORS);
export const DIRECTIONS = ["up", "down", "left", "right"];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 도형 SVG 마크업 반환
export function shapeSVG(shapeKey, colorKey) {
  return shapeSVGHex(shapeKey, COLORS[colorKey].hex);
}

// 임의의 HEX 색으로 도형 SVG 반환 (목표 표시 등, 색상 무관 렌더용)
// - path형: 단일 패스 + 미세 외곽선 / body형(클럽): 여러 요소 조합(외곽선 없음)
export function shapeSVGHex(shapeKey, hex) {
  const shape = SHAPES[shapeKey];
  const body = shape.body
    ? shape.body(hex)
    : `<path d="${shape.path}" fill="${hex}" stroke="rgba(0,0,0,0.25)" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-label="${shape.name}">${body}</svg>`;
}

// 게임 시작 시 목표 도형(모형)을 1회 선택
export function pickTargetShape() {
  return rand(SHAPE_KEYS);
}

// 고정된 목표 도형(targetShape)에 맞춘 한 라운드 생성
// - 정답: 목표와 '도형'이 같은 보기 (색은 랜덤, 무관)
// - 오답: 목표와 '도형'이 다른 보기 (색 랜덤)
// - 매 라운드 보기의 위치·색은 랜덤으로 바뀜
export function generateRound(targetShape) {
  const correctDir = rand(DIRECTIONS);
  const used = new Set(); // 중복 조합 방지(시각적 다양성)

  const options = {};
  for (const dir of DIRECTIONS) {
    let shape, color, key;
    do {
      if (dir === correctDir) {
        shape = targetShape;              // 정답: 도형 일치, 색은 랜덤
      } else {
        do { shape = rand(SHAPE_KEYS); } while (shape === targetShape); // 오답: 다른 도형
      }
      color = rand(COLOR_KEYS);
      key = `${shape}:${color}`;
    } while (used.has(key));
    used.add(key);
    options[dir] = { shape, color };
  }

  return { correctDir, options };
}

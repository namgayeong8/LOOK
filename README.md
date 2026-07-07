# LOOK! — 고개로 하트를 찾아라 🎯

제한 시간 **40초** 동안 **얼굴 방향(고개 제스처)** 으로 목표 도형(하트 등)을
상·하·좌·우 보기 중에서 골라 점수를 얻는 웹 게임입니다.

- **얼굴 인식**: [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe) (Yaw/Pitch 추적)
- **카메라**: `getUserMedia()`
- **순수 HTML/CSS/JS** (빌드 도구 불필요)

## 실행 방법

카메라(`getUserMedia`)와 ES 모듈은 `file://` 에서 동작하지 않으므로
**로컬 서버**로 열어야 합니다. `localhost` 는 HTTPS 없이도 카메라가 허용됩니다.

```bash
cd "LOOK!"
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

> Node가 있다면 `npx serve` 또는 `npx http-server` 도 됩니다.

처음 실행 시 브라우저가 **카메라 권한**을 물어보면 허용하세요.
얼굴 인식 모델은 실행 시 CDN에서 자동으로 내려받습니다(인터넷 연결 필요).

## 게임 흐름

1. **시작** → 2. **카메라 권한** → 3. **게임 방법** → 4. **플레이(40초)** → 5. **결과**

플레이 화면에서 위쪽 **목표**와 같은 도형·색이 있는 방향으로 **고개를 돌리거나 끄덕**이면,
잠시 유지 후 선택이 확정됩니다. 정답이면 **+100점**.

## 조작이 반대/둔감할 때 (튜닝)

`js/faceControl.js` 상단 상수를 조절하세요.

| 상수 | 설명 |
|------|------|
| `INVERT_YAW` | 좌우가 반대로 인식되면 `true` |
| `INVERT_PITCH` | 상하가 반대로 인식되면 `true` |
| `YAW_TH` / `PITCH_TH` | 값이 작을수록 예민 (기본 0.10) |
| `SMOOTH` | 클수록 반응 빠름 / 떨림 증가 |

`js/main.js` 의 `DWELL_MS`(선택 유지 시간), `GAME_TIME`(제한 시간), `POINTS`(점수)도 조절 가능합니다.

## 파일 구조

```
LOOK!/
├─ index.html          # 5개 화면 마크업
├─ css/style.css       # 스타일/레이아웃
├─ js/
│  ├─ main.js          # 게임 흐름·타이머·점수·선택 로직
│  ├─ faceControl.js   # MediaPipe + 고개 제스처 판별
│  └─ questions.js     # 랜덤 문제(도형×색) 생성
└─ README.md
```

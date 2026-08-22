---
name: my-music-start
description: my-music-app 세션을 시작한다. 현재 상태 확인 → 재진입 카드 → 오늘 focus 1개 제안 → 본론. 호출 예시 — "/my-music-start", "세션 시작하자".
allowed-tools: Read, Write, Glob, Grep, Bash
---

# my-music-start — 세션 시작

1. **현재 상태 확인 (내부적으로만):** `00_META/MASTER_PLAN.md` → `sessions/` 최신 로그 → `open_questions.md`.
2. **재진입 카드:**
   ```
   📍 현재: [Phase / 지난 세션 한 줄 요약 — 내가 요약해 주기, 회상 질문 금지]
   🎯 오늘 제안: [MASTER_PLAN 기준 다음 항목 1개]
   ❓ 미결: [open_questions 중 오늘 건드릴 만한 것, 있으면 — Q01 재생 소스가 최우선]
   ```
   제안만 하고 Nick 확인 후 진행한다.
3. **본론 (앱형 모드):** 오늘 변경 범위 합의 → 작업 → 원본→생성물 규칙 준수(데이터 구조 먼저, UI는 그 위에). Phase 0에서는 Q01~Q03 결정에 집중하고 코드를 먼저 짜지 않는다.

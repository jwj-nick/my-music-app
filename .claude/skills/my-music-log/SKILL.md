---
name: my-music-log
description: my-music-app 세션을 마무리하고 로그를 정리한다. 호출 예시 — "/my-music-log", "오늘 세션 정리".
allowed-tools: Read, Edit, Write, Glob
---

# my-music-log — 세션 종료·롤업

**중요: 결정·판단의 서술은 Nick의 말을 기준으로 정리한다. 내가 창작해 채우지 않는다.**

1. **세션 로그 작성:** `00_META/sessions/YYMMDD_<주제>.md` — 오늘 다룬 것·결정·산출물 경로, 끝에 "다음 액션" 1~2줄.
2. **롤업 갱신:** `MASTER_PLAN.md` 현재 위치/상태칸 · `decisions.md` 오늘 결정 · `open_questions.md` 해결분 ✅ + 신규 Q.
3. **다음 세션 예고:** MASTER_PLAN 기준 다음 focus 1개 한 줄.
4. **커밋:** 건드린 경로만 명시적 스테이징 (`git add -A` 금지) → 커밋. 공개 범위는 단일 public repo — 첫 배포(GitHub repo 생성+push)는 Phase 1에서, 그 전까지는 로컬 커밋만.

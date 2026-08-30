# my-music-app — Nick의 청음실

Nick 전용, 무료 운영을 전제로 한 개인 음악 앱. 범용 스트리밍 서비스를 흉내 내지 않고
사용자 1명(Nick)의 취향에만 맞춘다. 재생은 YouTube에 위임하고, 이 앱은 취향 큐레이션·
지식노트·AI 탐구에 집중한다.

## 받기

**[⬇ 최신 디버그 APK 바로 받기](https://github.com/jwj-nick/my-music-app/releases/latest/download/my-music-app-latest-debug.apk)**
· [모든 릴리스](https://github.com/jwj-nick/my-music-app/releases)

(위 링크는 `/releases/latest/download/`라 버전이 올라가도 고정 — 새 릴리스에 같은 이름
자산을 올리기만 하면 항상 최신을 가리킨다. `android/make-release.ps1`이 매번 이렇게 올림.)

자체 서명 디버그 빌드 — 폰에서 열면 "출처를 알 수 없는 앱" 허용이 필요하다(정상). 릴리스
서명은 아직(`00_META/MASTER_PLAN.md` PW7).

**웹으로 먼저 보기:** https://jwj-nick.github.io/my-music-app/ (APK와 같은 코드, 브라우저에서 바로)

## 뭘 하는 앱인가

- **취향 큐레이션** — 좋아하는 아티스트·클래식 음반·가족(딸) 취향을 태그·의도(intent)로 분류.
- **AI 탐구** — 목적(들을 것 찾기 / 새 음악 추천 / 요즘 소식 / 자유질문)을 고르면 앱이 내 취향
  데이터를 반영해 쿼리를 조립하고, 결과를 다시 내 컬렉션(엔트리·지식노트)으로 편입.
- **재생** — YouTube 임베드로 앱 안에서 재생 큐 연속 재생, 또는 "YouTube 앱에서 재생"으로 실제
  앱에 넘겨 백그라운드 청취. Spotify 링크가 있으면 보조로 노출.
- **리스트 관리** — 필터 결과를 이름 붙여 저장, 재생/이름변경/삭제.
- **APK** — 네이티브 WebView 래퍼(`android/`)로 패키징. 상세 이유는 `00_META/decisions.md` #59.

## 구조

```
00_META/       진행 상황 SSOT — MASTER_PLAN·decisions·backlog·세션 로그
10_app/        웹 앱 소스 (바닐라 HTML/CSS/JS, 빌드 없음) — GitHub Pages가 이 폴더만 배포
android/       APK 패키징 (Gradle 프로젝트, 10_app/을 그대로 번들) — android/BUILD.md 참고
```

## 현재 상태

Phase 1(기능)·Phase 1.5(AI 연결)·Phase 2(디자인 "소프트 글래스") 완료. **Phase 3(APK) 진행
중** — 첫 디버그 빌드 배포 완료, 릴리스 서명 대기. 상세 진행상황·마일스톤·의사결정 이력은
`00_META/MASTER_PLAN.md`·`00_META/decisions.md` 참조.

## 출처

아이디어 정본: `C:\idea\2026-08-22_my-music-app-idea.md`

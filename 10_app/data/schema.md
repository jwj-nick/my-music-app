# 데이터 스키마 — my-music-app (마일스톤 1.1)

> entry(고정 정보)와 log(시간에 따라 쌓이는 것) 두 층으로 나눈다.

## entry

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 고유 키 |
| type | `"track"` \| `"artist"` | 트랙 단위인지 아티스트 단위인지 |
| title | string | 표시명 — 트랙명/아티스트명/클래식 곡명 |
| credits | object | 역할별 참여자. 필드 전부 선택(null 허용) |
| credits.performer | string\|null | 실제로 부른/연주한 사람 — 사실상 항상 채움 |
| credits.composer | string\|null | 작곡 |
| credits.lyricist | string\|null | 작사 |
| credits.originalArtist | string\|null | 커버곡인 경우 원곡 아티스트 |
| credits.conductor | string\|null | 클래식 지휘자 |
| credits.ensemble | string\|null | 오케스트라/앙상블 |
| spotifyUrl | string\|null | 딥링크. 아직 못 채운 건 null |
| tags | string[] | 자유 형식 — 무드/상황/기타(예: 한국음악가, 방송커버, 딸픽) |
| intent | `"taste"` \| `"explore"` \| `"family"` | 왜 담았는가 — 내 취향 / 교양 탐구(클래식 등) / 가족 탐구(아이들 인기곡) |
| note | string | 지식노트 — 리서치하며 누적 |
| addedAt | string (date) | 추가한 날짜 |

## log

| 필드 | 타입 | 설명 |
|---|---|---|
| entryId | string | entry.id 참조 |
| date | string (date) | 들은 날짜 |
| note | string (선택) | 그때 느낌 |

## 설계 원칙

- **역할 분리 (credits)**: "누가 만들었나"와 "누가 실제로 들려주나"는 다른 정보다. K-pop의 작사/작곡, 클래식의 작곡가 vs 연주자/지휘자/오케스트라, 커버곡의 원곡자 vs 실연자 — 이 세 가지가 전부 같은 패턴이라 하나의 `credits` 구조로 표현한다.
- **구조는 최소로**: 필터·추천에 실제로 쓸 것만 필드로 만든다. 나머지 맥락은 `note`에 자유 텍스트로 쌓는다.
- **intent로 취향과 탐구를 분리**: `taste`(내 취향)/`explore`(교양 탐구)/`family`(가족 탐구) — 나중에 추천 로직이 이 셋을 다르게 다룬다.
- **추천은 짧게**: Nick의 음악 청취 시간이 길지 않다 — 이후 규칙 기반 추천(마일스톤 1.6)은 긴 목록보다 소수의 큐레이션된 픽으로 설계한다.

## 검증 — 실제 시드 5개 (2026-08-22 확인 완료)

```json
[
  { "id": "lena-park", "type": "artist", "title": "박정현",
    "credits": { "performer": "박정현" },
    "spotifyUrl": null, "tags": [], "intent": "taste",
    "note": "", "addedAt": "2026-08-22" },

  { "id": "heun", "type": "artist", "title": "흰 (박혜원)",
    "credits": { "performer": "흰" },
    "spotifyUrl": null, "tags": [], "intent": "taste",
    "note": "", "addedAt": "2026-08-22" },

  { "id": "wendy-covers", "type": "track", "title": "(방송 커버곡 — 곡명은 추후 개별 채움)",
    "credits": { "performer": "웬디", "originalArtist": null },
    "spotifyUrl": null, "tags": ["방송커버"], "intent": "taste",
    "note": "카테고리 자리만 잡음. 실제로는 곡별로 엔트리 여러 개 생길 것", "addedAt": "2026-08-22" },

  { "id": "beethoven-5-sample", "type": "track", "title": "베토벤 교향곡 5번 (예시 — 실제 음반 미정)",
    "credits": { "composer": "루트비히 판 베토벤", "conductor": "정명훈", "ensemble": "서울시립교향악단" },
    "spotifyUrl": null, "tags": ["클래식", "한국음악가"], "intent": "explore",
    "note": "2016년 이후 음반 기준 실제 후보는 마일스톤 1.2에서 리서치", "addedAt": "2026-08-22" },

  { "id": "boynextdoor", "type": "artist", "title": "보이넥스트도어",
    "credits": { "performer": "보이넥스트도어" },
    "spotifyUrl": null, "tags": ["딸픽"], "intent": "family",
    "note": "", "addedAt": "2026-08-22" }
]
```

## 확정 이력
- 2026-08-22 초안 (artist 단일 필드) → Nick 피드백(작사/작곡 필요, 클래식 부적합)으로 `credits` 객체 도입 → 5개 시드로 검증 후 확정.

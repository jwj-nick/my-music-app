// 프롬프트 파이프라인 회귀 테스트 (마일스톤 1.5.6~) — node test_prompt.js
// test_recommend.js와 같은 방식: 실제 seed.json + 고정 입력 → 항상 같은 출력.

const fs = require("fs");
const path = require("path");
const { tasteProfile, buildQuery, shiftYears, parseLinkResults, parseDiscoverResults } = require("./app.js");

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "seed.json"), "utf8"));

let failed = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`${label} OK`);
  } else {
    failed++;
    console.log(`${label} FAIL`);
    console.log("--- expected ---\n" + expected);
    console.log("--- actual ---\n" + actual);
  }
}

// case 1: 로그 없이 seed만 — intent별 분류와 태그 수집이 정확한가 ("최근 들은 것" 줄은 없어야 함)
check("case 1 (seed만, 로그 없음)", tasteProfile(seed), [
  "좋아하는 아티스트: 박정현, 흰, 웬디",
  "탐구 중인 음반(클래식 위주): 쇼팽: 에튀드 전곡, 모차르트: 피아노 소나타 & 피아노 협주곡 20번, 이자이: 무반주 바이올린 소나타 전곡, 닐센: 교향곡 4번·5번, 브리튼: 오페라 '피터 그라임스', 코른골트: 오페라 '죽음의 도시', 베를린 리사이틀, 바흐: 골드베르크 변주곡",
  "가족(딸) 취향: 보이넥스트도어, 리센느",
  "관심 태그: 방송커버, 딸픽, 2024 데뷔, 클래식, 한국음악가, 오페라, 기악"
].join("\n"));

// case 2: 청취 로그 반영 — 최근 것이 뒤에서부터, 중복 제거되어 나오는가
const logs = [
  { entryId: "lena-park", date: "2026-08-22" },
  { entryId: "yunchan-lim-chopin-etudes", date: "2026-08-23" },
  { entryId: "lena-park", date: "2026-08-23" } // 중복 — 한 번만 나와야 함
];
const p2 = tasteProfile(seed, logs);
check("case 2 (로그 반영, 최근순+중복제거)",
  p2.split("\n").pop(),
  "최근 들은 것: 박정현, 쇼팽: 에튀드 전곡");

// case 3: 빈 컬렉션 — 빈 문자열이어야 함 (빈 줄 뭉치 금지)
check("case 3 (빈 컬렉션)", tasteProfile([]), "");

// ---- buildQuery (마일스톤 1.5.7) ----

// case 4: T1 — 웬디 방송 커버 케이스. 상대 기간이 절대 날짜로 변환되는가, 출력 계약이 박히는가
check("case 4 (T1 웬디 커버)", buildQuery({
  type: "links", target: "웬디 (레드벨벳)", form: "방송 커버 영상",
  period: "1y", count: 10, today: "2026-08-23",
  hint: "JTBC, KBS 유튜브 위주"
}), [
  '"웬디 (레드벨벳)"의 방송 커버 영상을(를) 웹에서 검색해줘. 기간: 2025-08-23 ~ 2026-08-23. 최대 10개.',
  "각 항목을 정확히 이 형식의 한 줄로 써줘:",
  "곡명 | 아티스트 | 채널/방송 | 날짜 | URL",
  "확인된 것만 쓰고 추측 금지. 실제 URL 필수. 못 찾으면 찾은 만큼만 써줘.",
  "추가 조건: JTBC, KBS 유튜브 위주"
].join("\n"));

// case 5: T3 — 취향 프로파일과 제외 목록이 문장에 박히는가
const q5 = buildQuery({
  type: "discover", target: "클래식 (2016년 이후 발매, 유명 연주자/오케스트라, 한국 음악가 선호)",
  profile: tasteProfile(seed), excludeTitles: seed.map(e => e.title),
  count: 3, today: "2026-08-23", hint: ""
});
check("case 5a (T3 프로파일 포함)", q5.includes("좋아하는 아티스트: 박정현, 흰, 웬디"), true);
check("case 5b (T3 제외 목록 포함)", q5.includes("추천 금지") && q5.includes("쇼팽: 에튀드 전곡"), true);
check("case 5c (T3 출력 계약)", q5.includes("제목 | 아티스트 | 추천 이유(내 취향과의 연결) | 태그(쉼표 구분)"), true);

// case 6: T4 — 지역/범위/기간
check("case 6 (T4 한국 브리핑)", buildQuery({
  type: "brief", region: "한국", scope: "K-pop", period: "1m", count: 5, today: "2026-08-23", hint: ""
}), [
  "한국 K-pop 음악 씬에서 요즘 화제인 것들을 웹에서 검색해 브리핑해줘. 기간: 2026-07-23 ~ 2026-08-23.",
  "불릿 5개 이내로, 각 불릿 끝에 출처 링크를 붙여줘. 확인된 것만, 추측 금지."
].join("\n"));

// case 7: 연 경계 — 1월에서 1개월 전이면 전년 12월
check("case 7 (기간 연 경계)", buildQuery({
  type: "brief", region: "세계", scope: "전체", period: "1m", count: 3, today: "2026-01-15", hint: ""
}).includes("2025-12-15 ~ 2026-01-15"), true);

// ---- 응답 파싱 ----

// case 8: T1 파싱 — 불릿/번호 접두 제거, URL 없는 줄과 형식 어긋난 줄은 버림
const t1raw = [
  "찾은 결과입니다:",
  "1. Hero | 웬디 | KBS 더시즌즈 | 2026-03-14 | https://youtube.com/watch?v=abc",
  "- Speechless | 웬디 | JTBC 비긴어게인 | 2025-11-02 | https://youtube.com/watch?v=def",
  "형식 어긋난 줄 | 두 필드뿐",
  "곡명 | 아티스트 | 채널 | 날짜 | URL없음"
].join("\n");
const t1parsed = parseLinkResults(t1raw);
check("case 8 (T1 파싱)", JSON.stringify(t1parsed), JSON.stringify([
  { title: "Hero", artist: "웬디", channel: "KBS 더시즌즈", date: "2026-03-14", url: "https://youtube.com/watch?v=abc" },
  { title: "Speechless", artist: "웬디", channel: "JTBC 비긴어게인", date: "2025-11-02", url: "https://youtube.com/watch?v=def" }
]));

// case 9: T3 파싱 — 태그가 배열로 쪼개지는가
const t3parsed = parseDiscoverResults("정지용 - 봄 | 정지용 | 박정현과 같은 R&B 발라드 계열 | R&B, 발라드");
check("case 9 (T3 파싱)", JSON.stringify(t3parsed), JSON.stringify([
  { title: "정지용 - 봄", artist: "정지용", reason: "박정현과 같은 R&B 발라드 계열", tags: ["R&B", "발라드"] }
]));

if (failed === 0) console.log("모든 케이스 통과");
else { console.log(`${failed}개 실패`); process.exit(1); }

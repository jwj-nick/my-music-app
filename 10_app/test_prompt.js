// 프롬프트 파이프라인 회귀 테스트 (마일스톤 1.5.6~) — node test_prompt.js
// test_recommend.js와 같은 방식: 실제 seed.json + 고정 입력 → 항상 같은 출력.

const fs = require("fs");
const path = require("path");
const { tasteProfile } = require("./app.js");

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

if (failed === 0) console.log("모든 케이스 통과");
else { console.log(`${failed}개 실패`); process.exit(1); }

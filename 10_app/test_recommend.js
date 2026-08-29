// 마일스톤 1.6 회귀 테스트 — 고정 케이스 4개.
// `node 10_app/test_recommend.js`로 실행. app.js의 recommend()는 pool을 인자로 받는
// 순수 함수라 DOM/localStorage 없이도 그대로 불러 쓸 수 있다.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { recommend } = require("./app.js");

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "seed.json"), "utf8"));

function idsOf(entries) {
  return entries.map(e => e.id);
}

// Case 1: "클래식" 태그 → 태그를 가진 8개 중 앞에서부터(seed 순서) 3개
{
  const result = recommend(seed, ["클래식"], { limit: 3 });
  assert.deepEqual(idsOf(result), ["yunchan-lim-chopin-etudes", "cho-seongjin-mozart", "hilary-hahn-ysaye"]);
  console.log("case 1 (클래식) OK:", idsOf(result));
}

// Case 2: "딸픽" 태그 → 후보가 2개뿐이라 2개만 반환
{
  const result = recommend(seed, ["딸픽"], { limit: 3 });
  assert.deepEqual(idsOf(result), ["boynextdoor", "rescene"]);
  console.log("case 2 (딸픽) OK:", idsOf(result));
}

// Case 3: "한국음악가" 태그
{
  const result = recommend(seed, ["한국음악가"], { limit: 3 });
  assert.deepEqual(idsOf(result), ["yunchan-lim-chopin-etudes", "cho-seongjin-mozart"]);
  console.log("case 3 (한국음악가) OK:", idsOf(result));
}

// Case 4: 태그 없음 → intent(taste/explore/family)별로 하나씩 골고루
{
  const result = recommend(seed, [], { limit: 3 });
  assert.deepEqual(idsOf(result), ["lena-park", "yunchan-lim-chopin-etudes", "boynextdoor"]);
  console.log("case 4 (기본, 골고루) OK:", idsOf(result));
}

// Case 5 (1.7): "클래식" 태그인데 1등을 오늘 이미 들었으면(excludeIds) 다음 순위가 올라온다
{
  const result = recommend(seed, ["클래식"], { limit: 3, excludeIds: ["yunchan-lim-chopin-etudes"] });
  assert.deepEqual(idsOf(result), ["cho-seongjin-mozart", "hilary-hahn-ysaye", "nielsen-4-5-luisi"]);
  console.log("case 5 (클래식, 오늘 들은 것 제외) OK:", idsOf(result));
}

// Case 6 (1.7): 기본(골고루) 추천에서 taste 슬롯의 1순위를 오늘 들었으면 다음 taste 항목으로 대체
{
  const result = recommend(seed, [], { limit: 3, excludeIds: ["lena-park"] });
  assert.deepEqual(idsOf(result), ["heun", "yunchan-lim-chopin-etudes", "boynextdoor"]);
  console.log("case 6 (기본, 오늘 들은 것 제외) OK:", idsOf(result));
}

// Case 7 (2026-08-29): daySeed가 있으면 날짜별로 다른 픽이 나온다 — "매일 똑같아서 지루하다"는
// 실사용 피드백에 대한 회귀 테스트. daySeed 없는 케이스(4·6 위)는 여전히 옛날처럼 고정이어야 한다.
{
  const day1 = recommend(seed, [], { limit: 3, daySeed: "2026-08-29" });
  const day2 = recommend(seed, [], { limit: 3, daySeed: "2026-09-02" });
  assert.notDeepEqual(idsOf(day1), idsOf(day2), "날짜가 다르면 최소 한 슬롯은 바뀌어야 한다");
  // 같은 날짜를 두 번 호출해도 항상 같은 결과(순수 함수 — 새로고침해도 하루 안에서는 안 흔들림)
  assert.deepEqual(idsOf(day1), idsOf(recommend(seed, [], { limit: 3, daySeed: "2026-08-29" })));
  console.log("case 7 (daySeed 로테이션) OK:", idsOf(day1), "vs", idsOf(day2));
}

console.log("모든 케이스 통과");

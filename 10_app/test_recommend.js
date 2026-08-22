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

console.log("모든 케이스 통과");

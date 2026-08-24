// Phase 1 뼈대 — 목록 렌더링 · intent/tag 필터 · Spotify 딥링크 · 인앱 추가/편집(localStorage)
//
// 데이터는 두 레이어다.
//   1) seed(고정) — data/seed.json, git으로 관리되는 "출고 시" 데이터.
//   2) local(사용자 추가/수정) — 이 브라우저의 localStorage에만 저장된다. 새로고침해도 남지만,
//      다른 브라우저·기기에서는 안 보인다. seed.json에 실제로 합치려면(동기화) "내보내기"로
//      뽑아서 다음 Claude Code 세션에서 수동으로 반영한다 — 지금은 이 수동 방식으로 시작한다.
//
// file://로 열면 브라우저가 로컬 JSON fetch를 CORS로 막기 때문에, 로컬 확인 시엔 반드시
// 로컬 서버로 띄워야 한다. (예: `python -m http.server 8765` 후 http://localhost:8765)
// 이 제약은 Phase 3(TWA/PWA 패키징)에서도 그대로 적용되는 개념이라 지금 익혀둔다.

const LS_ENTRIES = "mma_local_entries";
const LS_OVERRIDES = "mma_overrides";
const LS_LOGS = "mma_logs";
const LS_APIKEY = "mma_api_key"; // Claude API 키 — 절대 seed.json/git에 안 들어감, 이 브라우저에만 저장 (decisions.md #21)
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // 개인 앱 운영비 0원 원칙(decisions.md #25) — 품질이 아쉬우면 이 상수만 교체
const CLAUDE_MAX_TOKENS = 1024;
const CLAUDE_MAX_SEARCHES = 3; // 웹 검색 도구(decisions.md #28) — 질문 하나당 검색 상한, 검색 1회 = $0.01(+토큰)

let allEntries = [];      // seed.json에서 읽은 고정 데이터
let localEntries = [];    // 사용자가 앱에서 추가한 항목 (localStorage)
let overrides = {};       // 기존 엔트리에 대한 사용자 수정 사항, entryId -> {필드: 값}
let logs = [];            // 청취 로그 — { entryId, date }[] (localStorage)

let activeIntent = "all";
let activeTags = new Set();

const INTENT_LABELS = { taste: "내 취향", explore: "클래식·교양", family: "아이돌·가족" }; // Q06: 탭 라벨 (Phase 2)
const LS_THEME = "mma_theme";

// ---- 테마 (Phase 2) — 순환: 시스템 → 다크 → 라이트 → 시스템 ----
// 시스템 상태에서는 data-theme 스탬프 없이 prefers-color-scheme 미디어쿼리만 동작한다.
function initTheme() {
  const saved = localStorage.getItem(LS_THEME);
  if (saved) document.documentElement.dataset.theme = saved;
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "";
    const next = cur === "" ? "dark" : cur === "dark" ? "light" : "";
    if (next) {
      document.documentElement.dataset.theme = next;
      localStorage.setItem(LS_THEME, next);
    } else {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(LS_THEME);
    }
  });
}

async function init() {
  initTheme();
  const res = await fetch("data/seed.json");
  allEntries = await res.json();
  localEntries = loadLocalEntries();
  overrides = loadOverrides();
  logs = loadLogs();
  initAddForm();
  initExport();
  initSettings();
  initExplore();
  initPlayer();
  renderFilters();
  render();
}

// ---- localStorage 레이어 ----

function loadLocalEntries() {
  try { return JSON.parse(localStorage.getItem(LS_ENTRIES)) || []; }
  catch { return []; }
}
function saveLocalEntries(list) {
  localStorage.setItem(LS_ENTRIES, JSON.stringify(list));
}
function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_OVERRIDES)) || {}; }
  catch { return {}; }
}
function saveOverrides(obj) {
  localStorage.setItem(LS_OVERRIDES, JSON.stringify(obj));
}

// ---- API 키 (마일스톤 1.5.2) ----
//
// 절대 seed.json이나 git에 들어가지 않는다 — 이 브라우저의 localStorage에만 저장된다.
// "내보내기"(initExport)도 의도적으로 이 키를 포함하지 않는다 (안전장치, 마일스톤 1.5.3).
// Phase 1.5.4에서 이 키로 Claude API를 브라우저가 직접 호출한다(백엔드 없음, decisions.md #21).

function loadApiKey() {
  return localStorage.getItem(LS_APIKEY) || "";
}
function saveApiKey(key) {
  localStorage.setItem(LS_APIKEY, key);
}
function deleteApiKey() {
  localStorage.removeItem(LS_APIKEY);
}

// ---- Claude API 직접 호출 (마일스톤 1.5.4) ----
//
// 백엔드 없이 브라우저가 Anthropic API를 직접 호출한다 (decisions.md #21).
// `anthropic-dangerous-direct-browser-access` 헤더가 있어야 브라우저의 CORS 요청을
// Anthropic이 받아준다 — 이름의 "dangerously"는 이 키가 이 브라우저 사용자에게 노출된다는
// 공식 경고다. 우리는 이미 이 키를 Nick 본인만 입력/저장하는 구조라 그 경고를 감수하는 범위 안이다.
//
// alert/confirm을 안 쓴다는 원칙대로, 실패도 예외를 던지지 않고 { error } 형태로 돌려준다 —
// 호출하는 쪽(1.5.5 UI)이 화면에 인라인으로 표시하면 된다.
//
// 웹 검색 도구(decisions.md #28): Anthropic이 서버 쪽에서 직접 실행하는 "server tool"이라
// 우리 쪽엔 백엔드가 여전히 필요 없다. 검색할지 말지는 Claude가 질문을 보고 스스로 판단한다
// (최신/시사성 질문엔 검색, 일반 지식엔 바로 답) — 우리가 분기 로직을 따로 안 짜도 된다.
async function askClaude(prompt) {
  const key = loadApiKey();
  if (!key) {
    return { error: "설정에서 API 키를 먼저 입력해주세요." };
  }
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: CLAUDE_MAX_SEARCHES }]
      })
    });
  } catch (err) {
    return { error: "네트워크 오류: " + err.message };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { error: `API 오류 (${res.status}): ${bodyText.slice(0, 200)}` };
  }
  const data = await res.json();
  // content 배열엔 text 외에 server_tool_use/web_search_tool_result 블록도 섞여 온다 —
  // text 블록만 걸러서 이어붙이면 자연스러운 답변 문단이 된다.
  const textBlocks = (data.content || []).filter(b => b.type === "text");
  const text = textBlocks.map(b => b.text || "").join("");
  // 인용(citation)에 실제 출처 URL이 붙어 오면 답변 아래에 목록으로 모아 보여준다.
  const urls = new Set();
  textBlocks.forEach(b => (b.citations || []).forEach(c => { if (c.url) urls.add(c.url); }));
  const sources = urls.size > 0 ? "\n\n출처:\n" + [...urls].map(u => "- " + u).join("\n") : "";
  return { text: text + sources };
}

// ---- 청취 로그 (마일스톤 1.7) ----

function loadLogs() {
  try { return JSON.parse(localStorage.getItem(LS_LOGS)) || []; }
  catch { return []; }
}
function saveLogs(list) {
  localStorage.setItem(LS_LOGS, JSON.stringify(list));
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function logListen(entryId) {
  logs.push({ entryId, date: todayStr() });
  saveLogs(logs);
  render();
}
function listenSummary(entryId) {
  const entryLogs = logs.filter(l => l.entryId === entryId);
  if (entryLogs.length === 0) return null;
  const last = entryLogs[entryLogs.length - 1].date;
  return `들은 기록 ${entryLogs.length}회 · 최근 ${last}`;
}

// seed + overrides + local을 합쳐서 화면에 쓸 최종 목록을 만든다.
function mergedEntries() {
  const withOverrides = allEntries.map(e => {
    const o = overrides[e.id];
    return o ? { ...e, ...o } : e;
  });
  return [...withOverrides, ...localEntries];
}

// ---- 표시 로직 ----

function spotifyLink(entry) {
  if (entry.spotifyUrl) return entry.spotifyUrl;
  const query = [entry.credits.performer, entry.title].filter(Boolean).join(" ");
  return "https://open.spotify.com/search/" + encodeURIComponent(query);
}

function formatCredits(c) {
  const parts = [];
  if (c.performer) parts.push(c.performer);
  if (c.composer) parts.push("작곡 " + c.composer);
  if (c.lyricist) parts.push("작사 " + c.lyricist);
  if (c.conductor) parts.push("지휘 " + c.conductor);
  if (c.ensemble) parts.push(c.ensemble);
  if (c.originalArtist) parts.push("원곡 " + c.originalArtist);
  return parts.join(" · ");
}

function matchesFilters(entry) {
  if (activeIntent !== "all" && entry.intent !== activeIntent) return false;
  if (activeTags.size > 0) {
    for (const t of activeTags) {
      if (!entry.tags.includes(t)) return false;
    }
  }
  return true;
}

// ---- 규칙 기반 추천 (마일스톤 1.6, 1.7에서 청취 로그 반영) ----
//
// pool을 인자로 받는 순수 함수로 만든다 — DOM/localStorage에 기대지 않아야
// Node에서 그대로 테스트할 수 있다 (test_recommend.js 참고).
//
// queryTags가 있으면: 태그 겹치는 개수로 점수를 매기고, 동점이면 seed 순서(먼저 나온 게 우선)로
//   정렬한다 — Math.random 같은 걸 안 쓰는 이유는 같은 입력이면 항상 같은 결과가 나와야
//   회귀 테스트(같은 케이스를 반복 실행해 결과가 안 바뀌는지 확인)가 가능하기 때문이다.
// queryTags가 없으면: intent(taste/explore/family)별로 하나씩 균형 있게 뽑는다 — 아직 "많이
//   들은 것" 같은 가중치 대신 지금은 "골고루" 규칙으로 시작한다.
// opts.excludeIds: 오늘 이미 들은 항목의 id 목록. 함수 안에서 new Date()를 직접 쓰지 않고
//   호출하는 쪽(renderRecommend)에서 "오늘"을 계산해 넘겨준다 — 그래야 recommend 자체는
//   여전히 순수 함수로 남아 테스트가 가능하다. 제외했더니 후보가 없으면 원래 pool로 되돌아간다
//   (추천 칸이 비어 보이는 것보다는 중복이라도 보여주는 게 낫다).
function recommend(pool, queryTags = [], opts = {}) {
  const limit = opts.limit || 3;
  const exclude = new Set(opts.excludeIds || []);

  if (queryTags.length === 0) {
    const seen = new Set();
    const picks = [];
    for (const intent of ["taste", "explore", "family"]) {
      const preferred = pool.find(e => e.intent === intent && !seen.has(e.id) && !exclude.has(e.id));
      const fallback = pool.find(e => e.intent === intent && !seen.has(e.id));
      const found = preferred || fallback;
      if (found) { picks.push(found); seen.add(found.id); }
    }
    return picks.slice(0, limit);
  }

  const excluded = pool.filter(e => !exclude.has(e.id));
  const usable = excluded.length > 0 ? excluded : pool;
  const scored = usable
    .map(entry => ({
      entry,
      idx: pool.indexOf(entry),
      score: queryTags.filter(t => entry.tags.includes(t)).length
    }))
    .filter(s => s.score > 0);
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.slice(0, limit).map(s => s.entry);
}

// ---- 쿼리 빌더 (마일스톤 1.5.7) ----
//
// "사용자는 선택하고, 쿼리 문장은 앱이 조립한다" (decisions.md #29~31).
// 답 4유형(T1 links / T2 knowledge / T3 discover / T4 brief)마다 템플릿과 출력 계약이 다르다.
// 순수 함수 원칙: 날짜(today)도 호출부가 넘긴다 — recommend()·tasteProfile()과 같은 이유.
//
// 품질 장치:
//   - "최근 1년" 같은 상대 기간은 절대 날짜로 변환해 넣는다 (모델이 컷오프 핑계를 못 대게)
//   - 출력 형식을 `필드 | 필드 | ...` 한 줄 계약으로 못박아 파싱 가능하게
//   - "확인된 것만, 추측 금지, 출처 필수" 명시

function shiftYears(dateStr, years) {
  // "YYYY-MM-DD"에서 연도만 조정 — Date 객체 없이 문자열 연산 (순수)
  const y = parseInt(dateStr.slice(0, 4), 10) + years;
  return String(y) + dateStr.slice(4);
}

function shiftMonths(dateStr, delta) {
  // 월 단위 이동 — 연 경계 처리. Date 객체 없이 문자열 연산 (순수)
  let y = parseInt(dateStr.slice(0, 4), 10);
  let m = parseInt(dateStr.slice(5, 7), 10) + delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}${dateStr.slice(7)}`;
}

function periodClause(period, today) {
  if (period === "1y") return `기간: ${shiftYears(today, -1)} ~ ${today}.`;
  if (period === "3y") return `기간: ${shiftYears(today, -3)} ~ ${today}.`;
  if (period === "1m") return `기간: ${shiftMonths(today, -1)} ~ ${today}.`;
  if (period === "3m") return `기간: ${shiftMonths(today, -3)} ~ ${today}.`;
  return ""; // "any" — 기간 제한 없음
}

function buildQuery(sel) {
  const hint = sel.hint ? `\n추가 조건: ${sel.hint}` : "";
  const today = sel.today;

  if (sel.type === "links") { // T1 플레이 링크
    return [
      `"${sel.target}"의 ${sel.form}을(를) 웹에서 검색해줘. ${periodClause(sel.period, today)} 최대 ${sel.count}개.`,
      `각 항목을 정확히 이 형식의 한 줄로 써줘:`,
      `곡명 | 아티스트 | 채널/방송 | 날짜 | URL`,
      `확인된 것만 쓰고 추측 금지. 실제 URL 필수. 못 찾으면 찾은 만큼만 써줘.`
    ].join("\n") + hint;
  }

  if (sel.type === "knowledge") { // T2 지식 (카드에서 진입)
    return [
      `다음 음악/아티스트에 대해 알려줘: ${sel.target}.`,
      `${sel.question || "배경, 특징, 알아둘 맥락"}을 지식노트에 쌓을 수 있게 간결하게 정리해줘.`,
      `최신 정보가 필요하면 웹 검색을 쓰고 출처 링크를 남겨줘. 추측 금지.`
    ].join("\n") + hint;
  }

  if (sel.type === "discover") { // T3 추천 후보
    return [
      `새로운 음악을 추천해줘. 방향: ${sel.target}.`,
      `내 취향 프로파일:`,
      sel.profile,
      `이미 갖고 있는 것(추천 금지): ${(sel.excludeTitles || []).join(", ")}`,
      `정확히 ${sel.count}개, 각 항목을 이 형식의 한 줄로 써줘:`,
      `제목 | 아티스트 | 추천 이유(내 취향과의 연결) | 태그(쉼표 구분)`,
      `실존하는 음악만. 확실하지 않으면 웹 검색으로 확인해줘.`
    ].join("\n") + hint;
  }

  if (sel.type === "brief") { // T4 요약 브리핑
    return [
      `${sel.region} ${sel.scope} 음악 씬에서 요즘 화제인 것들을 웹에서 검색해 브리핑해줘. ${periodClause(sel.period, today)}`,
      `불릿 ${sel.count}개 이내로, 각 불릿 끝에 출처 링크를 붙여줘. 확인된 것만, 추측 금지.`
    ].join("\n") + hint;
  }

  return "";
}

// T1/T3 응답 파싱 — `a | b | c` 줄만 골라 필드로 쪼갠다. 형식이 어긋난 줄은 조용히 건너뜀 (방어적).
function parsePipeLines(text, fieldCount) {
  return text.split("\n")
    .map(line => line.trim().replace(/^[-*\d.)\s]+/, "")) // 불릿/번호 접두 제거
    .filter(line => line.split("|").length === fieldCount)
    .map(line => line.split("|").map(s => s.trim()));
}

function parseLinkResults(text) { // T1: 곡명|아티스트|채널|날짜|URL
  return parsePipeLines(text, 5)
    .filter(f => /^https?:\/\//.test(f[4]))
    .map(f => ({ title: f[0], artist: f[1], channel: f[2], date: f[3], url: f[4] }));
}

function parseDiscoverResults(text) { // T3: 제목|아티스트|이유|태그
  return parsePipeLines(text, 4)
    .map(f => ({ title: f[0], artist: f[1], reason: f[2], tags: f[3].split(",").map(t => t.trim()).filter(Boolean) }));
}

// ---- 취향 프로파일 (마일스톤 1.5.6) ----
//
// 컬렉션 전체를 AI 프롬프트에 넣을 압축 텍스트로 증류한다.
// recommend()와 같은 이유로 순수 함수 — entries/logs를 인자로 받고 localStorage/DOM을 안 본다.
// 이 출력이 ②발견/③트렌드 프롬프트의 "자동 컨텍스트"가 된다 (decisions.md #29) —
// Nick이 매번 자기 취향을 타이핑하지 않아도 되는 것이 이 함수의 존재 이유.
function tasteProfile(entries, logs = []) {
  const byIntent = { taste: [], explore: [], family: [] };
  entries.forEach(e => { if (byIntent[e.intent]) byIntent[e.intent].push(e); });
  const name = e => e.credits.performer || e.title;

  // 최근 청취: 로그 뒤에서부터 중복 없이 최대 5개
  const idMap = new Map(entries.map(e => [e.id, e]));
  const recentIds = [];
  for (let i = logs.length - 1; i >= 0 && recentIds.length < 5; i--) {
    if (!recentIds.includes(logs[i].entryId)) recentIds.push(logs[i].entryId);
  }
  const recent = recentIds.map(id => idMap.get(id)).filter(Boolean).map(e => e.title);

  const allTags = [...new Set(entries.flatMap(e => e.tags))];

  const lines = [];
  if (byIntent.taste.length) lines.push("좋아하는 아티스트: " + byIntent.taste.map(name).join(", "));
  if (byIntent.explore.length) lines.push("탐구 중인 음반(클래식 위주): " + byIntent.explore.map(e => e.title).join(", "));
  if (byIntent.family.length) lines.push("가족(딸) 취향: " + byIntent.family.map(name).join(", "));
  if (allTags.length) lines.push("관심 태그: " + allTags.join(", "));
  if (recent.length) lines.push("최근 들은 것: " + recent.join(", "));
  return lines.join("\n");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function isLocalId(id) {
  return id.startsWith("local-");
}

// 아트 타일 (Phase 2) — 앨범아트 데이터가 없으므로 id 해시로 결정적 그라디언트 생성.
// 같은 엔트리는 항상 같은 색 (해시 기반이라 새로고침해도 안 바뀜).
function artTile(entry) {
  let h = 0;
  for (const ch of entry.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const h2 = (h + 40) % 360;
  const initial = (entry.title || "?").replace(/[\s"'(\[]/g, "").charAt(0) || "?";
  return `<div class="art" aria-hidden="true" style="background:linear-gradient(135deg, hsl(${h},38%,46%), hsl(${h2},45%,30%))">${escapeHtml(initial)}</div>`;
}

function renderCard(entry) {
  const card = document.createElement("div");
  card.className = "card";
  const local = isLocalId(entry.id);
  card.innerHTML = `
    ${artTile(entry)}
    <div class="card-body">
    <div class="card-top">
      <span class="intent-tag intent-${entry.intent}">${INTENT_LABELS[entry.intent] || entry.intent}</span>
      <h3>${escapeHtml(entry.title)}</h3>
    </div>
    <p class="credits">${escapeHtml(formatCredits(entry.credits))}</p>
    <div class="tags">${entry.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    <p class="note" data-note>${entry.note ? escapeHtml(entry.note) : '<span class="muted">메모 없음</span>'}</p>
    ${(entry.links || []).length ? `<p class="entry-links">${entry.links.map(l =>
      `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">▶ ${escapeHtml(l.label || "링크")}</a>`).join(" ")}</p>` : ""}
    ${listenSummary(entry.id) ? `<p class="listen-summary">${escapeHtml(listenSummary(entry.id))}</p>` : ""}
    <div class="card-actions">
      <a class="play-btn" href="${spotifyLink(entry)}" target="_blank" rel="noopener">Spotify에서 찾기</a>
      <button class="listen-btn" type="button">들었음</button>
      <button class="edit-note-btn" type="button">메모 편집</button>
      <button class="ask-ai-btn" type="button">AI에게 물어보기</button>
      <button class="find-links-btn" type="button">링크 찾기</button>
      ${local ? '<button class="delete-btn" type="button">삭제</button>' : ""}
    </div>
    </div>
  `;
  card.querySelector(".listen-btn").addEventListener("click", () => logListen(entry.id));
  card.querySelector(".edit-note-btn").addEventListener("click", () => startEditNote(card, entry));
  card.querySelector(".ask-ai-btn").addEventListener("click", () => startAskAI(card, entry));
  card.querySelector(".find-links-btn").addEventListener("click", () => startFindLinks(card, entry));
  if (local) {
    card.querySelector(".delete-btn").addEventListener("click", () => deleteLocalEntry(entry.id));
  }
  return card;
}

// ---- "AI에게 물어보기" (마일스톤 1.5.5) ----
//
// 카드마다 붙는 이유: 지식노트는 엔트리 단위로 쌓인다는 원래 컨셉과 맞고(decisions.md #26),
// 응답을 저장할 때 "이 엔트리의 메모"가 명확해서 startEditNote와 같은 저장 경로를 그대로 쓸 수 있다.
// 저장은 기존 메모를 지우지 않고 뒤에 이어붙인다 — 덮어써서 이전 메모가 날아가는 걸 막기 위함.
// T2 미리 정의 질문 — 쿼리 빌더 철학("선택이 문장을 만든다")을 카드 레벨에도 적용.
// 칩을 누르면 입력창에 문장이 채워지고, 사용자가 다듬어서 보낼 수 있다.
const ASK_PRESETS = [
  "배경과 히스토리를 알려줘",
  "수상 이력과 평단 평가는?",
  "이걸 좋아하면 다음에 뭘 들으면 좋아?",
  "최근 활동/발매 소식은?"
];

function startAskAI(card, entry) {
  if (card.querySelector(".ask-ai-box")) return; // 이미 열려 있으면 중복 생성 안 함

  const box = document.createElement("div");
  box.className = "ask-ai-box";
  box.innerHTML = `
    <div class="ask-ai-presets">${ASK_PRESETS.map(p =>
      `<button type="button" data-preset="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}</div>
    <input type="text" class="ask-ai-input" placeholder="직접 입력하거나 위에서 선택">
    <div class="ask-ai-actions">
      <button type="button" class="ask-ai-send">질문</button>
      <button type="button" class="ask-ai-cancel">닫기</button>
    </div>
    <p class="ask-ai-result" hidden></p>
    <button type="button" class="ask-ai-save" hidden>메모에 저장</button>
  `;
  card.appendChild(box);

  const input = box.querySelector(".ask-ai-input");
  box.querySelectorAll(".ask-ai-presets button").forEach(btn => {
    btn.addEventListener("click", () => { input.value = btn.dataset.preset; input.focus(); });
  });
  const resultEl = box.querySelector(".ask-ai-result");
  const saveBtn = box.querySelector(".ask-ai-save");
  let lastAnswer = "";

  box.querySelector(".ask-ai-send").addEventListener("click", async () => {
    const question = input.value.trim();
    if (!question) return;
    resultEl.hidden = false;
    resultEl.textContent = "물어보는 중...";
    saveBtn.hidden = true;

    // T2(지식) — 쿼리 빌더 템플릿 경유 (마일스톤 1.5.8에서 전환)
    const { text, error } = await askClaude(buildQuery({
      type: "knowledge",
      target: `${entry.title} — ${formatCredits(entry.credits)}`,
      question,
      hint: "",
      today: todayStr()
    }));
    if (error) {
      resultEl.textContent = error;
      return;
    }
    lastAnswer = text;
    resultEl.textContent = text;
    saveBtn.hidden = false;
  });

  saveBtn.addEventListener("click", () => {
    const merged = (entry.note ? entry.note + "\n\n" : "") + lastAnswer;
    if (isLocalId(entry.id)) {
      const idx = localEntries.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        localEntries[idx] = { ...localEntries[idx], note: merged };
        saveLocalEntries(localEntries);
      }
    } else {
      overrides[entry.id] = { ...(overrides[entry.id] || {}), note: merged };
      saveOverrides(overrides);
    }
    render();
  });

  box.querySelector(".ask-ai-cancel").addEventListener("click", () => box.remove());
}

function startEditNote(card, entry) {
  const noteEl = card.querySelector("[data-note]");
  const textarea = document.createElement("textarea");
  textarea.className = "note-edit";
  textarea.value = entry.note || "";
  noteEl.replaceWith(textarea);
  textarea.focus();
  textarea.addEventListener("blur", () => {
    const value = textarea.value.trim();
    if (isLocalId(entry.id)) {
      const idx = localEntries.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        localEntries[idx] = { ...localEntries[idx], note: value };
        saveLocalEntries(localEntries);
      }
    } else {
      overrides[entry.id] = { ...(overrides[entry.id] || {}), note: value };
      saveOverrides(overrides);
    }
    render();
  });
}

function deleteLocalEntry(id) {
  localEntries = localEntries.filter(e => e.id !== id);
  saveLocalEntries(localEntries);
  renderFilters();
  render();
}

function render() {
  const list = document.getElementById("entry-list");
  list.innerHTML = "";
  const merged = mergedEntries();
  const filtered = merged.filter(matchesFilters);
  document.getElementById("count").textContent = `${filtered.length} / ${merged.length}개 표시 중`;
  filtered.forEach(entry => list.appendChild(renderCard(entry)));
  renderRecommend(merged);
}

function renderRecommend(merged) {
  const box = document.getElementById("recommend-list");
  const heading = document.getElementById("recommend-heading");
  if (!box) return; // index.html에 아직 섹션이 없으면 조용히 건너뜀
  const excludeIds = logs.filter(l => l.date === todayStr()).map(l => l.entryId);
  const picks = recommend(merged, [...activeTags], { limit: 3, excludeIds });
  heading.textContent = activeTags.size > 0
    ? `"${[...activeTags].join(", ")}" 태그 추천`
    : "오늘의 추천 (취향 · 교양 · 가족 골고루, 오늘 들은 건 뒤로)";
  box.innerHTML = "";
  picks.forEach(entry => box.appendChild(renderCard(entry)));
}

function renderFilters() {
  const intents = ["all", "taste", "explore", "family"];
  const intentBar = document.getElementById("intent-filter");
  intentBar.innerHTML = intents
    .map(i => `<button data-intent="${i}" class="${i === activeIntent ? "active" : ""}">${i === "all" ? "전체" : INTENT_LABELS[i]}</button>`)
    .join("");
  intentBar.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeIntent = btn.dataset.intent;
      renderFilters();
      render();
    });
  });

  const allTags = [...new Set(mergedEntries().flatMap(e => e.tags))].sort();
  const tagBar = document.getElementById("tag-filter");
  tagBar.innerHTML = allTags
    .map(t => `<button data-tag="${escapeHtml(t)}" class="${activeTags.has(t) ? "active" : ""}">${escapeHtml(t)}</button>`)
    .join("");
  tagBar.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tag;
      if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
      renderFilters();
      render();
    });
  });
}

// ---- 새 항목 추가 폼 ----

function initAddForm() {
  const toggleBtn = document.getElementById("add-toggle");
  const form = document.getElementById("add-form");
  const errorEl = document.getElementById("f-error");

  toggleBtn.addEventListener("click", () => { form.hidden = !form.hidden; });

  document.getElementById("f-save").addEventListener("click", () => {
    const title = document.getElementById("f-title").value.trim();
    const performer = document.getElementById("f-performer").value.trim();
    if (!title || !performer) {
      errorEl.textContent = "제목과 연주자는 필수입니다.";
      return;
    }
    errorEl.textContent = "";

    const tags = document.getElementById("f-tags").value
      .split(",").map(t => t.trim()).filter(Boolean);

    const entry = {
      id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      type: "track",
      title,
      credits: { performer },
      spotifyUrl: null,
      tags,
      intent: document.getElementById("f-intent").value,
      note: document.getElementById("f-note").value.trim(),
      addedAt: new Date().toISOString().slice(0, 10)
    };

    localEntries.push(entry);
    saveLocalEntries(localEntries);

    document.getElementById("f-title").value = "";
    document.getElementById("f-performer").value = "";
    document.getElementById("f-tags").value = "";
    document.getElementById("f-note").value = "";
    form.hidden = true;

    renderFilters();
    render();
  });
}

// ---- 내보내기 (수동 동기화용) ----

function initExport() {
  const toggleBtn = document.getElementById("export-toggle");
  const box = document.getElementById("export-box");
  toggleBtn.addEventListener("click", () => {
    box.hidden = !box.hidden;
    if (!box.hidden) {
      // API 키는 의도적으로 포함하지 않는다 — localEntries/overrides만 seed.json 동기화 대상.
      box.value = JSON.stringify({ localEntries, overrides }, null, 2);
      box.select();
    }
  });
}

// ---- 재생 (P2·P3, decisions.md #39~40) ----
//
// 현재 탭/필터 결과 중 YouTube 링크가 있는 엔트리들이 재생 큐가 된다.
// YouTube IFrame Player API — 곡이 끝나면(ENDED) 청취 로그를 남기고 자동으로 다음 곡.
// 화면 유지는 Screen Wake Lock API (미지원 브라우저에선 조용히 무시 — APK에선 네이티브로 보강 예정).
// 절전 화면(P3)은 순수 검정 오버레이가 플레이어 바만 남기고 화면을 덮는다 (플레이어는 정책상 항상 노출).

let playQueue = [];      // [{ entry, videoId }]
let playIndex = -1;
let ytPlayer = null;
let ytApiLoading = false;
let wakeLockSentinel = null;

// 순수 함수 — URL에서 YouTube 영상 id 추출 (watch?v= / youtu.be / embed / shorts / music.youtube)
function youtubeIdFrom(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function firstYoutubeId(entry) {
  for (const l of (entry.links || [])) {
    const id = youtubeIdFrom(l.url);
    if (id) return id;
  }
  return null;
}

function buildPlayQueue() {
  return mergedEntries()
    .filter(matchesFilters)
    .map(e => ({ entry: e, videoId: firstYoutubeId(e) }))
    .filter(x => x.videoId);
}

function ensureYtApi(cb) {
  if (window.YT && window.YT.Player) { cb(); return; }
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { if (prev) prev(); cb(); };
  if (!ytApiLoading) {
    ytApiLoading = true;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }
}

async function requestWakeLock() {
  try {
    if (!wakeLockSentinel && navigator.wakeLock) {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => { wakeLockSentinel = null; });
    }
  } catch { /* 미지원/거부 — 재생은 계속 */ }
}
function releaseWakeLock() {
  try { if (wakeLockSentinel) { wakeLockSentinel.release(); wakeLockSentinel = null; } } catch {}
}

function updatePlayerInfo() {
  const cur = playQueue[playIndex];
  if (!cur) return;
  const sub = `${formatCredits(cur.entry.credits)} · ${playIndex + 1}/${playQueue.length}`;
  document.getElementById("pl-title").textContent = cur.entry.title;
  document.getElementById("pl-sub").textContent = sub;
  document.getElementById("pm-title").textContent = cur.entry.title;
  document.getElementById("pm-sub").textContent = sub;
}

function loadCurrent() {
  ytPlayer.loadVideoById(playQueue[playIndex].videoId);
  updatePlayerInfo();
}

function nextTrack() {
  if (playIndex < playQueue.length - 1) { playIndex++; loadCurrent(); }
  else stopPlayer();
}
function prevTrack() {
  if (playIndex > 0) { playIndex--; loadCurrent(); }
}

function stopPlayer() {
  if (ytPlayer) { try { ytPlayer.stopVideo(); } catch {} }
  document.getElementById("player-bar").hidden = true;
  document.getElementById("play-mode").hidden = true;
  document.body.classList.remove("has-player");
  releaseWakeLock();
}

function startQueue() {
  const statusEl = document.getElementById("play-status");
  playQueue = buildPlayQueue();
  if (playQueue.length === 0) {
    statusEl.textContent = "재생할 유튜브 링크가 없습니다 — 카드의 \"링크 찾기\"나 탐구(들을·볼 것 찾기)로 먼저 채워주세요.";
    return;
  }
  statusEl.textContent = "";
  playIndex = 0;
  document.getElementById("player-bar").hidden = false;
  document.body.classList.add("has-player");
  ensureYtApi(() => {
    if (!ytPlayer) {
      ytPlayer = new YT.Player("yt-holder", {
        width: "100%",
        height: "200",
        videoId: playQueue[0].videoId,
        playerVars: { autoplay: 1, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              logListen(playQueue[playIndex].entry.id); // 끝까지 들었을 때만 청취 로그
              nextTrack();
            } else if (e.data === YT.PlayerState.PLAYING) {
              requestWakeLock();
            }
          }
        }
      });
      updatePlayerInfo();
    } else {
      loadCurrent();
    }
  });
}

function initPlayer() {
  document.getElementById("play-all").addEventListener("click", startQueue);
  document.getElementById("pl-prev").addEventListener("click", prevTrack);
  document.getElementById("pl-next").addEventListener("click", nextTrack);
  document.getElementById("pl-close").addEventListener("click", stopPlayer);
  document.getElementById("pl-dark").addEventListener("click", () => {
    document.getElementById("play-mode").hidden = false;
  });
  document.getElementById("play-mode").addEventListener("click", () => {
    document.getElementById("play-mode").hidden = true;
  });
  // 화면 복귀 시 wake lock 재획득 (브라우저가 백그라운드 전환 때 자동 해제하므로)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !document.getElementById("player-bar").hidden) {
      requestWakeLock();
    }
  });
}

// ---- 링크 찾기 (P1, decisions.md #41) — 엔트리별 T1 쿼리 자동 실행 ----

function attachLinkToEntry(entry, link) {
  const newLinks = [...(entry.links || []), link];
  if (isLocalId(entry.id)) {
    const idx = localEntries.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      localEntries[idx] = { ...localEntries[idx], links: newLinks };
      saveLocalEntries(localEntries);
    }
  } else {
    // seed 엔트리는 overrides 레이어로 — seed.json 자체는 불변 (decisions.md #14)
    overrides[entry.id] = { ...(overrides[entry.id] || {}), links: newLinks };
    saveOverrides(overrides);
  }
  render();
}

function startFindLinks(card, entry) {
  if (card.querySelector(".find-links-box")) return;

  const box = document.createElement("div");
  box.className = "ask-ai-box find-links-box";
  box.innerHTML = `
    <p class="ask-ai-result">유튜브 링크 찾는 중...</p>
    <button type="button" class="ask-ai-cancel" style="align-self:flex-start">닫기</button>
  `;
  card.appendChild(box);
  box.querySelector(".ask-ai-cancel").addEventListener("click", () => box.remove());

  const resultEl = box.querySelector(".ask-ai-result");
  const target = entry.credits.performer && entry.credits.performer !== entry.title
    ? `${entry.credits.performer} "${entry.title}"`
    : entry.title;

  askClaude(buildQuery({
    type: "links",
    target,
    form: "공식 음원 영상 또는 대표 라이브/커버 영상",
    period: "any",
    count: 3,
    today: todayStr(),
    hint: "YouTube 링크 위주"
  })).then(({ text, error }) => {
    if (error) { resultEl.textContent = error; return; }
    const items = parseLinkResults(text).filter(it => youtubeIdFrom(it.url));
    if (items.length === 0) { resultEl.textContent = "유튜브 링크를 못 찾았습니다:\n" + text; return; }
    resultEl.remove();
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "ex-item";
      row.innerHTML = `
        <div class="ex-item-main">
          <b>${escapeHtml(item.title)}</b>
          <span class="ex-item-sub">${escapeHtml(item.channel)} · ${escapeHtml(item.date)}</span>
        </div>
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">확인</a>
        <button type="button" class="ex-add">붙이기</button>`;
      row.querySelector(".ex-add").addEventListener("click", () => {
        attachLinkToEntry(entry, { label: `${item.channel} ${item.date}`.trim(), url: item.url });
      });
      box.insertBefore(row, box.querySelector(".ask-ai-cancel"));
    });
  });
}

// ---- 탐구 UI — 쿼리 빌더 (마일스톤 1.5.8) ----
//
// Step1 답 유형 → Step2~3 유형별 선택(대상은 내 데이터에서 자동 생성) → Step4 자유 한 줄
// → buildQuery()로 문장 조립 → 미리보기(수정 가능) → 전송 → 유형별 파싱 → 행선지.
// T1/T3 결과는 항목별 "+추가"로 골라서만 엔트리화 (decisions.md #32).

const EX_TYPES = [
  { key: "links", label: "들을·볼 것 찾기" },
  { key: "discover", label: "새 음악 추천" },
  { key: "brief", label: "요즘 소식 브리핑" },
  { key: "free", label: "자유 질문" }
];
const EX_FORMS = [ // T1 형태 — value가 태그로도 쓰임
  { value: "방송커버", query: "방송 커버 영상" },
  { value: "라이브", query: "라이브 무대 영상" },
  { value: "뮤비", query: "뮤직비디오" },
  { value: "발매", query: "정규/싱글 발매곡" }
];
let exType = null;

function exSelect(id, label, options) {
  // options: [{value, label}]
  return `<label class="ex-field">${label}
    <select id="${id}">${options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("")}</select>
  </label>`;
}

function performerNames() {
  const names = mergedEntries().map(e => e.credits.performer || e.title);
  return [...new Set(names)];
}

function renderExploreControls() {
  const box = document.getElementById("ex-controls");
  const freebox = document.getElementById("ex-freebox");
  const hint = document.getElementById("ex-hint");
  const buildBtn = document.getElementById("ex-build");
  const sendBtn = document.getElementById("ex-send");
  const preview = document.getElementById("ex-preview");

  preview.hidden = true;
  sendBtn.hidden = true;
  document.getElementById("ex-results").innerHTML = "";
  document.getElementById("ex-status").textContent = "";

  if (!exType) { box.innerHTML = ""; freebox.hidden = true; hint.hidden = true; buildBtn.hidden = true; return; }

  if (exType === "free") {
    box.innerHTML = "";
    freebox.hidden = false;
    hint.hidden = true;
    buildBtn.hidden = true;
    sendBtn.hidden = false;
    return;
  }

  freebox.hidden = true;
  hint.hidden = false;
  buildBtn.hidden = false;

  if (exType === "links") {
    const artists = performerNames().map(n => ({ value: n, label: n }));
    box.innerHTML =
      exSelect("ex-target", "대상", [...artists, { value: "__custom__", label: "직접 입력..." }]) +
      `<input id="ex-target-custom" class="ex-hint" placeholder="아티스트/그룹 이름" hidden>` +
      exSelect("ex-form", "형태", EX_FORMS.map(f => ({ value: f.value, label: f.query }))) +
      exSelect("ex-period", "기간", [
        { value: "1y", label: "최근 1년" }, { value: "3y", label: "최근 3년" }, { value: "any", label: "기간 무관" }
      ]) +
      exSelect("ex-count", "개수", [
        { value: "5", label: "5개" }, { value: "10", label: "10개" }, { value: "3", label: "3개" }
      ]);
    document.getElementById("ex-target").addEventListener("change", e => {
      document.getElementById("ex-target-custom").hidden = e.target.value !== "__custom__";
    });
  } else if (exType === "discover") {
    const tasteArtists = mergedEntries().filter(e => e.intent === "taste").map(e => e.credits.performer || e.title);
    const directions = [
      { value: "내 취향 전체 기반", label: "전체 취향 기반" },
      ...[...new Set(tasteArtists)].map(n => ({ value: `"${n}" 계열 (비슷한 감성/보컬)`, label: `${n} 계열` })),
      { value: "클래식 (2016년 이후 발매, 유명 연주자/오케스트라, 한국 음악가 선호)", label: "클래식 탐구" },
      { value: "딸이 좋아하는 아이돌 주변의 요즘 그룹", label: "딸 취향 주변" }
    ];
    box.innerHTML =
      exSelect("ex-target", "방향", directions) +
      exSelect("ex-count", "개수", [{ value: "3", label: "3개" }, { value: "5", label: "5개" }]);
  } else if (exType === "brief") {
    box.innerHTML =
      exSelect("ex-region", "지역", [
        { value: "한국", label: "한국" }, { value: "미국", label: "미국" }, { value: "세계", label: "세계" }
      ]) +
      exSelect("ex-scope", "범위", [
        { value: "K-pop", label: "K-pop" }, { value: "클래식", label: "클래식" }, { value: "전체", label: "전체" }
      ]) +
      exSelect("ex-period", "기간", [
        { value: "1m", label: "최근 1개월" }, { value: "3m", label: "최근 3개월" }, { value: "1y", label: "최근 1년" }
      ]) +
      exSelect("ex-count", "개수", [{ value: "5", label: "5개" }, { value: "3", label: "3개" }]);
  }
}

function exBuildSelections() {
  const hint = document.getElementById("ex-hint").value.trim();
  const today = todayStr();
  if (exType === "links") {
    let target = document.getElementById("ex-target").value;
    if (target === "__custom__") target = document.getElementById("ex-target-custom").value.trim();
    const formValue = document.getElementById("ex-form").value;
    const form = EX_FORMS.find(f => f.value === formValue);
    return {
      type: "links", target, form: form.query, formTag: form.value,
      period: document.getElementById("ex-period").value,
      count: parseInt(document.getElementById("ex-count").value, 10),
      hint, today
    };
  }
  if (exType === "discover") {
    const merged = mergedEntries();
    return {
      type: "discover",
      target: document.getElementById("ex-target").value,
      profile: tasteProfile(merged, logs),
      excludeTitles: merged.map(e => e.title),
      count: parseInt(document.getElementById("ex-count").value, 10),
      hint, today
    };
  }
  if (exType === "brief") {
    return {
      type: "brief",
      region: document.getElementById("ex-region").value,
      scope: document.getElementById("ex-scope").value,
      period: document.getElementById("ex-period").value,
      count: parseInt(document.getElementById("ex-count").value, 10),
      hint, today
    };
  }
  return null;
}

function linkify(text) {
  // escape 후 URL만 앵커로 — 순서 중요 (먼저 escape해야 주입 안전)
  return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function exAddLinkEntry(item, formTag) {
  const merged = mergedEntries();
  const existing = merged.find(e => (e.credits.performer || e.title) === item.artist);
  const entry = {
    id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    type: "track",
    title: item.title,
    credits: { performer: item.artist },
    spotifyUrl: null,
    links: [{ label: `${item.channel} ${item.date}`.trim(), url: item.url }],
    tags: formTag ? [formTag] : [],
    intent: existing ? existing.intent : "taste",
    note: "",
    addedAt: todayStr()
  };
  localEntries.push(entry);
  saveLocalEntries(localEntries);
  renderFilters();
  render();
}

function exAddDiscoverEntry(item) {
  const entry = {
    id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    type: "track",
    title: item.title,
    credits: { performer: item.artist },
    spotifyUrl: null,
    tags: item.tags,
    intent: "explore",
    note: item.reason,
    addedAt: todayStr()
  };
  localEntries.push(entry);
  saveLocalEntries(localEntries);
  renderFilters();
  render();
}

function renderExploreResults(text) {
  const box = document.getElementById("ex-results");
  box.innerHTML = "";

  if (exType === "links") {
    const items = parseLinkResults(text);
    const formTag = document.getElementById("ex-form").value;
    if (items.length === 0) {
      box.innerHTML = `<p class="ex-raw">${linkify(text)}</p>`;
      return;
    }
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "ex-item";
      row.innerHTML = `
        <div class="ex-item-main">
          <b>${escapeHtml(item.title)}</b> — ${escapeHtml(item.artist)}
          <span class="ex-item-sub">${escapeHtml(item.channel)} · ${escapeHtml(item.date)}</span>
        </div>
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">열기</a>
        <button type="button" class="ex-add">+추가</button>`;
      row.querySelector(".ex-add").addEventListener("click", () => {
        exAddLinkEntry(item, formTag);
        row.querySelector(".ex-add").textContent = "추가됨";
        row.querySelector(".ex-add").disabled = true;
      });
      box.appendChild(row);
    });
  } else if (exType === "discover") {
    const items = parseDiscoverResults(text);
    if (items.length === 0) {
      box.innerHTML = `<p class="ex-raw">${linkify(text)}</p>`;
      return;
    }
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "ex-item";
      row.innerHTML = `
        <div class="ex-item-main">
          <b>${escapeHtml(item.title)}</b> — ${escapeHtml(item.artist)}
          <span class="ex-item-sub">${escapeHtml(item.reason)}</span>
          <span class="ex-item-sub">${item.tags.map(t => escapeHtml(t)).join(" · ")}</span>
        </div>
        <button type="button" class="ex-add">+추가</button>`;
      row.querySelector(".ex-add").addEventListener("click", () => {
        exAddDiscoverEntry(item);
        row.querySelector(".ex-add").textContent = "추가됨";
        row.querySelector(".ex-add").disabled = true;
      });
      box.appendChild(row);
    });
  } else {
    // brief / free — 읽을거리로 표시 (링크는 클릭 가능)
    box.innerHTML = `<p class="ex-raw">${linkify(text)}</p>`;
  }
}

function initExplore() {
  const typeBar = document.getElementById("ex-type");
  typeBar.innerHTML = EX_TYPES
    .map(t => `<button data-extype="${t.key}">${t.label}</button>`)
    .join("");
  typeBar.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      exType = btn.dataset.extype;
      typeBar.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
      renderExploreControls();
    });
  });

  const preview = document.getElementById("ex-preview");
  const statusEl = document.getElementById("ex-status");
  const sendBtn = document.getElementById("ex-send");

  document.getElementById("ex-build").addEventListener("click", () => {
    const sel = exBuildSelections();
    if (!sel || (sel.type === "links" && !sel.target)) {
      statusEl.textContent = "대상을 선택하거나 입력해주세요.";
      return;
    }
    statusEl.textContent = "";
    preview.value = buildQuery(sel);
    preview.hidden = false;
    sendBtn.hidden = false;
  });

  sendBtn.addEventListener("click", async () => {
    const prompt = exType === "free"
      ? document.getElementById("ex-free").value.trim()
      : preview.value.trim();
    if (!prompt) return;
    statusEl.textContent = "물어보는 중...";
    document.getElementById("ex-results").innerHTML = "";
    const { text, error } = await askClaude(prompt);
    if (error) { statusEl.textContent = error; return; }
    statusEl.textContent = "";
    renderExploreResults(text);
  });
}

// ---- 설정 (API 키 입력/저장/삭제, 마일스톤 1.5.2) ----

function initSettings() {
  const toggleBtn = document.getElementById("settings-toggle");
  const box = document.getElementById("settings-box");
  const input = document.getElementById("f-apikey");
  const statusEl = document.getElementById("apikey-status");

  function refreshStatus() {
    const key = loadApiKey();
    statusEl.textContent = key ? `저장됨 (••••${key.slice(-4)})` : "저장된 키 없음";
  }

  toggleBtn.addEventListener("click", () => {
    box.hidden = !box.hidden;
    if (!box.hidden) refreshStatus();
  });

  document.getElementById("apikey-save").addEventListener("click", () => {
    const key = input.value.trim();
    if (!key) return;
    saveApiKey(key);
    input.value = "";
    refreshStatus();
  });

  document.getElementById("apikey-delete").addEventListener("click", () => {
    deleteApiKey();
    input.value = "";
    refreshStatus();
  });

  refreshStatus();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

// Node(test_recommend.js)에서 순수 함수만 불러다 쓰기 위한 내보내기.
// 브라우저에서 <script src>로 로드될 땐 module이 없어서 그냥 건너뛴다 — 빌드 도구 없이도 동작.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    recommend,
    scoreEntry: (entry, tags) => tags.filter(t => entry.tags.includes(t)).length,
    tasteProfile,
    buildQuery, shiftYears, parseLinkResults, parseDiscoverResults,
    youtubeIdFrom
  };
}

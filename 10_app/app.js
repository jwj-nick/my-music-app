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
const LS_YTKEY = "mma_yt_key";   // YouTube Data API 키 — 같은 원칙. 링크 찾기/T1의 기본 엔진 (decisions.md #42)
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // 개인 앱 운영비 0원 원칙(decisions.md #25) — 품질이 아쉬우면 이 상수만 교체
const CLAUDE_MAX_TOKENS = 1600; // T1 10개+추천이유 응답이 잘리지 않게 (2026-08-25 상향)
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

// PWA 서비스 워커 등록 (Phase 3 준비, 2026-08-30) — 실패해도 앱 동작엔 영향 없음
// (구버전 브라우저, file:// 로컬 열람 등에서도 조용히 무시되게).
function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

async function init() {
  initTheme();
  registerServiceWorker();
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
  initPlaylists();
  renderWeeklyBrief();
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
function loadYtKey() { return localStorage.getItem(LS_YTKEY) || ""; }
function saveYtKey(key) { localStorage.setItem(LS_YTKEY, key); }
function deleteYtKey() { localStorage.removeItem(LS_YTKEY); }

// ---- YouTube Data API 직접 검색 (decisions.md #42) ----
//
// "영상 목록 찾기"는 AI 웹검색보다 유튜브 자체 검색 엔진이 압도적으로 낫다 —
// 유튜브 앱에서 검색하는 것과 같은 결과(제목·채널·업로드일·videoId)가 구조화되어 온다.
// 무료 할당량: 하루 검색 100회. AI(askClaude)는 지식/추천/브리핑에만 쓰고, T1은 이쪽이 기본.

function decodeEntities(str) {
  const ta = document.createElement("textarea");
  ta.innerHTML = str;
  return ta.value;
}

async function searchYouTube(query, opts = {}) {
  const key = loadYtKey();
  if (!key) return { error: "설정에서 YouTube API 키를 먼저 입력해주세요." };
  const params = new URLSearchParams({
    part: "snippet", type: "video",
    maxResults: String(opts.maxResults || 10),
    q: query, key
  });
  if (opts.publishedAfter) params.set("publishedAfter", opts.publishedAfter);
  let res;
  try {
    res = await fetch("https://www.googleapis.com/youtube/v3/search?" + params.toString());
  } catch (err) {
    return { error: "네트워크 오류: " + err.message };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { error: `YouTube API 오류 (${res.status}): ${bodyText.slice(0, 200)}` };
  }
  const data = await res.json();
  const items = (data.items || [])
    .filter(it => it.id && it.id.videoId)
    .map(it => ({
      title: decodeEntities(it.snippet.title),
      artist: "", // 검색 결과엔 아티스트 필드가 없음 — 호출부가 대상 이름으로 채움
      channel: decodeEntities(it.snippet.channelTitle),
      date: (it.snippet.publishedAt || "").slice(0, 10),
      reason: "",
      url: "https://www.youtube.com/watch?v=" + it.id.videoId
    }));
  return { items };
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

// 재생/시청 링크 표시 — Spotify는 실제 URL이 있을 때만 보여준다(2026-08-29).
// 예전엔 없으면 검색 페이지로 뭉뚱그려 보냈는데, Nick 실사용에서 "안 쓸 거고 불필요"로 확인 —
// YouTube 재생(P2)이 기본 동선이 된 지금은 Spotify가 있으면 보너스로만 노출하는 보조 링크.
function renderLinksHtml(entry) {
  const parts = [];
  if (entry.spotifyUrl) {
    parts.push(`<a href="${escapeHtml(entry.spotifyUrl)}" target="_blank" rel="noopener">Spotify</a>`);
  }
  (entry.links || []).forEach(l => {
    parts.push(`<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">▶ ${escapeHtml(l.label || "링크")}</a>`);
  });
  return parts.join(" ");
}

// 문자열 해시 — 아트 타일 색과 "오늘의 추천" 로테이션이 같은 방식을 쓴다(둘 다 결정적이어야 함).
function hashString(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
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
// opts.daySeed: "오늘의 추천"이 매일 같은 3개만 나오면 며칠 만에 지루해진다는 지적(2026-08-29)에
//   대한 답 — intent별 후보군 안에서 daySeed(보통 오늘 날짜 문자열)로 결정적으로 로테이션한다.
//   Math.random을 안 쓰는 이유는 여전히 같다: 같은 날엔 같은 결과가 나와야 테스트도 되고
//   하루 안에서 화면을 새로고침해도 추천이 안 흔들려야 한다. daySeed 없으면(테스트 등) 항상
//   첫 번째 후보 — 기존 동작과 100% 호환.
function recommend(pool, queryTags = [], opts = {}) {
  const limit = opts.limit || 3;
  const exclude = new Set(opts.excludeIds || []);

  if (queryTags.length === 0) {
    const seen = new Set();
    const picks = [];
    for (const intent of ["taste", "explore", "family"]) {
      const preferred = pool.filter(e => e.intent === intent && !seen.has(e.id) && !exclude.has(e.id));
      const fallback = pool.filter(e => e.intent === intent && !seen.has(e.id));
      const usable = preferred.length > 0 ? preferred : fallback;
      if (usable.length === 0) continue;
      const offset = opts.daySeed ? hashString(opts.daySeed + intent) % usable.length : 0;
      const found = usable[offset];
      picks.push(found); seen.add(found.id);
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
      `같은 곡은 한 번만 — 소스만 다른 중복은 제외하고, 서로 다른 곡/무대 위주로.`,
      `각 항목을 정확히 이 형식의 한 줄로 써줘:`,
      `곡명 | 아티스트 | 채널/방송 | 날짜 | 추천 이유(한 줄) | URL`,
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

function parseLinkResults(text) { // T1: 곡명|아티스트|채널|날짜|이유|URL — 같은 곡(제목+아티스트)은 첫 것만
  const seen = new Set();
  return parsePipeLines(text, 6)
    .filter(f => /^https?:\/\//.test(f[5]))
    .map(f => ({ title: f[0], artist: f[1], channel: f[2], date: f[3], reason: f[4], url: f[5] }))
    .filter(item => {
      const key = (item.title + "|" + item.artist).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseDiscoverResults(text) { // T3: 제목|아티스트|이유|태그
  return parsePipeLines(text, 4)
    .map(f => ({ title: f[0], artist: f[1], reason: f[2], tags: f[3].split(",").map(t => t.trim()).filter(Boolean) }));
}

// ---- 주간 브리핑 캐시 (2026-08-29) ----
//
// 방문할 때마다 새 API 호출을 하면 비용도 늘고 원치 않는 자동 호출이 생긴다 — 그래서 "일주일에
// 한 번, 누르면 생성, 그 결과를 캐시해두고 같은 주엔 계속 보여주기" 방식으로 비용을 통제하면서도
// 홈 화면이 매주 새로워지게 한다("며칠 쓰면 지루해진다"는 지적과 같은 맥락, decisions.md #46).
// weekKey는 달력 주 정확도까진 필요 없어서 "연도 + 그 해의 며칠째/7" 정도의 단순 계산으로 충분 —
// 이 함수는 recommend()류와 달리 순수성/테스트 대상이 아니라 실제 벽시계 시간을 다루는 게 목적이라
// new Date()를 직접 쓴다(이미 todayStr()도 같은 방식).
const LS_WEEKLY_BRIEF = "mma_weekly_brief";

function currentWeekKey() {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - start) / 86400000);
  return `${d.getFullYear()}-w${Math.floor(days / 7)}`;
}

function loadWeeklyBrief() { try { return JSON.parse(localStorage.getItem(LS_WEEKLY_BRIEF)); } catch { return null; } }
function saveWeeklyBrief(obj) { localStorage.setItem(LS_WEEKLY_BRIEF, JSON.stringify(obj)); }

function renderWeeklyBrief() {
  const body = document.getElementById("weekly-brief-body");
  if (!body) return;
  const cached = loadWeeklyBrief();
  const isFresh = cached && cached.weekKey === currentWeekKey();
  body.innerHTML = isFresh
    ? `<p class="ex-raw">${linkify(cached.text)}</p><button type="button" id="weekly-brief-refresh" class="ex-add">다시 생성</button>`
    : `<p class="count">이번 주 소식이 아직 없습니다.</p><button type="button" id="weekly-brief-refresh" class="ex-add">생성하기</button>`;
  document.getElementById("weekly-brief-refresh").addEventListener("click", generateWeeklyBrief);
}

async function generateWeeklyBrief() {
  const body = document.getElementById("weekly-brief-body");
  body.innerHTML = '<p class="count">생성 중...</p>';
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const fmt = d => d.toISOString().slice(0, 10);
  const prompt = buildQuery({
    type: "brief", region: "한국", scope: "전체", period: "any", count: 5,
    today: todayStr(), hint: `기간: ${fmt(weekAgo)} ~ ${fmt(today)}로 한정`
  });
  const { text, error } = await askClaude(prompt);
  if (error) { body.innerHTML = `<p class="ex-status">${escapeHtml(error)}</p><button type="button" id="weekly-brief-refresh" class="ex-add">다시 시도</button>`; document.getElementById("weekly-brief-refresh").addEventListener("click", generateWeeklyBrief); return; }
  saveWeeklyBrief({ weekKey: currentWeekKey(), text });
  renderWeeklyBrief();
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

// "추천에서 숨기기" — 오늘의 추천에 계속 뜨는 게 싫은 항목을 영구 제외한다 (마일스톤 P, 2026-08-29).
// excludeIds(오늘 들은 것)와는 다른 층 — 이건 하루 지나도 안 돌아온다.
const LS_HIDDEN = "mma_hidden_recs";
function loadHidden() { try { return JSON.parse(localStorage.getItem(LS_HIDDEN)) || []; } catch { return []; } }
function saveHidden(list) { localStorage.setItem(LS_HIDDEN, JSON.stringify(list)); }

// 아트 타일 (Phase 2) — 앨범아트 데이터가 없으므로 id 해시로 결정적 그라디언트 생성.
// 같은 엔트리는 항상 같은 색 (해시 기반이라 새로고침해도 안 바뀜).
function artTile(entry) {
  const h = hashString(entry.id) % 360;
  const h2 = (h + 40) % 360;
  const initial = (entry.title || "?").replace(/[\s"'(\[]/g, "").charAt(0) || "?";
  return `<div class="art" aria-hidden="true" style="background:linear-gradient(135deg, hsl(${h},38%,46%), hsl(${h2},45%,30%))">${escapeHtml(initial)}</div>`;
}

// 카드 접힘/펼침 상태 — 컬렉션이 늘어날수록 항상 펼친 카드는 스크롤 피로가 커진다는
// 지적(2026-08-29)에 대한 답. 세션 동안만 기억(새로고침하면 초기화, localStorage까진 불필요).
// "오늘의 추천"(forceExpanded)은 3개뿐이라 계속 펼친 채로 — 접었다 펴는 수고가 오히려 손해.
const expandedIds = new Set();

function renderCard(entry, opts = {}) {
  const expanded = opts.forceExpanded || expandedIds.has(entry.id);
  const card = document.createElement("div");
  card.className = "card" + (expanded ? " is-expanded" : "");
  const local = isLocalId(entry.id);
  const subLine = [entry.credits.performer, INTENT_LABELS[entry.intent] || entry.intent].filter(Boolean).join(" · ");
  card.innerHTML = `
    <div class="card-row" role="button" tabindex="0" aria-expanded="${expanded}"
         style="border-left:3px solid var(--intent-${entry.intent})">
      ${artTile(entry)}
      <div class="card-row-text">
        <b class="card-row-title">${escapeHtml(entry.title)}</b>
        <span class="card-row-sub">${escapeHtml(subLine)}</span>
      </div>
      ${opts.forceExpanded ? "" : `<span class="card-chevron" aria-hidden="true">▾</span>`}
    </div>
    <div class="card-detail" ${expanded ? "" : "hidden"}>
      <span class="intent-tag intent-${entry.intent}">${INTENT_LABELS[entry.intent] || entry.intent}</span>
      <p class="credits">${escapeHtml(formatCredits(entry.credits))}</p>
      <div class="tags">${entry.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      <p class="note" data-note>${entry.note ? escapeHtml(entry.note) : '<span class="muted">메모 없음</span>'}</p>
      ${renderLinksHtml(entry) ? `<p class="entry-links">${renderLinksHtml(entry)}</p>` : ""}
      ${listenSummary(entry.id) ? `<p class="listen-summary">${escapeHtml(listenSummary(entry.id))}</p>` : ""}
      <div class="card-actions">
        <button class="listen-btn" type="button">들었음</button>
        <button class="edit-note-btn" type="button">메모 편집</button>
        <button class="ask-ai-btn" type="button">AI에게 물어보기</button>
        <button class="find-links-btn" type="button">링크 찾기</button>
        ${opts.forceExpanded ? '<button class="hide-rec-btn" type="button">추천에서 숨기기</button>' : ""}
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
  if (opts.forceExpanded) {
    card.querySelector(".hide-rec-btn").addEventListener("click", () => {
      const hidden = loadHidden();
      hidden.push(entry.id);
      saveHidden(hidden);
      render();
    });
  } else {
    const row = card.querySelector(".card-row");
    const toggle = () => {
      if (expandedIds.has(entry.id)) expandedIds.delete(entry.id); else expandedIds.add(entry.id);
      render();
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
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
  card.querySelector(".card-detail").appendChild(box);

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
  const todayIds = logs.filter(l => l.date === todayStr()).map(l => l.entryId);
  const excludeIds = [...todayIds, ...loadHidden()]; // 오늘 들은 것 + 영구적으로 "숨기기"한 것
  const picks = recommend(merged, [...activeTags], { limit: 3, excludeIds, daySeed: todayStr() });
  heading.textContent = activeTags.size > 0
    ? `"${[...activeTags].join(", ")}" 태그 추천`
    : "오늘의 추천 (취향 · 교양 · 가족 골고루, 매일 조금씩 바뀜)";
  box.innerHTML = "";
  picks.forEach(entry => box.appendChild(renderCard(entry, { forceExpanded: true })));
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

// 큐를 받아 플레이어를 여는 공통 진입점 — 전체 재생(startQueue)과 미리듣기(previewVideo)가 공유
function openPlayerWithQueue(queue) {
  playQueue = queue;
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
              const cur = playQueue[playIndex];
              if (!cur.preview) logListen(cur.entry.id); // 끝까지 들었을 때만 청취 로그 (미저장 후보는 제외)
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

function startQueue() {
  const statusEl = document.getElementById("play-status");
  const queue = buildPlayQueue();
  if (queue.length === 0) {
    statusEl.textContent = "재생할 유튜브 링크가 없습니다 — 카드의 \"링크 찾기\"나 탐구(들을·볼 것 찾기)로 먼저 채워주세요.";
    return;
  }
  statusEl.textContent = "";
  openPlayerWithQueue(queue);
}

// ---- YouTube 앱으로 넘기기 (2026-08-29) ----
//
// 우리 임베드 플레이어는 화면이 켜져 있어야만 재생된다(YouTube 정책 — 무료 계정은 백그라운드
// 재생이 Premium 전용, 우리 임베드로 우회할 방법도 없고 시도하지 않는다). 진짜 다른 앱으로
// 전환하면서 계속 듣고 싶을 때의 현실적인 답은 "진짜 YouTube 앱에 넘기는 것" —
// watch_videos?video_ids=id1,id2,... 는 로그인 없이도 여러 영상을 임시 재생목록으로 열어준다.
function openInYoutubeApp(queue, fromIndex = 0) {
  const ids = queue.slice(fromIndex).map(q => q.videoId).filter(Boolean);
  if (ids.length === 0) return;
  window.open("https://www.youtube.com/watch_videos?video_ids=" + ids.join(","), "_blank", "noopener");
}

function startQueueInYoutubeApp() {
  const statusEl = document.getElementById("play-status");
  const queue = buildPlayQueue();
  if (queue.length === 0) {
    statusEl.textContent = "재생할 유튜브 링크가 없습니다 — 카드의 \"링크 찾기\"나 탐구(들을·볼 것 찾기)로 먼저 채워주세요.";
    return;
  }
  statusEl.textContent = "";
  openInYoutubeApp(queue, 0);
}

// 검색 결과 후보를 저장 전에 바로 들어보기 — 아직 엔트리가 아니면 preview 플래그로 로그 제외
function previewVideo(item, entry) {
  const videoId = youtubeIdFrom(item.url);
  if (!videoId) return;
  const pseudo = entry || { id: "preview", title: item.title, credits: { performer: item.artist } };
  openPlayerWithQueue([{ entry: pseudo, videoId, preview: !entry }]);
}

function initPlayer() {
  document.getElementById("play-all").addEventListener("click", startQueue);
  document.getElementById("play-all-yt").addEventListener("click", startQueueInYoutubeApp);
  document.getElementById("pl-prev").addEventListener("click", prevTrack);
  document.getElementById("pl-next").addEventListener("click", nextTrack);
  document.getElementById("pl-open-yt").addEventListener("click", () => openInYoutubeApp(playQueue, playIndex));
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

// ---- 플레이리스트 관리 (마일스톤 P4, 2026-08-29) ----
//
// "한번 리스트 만들면 저장·수정이 가능해야" — 지금 보고 있는 필터 결과를 이름 붙여 저장해두고,
// 나중에 그대로 다시 재생할 수 있게 한다. 기존 3레이어(seed/overrides/local) 패턴과 같은 자리에
// localStorage로 저장 — entryId 목록만 들고 있고, 실제 엔트리 데이터는 그때그때 mergedEntries()에서
// 찾아온다(플레이리스트가 데이터를 중복 보관하지 않음 — 엔트리가 나중에 수정돼도 리스트가 따라감).

const LS_PLAYLISTS = "mma_playlists";
let playlists = [];

function loadPlaylists() { try { return JSON.parse(localStorage.getItem(LS_PLAYLISTS)) || []; } catch { return []; } }
function savePlaylists(list) { localStorage.setItem(LS_PLAYLISTS, JSON.stringify(list)); }

function playlistQueue(pl) {
  const byId = new Map(mergedEntries().map(e => [e.id, e]));
  return pl.entryIds
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(entry => ({ entry, videoId: firstYoutubeId(entry) }))
    .filter(x => x.videoId);
}

function renderPlaylists() {
  const box = document.getElementById("playlist-list");
  if (!box) return;
  box.innerHTML = "";
  if (playlists.length === 0) {
    box.innerHTML = '<p class="count">아직 저장한 리스트가 없습니다 — 아래 "내 컬렉션"에서 필터를 고르고 "이 목록을 리스트로 저장"을 눌러보세요.</p>';
    return;
  }
  playlists.forEach(pl => {
    const row = document.createElement("div");
    row.className = "playlist-row";
    row.innerHTML = `
      <div class="playlist-row-main">
        <b class="playlist-name">${escapeHtml(pl.name)}</b>
        <span class="ex-item-sub">${pl.entryIds.length}곡</span>
      </div>
      <button type="button" class="pl-play" aria-label="재생">▶</button>
      <button type="button" class="pl-play-yt">YT 앱</button>
      <button type="button" class="pl-rename">이름변경</button>
      <button type="button" class="pl-delete">삭제</button>
    `;
    row.querySelector(".pl-play").addEventListener("click", () => {
      const queue = playlistQueue(pl);
      if (queue.length === 0) { document.getElementById("play-status").textContent = "이 리스트엔 재생 가능한 링크가 없습니다."; return; }
      openPlayerWithQueue(queue);
    });
    row.querySelector(".pl-play-yt").addEventListener("click", () => {
      const queue = playlistQueue(pl);
      if (queue.length === 0) { document.getElementById("play-status").textContent = "이 리스트엔 재생 가능한 링크가 없습니다."; return; }
      openInYoutubeApp(queue, 0);
    });
    row.querySelector(".pl-rename").addEventListener("click", () => {
      const nameEl = row.querySelector(".playlist-name");
      const input = document.createElement("input");
      input.type = "text";
      input.value = pl.name;
      input.className = "ex-hint";
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        pl.name = input.value.trim() || pl.name;
        savePlaylists(playlists);
        renderPlaylists();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", e => { if (e.key === "Enter") input.blur(); });
    });
    row.querySelector(".pl-delete").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.confirm !== "1") {
        btn.dataset.confirm = "1";
        btn.textContent = "정말 삭제?";
        setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "삭제"; }, 3000);
        return;
      }
      playlists = playlists.filter(p => p.id !== pl.id);
      savePlaylists(playlists);
      renderPlaylists();
    });
    box.appendChild(row);
  });
}

function initPlaylists() {
  playlists = loadPlaylists();
  renderPlaylists();

  const saveBox = document.getElementById("save-playlist-box");
  const nameInput = document.getElementById("pl-name-input");

  document.getElementById("save-playlist").addEventListener("click", () => {
    saveBox.hidden = !saveBox.hidden;
    if (!saveBox.hidden) nameInput.focus();
  });

  document.getElementById("pl-name-save").addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const ids = mergedEntries().filter(matchesFilters).map(e => e.id);
    if (ids.length === 0) {
      document.getElementById("play-status").textContent = "저장할 항목이 없습니다 — 필터 결과가 비어 있습니다.";
      return;
    }
    playlists.push({ id: "pl-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), name, entryIds: ids, createdAt: todayStr() });
    savePlaylists(playlists);
    nameInput.value = "";
    saveBox.hidden = true;
    renderPlaylists();
  });
}

// ---- 링크 찾기 (P1, decisions.md #41) — 엔트리별 T1 쿼리 자동 실행 ----

// 카드를 통째로 다시 그리지 않고(render()) 그 카드의 링크 표시만 즉석에서 갱신한다.
// render()를 부르면 지금 열려 있는 "링크 찾기" 결과 박스까지 같이 사라져서, 어디에 뭘 붙였는지
// 확인이 안 되던 문제(2026-08-29, Nick 리포트)의 원인이었다 — 그 자리에서 바로 보이게 고쳤다.
function patchCardLinks(card, entry) {
  let box = card.querySelector(".card-detail .entry-links");
  const html = renderLinksHtml(entry);
  if (!html) return;
  if (!box) {
    box = document.createElement("p");
    box.className = "entry-links";
    card.querySelector(".card-detail [data-note]").insertAdjacentElement("afterend", box);
  }
  box.innerHTML = html;
}

function attachLinkToEntry(entry, link, card) {
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
  entry.links = newLinks; // 지금 화면에 떠 있는 entry 객체도 갱신 — 같은 카드에서 또 찾기를 눌러도 반영되게
  if (card) patchCardLinks(card, entry);
}

// 결과를 한 번에 다 보여주지 않고 10개씩 "더 보기"로 — 그래도 API 호출은 이미 끝난 뒤라
// 추가 비용이 없다. YouTube API는 한 번 호출에 최대 50개까지 오고 요청 개수와 무관하게
// 같은 비용(검색 1회 = 100 유닛)이라, 애초에 넉넉히 받아두고 화면에서만 나눠 보여주는 게
// "더 보기"를 API 재호출 없이 구현하는 가장 저렴한 방법이다 (2026-08-29).
function renderLinkCandidates(box, items, entry, card, pageSize = 10) {
  const cancelBtn = box.querySelector(".ask-ai-cancel");
  let shown = 0;
  let moreBtn = null;

  function addRow(item) {
    const row = document.createElement("div");
    row.className = "ex-item ex-item--compact";
    row.innerHTML = `
      <div class="ex-item-main">
        <b>${escapeHtml(item.title)}</b>
        <span class="ex-item-sub">${escapeHtml(item.channel)} · ${escapeHtml(item.date)}${item.reason ? " — " + escapeHtml(item.reason) : ""}</span>
      </div>
      <button type="button" class="ex-play" aria-label="미리듣기">▶</button>
      <button type="button" class="ex-add">붙이기</button>`;
    row.querySelector(".ex-play").addEventListener("click", () => previewVideo(item, entry));
    row.querySelector(".ex-add").addEventListener("click", () => {
      attachLinkToEntry(entry, { label: `${item.channel} ${item.date}`.trim(), url: item.url }, card);
      row.querySelector(".ex-add").textContent = "✓ 카드에 추가됨";
      row.querySelector(".ex-add").disabled = true;
    });
    box.insertBefore(row, moreBtn || cancelBtn);
  }

  function showMore() {
    const next = items.slice(shown, shown + pageSize);
    next.forEach(addRow);
    shown += next.length;
    if (moreBtn) {
      if (shown >= items.length) { moreBtn.remove(); moreBtn = null; }
      else moreBtn.textContent = `더 보기 (${items.length - shown}개 더)`;
    }
  }

  if (items.length > pageSize) {
    moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "ex-add";
    box.insertBefore(moreBtn, cancelBtn);
    moreBtn.addEventListener("click", showMore);
  }
  showMore();
}

function startFindLinks(card, entry) {
  if (card.querySelector(".find-links-box")) return;

  const box = document.createElement("div");
  box.className = "ask-ai-box find-links-box";
  box.innerHTML = `
    <p class="ask-ai-result">유튜브에서 찾는 중...</p>
    <button type="button" class="ask-ai-cancel" style="align-self:flex-start">닫기</button>
  `;
  card.querySelector(".card-detail").appendChild(box);
  box.querySelector(".ask-ai-cancel").addEventListener("click", () => box.remove());

  const resultEl = box.querySelector(".ask-ai-result");
  const performer = entry.credits.performer || entry.title;
  const query = performer !== entry.title && entry.type === "track"
    ? `${performer} ${entry.title}`
    : performer;

  if (loadYtKey()) {
    // 기본 경로: YouTube 자체 검색 — 유튜브에서 직접 검색하는 것과 같은 품질 (decisions.md #42)
    searchYouTube(query, { maxResults: 25 }).then(({ items, error }) => {
      if (error) { resultEl.textContent = error; return; }
      if (!items.length) { resultEl.textContent = "검색 결과가 없습니다."; return; }
      resultEl.remove();
      items.forEach(it => { it.artist = performer; });
      renderLinkCandidates(box, items, entry, card);
    });
    return;
  }

  // 폴백: AI 웹검색 (YouTube 키가 없을 때) — 품질이 낮으니 키 등록 안내를 함께
  resultEl.textContent = "AI 웹검색으로 찾는 중... (설정에 YouTube API 키를 넣으면 유튜브 검색 품질로 좋아집니다)";
  askClaude(buildQuery({
    type: "links",
    target: query,
    form: "공식 음원 영상, 대표 라이브/커버 영상",
    period: "any",
    count: 10,
    today: todayStr(),
    hint: "YouTube 링크 위주, 서로 다른 곡으로 다양하게"
  })).then(({ text, error }) => {
    if (error) { resultEl.textContent = error; return; }
    const items = parseLinkResults(text).filter(it => youtubeIdFrom(it.url));
    if (items.length === 0) { resultEl.textContent = "유튜브 링크를 못 찾았습니다:\n" + text; return; }
    resultEl.remove();
    renderLinkCandidates(box, items, entry, card);
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
const EX_FORMS = [ // T1 형태 — value가 태그로도 쓰이고, kw는 유튜브 검색어에 붙는 키워드
  { value: "방송커버", query: "방송 커버 영상", kw: "커버" },
  { value: "라이브", query: "라이브 무대 영상", kw: "라이브" },
  { value: "뮤비", query: "뮤직비디오", kw: "MV" },
  { value: "발매", query: "정규/싱글 발매곡", kw: "공식 음원" }
];
let exType = null;
let exNative = null; // T1을 YouTube API로 보낼 때의 상태 {target, period, count} — 미리보기 내용이 검색어가 됨

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

// pageSize 기본 10 — 링크찾기 카드와 같은 "더 보기" 방식(renderLinkCandidates 참고).
function renderExploreLinkItems(items, pageSize = 10) {
  const box = document.getElementById("ex-results");
  box.innerHTML = "";
  const formEl = document.getElementById("ex-form");
  const formTag = formEl ? formEl.value : "";
  if (items.length === 0) {
    box.innerHTML = '<p class="ex-raw">결과가 없습니다.</p>';
    return;
  }

  let shown = 0;
  let moreBtn = null;

  function addRow(item) {
    const row = document.createElement("div");
    row.className = "ex-item ex-item--compact";
    const canPreview = !!youtubeIdFrom(item.url);
    row.innerHTML = `
      <div class="ex-item-main">
        <b>${escapeHtml(item.title)}</b>${item.artist ? " — " + escapeHtml(item.artist) : ""}
        <span class="ex-item-sub">${escapeHtml(item.channel)} · ${escapeHtml(item.date)}${item.reason ? " — " + escapeHtml(item.reason) : ""}</span>
      </div>
      ${canPreview ? '<button type="button" class="ex-play" aria-label="미리듣기">▶</button>'
                   : `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">열기</a>`}
      <button type="button" class="ex-add">+추가</button>`;
    if (canPreview) row.querySelector(".ex-play").addEventListener("click", () => previewVideo(item, null));
    row.querySelector(".ex-add").addEventListener("click", () => {
      exAddLinkEntry(item, formTag);
      row.querySelector(".ex-add").textContent = "추가됨";
      row.querySelector(".ex-add").disabled = true;
    });
    box.insertBefore(row, moreBtn);
  }

  function showMore() {
    const next = items.slice(shown, shown + pageSize);
    next.forEach(addRow);
    shown += next.length;
    if (moreBtn) {
      if (shown >= items.length) { moreBtn.remove(); moreBtn = null; }
      else moreBtn.textContent = `더 보기 (${items.length - shown}개 더)`;
    }
  }

  if (items.length > pageSize) {
    moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "ex-add";
    box.appendChild(moreBtn);
    moreBtn.addEventListener("click", showMore);
  }
  showMore();
}

function renderExploreResults(text) {
  const box = document.getElementById("ex-results");
  box.innerHTML = "";

  if (exType === "links") {
    const items = parseLinkResults(text);
    if (items.length === 0) {
      box.innerHTML = `<p class="ex-raw">${linkify(text)}</p>`;
      return;
    }
    renderExploreLinkItems(items);
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

// ---- 탐구 프리셋 저장 (2026-08-29) ----
//
// 매번 Step1~4를 다시 고르지 않아도 되게, 조립된 최종 쿼리 문장을 이름 붙여 저장해둔다.
// 원본 선택지(sel 객체)가 아니라 "완성된 문장"을 저장하는 이유: T1~T4마다 sel의 모양이
// 다 달라서 그대로 저장하면 복원 로직이 유형별로 갈라지는데, 완성 문장 하나면 재실행이 단순해진다.
// native(T1이 유튜브 직접검색 경로였는지)만 별도로 기억해서 재실행 때 같은 경로를 타게 한다.
const LS_EX_PRESETS = "mma_ex_presets";
let exPresets = [];

function loadExPresets() { try { return JSON.parse(localStorage.getItem(LS_EX_PRESETS)) || []; } catch { return []; } }
function saveExPresets(list) { localStorage.setItem(LS_EX_PRESETS, JSON.stringify(list)); }

async function runExPreset(p) {
  const statusEl = document.getElementById("ex-status");
  const resultsEl = document.getElementById("ex-results");
  const preview = document.getElementById("ex-preview");
  exType = p.type;
  preview.value = p.prompt;
  preview.hidden = false;
  resultsEl.innerHTML = "";

  if (p.native && loadYtKey()) {
    statusEl.textContent = "유튜브에서 찾는 중...";
    const { items, error } = await searchYouTube(p.prompt, { maxResults: 25 });
    if (error) { statusEl.textContent = error; return; }
    statusEl.textContent = "";
    renderExploreLinkItems(items);
    return;
  }
  statusEl.textContent = "물어보는 중...";
  const { text, error } = await askClaude(p.prompt);
  if (error) { statusEl.textContent = error; return; }
  statusEl.textContent = "";
  renderExploreResults(text);
}

function renderExPresets() {
  const box = document.getElementById("ex-presets");
  if (!box) return;
  box.innerHTML = "";
  exPresets.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `★ ${escapeHtml(p.name)} <span class="ex-preset-x">×</span>`;
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("ex-preset-x")) {
        e.stopPropagation();
        if (btn.dataset.confirm !== "1") {
          btn.dataset.confirm = "1";
          e.target.textContent = "삭제?";
          setTimeout(() => { btn.dataset.confirm = ""; e.target.textContent = "×"; }, 3000);
          return;
        }
        exPresets = exPresets.filter(x => x.id !== p.id);
        saveExPresets(exPresets);
        renderExPresets();
        return;
      }
      runExPreset(p);
    });
    box.appendChild(btn);
  });
}

function initExplore() {
  exPresets = loadExPresets();
  renderExPresets();

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
    if (sel.type === "links" && loadYtKey()) {
      // 네이티브 경로 — 미리보기 = 유튜브 검색어 그대로 (수정 가능)
      exNative = { target: sel.target, period: sel.period, count: sel.count };
      const form = EX_FORMS.find(f => f.value === sel.formTag);
      preview.value = [sel.target, form ? form.kw : "", sel.hint].filter(Boolean).join(" ");
    } else {
      exNative = null;
      preview.value = buildQuery(sel);
    }
    preview.hidden = false;
    sendBtn.hidden = false;
    document.getElementById("ex-save-preset").hidden = false;
  });

  const presetSaveBox = document.getElementById("ex-save-preset-box");
  const presetNameInput = document.getElementById("ex-preset-name");
  document.getElementById("ex-save-preset").addEventListener("click", () => {
    presetSaveBox.hidden = !presetSaveBox.hidden;
    if (!presetSaveBox.hidden) presetNameInput.focus();
  });
  document.getElementById("ex-preset-name-save").addEventListener("click", () => {
    const name = presetNameInput.value.trim();
    const prompt = preview.value.trim();
    if (!name || !prompt) return;
    exPresets.push({
      id: "exp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      name, type: exType, prompt,
      native: exType === "links" && !!exNative && !!loadYtKey()
    });
    saveExPresets(exPresets);
    presetNameInput.value = "";
    presetSaveBox.hidden = true;
    renderExPresets();
  });

  sendBtn.addEventListener("click", async () => {
    const resultsEl = document.getElementById("ex-results");

    // T1 네이티브 경로: 미리보기 내용을 유튜브 검색어로 실행 (decisions.md #42)
    if (exType === "links" && exNative && loadYtKey()) {
      const q = preview.value.trim();
      if (!q) return;
      statusEl.textContent = "유튜브에서 찾는 중...";
      resultsEl.innerHTML = "";
      const publishedAfter =
        exNative.period === "1y" ? shiftYears(todayStr(), -1) + "T00:00:00Z" :
        exNative.period === "3y" ? shiftYears(todayStr(), -3) + "T00:00:00Z" : undefined;
      // 화면엔 사용자가 고른 개수(exNative.count)만큼만 먼저 보여주고, API에는 항상 넉넉히
      // 요청해서(최소 25) "더 보기"를 눌러도 재호출 없이 바로 나오게 한다.
      const { items, error } = await searchYouTube(q, { maxResults: Math.max(exNative.count || 10, 25), publishedAfter });
      if (error) { statusEl.textContent = error; return; }
      statusEl.textContent = "";
      items.forEach(it => { it.artist = exNative.target; });
      renderExploreLinkItems(items, exNative.count || 10);
      return;
    }

    const prompt = exType === "free"
      ? document.getElementById("ex-free").value.trim()
      : preview.value.trim();
    if (!prompt) return;
    statusEl.textContent = "물어보는 중...";
    resultsEl.innerHTML = "";
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

  const ytInput = document.getElementById("f-ytkey");
  const ytStatusEl = document.getElementById("ytkey-status");

  function refreshStatus() {
    const key = loadApiKey();
    statusEl.textContent = key ? `저장됨 (••••${key.slice(-4)})` : "저장된 키 없음";
    const ytKey = loadYtKey();
    ytStatusEl.textContent = ytKey ? `저장됨 (••••${ytKey.slice(-4)})` : "저장된 키 없음";
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

  document.getElementById("ytkey-save").addEventListener("click", () => {
    const key = ytInput.value.trim();
    if (!key) return;
    saveYtKey(key);
    ytInput.value = "";
    refreshStatus();
  });

  document.getElementById("ytkey-delete").addEventListener("click", () => {
    deleteYtKey();
    ytInput.value = "";
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

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

const INTENT_LABELS = { taste: "내 취향", explore: "교양 탐구", family: "가족 탐구" };

async function init() {
  const res = await fetch("data/seed.json");
  allEntries = await res.json();
  localEntries = loadLocalEntries();
  overrides = loadOverrides();
  logs = loadLogs();
  initAddForm();
  initExport();
  initSettings();
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function isLocalId(id) {
  return id.startsWith("local-");
}

function renderCard(entry) {
  const card = document.createElement("div");
  card.className = "card";
  const local = isLocalId(entry.id);
  card.innerHTML = `
    <div class="card-top">
      <span class="intent-tag intent-${entry.intent}">${INTENT_LABELS[entry.intent] || entry.intent}</span>
      <h3>${escapeHtml(entry.title)}</h3>
    </div>
    <p class="credits">${escapeHtml(formatCredits(entry.credits))}</p>
    <div class="tags">${entry.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
    <p class="note" data-note>${entry.note ? escapeHtml(entry.note) : '<span class="muted">메모 없음</span>'}</p>
    ${listenSummary(entry.id) ? `<p class="listen-summary">${escapeHtml(listenSummary(entry.id))}</p>` : ""}
    <div class="card-actions">
      <a class="play-btn" href="${spotifyLink(entry)}" target="_blank" rel="noopener">Spotify에서 찾기</a>
      <button class="listen-btn" type="button">들었음</button>
      <button class="edit-note-btn" type="button">메모 편집</button>
      <button class="ask-ai-btn" type="button">AI에게 물어보기</button>
      ${local ? '<button class="delete-btn" type="button">삭제</button>' : ""}
    </div>
  `;
  card.querySelector(".listen-btn").addEventListener("click", () => logListen(entry.id));
  card.querySelector(".edit-note-btn").addEventListener("click", () => startEditNote(card, entry));
  card.querySelector(".ask-ai-btn").addEventListener("click", () => startAskAI(card, entry));
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
function startAskAI(card, entry) {
  if (card.querySelector(".ask-ai-box")) return; // 이미 열려 있으면 중복 생성 안 함

  const box = document.createElement("div");
  box.className = "ask-ai-box";
  box.innerHTML = `
    <input type="text" class="ask-ai-input" placeholder="이 항목에 대해 물어보기 (예: 이 곡 배경이 뭐야?)">
    <div class="ask-ai-actions">
      <button type="button" class="ask-ai-send">질문</button>
      <button type="button" class="ask-ai-cancel">닫기</button>
    </div>
    <p class="ask-ai-result" hidden></p>
    <button type="button" class="ask-ai-save" hidden>메모에 저장</button>
  `;
  card.appendChild(box);

  const input = box.querySelector(".ask-ai-input");
  const resultEl = box.querySelector(".ask-ai-result");
  const saveBtn = box.querySelector(".ask-ai-save");
  let lastAnswer = "";

  box.querySelector(".ask-ai-send").addEventListener("click", async () => {
    const question = input.value.trim();
    if (!question) return;
    resultEl.hidden = false;
    resultEl.textContent = "물어보는 중...";
    saveBtn.hidden = true;

    const context = `${entry.title} — ${formatCredits(entry.credits)}`;
    const { text, error } = await askClaude(
      `다음 음악/아티스트에 대한 질문에 답해줘. 최신 정보나 실제 링크가 필요한 질문이면 웹 검색을 써서 ` +
      `정확한 정보로 답해. 대상: ${context}\n질문: ${question}`
    );
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
  module.exports = { recommend, scoreEntry: (entry, tags) => tags.filter(t => entry.tags.includes(t)).length };
}

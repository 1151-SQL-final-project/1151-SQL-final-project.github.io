// 探點：單頁式網頁。網址 # 後面決定顯示哪一頁：
//   #/ 首頁　#/search 找活動　#/event/12 活動詳情　#/saves 我的收藏　#/stats 數據　#/login 登入／註冊
//   #/merchant 商家後台　#/merchant/new 上架活動　#/merchant/edit/12 修改活動　#/admin 管理員後台
// 三種角色：使用者（查詢、收藏）、商家（上架、修改自己的活動）、管理員（審核、下架、統計）。
// 畫面上依角色顯示不同選單，但真正的權限檢查在後端（api/main.py 的 require_role）。

const app = document.getElementById("app");
const WEEKDAYS = "日一二三四五六";

// ---------- 小工具 ----------

// 活動資料來自外部（開放資料），放進畫面前一律跳脫，避免夾帶 HTML
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const toDate = (iso) => (iso ? new Date(iso.slice(0, 19)) : null);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const money = (n) => `NT$${Number(n).toLocaleString("zh-TW")}`;

function fmtDay(iso, withYear = false) {
  const d = toDate(iso);
  if (!d) return "";
  const year = withYear || d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}/` : "";
  return `${year}${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}
// 開賣時間要到時、分：11/1（六）12:00
function fmtTime(iso) {
  const d = toDate(iso);
  return d ? `${fmtDay(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
}
// 還沒開賣：有開賣時間而且還沒到
const notOnSale = (iso) => !!iso && toDate(iso) > new Date();
const saleTag = (iso) => (notOnSale(iso) ? `<span class="tag tag-sale">🎫 ${esc(fmtTime(iso))} 開賣</span>` : "");
function fmtRange(start, end) {
  return ymd(toDate(start)) === ymd(toDate(end)) ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
}

// 票價規則：0 = 免費、null = 票價未定；有目前有效的優惠且比原價便宜時，顯示優惠價
function priceView(original, best) {
  if (original === 0) return { main: "免費", tag: '<span class="tag tag-free">免費</span>' };
  if (best !== null && best !== undefined && (original === null || best < original)) {
    return { main: `${money(best)} 起`, old: original !== null ? money(original) : "", tag: '<span class="tag tag-deal">有優惠</span>' };
  }
  if (original === null) return { main: "票價未定", muted: true };
  return { main: money(original) };
}

// 審核狀態標籤：待審核、上架中、已退回、已下架
const STATUS_TAG = { "待審核": "tag-warn", "上架中": "tag-free", "已退回": "tag-deal", "已下架": "" };
const statusTag = (s) => `<span class="tag ${STATUS_TAG[s] ?? ""}">${esc(s)}</span>`;
const isoDay = (iso) => (iso ? iso.slice(0, 10) : "");

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------- 登入狀態與 API ----------

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* 略過 */ } },
};
let token = store.get("token");
let me = null;
let savedIds = new Set();

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) logout(false);
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("；") : data.detail;
    throw Object.assign(new Error(detail || `發生錯誤（${res.status}）`), { status: res.status });
  }
  return data;
}

async function loadMe() {
  if (!token) { me = null; savedIds = new Set(); updateNav(); return; }
  try {
    me = await api("/api/me");
    // 收藏只開放給「使用者」角色
    savedIds = me.UserRole === "使用者" ? new Set((await api("/api/saves")).map((e) => e.EventID)) : new Set();
  } catch { me = null; }
  updateNav();
}

function logout(showToast = true) {
  token = null; me = null; savedIds = new Set();
  store.set("token", null);
  updateNav();
  if (showToast) toast("已登出");
}

function updateNav() {
  document.getElementById("nav-account").textContent = me ? me.UserName : "登入";
  // data-roles：這個選單項目給哪些角色看（guest = 沒登入）
  const role = me ? me.UserRole : "guest";
  document.querySelectorAll("[data-roles]").forEach((a) => (a.hidden = !a.dataset.roles.split(",").includes(role)));
}

let optionsCache = null;
const getOptions = async () => (optionsCache ??= await api("/api/options"));

// 等資料回來時使用者可能已經換頁；這時不要再畫這一頁，否則會蓋掉新的頁面
const routeNow = () => location.hash || "#/";

// ---------- 路由 ----------

const routes = [
  [/^#\/?$/, viewHome, "home"],
  [/^#\/search$/, viewSearch, "search"],
  [/^#\/event\/(\d+)$/, viewEvent, null],
  [/^#\/saves$/, viewSaves, "saves"],
  [/^#\/stats$/, viewStats, "stats"],
  [/^#\/login$/, viewLogin, "login"],
  [/^#\/merchant$/, viewMerchant, "merchant"],
  [/^#\/merchant\/new$/, () => viewEventForm(null), "merchant"],
  [/^#\/merchant\/edit\/(\d+)$/, viewEventForm, "merchant"],
  [/^#\/admin$/, viewAdmin, "admin"],
];

async function router() {
  const hash = location.hash || "#/";
  const [pattern, view, nav] = routes.find(([re]) => re.test(hash)) ?? routes[0];
  document.querySelectorAll("[data-nav]").forEach((a) => a.dataset.nav === nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  try {
    await view(...(hash.match(pattern) ?? []).slice(1));
  } catch (err) {
    app.innerHTML = `<div class="card empty"><h2>出了點問題</h2><p>${esc(err.message)}</p><a class="btn" href="#/">回首頁</a></div>`;
  }
}

// ---------- 首頁 ----------

// 首頁只放 logo、名稱、介紹，以及「找活動」「登入」兩個按鈕（已登入就不顯示登入）
function viewHome() {
  app.innerHTML = `
    <section class="home-hero">
      <div class="home-art"><img src="logo.png" alt="探點 logo"></div>
      <h1 class="home-name">探點</h1>
      <p class="eyebrow">SpotGo</p>
      <p class="lead">把全臺灣的展覽、講座、工作坊與表演集中在一起。<br>
        依地區、日期、類型與優惠查詢活動，<br>學生優惠、早鳥票直接標出來，看到喜歡的就收藏起來。</p>
      <div class="home-actions">
        <a class="btn btn-primary" href="#/search">找活動</a>
        ${me ? "" : '<a class="btn" href="#/login">登入／註冊</a>'}
      </div>
    </section>`;
}

// ---------- 找活動 ----------

// requestId：連續改條件時會同時有好幾個搜尋在跑，只採用最後一次的結果
const search = { params: null, items: [], total: 0, page: 1, scrollY: 0, requestId: 0 };

async function viewSearch() {
  const here = routeNow();
  const opts = await getOptions();
  if (routeNow() !== here) return;
  const chip = (name, value, text, type = "radio") =>
    `<label class="chip"><input type="${type}" name="${name}" value="${esc(value)}"><span>${esc(text)}</span></label>`;
  app.innerHTML = `
    <section class="hero">
      <h1>找到課堂之外的好活動</h1>
      <p>展覽、講座、工作坊、表演一次查，學生優惠、早鳥票直接標出來。</p>
    </section>
    <form class="card filters" id="filters">
      <div class="filter-row">
        <label class="field"><span>關鍵字</span><input class="input" name="keyword" type="search" placeholder="例如：恐龍、爵士、陶藝"></label>
        <label class="field"><span>縣市</span><select class="input" name="city_id"><option value="">全部縣市</option>
          ${opts.cities.map((c) => `<option value="${c.CityID}">${esc(c.CityName)}</option>`).join("")}</select></label>
        <label class="field"><span>類型</span><select class="input" name="category"><option value="">全部類型</option>
          ${categoryFilterOptions(opts)}</select></label>
      </div>
      <div class="chip-rows">
        <div>
          <div class="chip-label">地區</div>
          <div class="chips">${chip("region", "", "全部")}${opts.regions.map((r) => chip("region", r, r)).join("")}</div>
        </div>
      </div>
      <div class="filter-row dates">
        <label class="field"><span>從</span><input class="input" type="date" name="date_from"></label>
        <label class="field"><span>到</span><input class="input" type="date" name="date_to"></label>
        <div class="quick-dates" aria-label="快速選日期">
          <button type="button" class="btn" data-quick="today">今天</button>
          <button type="button" class="btn" data-quick="weekend">這個週末</button>
          <button type="button" class="btn" data-quick="week">未來 7 天</button>
          <button type="button" class="btn" data-quick="month">這個月</button>
        </div>
      </div>
      <div>
        <div class="chip-label">優惠</div>
        <div class="chips">
          ${opts.discount_types.map((t) => chip("discount_type_id", t.DiscountTypeID, t.DiscountTypeName, "checkbox")).join("")}
          ${chip("free_only", "true", "只看免費", "checkbox")}
        </div>
      </div>
      <div>
        <div class="chip-label">售票</div>
        <div class="chips">${chip("not_on_sale", "true", "🎫 還沒開賣（可以先收藏，開賣前提醒你）", "checkbox")}</div>
      </div>
      <div class="filter-actions">
        <button type="reset" class="btn-text">清除條件</button>
        <button class="btn btn-primary">搜尋活動</button>
      </div>
    </form>
    <section class="strip" id="sale-soon" hidden></section>
    <section class="strip" id="early-bird" hidden></section>
    <div class="results-head">
      <h2 id="result-count" aria-live="polite">　</h2>
      <label class="field"><span class="sr-only">排序</span>
        <select class="input" id="sort"><option value="date">依日期（進行中優先）</option><option value="ending">快結束的優先</option><option value="price">價格低到高</option><option value="sale">即將開賣的優先</option></select>
      </label>
    </div>
    <div class="grid" id="results"></div>
    <div class="more"><button class="btn" id="more" hidden>載入更多</button></div>`;

  const form = document.getElementById("filters");
  // 預設縣市：登入時用使用者設定的預設縣市
  const initial = search.params ?? new URLSearchParams(me?.UserDefaultCity_FK ? { city_id: me.UserDefaultCity_FK } : {});
  for (let [key, value] of initial) {
    // 類型下拉選單同時代表 category_id（單一類別）和 category_group（整組，值是「group:學習類」）
    if (key === "category_id") key = "category";
    if (key === "category_group") [key, value] = ["category", `group:${value}`];
    const el = form.elements[key];
    if (!el) continue;
    if (el instanceof RadioNodeList || el.type === "checkbox" || el.type === "radio") {
      form.querySelectorAll(`[name="${key}"]`).forEach((i) => { if (i.value === value) i.checked = true; });
    } else el.value = value;
  }
  const checkAll = () => ["region"].forEach((name) => {
    if (!form.querySelector(`[name="${name}"]:checked`)) form.querySelector(`[name="${name}"][value=""]`).checked = true;
  });
  checkAll();
  document.getElementById("sort").value = initial.get("sort") || "date";

  form.addEventListener("submit", (e) => { e.preventDefault(); runSearch(form); });
  form.addEventListener("reset", () => setTimeout(() => { checkAll(); runSearch(form); }));
  form.querySelectorAll('[name="region"], [name="discount_type_id"], [name="free_only"], [name="not_on_sale"], select').forEach((el) =>
    el.addEventListener("change", () => runSearch(form)));
  document.getElementById("sort").addEventListener("change", () => runSearch(form));
  form.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => {
    const [from, to] = quickRange(b.dataset.quick);
    form.elements.date_from.value = ymd(from);
    form.elements.date_to.value = ymd(to);
    runSearch(form);
  }));
  document.getElementById("more").addEventListener("click", () => fetchPage(search.page + 1));

  loadSaleSoon();
  loadEarlyBird();
  if (search.params && search.items.length) {
    renderResults();
    requestAnimationFrame(() => window.scrollTo(0, search.scrollY));
  } else {
    runSearch(form);
  }
}

// 找活動的類型下拉選單：每組最上面是「整組」（例如全部學習類），下面是該組的各類別
function categoryFilterOptions(opts) {
  return opts.category_groups.map((g) => `<optgroup label="${esc(g)}">
    <option value="group:${esc(g)}">全部${esc(g)}</option>
    ${opts.categories.filter((c) => c.CategoryGroup === g).map((c) => `<option value="${c.CategoryID}">${esc(c.CategoryName)}</option>`).join("")}
  </optgroup>`).join("");
}

// 類別下拉選單依「學習類／休閒類」分組
function categoryOptions(opts, selected = null) {
  return opts.category_groups.map((g) => `<optgroup label="${esc(g)}">${opts.categories.filter((c) => c.CategoryGroup === g)
    .map((c) => `<option value="${c.CategoryID}" ${c.CategoryID === selected ? "selected" : ""}>${esc(c.CategoryName)}</option>`)
    .join("")}</optgroup>`).join("");
}

function quickRange(kind) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  if (kind === "today") return [today, today];
  if (kind === "week") return [today, add(today, 6)];
  if (kind === "month") return [today, new Date(today.getFullYear(), today.getMonth() + 1, 0)];
  const saturday = add(today, (6 - today.getDay() + 7) % 7);   // 今天是週日時，算今天這個週末
  return today.getDay() === 0 ? [today, today] : [saturday, add(saturday, 1)];
}

function runSearch(form) {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (!value) continue;
    if (key === "category") params.append(value.startsWith("group:") ? "category_group" : "category_id", value.replace("group:", ""));
    else params.append(key, value);
  }
  params.set("sort", document.getElementById("sort").value);
  search.params = params;
  search.items = [];
  document.getElementById("results").innerHTML = '<div class="skeleton"></div>'.repeat(3);
  fetchPage(1);
}

async function fetchPage(page) {
  const params = new URLSearchParams(search.params);
  params.set("page", page);
  params.set("page_size", 24);
  const more = document.getElementById("more");
  more.disabled = true;
  const requestId = ++search.requestId;
  try {
    const data = await api("/api/events?" + params);
    if (requestId !== search.requestId) return; // 已經有更新的搜尋，這個結果作廢
    search.items = page === 1 ? data.items : search.items.concat(data.items);
    search.total = data.total;
    search.page = page;
    renderResults();
  } catch (err) {
    if (requestId !== search.requestId) return;
    document.getElementById("results").innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  } finally {
    if (requestId === search.requestId) more.disabled = false;
  }
}

function renderResults() {
  document.getElementById("result-count").textContent = `找到 ${search.total.toLocaleString("zh-TW")} 場活動`;
  document.getElementById("results").innerHTML = search.items.length
    ? search.items.map(eventCard).join("")
    : '<div class="card empty" style="grid-column: 1 / -1">沒有符合條件的活動，試著放寬地區或日期。</div>';
  document.getElementById("more").hidden = search.items.length >= search.total;
}

function eventCard(e) {
  const p = priceView(e.EventOriginalPrice, e.BestDiscountPrice);
  return `<a class="card event-card" href="#/event/${e.EventID}">
    <div><span class="tag">${esc(e.CategoryName)}</span> ${p.tag ?? ""} ${saleTag(e.EventSaleStartDate)}</div>
    <h3>${esc(e.EventTitle)}</h3>
    <div class="event-meta">
      <div>📅 ${fmtRange(e.EventStartDate, e.EventEndDate)}</div>
      <div>📍 ${esc(`${e.CityName}・${e.VenueName}`)}</div>
    </div>
    <div class="price-row">
      <span class="price ${p.muted ? "muted" : ""}">${esc(p.main)}</span>
      ${p.old ? `<span class="price-old">${esc(p.old)}</span>` : ""}
    </div>
  </a>`;
}

// 即將開賣：熱門演唱會一開賣就賣完，提早告訴使用者開賣時間
async function loadSaleSoon() {
  const list = await api("/api/sales/upcoming?days=14").catch(() => []);
  const box = document.getElementById("sale-soon");
  if (!box || !list.length) return;
  box.innerHTML = `
    <div class="strip-head"><h2>🎫 即將開賣</h2><span class="muted small">14 天內開賣，熱門場次常常一開賣就賣完</span></div>
    <div class="strip-list">${list.map((e) => `
      <a class="card strip-item" href="#/event/${e.EventID}">
        <span class="tag tag-sale">${e.DaysLeft === 0 ? "今天" : `${e.DaysLeft} 天後`} ${esc(fmtTime(e.EventSaleStartDate).split(" ")[1])} 開賣</span>
        <b>${esc(e.EventTitle)}</b>
        <span class="muted small">${fmtRange(e.EventStartDate, e.EventEndDate)}・${esc(e.CityName)}</span>
      </a>`).join("")}</div>`;
  box.hidden = false;
}

async function loadEarlyBird() {
  const list = await api("/api/discounts/early-bird?days=14").catch(() => []);
  const box = document.getElementById("early-bird");
  if (!box || !list.length) return;
  box.innerHTML = `
    <div class="strip-head"><h2>⏰ 早鳥即將截止</h2><span class="muted small">14 天內截止</span></div>
    <div class="strip-list">${list.map((d) => `
      <a class="card strip-item" href="#/event/${d.EventID}">
        <span class="tag tag-warn">${d.DaysLeft === 0 ? "今天截止" : `剩 ${d.DaysLeft} 天`}</span>
        <b>${esc(d.EventTitle)}</b>
        <span><span class="price">${money(d.DiscountPrice)}</span>
          ${d.EventOriginalPrice ? `<span class="price-old">${money(d.EventOriginalPrice)}</span>` : ""}</span>
      </a>`).join("")}</div>`;
  box.hidden = false;
}

// ---------- 活動詳情 ----------

async function viewEvent(id) {
  search.scrollY = window.scrollY;
  app.innerHTML = '<div class="skeleton" style="min-height: 320px"></div>';
  const here = routeNow();
  const e = await api(`/api/events/${id}`);
  if (routeNow() !== here) return;
  const valid = e.Discounts.filter((d) => d.IsValidNow);
  const best = valid.length ? Math.min(...valid.map((d) => d.DiscountPrice)) : null;
  const p = priceView(e.EventOriginalPrice, best);
  const saved = savedIds.has(e.EventID);
  const longText = (e.EventDescription || "").length > 600;
  const isOwner = me && me.UserID === e.EventOrganizer_FK && me.UserRole === "商家";
  const canSave = !me || me.UserRole === "使用者";
  const back = isOwner ? ["#/merchant", "← 回商家後台"] : me?.UserRole === "管理員" && e.EventStatus !== "上架中"
    ? ["#/admin", "← 回管理員後台"] : ["#/search", "← 回搜尋結果"];

  app.innerHTML = `
    <a class="back btn-text" href="${back[0]}">${back[1]}</a>
    ${e.EventStatus !== "上架中" ? `<div class="notice">這場活動目前是 ${statusTag(e.EventStatus)}，
      只有上架的商家和管理員看得到${e.EventStatus === "待審核" ? "；管理員通過後才會公開" : ""}。</div>` : ""}
    <div class="detail">
      <div style="display: grid; gap: 18px; min-width: 0">
        <section class="card detail-head">
          <div class="tags"><span class="tag">${esc(e.CategoryName)}</span><span class="tag">${esc(e.CategoryGroup)}</span>${p.tag ?? ""}</div>
          <h1>${esc(e.EventTitle)}</h1>
          <div class="muted">📅 ${fmtDay(e.EventStartDate, true)}${ymd(toDate(e.EventStartDate)) === ymd(toDate(e.EventEndDate)) ? "" : ` – ${fmtDay(e.EventEndDate, true)}`}</div>
        </section>
        <section class="card panel">
          <h2>地點</h2>
          <div class="session-time">${esc(e.VenueName)} <span class="tag">${esc(e.CityName)}</span> <span class="tag">${esc(e.CityRegion)}</span></div>
          <div class="muted small"><a href="${esc(e.GoogleMapsAddressURL)}" target="_blank" rel="noopener" title="用地址在 Google 地圖定位">${esc(e.VenueAddress)}</a>・<a href="${esc(e.GoogleMapsURL)}" target="_blank" rel="noopener">在 Google 地圖開啟 ↗</a></div>
        </section>
        ${e.EventDescription ? `
        <section class="card panel">
          <h2>活動介紹</h2>
          <div class="description ${longText ? "clamped" : ""}" id="desc">${esc(e.EventDescription)}</div>
          ${longText ? '<button class="btn-text" id="desc-toggle">展開全文</button>' : ""}
        </section>` : ""}
      </div>
      <aside class="side">
        <section class="card price-box">
          <div class="muted small">${best !== null && p.old ? "優惠價" : "票價"}</div>
          <div><span class="price-big ${p.muted ? "muted" : ""}">${esc(p.main)}</span>
            ${p.old ? `<span class="price-old">原價 ${esc(p.old)}</span>` : ""}</div>
          ${e.EventSaleStartDate ? `<div class="sale-info ${notOnSale(e.EventSaleStartDate) ? "upcoming" : ""}">
            ${notOnSale(e.EventSaleStartDate) ? `🎫 <b>${esc(fmtTime(e.EventSaleStartDate))} 開賣</b>
              <div class="small">${saleCountdown(e.EventSaleStartDate)}${canSave ? "，收藏後會在「我的收藏」提醒你" : ""}</div>`
              : `<span class="small">已開賣（${esc(fmtTime(e.EventSaleStartDate))} 起）</span>`}</div>` : ""}
          ${canSave && e.EventStatus === "上架中" ? `<button class="btn ${saved ? "btn-saved" : "btn-primary"}" id="save-btn">${saved ? "✓ 已收藏" : "☆ 收藏活動"}</button>` : ""}
          ${isOwner ? `<a class="btn btn-primary" href="#/merchant/edit/${e.EventID}">修改活動</a>` : ""}
          ${e.EventURL ? `<a class="btn" href="${esc(e.EventURL)}" target="_blank" rel="noopener">活動官網 ↗</a>` : ""}
        </section>
        <section class="card panel">
          <h2>優惠</h2>
          <ul class="list">${e.Discounts.map((d) => `
            <li class="discount ${d.IsValidNow ? "" : "expired"}">
              <div><span class="tag ${d.IsValidNow ? "tag-deal" : ""}">${esc(d.DiscountTypeName)}</span>
                <div class="small">${esc(d.DiscountDescription || "")}</div>
                <div class="muted small">${d.IsValidNow ? (d.DiscountEndDate ? `${fmtDay(d.DiscountEndDate)} 截止` : "無截止日") : "已失效"}</div></div>
              <div class="amount">${money(d.DiscountPrice)}</div>
            </li>`).join("") || '<li class="muted small">目前沒有登錄優惠</li>'}
          </ul>
        </section>
        <p class="muted small">上架：${esc(e.OrganizerName)}・資料來源：${esc(e.EventDataSource)}</p>
      </aside>
    </div>`;

  document.getElementById("desc-toggle")?.addEventListener("click", (ev) => {
    const clamped = document.getElementById("desc").classList.toggle("clamped");
    ev.target.textContent = clamped ? "展開全文" : "收合";
  });
  document.getElementById("save-btn")?.addEventListener("click", () => toggleSave(e.EventID));
  window.scrollTo(0, 0);
}

function saleCountdown(iso) {
  const ms = toDate(iso) - new Date();
  const days = Math.floor(ms / 86400000), hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `還有 ${days} 天 ${hours} 小時` : hours > 0 ? `還有 ${hours} 小時` : "快開賣了";
}

async function toggleSave(eventId) {
  if (!me) { location.hash = "#/login"; viewLogin.returnTo = `#/event/${eventId}`; toast("登入後就能收藏"); return; }
  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  try {
    if (savedIds.has(eventId)) {
      await api(`/api/saves/${eventId}`, { method: "DELETE" });
      savedIds.delete(eventId);
      toast("已取消收藏");
    } else {
      await api(`/api/saves/${eventId}`, { method: "POST" });
      savedIds.add(eventId);
      toast("已加入收藏");
    }
    const saved = savedIds.has(eventId);
    btn.className = `btn ${saved ? "btn-saved" : "btn-primary"}`;
    btn.textContent = saved ? "✓ 已收藏" : "☆ 收藏活動";
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- 我的收藏 ----------

async function viewSaves() {
  if (!me) {
    app.innerHTML = `<div class="card empty"><h2>登入後查看收藏</h2><p>收藏的活動和優惠截止提醒都會在這裡。</p>
      <a class="btn btn-primary" href="#/login">登入／註冊</a></div>`;
    viewLogin.returnTo = "#/saves";
    return;
  }
  if (me.UserRole !== "使用者") {
    app.innerHTML = `<div class="card empty"><h2>收藏功能只開放給使用者帳號</h2>
      <p>${esc(me.UserRole)}帳號請到${me.UserRole === "商家" ? '<a href="#/merchant">商家後台</a>' : '<a href="#/admin">管理員後台</a>'}。</p></div>`;
    return;
  }
  const [saves, reminders, sales] = await Promise.all([
    api("/api/saves"), api("/api/saves/reminders?days=14"), api("/api/saves/sale-reminders?days=14")]);
  if (routeNow() !== "#/saves") return;
  savedIds = new Set(saves.map((s) => s.EventID));
  app.innerHTML = `
    <h1>我的收藏</h1>
    ${sales.length ? `<section style="margin-bottom: 10px">${sales.map((r) => `
      <a class="reminder reminder-sale" href="#/event/${r.EventID}">🎫 <span><b>${r.DaysLeft === 0 ? "今天" : `${r.DaysLeft} 天後`}開賣</b>：
        ${esc(r.EventTitle)}（${esc(fmtTime(r.EventSaleStartDate))}）</span></a>`).join("")}</section>` : ""}
    ${reminders.length ? `<section style="margin-bottom: 18px">${reminders.map((r) => `
      <a class="reminder" href="#/event/${r.EventID}">⏰ <span><b>${r.DaysLeft === 0 ? "今天" : `${r.DaysLeft} 天後`}截止</b>：
        ${esc(r.EventTitle)} 的${esc(r.DiscountTypeName)}（${money(r.DiscountPrice)}）</span></a>`).join("")}</section>` : ""}
    <section class="card">${saves.length ? saves.map((s) => `
      <div class="save-row">
        <div style="min-width: 0">
          ${s.EventStatus === "上架中" ? `<a href="#/event/${s.EventID}">${esc(s.EventTitle)}</a>`
            : `<span class="save-title">${esc(s.EventTitle)}</span> ${statusTag(s.EventStatus)}`}
          <div class="muted small">${esc(s.CategoryName)}・${fmtRange(s.EventStartDate, s.EventEndDate)}・${esc(s.CityName)}・收藏於 ${fmtDay(s.SaveDate)}</div>
          ${notOnSale(s.EventSaleStartDate) ? `<div class="small">${saleTag(s.EventSaleStartDate)}</div>` : ""}
        </div>
        <button class="btn" data-unsave="${s.EventID}">取消收藏</button>
      </div>`).join("") : '<div class="empty">還沒有收藏。看到喜歡的活動，在活動頁按「收藏活動」。<br><br><a class="btn btn-primary" href="#/search">去找活動</a></div>'}
    </section>`;
  app.querySelectorAll("[data-unsave]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    await api(`/api/saves/${b.dataset.unsave}`, { method: "DELETE" });
    toast("已取消收藏");
    viewSaves();
  }));
}

// ---------- 數據 ----------

function barChart(rows, label, value, unit, titleId) {
  const max = Math.max(...rows.map((r) => r[value]), 1);
  return `<div class="bars" role="list" aria-labelledby="${titleId}">${rows.map((r) => `
    <div class="bar-row" role="listitem" tabindex="0" data-tip="${esc(r[label])}：${r[value].toLocaleString("zh-TW")} ${unit}">
      <span class="bar-label">${esc(r[label])}</span>
      <span class="bar-track"><span class="bar" style="flex: 0 0 calc((100% - 4em) * ${(r[value] / max).toFixed(4)})"></span>
        <span class="bar-value">${r[value].toLocaleString("zh-TW")}</span></span>
    </div>`).join("")}</div>
    <details class="table-view"><summary>以表格檢視</summary>
      <table class="data-table"><thead><tr><th>${{ CityRegion: "地區", CityName: "縣市", EventStatus: "審核狀態" }[label] ?? "類別"}</th><th class="num">${unit}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[label])}</td><td class="num">${r[value]}</td></tr>`).join("")}</tbody></table>
    </details>`;
}

async function viewStats() {
  app.innerHTML = '<div class="skeleton" style="min-height: 320px"></div>';
  const s = await api("/api/stats");
  if (routeNow() !== "#/stats") return;
  const total = s.categories.reduce((sum, c) => sum + c.EventCount, 0);
  app.innerHTML = `
    <h1>活動數據</h1>
    <div class="stats-grid">
      <section class="card panel">
        <div class="muted">目前上架中的活動</div>
        <div class="hero-number">${total.toLocaleString("zh-TW")}</div>
        <p class="muted small">同一場活動在多個場館舉辦時，每個場館各算一場。</p>
        <h2 id="t-region" style="margin-top: 18px">各地區活動數</h2>
        ${barChart(s.regions, "CityRegion", "EventCount", "場", "t-region")}
      </section>
      <section class="card panel">
        <h2 id="t-cat">各類別活動數</h2>
        ${barChart(s.categories, "CategoryName", "EventCount", "場", "t-cat")}
      </section>
      <section class="card panel">
        <h2 id="t-city">活動最多的縣市（前 10 名）</h2>
        ${barChart(s.cities.slice(0, 10), "CityName", "EventCount", "場", "t-city")}
      </section>
      <section class="card panel">
        <h2>熱門收藏排行</h2>
        <ol class="list rank">${s.popular.map((p) => `
          <li><a href="#/event/${p.EventID}">${esc(p.EventTitle)}</a><span class="tag">${p.SaveCount} 人收藏</span></li>`).join("") || '<li class="muted">還沒有人收藏</li>'}
        </ol>
      </section>
    </div>`;
}

// 長條圖的滑鼠提示（鍵盤 focus 也會顯示）
const tooltip = document.getElementById("tooltip");
function showTip(target, x, y) {
  tooltip.textContent = target.dataset.tip;
  tooltip.hidden = false;
  const rect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(x + 12, window.innerWidth - rect.width - 8)}px`;
  tooltip.style.top = `${Math.max(8, y - rect.height - 10)}px`;
}
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  t ? showTip(t, e.clientX, e.clientY) : (tooltip.hidden = true);
});
document.addEventListener("focusin", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (t) { const r = t.getBoundingClientRect(); showTip(t, r.left + r.width / 2, r.top); }
});
document.addEventListener("focusout", () => (tooltip.hidden = true));

// ---------- 登入／註冊 ----------

async function viewLogin() {
  if (me) {
    const home = { "商家": ["#/merchant", "前往商家後台"], "管理員": ["#/admin", "前往管理員後台"] }[me.UserRole];
    app.innerHTML = `<section class="card auth"><h1>帳號</h1>
      <div><b>${esc(me.UserName)}</b> <span class="tag">${esc(me.UserRole)}</span><div class="muted">${esc(me.UserEmail)}</div>
      <div class="muted small">預設查詢縣市：${esc(me.CityName ?? "未設定")}</div></div>
      ${home ? `<a class="btn btn-primary" href="${home[0]}">${home[1]}</a>` : ""}
      <button class="btn" id="logout">登出</button></section>`;
    document.getElementById("logout").addEventListener("click", () => { logout(); search.params = null; viewLogin(); });
    return;
  }
  const opts = await getOptions();
  if (routeNow() !== "#/login") return;
  app.innerHTML = `
    <section class="card auth">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="login">登入</button>
        <button role="tab" aria-selected="false" data-tab="register">註冊</button>
      </div>
      <form class="form" id="login-form">
        <label class="field"><span>Email</span><input class="input" name="email" type="email" required autocomplete="email"></label>
        <label class="field"><span>密碼</span><input class="input" name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn btn-primary">登入</button>
        <p class="muted small">示範帳號（密碼都是 test1234）<br>使用者：student@example.com<br>商家：merchant@example.com<br>管理員：admin@example.com</p>
      </form>
      <form class="form" id="register-form" hidden>
        <div><div class="chip-label">註冊身分</div>
          <div class="chips">
            <label class="chip"><input type="radio" name="role" value="使用者" checked><span>使用者（找活動、收藏）</span></label>
            <label class="chip"><input type="radio" name="role" value="商家"><span>商家（上架活動）</span></label>
          </div>
          <p class="muted small">管理員帳號不開放註冊。</p></div>
        <label class="field"><span>暱稱</span><input class="input" name="name" required maxlength="20"></label>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" required maxlength="50" autocomplete="email"></label>
        <label class="field"><span>密碼（至少 8 碼）</span><input class="input" name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>預設查詢縣市</span><select class="input" name="default_city_id"><option value="">不設定</option>
          ${opts.cities.map((c) => `<option value="${c.CityID}">${esc(c.CityName)}</option>`).join("")}</select></label>
        <button class="btn btn-primary">建立帳號</button>
      </form>
      <p class="error" id="auth-error" role="alert"></p>
    </section>`;

  app.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    app.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", t === tab));
    document.getElementById("login-form").hidden = tab.dataset.tab !== "login";
    document.getElementById("register-form").hidden = tab.dataset.tab !== "register";
    document.getElementById("auth-error").textContent = "";
  }));

  const submit = (formId, path, transform = (b) => b) => document.getElementById(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      const data = await api(path, { method: "POST", body: JSON.stringify(transform(Object.fromEntries(new FormData(e.target)))) });
      token = data.token;
      store.set("token", token);
      await loadMe();
      search.params = null; // 換成新使用者的預設縣市
      toast(`歡迎，${me.UserName}`);
      // 商家、管理員登入後直接到後台（從活動頁來的就回原頁）
      location.hash = viewLogin.returnTo || { "商家": "#/merchant", "管理員": "#/admin" }[me.UserRole] || "#/";
      viewLogin.returnTo = null;
    } catch (err) {
      document.getElementById("auth-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
  submit("login-form", "/api/auth/login");
  submit("register-form", "/api/auth/register", (b) => ({ ...b, default_city_id: b.default_city_id ? Number(b.default_city_id) : null }));
}

// ---------- 後台共用 ----------

// 沒登入或角色不對時顯示提示，回傳 false
function requireRole(role, returnTo) {
  if (me?.UserRole === role) return true;
  viewLogin.returnTo = returnTo;
  app.innerHTML = `<div class="card empty"><h2>這一頁只開放給${esc(role)}帳號</h2>
    <p>${me ? `目前登入的是${esc(me.UserRole)}帳號（${esc(me.UserName)}）。` : "請先登入。"}</p>
    <a class="btn btn-primary" href="#/login">${me ? "切換帳號" : "登入／註冊"}</a></div>`;
  return false;
}

const countsBar = (counts, current) => `<div class="status-tabs" role="tablist">${["", ...Object.keys(counts)].map((s) => `
  <button type="button" role="tab" data-status="${esc(s)}" aria-selected="${s === current}">
    ${s ? esc(s) : "全部"} <span class="count">${s ? counts[s] : Object.values(counts).reduce((a, b) => a + b, 0)}</span></button>`).join("")}</div>`;

// ---------- 商家後台 ----------

const merchant = { status: "" };

async function viewMerchant() {
  if (!requireRole("商家", "#/merchant")) return;
  app.innerHTML = '<div class="skeleton" style="min-height: 320px"></div>';
  const events = await api("/api/merchant/events");
  if (routeNow() !== "#/merchant") return;
  const counts = Object.fromEntries(["待審核", "上架中", "已退回", "已下架"].map((s) => [s, events.filter((e) => e.EventStatus === s).length]));
  const shown = merchant.status ? events.filter((e) => e.EventStatus === merchant.status) : events;
  app.innerHTML = `
    <div class="page-head">
      <div><h1>商家後台</h1><p class="muted">${esc(me.UserName)} 上架的活動。新增或修改後都要經過管理員審核才會公開；活動結束後會自動下架。</p></div>
      <a class="btn btn-primary" href="#/merchant/new">＋ 上架新活動</a>
    </div>
    ${countsBar(counts, merchant.status)}
    <section class="card">${shown.length ? shown.map((e) => `
      <div class="admin-row">
        <div style="min-width: 0">
          <a href="#/event/${e.EventID}">${esc(e.EventTitle)}</a> ${statusTag(e.EventStatus)}
          <div class="muted small">${[esc(e.CategoryName), fmtRange(e.EventStartDate, e.EventEndDate), `${esc(e.CityName)} ${esc(e.VenueName)}`,
            e.EventOriginalPrice === null ? "票價未公布" : e.EventOriginalPrice === 0 ? "免費" : money(e.EventOriginalPrice),
            `優惠 ${e.DiscountCount} 筆`, `${e.SaveCount} 人收藏`].join("・")} ${saleTag(e.EventSaleStartDate)}</div>
          ${e.EventStatus === "已退回" ? `<div class="reject-note"><b>被管理員退回</b>：${esc(e.EventRejectReason || "未註明理由")}
            <div class="small">請依理由修改資料後重新送出審核。</div></div>` : ""}
        </div>
        <div class="row-actions">${e.EventStatus === "已下架" ? "" : `<a class="btn" href="#/merchant/edit/${e.EventID}">修改</a>`}</div>
      </div>`).join("") : `<div class="empty">${events.length ? "這個狀態沒有活動。" : "還沒有上架活動。按右上角「上架新活動」開始。"}</div>`}
    </section>`;
  app.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => { merchant.status = b.dataset.status; viewMerchant(); }));
}

function discountRow(opts, d = {}) {
  return `<div class="discount-row" data-discount>
    <label class="field"><span>優惠類型</span><select class="input" name="d_type">${opts.discount_types.map((t) =>
      `<option value="${t.DiscountTypeID}" ${t.DiscountTypeID === d.DiscountType_FK ? "selected" : ""}>${esc(t.DiscountTypeName)}</option>`).join("")}</select></label>
    <label class="field"><span>優惠價</span><input class="input" name="d_price" type="number" min="0" required value="${d.DiscountPrice ?? ""}"></label>
    <label class="field wide"><span>說明</span><input class="input" name="d_desc" maxlength="100" placeholder="例如：憑學生證購票" value="${esc(d.DiscountDescription ?? "")}"></label>
    <label class="field"><span>開始日期（可空白）</span><input class="input" name="d_start" type="date" value="${isoDay(d.DiscountStartDate)}"></label>
    <label class="field"><span>截止日期（早鳥必填）</span><input class="input" name="d_end" type="date" value="${isoDay(d.DiscountEndDate)}"></label>
    <button type="button" class="btn-text" data-remove aria-label="刪除這筆優惠">刪除</button>
  </div>`;
}

async function viewEventForm(id) {
  if (!requireRole("商家", id ? `#/merchant/edit/${id}` : "#/merchant/new")) return;
  app.innerHTML = '<div class="skeleton" style="min-height: 320px"></div>';
  const here = routeNow();
  const [opts, venues, e] = await Promise.all([getOptions(), api("/api/venues"), id ? api(`/api/events/${id}`) : null]);
  if (routeNow() !== here) return;
  const venueOptions = (list, selected) => list.map((v) =>
    `<option value="${v.VenueID}" ${v.VenueID === selected ? "selected" : ""}>${esc(v.CityName)}・${esc(v.VenueName)}</option>`).join("");
  app.innerHTML = `
    <a class="back btn-text" href="#/merchant">← 回商家後台</a>
    <h1>${e ? "修改活動" : "上架新活動"}</h1>
    <p class="muted">${e ? `目前狀態：${statusTag(e.EventStatus)}。` : ""}送出後會變成「待審核」，管理員通過後才會出現在搜尋結果。</p>
    ${e?.EventStatus === "已退回" ? `<div class="reject-note"><b>退回理由</b>：${esc(e.EventRejectReason || "未註明理由")}</div>` : ""}
    <form class="card panel form" id="event-form">
      <label class="field"><span>活動名稱</span><input class="input" name="title" required maxlength="100" value="${esc(e?.EventTitle ?? "")}"></label>
      <div class="form-grid">
        <label class="field"><span>類別</span><select class="input" name="category_id" required>${categoryOptions(opts, e?.EventCategory_FK)}</select></label>
        <label class="field"><span>場館</span><select class="input" name="venue_id" id="venue-select" required>
          <option value="">請選擇場館</option>${venueOptions(venues, e?.EventVenue_FK)}</select></label>
        <label class="field"><span>開始日期</span><input class="input" type="date" name="start_date" required value="${isoDay(e?.EventStartDate)}"></label>
        <label class="field"><span>結束日期</span><input class="input" type="date" name="end_date" required value="${isoDay(e?.EventEndDate)}"></label>
        <label class="field"><span>全票價格（免費填 0，未公布留空）</span><input class="input" type="number" min="0" name="price" value="${e?.EventOriginalPrice ?? ""}"></label>
        <label class="field"><span>活動網址</span><input class="input" type="url" name="url" maxlength="255" placeholder="https://" value="${esc(e?.EventURL ?? "")}"></label>
        <label class="field"><span>開賣時間（選填，熱門場次請一定要填）</span><input class="input" type="datetime-local" name="sale_start" value="${e?.EventSaleStartDate ? e.EventSaleStartDate.slice(0, 16) : ""}"></label>
      </div>
      <details class="venue-new" id="venue-new">
        <summary>找不到場館？新增場館</summary>
        <div class="form-grid">
          <label class="field"><span>場館名稱</span><input class="input" id="v-name" maxlength="50"></label>
          <label class="field"><span>縣市</span><select class="input" id="v-city">${opts.cities.map((c) => `<option value="${c.CityID}">${esc(c.CityName)}</option>`).join("")}</select></label>
          <label class="field wide"><span>完整地址</span><input class="input" id="v-address" maxlength="100" placeholder="例如：臺北市大安區和平東路一段162號"></label>
        </div>
        <button type="button" class="btn" id="v-add">新增場館</button>
      </details>
      <label class="field"><span>活動說明</span><textarea class="input" name="description" rows="5">${esc(e?.EventDescription ?? "")}</textarea></label>
      <div>
        <h2>優惠</h2>
        <p class="muted small">學生票、敬老票等全票以外的票價都記在這裡。早鳥優惠一定要填截止日期。</p>
        <div id="discounts">${(e?.Discounts ?? []).map((d) => discountRow(opts, d)).join("")}</div>
        <button type="button" class="btn" id="add-discount">＋ 新增一筆優惠</button>
      </div>
      <div id="similar-warn" hidden></div>
      <p class="error" id="form-error" role="alert"></p>
      <div class="filter-actions"><a class="btn-text" href="#/merchant">取消</a>
        <button class="btn btn-primary">${e ? "儲存並重新送審" : "送出審核"}</button></div>
    </form>`;

  const form = document.getElementById("event-form");
  const box = document.getElementById("discounts");
  document.getElementById("add-discount").addEventListener("click", () => box.insertAdjacentHTML("beforeend", discountRow(opts)));
  box.addEventListener("click", (ev) => ev.target.closest("[data-remove]")?.closest("[data-discount]").remove());

  document.getElementById("v-add").addEventListener("click", async () => {
    const name = document.getElementById("v-name").value.trim();
    const address = document.getElementById("v-address").value.trim();
    if (!name || !address) { toast("請填寫場館名稱與地址"); return; }
    try {
      const { venue_id } = await api("/api/venues", { method: "POST", body: JSON.stringify({ name, address, city_id: Number(document.getElementById("v-city").value) }) });
      document.getElementById("venue-select").innerHTML = '<option value="">請選擇場館</option>' + venueOptions(await api("/api/venues"), venue_id);
      document.getElementById("venue-new").open = false;
      toast("已新增場館");
    } catch (err) { toast(err.message); }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const body = {
      title: f.title, category_id: Number(f.category_id), venue_id: Number(f.venue_id),
      start_date: f.start_date, end_date: f.end_date, price: f.price === "" ? null : Number(f.price),
      url: f.url || null, description: f.description || null, sale_start: f.sale_start || null,
      discounts: [...box.querySelectorAll("[data-discount]")].map((row) => {
        const v = (name) => row.querySelector(`[name=${name}]`).value;
        return { discount_type_id: Number(v("d_type")), price: Number(v("d_price")), description: v("d_desc") || null,
                 start_date: v("d_start") || null, end_date: v("d_end") || null };
      }),
    };
    const button = form.querySelector("button.btn-primary");
    button.disabled = true;
    try {
      // 送出前先檢查有沒有相似的活動（避免重複上架）；看過提醒、按「仍要送出審核」就不再擋
      const key = JSON.stringify([body.title, body.venue_id, body.start_date, body.end_date]);
      if (form.dataset.similarChecked !== key) {
        const similar = await api("/api/merchant/events/similar", { method: "POST", body: JSON.stringify({
          title: body.title, venue_id: body.venue_id, start_date: body.start_date, end_date: body.end_date,
          url: body.url, event_id: id ? Number(id) : null }) }).catch(() => []);
        if (similar.length) { showSimilarWarning(form, similar, key); return; }
      }
      await api(id ? `/api/merchant/events/${id}` : "/api/merchant/events", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
      toast(id ? "已儲存，等待管理員重新審核" : "已送出，等待管理員審核");
      merchant.status = "待審核";
      location.hash = "#/merchant";
    } catch (err) {
      document.getElementById("form-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

// 商家送出前的重複提醒：只列已上架的活動和自己的活動
function showSimilarWarning(form, list, key) {
  const box = document.getElementById("similar-warn");
  const likely = list.some((s) => s.Level === "很可能重複");
  box.innerHTML = `<div class="dup-warn ${likely ? "likely" : ""}" role="alert">
    <b>⚠ 系統裡已經有 ${list.length} 場${likely ? "很可能重複" : "相似"}的活動</b>，請確認不是重複上架（重複的活動會被管理員退回）：
    ${similarList(list)}
    <div class="filter-actions">
      <button type="button" class="btn-text" id="similar-back">回去修改</button>
      <button type="button" class="btn" id="similar-go">不是重複，仍要送出審核</button>
    </div></div>`;
  box.hidden = false;
  box.scrollIntoView({ block: "center", behavior: "smooth" });
  document.getElementById("similar-back").addEventListener("click", () => { box.hidden = true; form.elements.title.focus(); });
  document.getElementById("similar-go").addEventListener("click", () => {
    form.dataset.similarChecked = key;
    box.hidden = true;
    form.requestSubmit();
  });
}

// ---------- 管理員後台 ----------

const admin = { status: "待審核", keyword: "", items: [], total: 0, page: 1 };
// 每個狀態可以做的操作：[新狀態, 按鈕文字, 是否要再按一次確認]
const ADMIN_ACTIONS = {
  "待審核": [["上架中", "通過並上架", false], ["已退回", "退回…", false]],
  "上架中": [["已下架", "違規下架", true]],
  "已下架": [["上架中", "重新上架", false]],
  "已退回": [],
};

async function viewAdmin() {
  if (!requireRole("管理員", "#/admin")) return;
  app.innerHTML = `
    <div class="page-head">
      <div><h1>管理員後台</h1><p class="muted">審核商家送出的活動、處理違規下架。已結束的活動會在打開後台時自動下架。</p></div>
    </div>
    <div class="admin-tabs tabs" role="tablist">
      <button role="tab" data-tab="review" aria-selected="true">活動審核</button>
      <button role="tab" data-tab="stats" aria-selected="false">統計</button>
    </div>
    <div id="admin-body"></div>`;
  app.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => {
    app.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === t));
    t.dataset.tab === "stats" ? adminStats() : adminReview();
  }));
  adminReview();
}

async function adminReview(page = 1) {
  const body = document.getElementById("admin-body");
  if (page === 1) body.innerHTML = '<div class="skeleton" style="min-height: 240px"></div>';
  const params = new URLSearchParams({ page, page_size: 30 });
  if (admin.status) params.set("status", admin.status);
  if (admin.keyword) params.set("keyword", admin.keyword);
  const data = await api("/api/admin/events?" + params);
  if (routeNow() !== "#/admin" || !body.isConnected) return;
  if (data.auto_offlined) toast(`自動下架 ${data.auto_offlined} 場已結束的活動`);
  admin.items = page === 1 ? data.items : admin.items.concat(data.items);
  admin.total = data.total;
  admin.page = page;
  body.innerHTML = `
    ${countsBar(data.counts, admin.status)}
    <form class="admin-search" id="admin-search">
      <input class="input" name="keyword" type="search" placeholder="搜尋活動名稱或上架者" value="${esc(admin.keyword)}">
      <button class="btn">搜尋</button>
    </form>
    <p class="muted small" id="admin-count">共 ${data.total.toLocaleString("zh-TW")} 場</p>
    <section class="card" id="admin-list">${admin.items.map(adminRow).join("") || '<div class="empty">沒有符合條件的活動。</div>'}</section>
    <div class="more"><button class="btn" id="admin-more" ${admin.items.length >= data.total ? "hidden" : ""}>載入更多</button></div>`;
  body.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => { admin.status = b.dataset.status; adminReview(); }));
  document.getElementById("admin-search").addEventListener("submit", (ev) => {
    ev.preventDefault();
    admin.keyword = new FormData(ev.target).get("keyword").trim();
    adminReview();
  });
  document.getElementById("admin-more").addEventListener("click", () => adminReview(admin.page + 1));
  document.getElementById("admin-list").addEventListener("click", adminAction);
}

// 審核時的重複提醒：日期重疊、名稱相似（加上同場館或同縣市）的其他已上架或待審核活動（規則見 api/similar.py）
function similarBox(list) {
  const likely = list.some((s) => s.Level === "很可能重複");
  return `<div class="dup-warn ${likely ? "likely" : ""}" role="note">
    <b>⚠ 偵測到 ${list.length} 場${likely ? "很可能重複" : "相似"}的活動</b>，通過前請確認是不是重複上架：
    ${similarList(list)}</div>`;
}

function similarList(list) {
  return `<ul>${list.map((s) => `<li>
      <span class="tag ${s.Level === "很可能重複" ? "tag-deal" : "tag-warn"}">${esc(s.Level)}</span>
      <a href="#/event/${s.EventID}">${esc(s.EventTitle)}</a> ${statusTag(s.EventStatus)}
      <div class="muted small">${fmtRange(s.EventStartDate, s.EventEndDate)}・${esc(s.CityName)} ${esc(s.VenueName)}・上架：${esc(s.OrganizerName)}
        ・${s.Reasons.map(esc).join("、")}</div></li>`).join("")}</ul>`;
}

function adminRow(e) {
  const ended = toDate(e.EventEndDate) < new Date(new Date().toDateString());
  const actions = (ADMIN_ACTIONS[e.EventStatus] ?? []).filter(([to]) => !(to === "上架中" && ended))
    .map(([to, label, confirm]) => [to, label, confirm || (to === "上架中" && !!e.Similar?.length)]);
  return `<div class="admin-row" data-row="${e.EventID}">
    <div style="min-width: 0">
      <a href="#/event/${e.EventID}">${esc(e.EventTitle)}</a> ${statusTag(e.EventStatus)}
      <div class="muted small">${esc(e.CategoryName)}・${fmtRange(e.EventStartDate, e.EventEndDate)}${ended ? "（已結束）" : ""}・${esc(e.CityName)} ${esc(e.VenueName)}</div>
      <div class="muted small">上架：${esc(e.OrganizerName)}（${esc(e.OrganizerRole)}）・來源：${esc(e.EventDataSource)} ${saleTag(e.EventSaleStartDate)}</div>
      ${e.EventStatus === "已退回" && e.EventRejectReason ? `<div class="reject-note small">退回理由：${esc(e.EventRejectReason)}</div>` : ""}
      ${e.Similar?.length ? similarBox(e.Similar) : ""}
    </div>
    <div class="row-actions">${actions.map(([to, label, confirm]) =>
      `<button class="btn ${to === "上架中" ? "btn-primary" : ""}" data-to="${to}" data-id="${e.EventID}" data-label="${label}" ${confirm ? "data-confirm" : ""}>${label}</button>`).join("")}
      ${e.EventStatus === "已退回" ? '<span class="muted small">等商家修改後重新送審</span>' : ""}</div>
  </div>`;
}

async function adminAction(ev) {
  const btn = ev.target.closest("[data-to]");
  if (!btn) return;
  // 退回、下架要再按一次確認（不用瀏覽器的 confirm 對話框）
  if (btn.hasAttribute("data-confirm") && !btn.dataset.armed) {
    btn.dataset.armed = "1";
    btn.textContent = `確定${btn.dataset.label}？`;
    btn.classList.add("btn-danger");
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; btn.classList.remove("btn-danger"); } }, 4000);
    return;
  }
  // 退回：跳出彈窗選理由，按「確定退回」才送出
  let reason = null;
  if (btn.dataset.to === "已退回") {
    const item = admin.items.find((i) => String(i.EventID) === btn.dataset.id);
    const dup = item?.Similar?.[0];
    reason = await askRejectReason(btn.closest("[data-row]").querySelector("a").textContent,
      dup ? { reasons: ["重複上架"], note: `和「${dup.EventTitle}」（編號 ${dup.EventID}）重複` } : {});
    if (!reason) return;
  }
  btn.disabled = true;
  try {
    const r = await api(`/api/admin/events/${btn.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: btn.dataset.to, reason }) });
    toast(`已${r.action}`);
    adminReview();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
}

// 退回理由彈窗：勾選一個以上的常見理由，可以再寫補充說明。回傳理由文字；按取消回傳 null
async function askRejectReason(title, preset = {}) {
  const opts = await getOptions();
  const dialog = document.createElement("dialog");
  dialog.className = "card dialog";
  dialog.setAttribute("aria-labelledby", "reject-title");
  dialog.innerHTML = `
    <form method="dialog" class="form" id="reject-form">
      <h2 id="reject-title">退回活動</h2>
      <p class="muted small">「${esc(title)}」會改成「已退回」，商家在後台會看到你選的理由，修改後可以重新送審。</p>
      <fieldset class="reasons"><legend class="chip-label">退回理由（可複選）</legend>
        ${opts.reject_reasons.map((r) => `<label class="reason"><input type="checkbox" name="reason" value="${esc(r)}" ${preset.reasons?.includes(r) ? "checked" : ""}><span>${esc(r)}</span></label>`).join("")}
      </fieldset>
      <label class="field"><span>補充說明（選填，例如要修改哪裡）</span><textarea class="input" name="note" rows="3" maxlength="120">${esc(preset.note ?? "")}</textarea></label>
      <p class="error" id="reject-error" role="alert"></p>
      <div class="filter-actions">
        <button type="button" class="btn-text" value="cancel" id="reject-cancel">取消</button>
        <button class="btn btn-danger" value="ok">確定退回</button>
      </div>
    </form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    const form = dialog.querySelector("form");
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.querySelector("#reject-cancel").addEventListener("click", () => close(null));
    dialog.addEventListener("cancel", (ev) => { ev.preventDefault(); close(null); }); // 按 Esc
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const picked = [...form.querySelectorAll('[name="reason"]:checked')].map((i) => i.value);
      const note = form.elements.note.value.trim();
      if (!picked.length && !note) { dialog.querySelector("#reject-error").textContent = "請至少勾選一個理由，或寫下補充說明"; return; }
      close([picked.join("；"), note && `補充：${note}`].filter(Boolean).join("；").slice(0, 255));
    });
    dialog.showModal();
    dialog.querySelector('[name="reason"]').focus();
  });
}

async function adminStats() {
  const body = document.getElementById("admin-body");
  body.innerHTML = '<div class="skeleton" style="min-height: 240px"></div>';
  const s = await api("/api/admin/stats");
  if (routeNow() !== "#/admin" || !body.isConnected) return;
  body.innerHTML = `
    <div class="stats-grid">
      <section class="card panel"><h2 id="t-status">各審核狀態活動數</h2>${barChart(s.statuses, "EventStatus", "EventCount", "場", "t-status")}</section>
      <section class="card panel"><h2 id="t-region2">各地區上架中活動數</h2>${barChart(s.regions, "CityRegion", "EventCount", "場", "t-region2")}</section>
      <section class="card panel"><h2>熱門收藏排行</h2>
        <ol class="list rank">${s.popular.map((p) => `
          <li><a href="#/event/${p.EventID}">${esc(p.EventTitle)}</a><span class="tag">${p.SaveCount} 人收藏</span></li>`).join("") || '<li class="muted">還沒有人收藏</li>'}
        </ol></section>
    </div>`;
}

// ---------- 啟動 ----------

window.addEventListener("hashchange", router);
loadMe().then(router);

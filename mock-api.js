// 線上示範版的「後端」：在瀏覽器裡模擬 api/main.py 的每一支 API，讓 web/app.js 不用改就能跑。
// 資料來自 data.js（demo/build_demo.py 從 db/events.accdb 匯出的 8 張資料表）；
// 每個查詢都照 sql/ 裡對應的 .sql 檔改寫，函式上方註明是哪一個檔。
// 示範時新增、修改的資料（註冊、收藏、上架、審核）只存在看的人自己的瀏覽器（localStorage）。
(() => {
  const BASE = window.DEMO_DATA;
  const STORE_KEY = "demo-db-v1";
  const PENDING = "待審核", LISTED = "上架中", REJECTED = "已退回", OFFLINE = "已下架";
  const STATUSES = [PENDING, LISTED, REJECTED, OFFLINE];
  const USER = "使用者", MERCHANT = "商家", ADMIN = "管理員";
  const REGIONS = ["北部", "中部", "南部", "東部", "離島"];
  const CATEGORY_GROUPS = ["學習類", "休閒類"];
  const EARLY_BIRD = 2; // DiscountTypeTable 的早鳥優惠固定是 2 號（db/schema.py）
  const DEMO_PASSWORD = "test1234";
  // 和 api/main.py 的 REJECT_REASONS 相同
  const REJECT_REASONS = [
    "活動資訊不完整（缺少時間、地點或主辦單位）", "活動日期或時間有誤", "票價或優惠資訊有誤", "場館或地址有誤",
    "開賣時間有誤", "活動網址無法開啟或不是官方網址", "內容不適當或違反上架規範", "重複上架",
  ];

  // ---------- 資料：匯出的資料庫＋這個瀏覽器裡的修改 ----------

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const db = clone(BASE);
  shiftTestEvents();
  // 只存有改過的部分，避免把整個資料庫塞進 localStorage
  let changes = { events: {}, discounts: {}, users: [], venues: [], saves: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved) changes = { ...changes, ...saved };
  } catch { /* 讀不到就用原始資料 */ }

  for (const e of Object.values(changes.events)) {
    const i = db.EventTable.findIndex((x) => x.EventID === e.EventID);
    i >= 0 ? (db.EventTable[i] = e) : db.EventTable.push(e);
  }
  for (const [eventId, rows] of Object.entries(changes.discounts)) {
    db.DiscountTable = db.DiscountTable.filter((d) => d.DiscountEvent_FK !== Number(eventId)).concat(rows);
  }
  db.UserTable.push(...changes.users.map(({ password, ...u }) => u));
  db.VenueTable.push(...changes.venues);
  if (changes.saves) db.SaveTable = changes.saves;

  // 「（測試）」活動的日期是建資料庫那天往前後推算的（db/build_test_db.py）。示範版可能晚幾天才打開，
  // 所以把這些活動和它們的優惠整體往後推同樣的天數，即將開賣、早鳥即將截止的範例才會一直都在
  function shiftTestEvents() {
    const days = Math.round((Date.parse(today()) - Date.parse(window.DEMO_EXPORTED || today())) / 86400000);
    if (!days) return;
    const shift = (iso) => (iso ? `${addDays(iso.slice(0, 10), days)}${iso.slice(10)}` : iso);
    const ids = new Set();
    for (const e of db.EventTable.filter((x) => x.EventDataSource === "測試資料")) {
      ids.add(e.EventID);
      for (const k of ["EventStartDate", "EventEndDate", "EventSaleStartDate"]) e[k] = shift(e[k]);
    }
    for (const d of db.DiscountTable.filter((x) => ids.has(x.DiscountEvent_FK))) {
      d.DiscountStartDate = shift(d.DiscountStartDate);
      d.DiscountEndDate = shift(d.DiscountEndDate);
    }
  }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(changes)); } catch { /* 存不了就只在這次瀏覽有效 */ }
  }
  const touchEvent = (e) => { changes.events[e.EventID] = e; persist(); };
  const nextId = (rows, key) => rows.reduce((m, r) => Math.max(m, r[key]), 0) + 1;

  const byId = (table, key) => new Map(db[table].map((r) => [r[key], r]));
  const cities = () => byId("CityTable", "CityID");
  const categories = () => byId("CategoryTable", "CategoryID");
  const venues = () => byId("VenueTable", "VenueID");
  const users = () => byId("UserTable", "UserID");
  const types = () => byId("DiscountTypeTable", "DiscountTypeID");

  // ---------- 日期（Access 的 Date() 是今天 0 點，資料庫裡的日期都是 yyyy-mm-ddT00:00:00） ----------

  function pad(n) { return String(n).padStart(2, "0"); }
  function dayOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function today() { return dayOf(new Date()); }
  const day = (iso) => (iso ? iso.slice(0, 10) : null);
  const dayStart = (ymd) => (ymd ? `${ymd}T00:00:00` : null);
  const nowIso = () => { const d = new Date(); return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const dateDiff = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  function addDays(ymd, n) { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return dayOf(d); }
  const notEnded = (e) => day(e.EventEndDate) >= today();
  const notOnSale = (e) => !!e.EventSaleStartDate && e.EventSaleStartDate > nowIso();
  const validNow = (d) => (!d.DiscountStartDate || day(d.DiscountStartDate) <= today()) && (!d.DiscountEndDate || day(d.DiscountEndDate) >= today());

  // ---------- 查詢（對應 sql/ 的檔案） ----------

  // 把活動接上類別、場館、縣市（多數查詢共用的 JOIN）
  function joined(e) {
    const c = categories().get(e.EventCategory_FK), v = venues().get(e.EventVenue_FK), ci = cities().get(v.VenueCity_FK);
    return { e, c, v, ci };
  }

  // admin/deactivate_ended_events.sql
  function autoOffline() {
    let count = 0;
    for (const e of db.EventTable) {
      if (e.EventStatus === LISTED && !notEnded(e)) { e.EventStatus = OFFLINE; count++; }
    }
    return count;
  }

  // user_by_id.sql（不回傳密碼）
  function userById(id) {
    const u = users().get(id);
    if (!u) return null;
    return { UserID: u.UserID, UserName: u.UserName, UserEmail: u.UserEmail, UserRole: u.UserRole,
             UserDefaultCity_FK: u.UserDefaultCity_FK, CityName: cities().get(u.UserDefaultCity_FK)?.CityName ?? null };
  }

  // search_events.sql ＋ api/main.py 的 search_events 加上的條件與排序
  function searchEvents(q) {
    const region = q.get("region"), cityId = num(q.get("city_id")), from = q.get("date_from"), to = q.get("date_to");
    const categoryId = num(q.get("category_id")), group = q.get("category_group"), keyword = q.get("keyword");
    const discountTypes = q.getAll("discount_type_id").map(Number), freeOnly = q.get("free_only") === "true";
    const phase = q.get("phase");
    if (phase && !["ongoing", "upcoming", "early_bird"].includes(phase)) throw httpError(422, "活動狀態不正確");
    const earlyBirdSoon = new Set(endingSoon(14, true).map((d) => d.EventID));
    const sort = q.get("sort") || "date";
    if (region && !REGIONS.includes(region)) throw httpError(400, "地區只能是 北部、中部、南部、東部、離島");
    if (group && !CATEGORY_GROUPS.includes(group)) throw httpError(400, "類別分組只能是 學習類、休閒類");

    const discountsOf = groupBy(db.DiscountTable, "DiscountEvent_FK");
    let rows = db.EventTable.filter((e) => e.EventStatus === LISTED && notEnded(e)).map(joined).filter(({ e, c, v, ci }) =>
      (!region || ci.CityRegion === region)
      && (cityId === null || v.VenueCity_FK === cityId)
      && (!to || day(e.EventStartDate) <= to)
      && (!from || day(e.EventEndDate) >= from)
      && (categoryId === null || e.EventCategory_FK === categoryId)
      && (!group || c.CategoryGroup === group)
      && (!discountTypes.length || (discountsOf.get(e.EventID) ?? []).some((d) => discountTypes.includes(d.DiscountType_FK) && validNow(d)))
      && (!keyword || e.EventTitle.includes(keyword) || v.VenueName.includes(keyword))
      && (!freeOnly || e.EventOriginalPrice === 0)
      && (phase !== "ongoing" || day(e.EventStartDate) <= today())
      && (phase !== "upcoming" || day(e.EventStartDate) > today() || notOnSale(e))
      && (phase !== "early_bird" || earlyBirdSoon.has(e.EventID)));

    const t = today();
    const key = {
      date: ({ e }) => [day(e.EventStartDate) < t ? t : day(e.EventStartDate), e.EventEndDate, e.EventID],
      price: ({ e }) => [e.EventOriginalPrice === null ? 1 : 0, e.EventOriginalPrice ?? 0, e.EventStartDate, e.EventID],
      ending: ({ e }) => [e.EventEndDate, e.EventID],
      sale: ({ e }) => [notOnSale(e) ? 0 : 1, e.EventSaleStartDate ?? "", e.EventStartDate, e.EventID],
    }[sort];
    if (!key) throw httpError(400, "排序只能是 date、price、ending、sale");
    rows.sort((a, b) => compare(key(a), key(b)));

    const items = rows.map(({ e, c, v, ci }) => {
      const valid = (discountsOf.get(e.EventID) ?? []).filter(validNow).map((d) => d.DiscountPrice);
      return { EventID: e.EventID, EventTitle: e.EventTitle, CategoryName: c.CategoryName, CategoryGroup: c.CategoryGroup,
               EventStartDate: e.EventStartDate, EventEndDate: e.EventEndDate, EventOriginalPrice: e.EventOriginalPrice,
               EventSaleStartDate: e.EventSaleStartDate ?? null, VenueName: v.VenueName, CityName: ci.CityName,
               CityRegion: ci.CityRegion, BestDiscountPrice: valid.length ? Math.min(...valid) : null };
    });
    const page = Math.max(1, num(q.get("page")) ?? 1), size = Math.min(100, num(q.get("page_size")) ?? 20);
    return { total: items.length, page, page_size: size, items: items.slice((page - 1) * size, page * size) };
  }

  // event_detail.sql ＋ event_discounts.sql
  function loadEvent(id) {
    const ev = db.EventTable.find((x) => x.EventID === id);
    if (!ev) throw httpError(404, "找不到這個活動");
    const { e, c, v, ci } = joined(ev);
    const maps = (query) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
    const t = types();
    return {
      EventID: e.EventID, EventTitle: e.EventTitle, EventCategory_FK: e.EventCategory_FK, CategoryName: c.CategoryName,
      CategoryGroup: c.CategoryGroup, EventStartDate: e.EventStartDate, EventEndDate: e.EventEndDate,
      EventOriginalPrice: e.EventOriginalPrice, EventURL: e.EventURL, EventDataSource: e.EventDataSource,
      EventStatus: e.EventStatus, EventRejectReason: e.EventRejectReason ?? null, EventSaleStartDate: e.EventSaleStartDate ?? null,
      IsOnSale: !notOnSale(e), EventDescription: e.EventDescription, EventOrganizer_FK: e.EventOrganizer_FK,
      OrganizerName: users().get(e.EventOrganizer_FK)?.UserName, EventVenue_FK: e.EventVenue_FK,
      VenueName: v.VenueName, VenueAddress: v.VenueAddress, CityName: ci.CityName, CityRegion: ci.CityRegion,
      GoogleMapsURL: maps(v.VenueName), GoogleMapsAddressURL: maps(v.VenueAddress), IsEnded: !notEnded(e),
      Discounts: db.DiscountTable.filter((d) => d.DiscountEvent_FK === id).sort((a, b) => a.DiscountPrice - b.DiscountPrice)
        .map((d) => ({ DiscountID: d.DiscountID, DiscountType_FK: d.DiscountType_FK, DiscountTypeName: t.get(d.DiscountType_FK)?.DiscountTypeName,
                       DiscountDescription: d.DiscountDescription, DiscountPrice: d.DiscountPrice,
                       DiscountStartDate: d.DiscountStartDate, DiscountEndDate: d.DiscountEndDate, IsValidNow: validNow(d) })),
    };
  }

  // stats_events_by_region.sql / stats_events_by_city.sql / stats_events_by_category.sql
  function countListed(keyOf, extra = () => ({})) {
    const groups = new Map();
    for (const row of db.EventTable.filter((e) => e.EventStatus === LISTED && notEnded(e)).map(joined)) {
      const k = keyOf(row);
      if (!groups.has(k)) groups.set(k, { ...extra(row), rows: [] });
      groups.get(k).rows.push(row.e);
    }
    return [...groups.values()];
  }
  const statsRegions = () => countListed(({ ci }) => ci.CityRegion, ({ ci }) => ({ CityRegion: ci.CityRegion }))
    .map(({ rows, ...g }) => ({ ...g, EventCount: rows.length })).sort((a, b) => b.EventCount - a.EventCount);
  const statsCities = () => countListed(({ ci }) => ci.CityID, ({ ci }) => ({ CityName: ci.CityName, CityRegion: ci.CityRegion }))
    .map(({ rows, ...g }) => ({ ...g, EventCount: rows.length }))
    .sort((a, b) => b.EventCount - a.EventCount || a.CityName.localeCompare(b.CityName, "zh-Hant"));
  const statsCategories = () => countListed(({ c }) => c.CategoryID, ({ c }) => ({ CategoryName: c.CategoryName, CategoryGroup: c.CategoryGroup }))
    .map(({ rows, ...g }) => {
      const priced = rows.filter((e) => e.EventOriginalPrice !== null);
      return { ...g, EventCount: rows.length, FreeCount: rows.filter((e) => e.EventOriginalPrice === 0).length,
               AvgPrice: priced.length ? Math.round(priced.reduce((s, e) => s + e.EventOriginalPrice, 0) / priced.length) : null };
    }).sort((a, b) => b.EventCount - a.EventCount);

  // popular_saves.sql（前 10 名）
  function popularSaves() {
    const counts = new Map();
    for (const s of db.SaveTable) counts.set(s.SaveEvent_FK, (counts.get(s.SaveEvent_FK) ?? 0) + 1);
    return db.EventTable.filter((e) => counts.has(e.EventID) && e.EventStatus === LISTED && notEnded(e))
      .map((e) => ({ EventID: e.EventID, EventTitle: e.EventTitle, CategoryName: categories().get(e.EventCategory_FK).CategoryName,
                     EventStartDate: e.EventStartDate, EventEndDate: e.EventEndDate, SaveCount: counts.get(e.EventID) }))
      .sort((a, b) => b.SaveCount - a.SaveCount || a.EventID - b.EventID).slice(0, 10);
  }

  // early_bird_ending_soon.sql 與 save_reminders.sql：N 天內截止的優惠
  function endingSoon(days, onlyEarlyBird, eventIds = null) {
    const t = today(), last = addDays(t, days), ev = byId("EventTable", "EventID"), tt = types();
    return db.DiscountTable.filter((d) => (!onlyEarlyBird || d.DiscountType_FK === EARLY_BIRD) && d.DiscountEndDate
        && d.DiscountEndDate >= dayStart(t) && d.DiscountEndDate <= dayStart(last)  // 同 Access 的 BETWEEN Date() AND DateAdd(...)：最後一天只算到 0 點
        && ev.get(d.DiscountEvent_FK)?.EventStatus === LISTED && (!eventIds || eventIds.has(d.DiscountEvent_FK)))
      .sort((a, b) => compare([a.DiscountEndDate, a.DiscountEvent_FK], [b.DiscountEndDate, b.DiscountEvent_FK]))
      .map((d) => {
        const e = ev.get(d.DiscountEvent_FK);
        return { EventID: e.EventID, EventTitle: e.EventTitle, EventOriginalPrice: e.EventOriginalPrice,
                 DiscountTypeName: tt.get(d.DiscountType_FK)?.DiscountTypeName, DiscountPrice: d.DiscountPrice,
                 DiscountDescription: d.DiscountDescription, DiscountEndDate: d.DiscountEndDate,
                 DaysLeft: dateDiff(dayStart(t), dayStart(day(d.DiscountEndDate))) };
      });
  }

  // sale_starting_soon.sql 與 save_sale_reminders.sql：N 天內開賣（還沒開賣的才算）
  function saleSoon(days, eventIds = null) {
    const now = nowIso(), last = `${addDays(today(), days)}${now.slice(10)}`;
    return db.EventTable.filter((e) => e.EventStatus === LISTED && (eventIds ? eventIds.has(e.EventID) : notEnded(e))
        && e.EventSaleStartDate && e.EventSaleStartDate >= now && e.EventSaleStartDate <= last)
      .sort((a, b) => compare([a.EventSaleStartDate, a.EventID], [b.EventSaleStartDate, b.EventID]))
      .map((ev) => {
        const { e, c, v, ci } = joined(ev);
        return { EventID: e.EventID, EventTitle: e.EventTitle, CategoryName: c.CategoryName, EventStartDate: e.EventStartDate,
                 EventEndDate: e.EventEndDate, EventOriginalPrice: e.EventOriginalPrice, EventSaleStartDate: e.EventSaleStartDate,
                 VenueName: v.VenueName, CityName: ci.CityName,
                 DaysLeft: dateDiff(dayStart(today()), dayStart(day(e.EventSaleStartDate))) };
      });
  }

  // list_saves.sql
  function listSaves(userId) {
    return db.SaveTable.filter((s) => s.SaveUser_FK === userId).sort((a, b) => compare([b.SaveDate], [a.SaveDate])).map((s) => {
      const ev = db.EventTable.find((x) => x.EventID === s.SaveEvent_FK);
      const { e, c, v, ci } = joined(ev);
      return { EventID: e.EventID, EventTitle: e.EventTitle, CategoryName: c.CategoryName, EventStartDate: e.EventStartDate,
               EventEndDate: e.EventEndDate, EventOriginalPrice: e.EventOriginalPrice, EventSaleStartDate: e.EventSaleStartDate ?? null,
               EventStatus: e.EventStatus, VenueName: v.VenueName, CityName: ci.CityName, SaveDate: s.SaveDate };
    });
  }

  // list_venues.sql
  const listVenues = () => db.VenueTable.map((v) => ({ ...v, CityName: cities().get(v.VenueCity_FK).CityName }))
    .sort((a, b) => a.VenueCity_FK - b.VenueCity_FK || a.VenueName.localeCompare(b.VenueName, "zh-Hant"));

  // merchant/list_my_events.sql 與 admin/list_events.sql
  function eventRow(ev) {
    const { e, c, v, ci } = joined(ev), u = users().get(e.EventOrganizer_FK);
    return { EventID: e.EventID, EventTitle: e.EventTitle, CategoryName: c.CategoryName, EventStartDate: e.EventStartDate,
             EventEndDate: e.EventEndDate, EventOriginalPrice: e.EventOriginalPrice, EventStatus: e.EventStatus,
             EventRejectReason: e.EventRejectReason ?? null, EventSaleStartDate: e.EventSaleStartDate ?? null,
             EventDataSource: e.EventDataSource, VenueName: v.VenueName, CityName: ci.CityName, CityRegion: ci.CityRegion,
             EventOrganizer_FK: e.EventOrganizer_FK, OrganizerName: u?.UserName, OrganizerRole: u?.UserRole,
             DiscountCount: db.DiscountTable.filter((d) => d.DiscountEvent_FK === e.EventID).length,
             SaveCount: db.SaveTable.filter((s) => s.SaveEvent_FK === e.EventID).length };
  }

  // 重複提醒：admin/similar_events.sql 撈候選活動＋api/similar.py 的比對規則（兩邊要一致）
  const normalize = (s) => (s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  function titleSimilarity(a, b) {
    a = normalize(a); b = normalize(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return 0.9;
    const pairs = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1); if (!m.size) m.set(s, 1); return m; };
    const pa = pairs(a), pb = pairs(b);
    let common = 0, total = 0;
    for (const [k, n] of pa) { common += Math.min(n, pb.get(k) ?? 0); total += n; }
    for (const n of pb.values()) total += n;
    return (2 * common) / total;
  }
  const SIMILAR_RULES = [["很可能重複", 0.8, "venue"], ["可能重複", 0.6, "venue"], ["可能重複", 0.7, "city"], ["可能重複", 0.9, "any"]];
  function findSimilar(id) {
    const ev = db.EventTable.find((x) => x.EventID === id);
    if (!ev) throw httpError(404, "找不到這個活動");
    return similarTo(ev, id).slice(0, 5);
  }
  // ev 只需要 EventTitle、EventVenue_FK、EventStartDate、EventEndDate、EventURL（商家送出前檢查時還沒存進資料庫）
  function similarTo(ev, excludeId) {
    const target = joined(ev), u = users();
    return db.EventTable.filter((e) => e.EventID !== excludeId && [LISTED, PENDING].includes(e.EventStatus) && notEnded(e)
        && day(e.EventStartDate) <= day(ev.EventEndDate) && day(e.EventEndDate) >= day(ev.EventStartDate))
      .map((other) => {
        const o = joined(other), score = titleSimilarity(ev.EventTitle, other.EventTitle);
        const sameVenue = ev.EventVenue_FK === other.EventVenue_FK, sameCity = target.ci.CityID === o.ci.CityID;
        const ok = { venue: sameVenue, city: sameCity, any: true };
        const rule = SIMILAR_RULES.find(([, threshold, place]) => score >= threshold && ok[place]);
        if (!rule) return null;
        const reasons = [`名稱相似度 ${Math.round(score * 100)}%`, sameVenue ? "同一個場館" : sameCity ? "同縣市" : `不同縣市（${o.ci.CityName}）`, "日期重疊"];
        if (ev.EventURL && ev.EventURL === other.EventURL) reasons.push("活動網址相同");
        return { EventID: other.EventID, EventTitle: other.EventTitle, EventStatus: other.EventStatus,
                 EventStartDate: other.EventStartDate, EventEndDate: other.EventEndDate, VenueName: o.v.VenueName,
                 CityName: o.ci.CityName, OrganizerName: u.get(other.EventOrganizer_FK)?.UserName,
                 EventOrganizer_FK: other.EventOrganizer_FK,
                 Level: rule[0], Score: Math.round(score * 100) / 100, Reasons: reasons };
      })
      .filter(Boolean)
      .sort((a, b) => compare([a.Level !== "很可能重複", -a.Score, a.EventID], [b.Level !== "很可能重複", -b.Score, b.EventID]));
  }

  // admin/stats_events_by_status.sql
  const statsByStatus = () => STATUSES.map((s) => ({ EventStatus: s, EventCount: db.EventTable.filter((e) => e.EventStatus === s).length }))
    .filter((r) => r.EventCount).sort((a, b) => b.EventCount - a.EventCount);

  // ---------- 商家上架：api/main.py 的 check_event_body 與資料表驗證規則 ----------

  function checkEventBody(b) {
    if (!b.title?.trim()) throw httpError(422, "請填寫活動名稱");
    if (!b.start_date || !b.end_date) throw httpError(422, "請填寫活動開始與結束日期");
    if (b.end_date < b.start_date) throw httpError(400, "活動結束日期不能早於開始日期");
    if (b.end_date < today()) throw httpError(400, "結束日期已經過了；活動結束後會自動下架，不需要再上架");
    if (b.sale_start && b.sale_start.slice(0, 10) > b.end_date) throw httpError(400, "開賣時間不能晚於活動結束日期");
    if (b.url && !/^https?:\/\//.test(b.url)) throw httpError(400, "活動網址要以 http:// 或 https:// 開頭");
    if (b.price !== null && b.price < 0) throw httpError(400, "票價不能是負數（免費請填 0，未公布請留空）");
    for (const d of b.discounts ?? []) {
      if (d.start_date && d.end_date && d.end_date < d.start_date) throw httpError(400, "優惠截止日期不能早於開始日期");
      if (b.price !== null && d.price > b.price) throw httpError(400, `優惠價 NT$${d.price} 比全票 NT$${b.price} 還貴`);
      if (d.price < 0) throw httpError(400, "優惠價不能是負數");
      // DiscountTable 的資料表驗證規則（ValidationText 原文）
      if (d.discount_type_id === EARLY_BIRD && !d.end_date) throw httpError(400, "優惠截止日期不能早於開始日期；早鳥優惠一定要填截止日期");
    }
    if (!venues().has(b.venue_id)) throw httpError(400, "請選擇場館");
  }

  function saveEvent(b, user, id = null) {
    checkEventBody(b);
    let e;
    if (id === null) {
      e = { EventID: nextId(db.EventTable, "EventID"), EventDataSource: "商家上架", EventOrganizer_FK: user.UserID };
      db.EventTable.push(e);
    } else {
      e = db.EventTable.find((x) => x.EventID === id && x.EventOrganizer_FK === user.UserID);
      if (!e) throw httpError(404, "找不到這個活動，或不是你上架的活動");
    }
    Object.assign(e, { EventCategory_FK: b.category_id, EventVenue_FK: b.venue_id, EventTitle: b.title.trim(),
                       EventStartDate: dayStart(b.start_date), EventEndDate: dayStart(b.end_date), EventOriginalPrice: b.price,
                       EventURL: b.url?.trim() || null, EventDescription: b.description?.trim() || null,
                       EventSaleStartDate: b.sale_start ? `${b.sale_start.slice(0, 16)}:00` : null,
                       EventStatus: PENDING, EventRejectReason: null });
    // 優惠整批換成新的（merchant/delete_event_discounts.sql ＋ insert_discount.sql）
    db.DiscountTable = db.DiscountTable.filter((d) => d.DiscountEvent_FK !== e.EventID);
    let discountId = Math.max(nextId(db.DiscountTable, "DiscountID"), 100000);
    const rows = (b.discounts ?? []).map((d) => ({ DiscountID: discountId++, DiscountEvent_FK: e.EventID, DiscountType_FK: d.discount_type_id,
      DiscountDescription: d.description?.trim() || null, DiscountPrice: d.price,
      DiscountStartDate: dayStart(d.start_date), DiscountEndDate: dayStart(d.end_date) }));
    db.DiscountTable.push(...rows);
    changes.discounts[e.EventID] = rows;
    touchEvent(e);
    return { event_id: e.EventID, status: PENDING };
  }

  // 管理員可以做的狀態變更（api/main.py 的 ALLOWED_CHANGES）
  const ALLOWED_CHANGES = { [`${PENDING}>${LISTED}`]: "通過審核", [`${PENDING}>${REJECTED}`]: "退回",
                            [`${LISTED}>${OFFLINE}`]: "違規下架", [`${OFFLINE}>${LISTED}`]: "重新上架" };

  // ---------- 路由：路徑、方法對應到上面的查詢 ----------

  const routes = [
    ["GET", /^\/api\/health$/, () => ({ database: "events.accdb（線上示範版）", sample_event: db.EventTable[0] && { EventID: db.EventTable[0].EventID, EventTitle: db.EventTable[0].EventTitle } })],
    ["GET", /^\/api\/options$/, () => ({
      regions: REGIONS, category_groups: CATEGORY_GROUPS, statuses: STATUSES, reject_reasons: REJECT_REASONS,
      cities: db.CityTable, categories: db.CategoryTable, discount_types: db.DiscountTypeTable })],
    ["GET", /^\/api\/events$/, ({ q }) => searchEvents(q)],
    ["GET", /^\/api\/events\/(\d+)$/, ({ id, user }) => {
      const e = loadEvent(id);
      const canPreview = user && (user.UserRole === ADMIN || user.UserID === e.EventOrganizer_FK);
      if (e.EventStatus !== LISTED && !canPreview) throw httpError(404, "找不到這個活動，或活動已經下架");
      return e;
    }],
    ["GET", /^\/api\/stats$/, () => ({ regions: statsRegions(), cities: statsCities(), categories: statsCategories(), popular: popularSaves() })],
    ["GET", /^\/api\/discounts\/early-bird$/, ({ q }) => endingSoon(num(q.get("days")) ?? 14, true)],
    ["GET", /^\/api\/sales\/upcoming$/, ({ q }) => saleSoon(num(q.get("days")) ?? 14)],
    ["POST", /^\/api\/auth\/register$/, ({ body }) => {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (![USER, MERCHANT].includes(body.role)) throw httpError(400, "身分只能選「使用者」或「商家」");
      if (!body.name?.trim()) throw httpError(422, "請填寫暱稱");
      if (String(body.password ?? "").length < 8) throw httpError(422, "密碼至少 8 碼");
      if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) throw httpError(400, "請輸入正確的電子郵件格式");
      if (db.UserTable.some((u) => u.UserEmail === email)) throw httpError(409, "這個信箱已經註冊過了");
      const u = { UserID: nextId(db.UserTable, "UserID"), UserName: body.name.trim(), UserEmail: email,
                  UserRole: body.role, UserDefaultCity_FK: body.default_city_id ?? null };
      db.UserTable.push(u);
      changes.users.push({ ...u, password: body.password });
      persist();
      return [201, { token: `demo-${u.UserID}`, user_id: u.UserID, role: u.UserRole }];
    }],
    ["POST", /^\/api\/auth\/login$/, ({ body }) => {
      const email = String(body.email ?? "").trim().toLowerCase();
      const u = db.UserTable.find((x) => x.UserEmail === email);
      const registered = changes.users.find((x) => x.UserEmail === email);
      if (!u || body.password !== (registered ? registered.password : DEMO_PASSWORD)) throw httpError(401, "信箱或密碼錯誤");
      return { token: `demo-${u.UserID}`, user_id: u.UserID, role: u.UserRole };
    }],
    ["GET", /^\/api\/me$/, ({ need }) => need()],
    ["GET", /^\/api\/saves$/, ({ need }) => listSaves(need(USER).UserID)],
    ["GET", /^\/api\/saves\/reminders$/, ({ need, q }) => {
      const user = need(USER);
      const mine = new Set(db.SaveTable.filter((s) => s.SaveUser_FK === user.UserID).map((s) => s.SaveEvent_FK));
      return endingSoon(num(q.get("days")) ?? 7, false, mine);
    }],
    ["GET", /^\/api\/saves\/sale-reminders$/, ({ need, q }) => {
      const user = need(USER);
      const mine = new Set(db.SaveTable.filter((s) => s.SaveUser_FK === user.UserID).map((s) => s.SaveEvent_FK));
      return saleSoon(num(q.get("days")) ?? 14, mine);
    }],
    ["POST", /^\/api\/saves\/(\d+)$/, ({ need, id }) => {
      const user = need(USER);
      const e = db.EventTable.find((x) => x.EventID === id);
      if (!e || e.EventStatus !== LISTED) throw httpError(404, "找不到這個活動，或活動已經下架");
      if (db.SaveTable.some((s) => s.SaveUser_FK === user.UserID && s.SaveEvent_FK === id)) throw httpError(409, "已經收藏過這個活動");
      db.SaveTable.push({ SaveID: nextId(db.SaveTable, "SaveID"), SaveUser_FK: user.UserID, SaveEvent_FK: id, SaveDate: nowIso() });
      changes.saves = db.SaveTable; persist();
      return [201, { saved: true }];
    }],
    ["DELETE", /^\/api\/saves\/(\d+)$/, ({ need, id }) => {
      const user = need(USER);
      db.SaveTable = db.SaveTable.filter((s) => !(s.SaveUser_FK === user.UserID && s.SaveEvent_FK === id));
      changes.saves = db.SaveTable; persist();
      return { saved: false };
    }],
    ["GET", /^\/api\/venues$/, ({ need }) => { need(MERCHANT, ADMIN); return listVenues(); }],
    ["POST", /^\/api\/venues$/, ({ need, body }) => {
      need(MERCHANT, ADMIN);
      if (!body.name?.trim() || !body.address?.trim()) throw httpError(422, "請填寫場館名稱與地址");
      const v = { VenueID: nextId(db.VenueTable, "VenueID"), VenueName: body.name.trim(), VenueCity_FK: body.city_id, VenueAddress: body.address.trim() };
      db.VenueTable.push(v);
      changes.venues.push(v); persist();
      return [201, { venue_id: v.VenueID }];
    }],
    ["GET", /^\/api\/merchant\/events$/, ({ need }) => {
      const user = need(MERCHANT);
      autoOffline();
      return db.EventTable.filter((e) => e.EventOrganizer_FK === user.UserID).sort((a, b) => b.EventID - a.EventID).map(eventRow);
    }],
    // 商家送出前檢查：只回傳已上架的活動和自己的活動
    ["POST", /^\/api\/merchant\/events\/similar$/, ({ need, body }) => {
      const user = need(MERCHANT);
      if (!venues().has(body.venue_id)) throw httpError(400, "找不到這個場館");
      const ev = { EventTitle: body.title, EventVenue_FK: body.venue_id, EventStartDate: dayStart(body.start_date),
                   EventEndDate: dayStart(body.end_date), EventURL: body.url?.trim() || null };
      return similarTo(ev, body.event_id ?? 0)
        .filter((s) => s.EventStatus === LISTED || s.EventOrganizer_FK === user.UserID).slice(0, 5);
    }],
    ["POST", /^\/api\/merchant\/events$/, ({ need, body }) => [201, saveEvent(body, need(MERCHANT))]],
    ["PUT", /^\/api\/merchant\/events\/(\d+)$/, ({ need, body, id }) => saveEvent(body, need(MERCHANT), id)],
    ["GET", /^\/api\/admin\/events$/, ({ need, q }) => {
      need(ADMIN);
      const status = q.get("status"), keyword = q.get("keyword");
      if (status && !STATUSES.includes(status)) throw httpError(400, "審核狀態不正確");
      const offlined = autoOffline();
      const u = users();
      const rows = db.EventTable.filter((e) => (!status || e.EventStatus === status)
          && (!keyword || e.EventTitle.includes(keyword) || u.get(e.EventOrganizer_FK)?.UserName.includes(keyword)))
        .sort((a, b) => (status === PENDING ? a.EventID - b.EventID : b.EventID - a.EventID));
      const page = Math.max(1, num(q.get("page")) ?? 1), size = Math.min(200, num(q.get("page_size")) ?? 30);
      const counts = Object.fromEntries(STATUSES.map((s) => [s, db.EventTable.filter((e) => e.EventStatus === s).length]));
      const items = rows.slice((page - 1) * size, page * size).map(eventRow);
      for (const item of items) if (item.EventStatus === PENDING) item.Similar = findSimilar(item.EventID);
      return { total: rows.length, page, page_size: size, auto_offlined: offlined, counts, items };
    }],
    ["GET", /^\/api\/admin\/events\/(\d+)\/similar$/, ({ need, id }) => { need(ADMIN); return findSimilar(id); }],
    ["POST", /^\/api\/admin\/events\/(\d+)\/status$/, ({ need, body, id }) => {
      need(ADMIN);
      if (!STATUSES.includes(body.status)) throw httpError(400, "審核狀態不正確");
      const e = db.EventTable.find((x) => x.EventID === id);
      if (!e) throw httpError(404, "找不到這個活動");
      const action = ALLOWED_CHANGES[`${e.EventStatus}>${body.status}`];
      if (!action) throw httpError(400, `「${e.EventStatus}」的活動不能改成「${body.status}」`);
      if (body.status === LISTED && !notEnded(e)) throw httpError(400, "這場活動已經結束，不能上架");
      const reason = String(body.reason ?? "").trim().slice(0, 255) || null;
      if (body.status === REJECTED && !reason) throw httpError(400, "請選擇退回理由");
      e.EventStatus = body.status;
      e.EventRejectReason = body.status === REJECTED ? reason : null;
      touchEvent(e);
      return { event_id: id, status: body.status, action };
    }],
    ["GET", /^\/api\/admin\/stats$/, ({ need }) => {
      need(ADMIN);
      return { auto_offlined: autoOffline(), statuses: statsByStatus(), regions: statsRegions(), popular: popularSaves() };
    }],
  ];

  // ---------- 小工具 ----------

  function num(v) { return v === null || v === undefined || v === "" ? null : Number(v); }
  function compare(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }
  function groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r);
    return m;
  }
  function httpError(status, detail) { return Object.assign(new Error(detail), { status, detail }); }
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  // ---------- 攔截 fetch("/api/...") ----------

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const path = typeof input === "string" && input.startsWith("/api/") ? input.split("?")[0] : null;
    if (!path) return realFetch(input, options);
    const method = (options.method || "GET").toUpperCase();
    const q = new URLSearchParams(input.includes("?") ? input.slice(input.indexOf("?") + 1) : "");
    const auth = (options.headers?.Authorization || "").match(/^Bearer demo-(\d+)$/);
    const user = auth ? userById(Number(auth[1])) : null;
    const need = (...roles) => {
      if (!auth) throw httpError(401, "請先登入");
      if (!user) throw httpError(401, "帳號不存在，請重新登入");
      if (roles.length && !roles.includes(user.UserRole)) throw httpError(403, `這個功能只開放給${roles.join("、")}`);
      return user;
    };
    await new Promise((r) => setTimeout(r, 60)); // 模擬一點網路延遲，載入動畫才看得到
    try {
      for (const [m, re, handler] of routes) {
        const match = method === m && path.match(re);
        if (!match) continue;
        const body = options.body ? JSON.parse(options.body) : {};
        const result = handler({ q, body, user, need, id: match[1] ? Number(match[1]) : null });
        return Array.isArray(result) && typeof result[0] === "number" ? json(result[0], result[1]) : json(200, result);
      }
      return json(404, { detail: "Not Found" });
    } catch (err) {
      if (!err.status) console.error(err);
      return json(err.status || 500, { detail: err.detail || "示範版發生錯誤" });
    }
  };

  // 伺服器啟動時的自動下架（api/main.py 的 lifespan）
  autoOffline();

  // 頁尾的「重設示範資料」：清掉這個瀏覽器裡的修改與登入狀態
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest?.("#demo-reset")) return;
    ev.preventDefault();
    try { localStorage.removeItem(STORE_KEY); localStorage.removeItem("token"); } catch { /* 略過 */ }
    location.hash = "#/";
    location.reload();
  });
})();

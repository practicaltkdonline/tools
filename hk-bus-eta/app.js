const KMB_BASE = "https://data.etabus.gov.hk/v1/transport/kmb";
const CTB_BASE = "https://rt.data.gov.hk/v2/transport/citybus";
const TIME_API = "https://timeinterval.hkbuseta.com/times";

let state = {
  route: null,
  // 合併後的方向：[{ key, orig_tc, dest_tc, variants: [{co, bound, service_type, ...}] }]
  directions: [],
  selectedDir: null,   // 合併後的方向物件
  stops: [],           // [{ seq, stop, name_tc, companies: ['KMB','CTB'], stopIds: {KMB: id, CTB: id} }]
  timeCache: {},
  openStopId: null,
};

const $ = (id) => document.getElementById(id);
const routeInput = $("routeInput");
const searchBtn = $("searchBtn");
const directionBar = $("directionBar");
const currentDirInfo = $("currentDirInfo");
const mainView = $("mainView");
const stopList = $("stopList");
const journeyView = $("journeyView");
const fromStopSelect = $("fromStopSelect");
const toStopSelect = $("toStopSelect");
const calcJourneyBtn = $("calcJourneyBtn");
const journeyResult = $("journeyResult");
const fabJourney = $("fabJourney");
const backToStopsBtn = $("backToStopsBtn");

// ========== 工具 ==========
function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function minsFromNow(iso) {
  if (!iso) return null;
  const diff = Math.round((new Date(iso) - new Date()) / 60000);
  if (diff <= 0) return "即將到站";
  return `${diff} 分鐘`;
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} 分鐘`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} 小時 ${m} 分鐘` : `${h} 小時`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function companyLabel(co) {
  if (co === "KMB" || co === "LWB") return "九巴";
  if (co === "CTB") return "城巴";
  return co;
}

// 簡單正規化終點名稱，方便合併（去掉括號內容差異、空白）
function normalizeName(name) {
  if (!name) return "";
  return name
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/中$/g, "(中)")
    .toLowerCase();
}

// ========== 畫面切換 ==========
function showMainView() {
  mainView.classList.remove("hidden");
  journeyView.classList.add("hidden");
  fabJourney.classList.remove("hidden");
}

function showJourneyView() {
  mainView.classList.add("hidden");
  journeyView.classList.remove("hidden");
  fabJourney.classList.add("hidden");
  populateJourneySelects();
  journeyResult.classList.add("hidden");
}

// ========== Step 1: 查路線 ==========
searchBtn.addEventListener("click", searchRoute);
routeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchRoute();
});

async function searchRoute() {
  const route = routeInput.value.trim().toUpperCase();
  if (!route) {
    alert("請輸入路線號碼");
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = "查詢中...";
  directionBar.classList.add("hidden");
  currentDirInfo.classList.add("hidden");
  mainView.classList.add("hidden");
  journeyView.classList.add("hidden");
  fabJourney.classList.add("hidden");

  try {
    const [kmbRes, ctbRes] = await Promise.allSettled([
      fetchJSON(`${KMB_BASE}/route/`),
      fetchJSON(`${CTB_BASE}/route/ctb`),
    ]);

    const rawVariants = [];

    // 九巴
    if (kmbRes.status === "fulfilled") {
      const matched = (kmbRes.value.data || []).filter((r) => r.route === route);
      matched.forEach((r) => {
        rawVariants.push({
          co: "KMB",
          route: r.route,
          bound: r.bound,
          service_type: r.service_type || "1",
          orig_tc: r.orig_tc,
          dest_tc: r.dest_tc,
        });
      });
    }

    // 城巴：要驗證方向是否有站
    if (ctbRes.status === "fulfilled") {
      const matched = (ctbRes.value.data || []).filter((r) => r.route === route);
      for (const r of matched) {
        for (const [bound, dirPath, orig, dest] of [
          ["O", "outbound", r.orig_tc, r.dest_tc],
          ["I", "inbound", r.dest_tc, r.orig_tc],
        ]) {
          try {
            const rs = await fetchJSON(
              `${CTB_BASE}/route-stop/ctb/${r.route}/${dirPath}`
            );
            if (rs.data && rs.data.length > 0) {
              rawVariants.push({
                co: "CTB",
                route: r.route,
                bound,
                service_type: null,
                orig_tc: orig,
                dest_tc: dest,
              });
            }
          } catch {}
        }
      }
    }

    if (rawVariants.length === 0) {
      alert(`找不到路線 ${route}\n請確認號碼是否正確（支援九巴／龍運／城巴）`);
      return;
    }

    // 合併：同一起點→終點 合成一個方向
    const groupMap = new Map();
    rawVariants.forEach((v) => {
      const key = `${normalizeName(v.orig_tc)}|${normalizeName(v.dest_tc)}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          orig_tc: v.orig_tc,
          dest_tc: v.dest_tc,
          variants: [],
        });
      }
      groupMap.get(key).variants.push(v);
    });

    const directions = Array.from(groupMap.values());

    state.route = route;
    state.directions = directions;
    state.openStopId = null;

    renderDirectionBar();
    directionBar.classList.remove("hidden");

    // 預設第一個方向
    await selectDirection(directions[0]);
    showMainView();
  } catch (err) {
    console.error(err);
    alert("查詢失敗，請稍後再試\n" + err.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "查詢";
  }
}

// ========== 方向選擇 ==========
function renderDirectionBar() {
  directionBar.innerHTML = "";
  state.directions.forEach((dir) => {
    const btn = document.createElement("button");
    const isActive = dir === state.selectedDir;
    btn.className = "dir-btn" + (isActive ? " active" : "");

    // 顯示有哪些公司
    const cos = [...new Set(dir.variants.map((v) => companyLabel(v.co)))];
    btn.innerHTML = `
      ${dir.orig_tc} → ${dir.dest_tc}
      <span class="dir-label">${cos.join(" / ")}</span>
    `;
    btn.onclick = () => {
      if (dir !== state.selectedDir) selectDirection(dir);
    };
    directionBar.appendChild(btn);
  });
}

async function selectDirection(dir) {
  state.selectedDir = dir;
  state.openStopId = null;

  renderDirectionBar();

  // 階段一：多 service_type 或聯營停站差異時顯示提示
  const serviceTypes = new Set(
    dir.variants.filter((v) => v.co === "KMB" || v.co === "LWB").map((v) => v.service_type || "1")
  );
  const companies = new Set(dir.variants.map((v) => v.co));
  const maybeSpecial = serviceTypes.size > 1 || companies.size > 1;

  let infoHtml = `${state.route}｜${dir.orig_tc} → ${dir.dest_tc}`;
  if (maybeSpecial) {
    infoHtml += `<br><span class="special-hint">此路線可能有特別班次，實際以到站時間為準</span>`;
  }
  currentDirInfo.innerHTML = infoHtml;
  currentDirInfo.classList.remove("hidden");
  stopList.innerHTML = `<div class="eta-loading">載入車站中...</div>`;
  mainView.classList.remove("hidden");

  // 如果在車程頁，也更新下拉
  if (!journeyView.classList.contains("hidden")) {
    // 保持在車程頁，只更新 stops
  }

  try {
    // 對每個 variant 取車站列表
    const variantStops = await Promise.all(
      dir.variants.map(async (v) => {
        try {
          let raw = [];
          if (v.co === "CTB") {
            const dirPath = v.bound === "O" ? "outbound" : "inbound";
            const rs = await fetchJSON(
              `${CTB_BASE}/route-stop/ctb/${v.route}/${dirPath}`
            );
            raw = (rs.data || []).map((s) => ({
              seq: Number(s.seq),
              stop: s.stop,
            }));
          } else {
            const dirPath = v.bound === "O" ? "outbound" : "inbound";
            const st = v.service_type || "1";
            const rs = await fetchJSON(
              `${KMB_BASE}/route-stop/${v.route}/${dirPath}/${st}`
            );
            raw = (rs.data || []).map((s) => ({
              seq: Number(s.seq),
              stop: s.stop,
            }));
          }

          // 取站名
          const withName = await Promise.all(
            raw.map(async (s) => {
              try {
                const base = v.co === "CTB" ? CTB_BASE : KMB_BASE;
                const stopData = await fetchJSON(`${base}/stop/${s.stop}`);
                return {
                  seq: s.seq,
                  stop: s.stop,
                  name_tc: stopData.data?.name_tc || s.stop,
                  co: v.co,
                };
              } catch {
                return {
                  seq: s.seq,
                  stop: s.stop,
                  name_tc: s.stop,
                  co: v.co,
                };
              }
            })
          );
          return { variant: v, stops: withName };
        } catch {
          return { variant: v, stops: [] };
        }
      })
    );

    // 選停站最多的作為主列表
    variantStops.sort((a, b) => b.stops.length - a.stops.length);
    const primary = variantStops[0];
    if (!primary || primary.stops.length === 0) {
      stopList.innerHTML = `<div class="eta-error">此方向暫無車站資料</div>`;
      state.stops = [];
      return;
    }

    // 建立合併列表：以主列表為序，標記每站屬於哪些公司
    const merged = primary.stops.map((s) => {
      const companies = [s.co];
      const stopIds = { [s.co]: s.stop };

      // 在其他 variant 找同名站
      for (let i = 1; i < variantStops.length; i++) {
        const other = variantStops[i];
        const match = other.stops.find(
          (os) => normalizeName(os.name_tc) === normalizeName(s.name_tc)
        );
        if (match) {
          if (!companies.includes(match.co)) companies.push(match.co);
          stopIds[match.co] = match.stop;
        }
      }

      return {
        seq: s.seq,
        stop: s.stop, // 主列表的 stop id（用於 key）
        name_tc: s.name_tc,
        companies,
        stopIds,
      };
    });

    // 補上其他 variant 獨有的站（插在相近位置較難，先附加在後面並標註）
    for (let i = 1; i < variantStops.length; i++) {
      const other = variantStops[i];
      other.stops.forEach((os) => {
        const exists = merged.some(
          (m) => normalizeName(m.name_tc) === normalizeName(os.name_tc)
        );
        if (!exists) {
          merged.push({
            seq: os.seq + 0.5, // 稍微偏移，排序時靠後
            stop: os.stop,
            name_tc: os.name_tc,
            companies: [os.co],
            stopIds: { [os.co]: os.stop },
          });
        }
      });
    }

    merged.sort((a, b) => a.seq - b.seq);
    // 重新編 seq 顯示用
    merged.forEach((m, idx) => {
      m.displaySeq = idx + 1;
    });

    state.stops = merged;
    renderStopList();

    // 若在車程頁，更新下拉
    if (!journeyView.classList.contains("hidden")) {
      populateJourneySelects();
    }
  } catch (err) {
    console.error(err);
    stopList.innerHTML = `<div class="eta-error">載入車站失敗：${err.message}</div>`;
  }
}

// ========== 車站列表 + Accordion ETA ==========
function renderStopList() {
  stopList.innerHTML = "";
  state.stops.forEach((s) => {
    const item = document.createElement("div");
    item.className = "stop-item" + (state.openStopId === s.stop ? " open" : "");
    item.dataset.stop = s.stop;

    // 標籤
    let tagsHtml = "";
    if (s.companies.length > 1) {
      tagsHtml = `<span class="tag tag-both">共同</span>`;
    } else if (s.companies.includes("KMB") || s.companies.includes("LWB")) {
      tagsHtml = `<span class="tag tag-kmb">九巴</span>`;
    } else if (s.companies.includes("CTB")) {
      tagsHtml = `<span class="tag tag-ctb">城巴</span>`;
    }

    item.innerHTML = `
      <div class="stop-header">
        <span class="seq">${s.displaySeq || s.seq}</span>
        <span class="name">${s.name_tc}</span>
        <span class="tags">${tagsHtml}</span>
        <span class="chevron">▼</span>
      </div>
      <div class="eta-panel" id="eta-${s.stop}">
        <div class="eta-loading">載入到站時間...</div>
      </div>
    `;

    item.querySelector(".stop-header").onclick = () => toggleStop(s);
    stopList.appendChild(item);

    if (state.openStopId === s.stop) {
      loadETAForStop(s);
    }
  });
}

function toggleStop(stop) {
  state.openStopId = state.openStopId === stop.stop ? null : stop.stop;
  renderStopList();
}

async function loadETAForStop(stop) {
  const panel = document.getElementById(`eta-${stop.stop}`);
  if (!panel) return;

  panel.innerHTML = `<div class="eta-loading">載入到站時間...</div>`;

  try {
    const allEtas = [];

    // 對每個有此站的公司、以及該公司所有 variant（含不同 service_type）查 ETA
    for (const co of stop.companies) {
      const stopId = stop.stopIds[co];
      if (!stopId) continue;

      const variants = state.selectedDir.variants.filter((v) => v.co === co);
      if (variants.length === 0) continue;

      for (const variant of variants) {
        try {
          if (co === "CTB") {
            const data = await fetchJSON(
              `${CTB_BASE}/eta/ctb/${stopId}/${variant.route}`
            );
            let etas = (data.data || []).filter((e) => e.eta);
            const filtered = etas.filter((e) => e.dir === variant.bound);
            if (filtered.length > 0) etas = filtered;
            etas.forEach((e) => {
              allEtas.push({
                ...e,
                co: "CTB",
                dest_tc: e.dest_tc || e.dest || "",
                rmk: e.rmk_tc || e.rmk_en || e.rmk || "",
              });
            });
            // 城巴同一 route 查一次即可
            break;
          } else {
            const st = variant.service_type || "1";
            const data = await fetchJSON(
              `${KMB_BASE}/eta/${stopId}/${variant.route}/${st}`
            );
            let etas = (data.data || []).filter(
              (e) => e.dir === variant.bound && e.eta
            );
            if (etas.length === 0) {
              etas = (data.data || []).filter((e) => e.eta);
            }
            etas.forEach((e) => {
              allEtas.push({
                ...e,
                co: "KMB",
                dest_tc: e.dest_tc || "",
                rmk: e.rmk_tc || e.rmk_en || e.rmk || "",
              });
            });
          }
        } catch (err) {
          console.warn("ETA fetch failed for", co, variant.service_type, err);
        }
      }
    }

    // 同一時間去重（不同 service_type 可能回相同 ETA）
    const seen = new Set();
    const deduped = [];
    for (const e of allEtas) {
      const key = `${e.co}|${e.eta}|${e.dest_tc || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(e);
    }
    allEtas.length = 0;
    allEtas.push(...deduped);

    // 按時間排序，取前 3
    allEtas.sort((a, b) => new Date(a.eta) - new Date(b.eta));
    const top = allEtas.slice(0, 3);

    if (top.length === 0) {
      panel.innerHTML = `
        <div class="eta-empty">
          目前沒有預計到站時間<br>
          <small>可能剛過站或末班車已過</small>
        </div>`;
      return;
    }

    panel.innerHTML = top
      .map((e, i) => {
        const time = formatTime(e.eta);
        const mins = minsFromNow(e.eta);
        const dest = e.dest_tc || "";
        const rmk = (e.rmk || "").trim();
        const coClass = e.co === "CTB" ? "ctb" : "kmb";
        return `
          <div class="eta-row">
            <div>
              <div class="eta-time">${time}</div>
              <div class="eta-mins">${mins || ""}</div>
              ${rmk ? `<div class="eta-rmk">${rmk}</div>` : ""}
            </div>
            <div class="eta-dest">
              <div class="eta-co ${coClass}">${companyLabel(e.co)}</div>
              ${i === 0 ? "最近" : `第 ${i + 1} 班`}<br>
              ${dest ? `往 ${dest}` : ""}
            </div>
          </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    panel.innerHTML = `<div class="eta-error">無法取得到站時間</div>`;
  }
}

// ========== 車程畫面 ==========
fabJourney.addEventListener("click", showJourneyView);
backToStopsBtn.addEventListener("click", showMainView);

function populateJourneySelects() {
  fromStopSelect.innerHTML = `<option value="">— 選擇上車站 —</option>`;
  toStopSelect.innerHTML = `<option value="">— 選擇落車站 —</option>`;
  state.stops.forEach((s) => {
    const opt1 = document.createElement("option");
    opt1.value = s.stop;
    opt1.textContent = `${s.displaySeq || s.seq}. ${s.name_tc}`;
    fromStopSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = s.stop;
    opt2.textContent = `${s.displaySeq || s.seq}. ${s.name_tc}`;
    toStopSelect.appendChild(opt2);
  });
}

fromStopSelect.addEventListener("change", () => {
  const fromId = fromStopSelect.value;
  const currentTo = toStopSelect.value;
  toStopSelect.innerHTML = `<option value="">— 選擇落車站 —</option>`;
  if (!fromId) {
    state.stops.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.stop;
      opt.textContent = `${s.displaySeq || s.seq}. ${s.name_tc}`;
      toStopSelect.appendChild(opt);
    });
  } else {
    const fromIdx = state.stops.findIndex((s) => s.stop === fromId);
    state.stops.forEach((s, idx) => {
      if (idx > fromIdx) {
        const opt = document.createElement("option");
        opt.value = s.stop;
        opt.textContent = `${s.displaySeq || s.seq}. ${s.name_tc}`;
        toStopSelect.appendChild(opt);
      }
    });
  }
  if (currentTo && [...toStopSelect.options].some((o) => o.value === currentTo)) {
    toStopSelect.value = currentTo;
  }
});

toStopSelect.addEventListener("change", () => {
  const toId = toStopSelect.value;
  const currentFrom = fromStopSelect.value;
  fromStopSelect.innerHTML = `<option value="">— 選擇上車站 —</option>`;
  if (!toId) {
    state.stops.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.stop;
      opt.textContent = `${s.displaySeq || s.seq}. ${s.name_tc}`;
      fromStopSelect.appendChild(opt);
    });
  } else {
    const toIdx = state.stops.findIndex((s) => s.stop === toId);
    state.stops.forEach((s, idx) => {
      if (idx < toIdx) {
        const opt = document.createElement("option");
        opt.value = s.stop;
        opt.textContent = `${s.displaySeq || s.seq}. ${s.name_tc}`;
        fromStopSelect.appendChild(opt);
      }
    });
  }
  if (currentFrom && [...fromStopSelect.options].some((o) => o.value === currentFrom)) {
    fromStopSelect.value = currentFrom;
  }
});

// ========== 計算車程 ==========
calcJourneyBtn.addEventListener("click", calculateJourney);

async function getTimeData(prefix) {
  if (state.timeCache[prefix]) return state.timeCache[prefix];
  try {
    const data = await fetchJSON(`${TIME_API}/${prefix}.json`);
    state.timeCache[prefix] = data;
    return data;
  } catch {
    return null;
  }
}

async function calculateJourney() {
  const fromId = fromStopSelect.value;
  const toId = toStopSelect.value;

  if (!fromId || !toId) {
    alert("請選擇上車站和落車站");
    return;
  }

  const fromIdx = state.stops.findIndex((s) => s.stop === fromId);
  const toIdx = state.stops.findIndex((s) => s.stop === toId);

  if (fromIdx < 0 || toIdx < 0 || fromIdx >= toIdx) {
    alert("落車站必須在上車站之後");
    return;
  }

  const fromStop = state.stops[fromIdx];
  const toStop = state.stops[toIdx];
  const stopCount = toIdx - fromIdx;

  calcJourneyBtn.disabled = true;
  calcJourneyBtn.textContent = "計算中...";
  journeyResult.classList.remove("hidden");
  journeyResult.innerHTML = `<div class="eta-loading">正在估算車程...</div>`;

  try {
    let totalSeconds = 0;
    let missingSegments = 0;
    const neededPrefixes = new Set();

    for (let i = fromIdx; i < toIdx; i++) {
      neededPrefixes.add(state.stops[i].stop.slice(0, 2));
    }

    const prefixData = {};
    await Promise.all(
      [...neededPrefixes].map(async (p) => {
        prefixData[p] = await getTimeData(p);
      })
    );

    for (let i = fromIdx; i < toIdx; i++) {
      const start = state.stops[i].stop;
      const end = state.stops[i + 1].stop;
      const prefix = start.slice(0, 2);
      const data = prefixData[prefix];

      let seg = null;
      if (data && data[start] && data[start][end] != null) {
        seg = data[start][end];
      }

      if (seg != null && !isNaN(seg)) {
        totalSeconds += seg;
      } else {
        totalSeconds += 100;
        missingSegments++;
      }
    }

    const durationText = formatDuration(totalSeconds);

    let html = `
      <div class="time">${durationText}</div>
      <div class="detail">
        ${fromStop.displaySeq || fromStop.seq}. ${fromStop.name_tc}<br>
        → ${toStop.displaySeq || toStop.seq}. ${toStop.name_tc}<br>
        共 ${stopCount} 站
      </div>
    `;

    if (missingSegments > 0) {
      html += `<div class="warn">部分路段缺少歷史數據，已用估計值補上</div>`;
    } else {
      html += `<div class="detail" style="margin-top:8px;">根據歷史平均車速估算 · 僅供參考</div>`;
    }

    journeyResult.innerHTML = html;
  } catch (err) {
    console.error(err);
    journeyResult.innerHTML = `<div class="eta-error">計算失敗：${err.message}</div>`;
  } finally {
    calcJourneyBtn.disabled = false;
    calcJourneyBtn.textContent = "計算車程";
  }
}

// 初始
routeInput.focus();

const API_BASE = "https://data.etabus.gov.hk/v1/transport/kmb";

// 狀態
let state = {
  route: null,
  directions: [],      // 可用方向
  selectedDir: null,   // { bound, service_type, orig_tc, dest_tc }
  stops: [],           // [{ seq, stop, name_tc }]
  selectedStop: null,
};

// DOM
const $ = (id) => document.getElementById(id);
const routeInput = $("routeInput");
const searchBtn = $("searchBtn");
const directionList = $("directionList");
const stopSelect = $("stopSelect");
const stopList = $("stopList");
const etaResult = $("etaResult");
const selectedRouteInfo = $("selectedRouteInfo");
const etaRouteInfo = $("etaRouteInfo");
const refreshEtaBtn = $("refreshEtaBtn");

// ========== 工具 ==========
function showStep(n) {
  [1, 2, 3, 4].forEach((i) => {
    $(`step${i}`).classList.toggle("hidden", i !== n);
  });
}

function goBack(toStep) {
  showStep(toStep);
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-HK", {
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

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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

  try {
    // 取得所有路線，再過濾
    const data = await fetchJSON(`${API_BASE}/route/`);
    const matched = data.data.filter((r) => r.route === route);

    if (matched.length === 0) {
      alert(`找不到路線 ${route}\n請確認號碼是否正確（目前支援九巴/龍運）`);
      return;
    }

    state.route = route;
    state.directions = matched;

    // 渲染方向選項
    directionList.innerHTML = "";
    matched.forEach((dir) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.innerHTML = `
        <strong>${dir.orig_tc} → ${dir.dest_tc}</strong>
        <div class="bound">${dir.bound === "O" ? "去程 (Outbound)" : "回程 (Inbound)"} · 服務類型 ${dir.service_type}</div>
      `;
      btn.onclick = () => selectDirection(dir);
      directionList.appendChild(btn);
    });

    showStep(2);
  } catch (err) {
    console.error(err);
    alert("查詢失敗，請稍後再試\n" + err.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "查詢";
  }
}

// ========== Step 2: 選擇方向 ==========
async function selectDirection(dir) {
  state.selectedDir = dir;
  selectedRouteInfo.textContent = `${state.route}｜${dir.orig_tc} → ${dir.dest_tc}`;

  // 顯示載入
  stopList.innerHTML = `<div class="loading">載入車站中...</div>`;
  stopSelect.innerHTML = `<option value="">載入中...</option>`;
  showStep(3);

  try {
    const boundPath = dir.bound === "O" ? "outbound" : "inbound";
    const rs = await fetchJSON(
      `${API_BASE}/route-stop/${state.route}/${boundPath}/${dir.service_type}`
    );

    if (!rs.data || rs.data.length === 0) {
      stopList.innerHTML = `<div class="error">此方向暫無車站資料</div>`;
      return;
    }

    // 平行取得每個站名
    const stopsWithName = await Promise.all(
      rs.data.map(async (s) => {
        try {
          const stopData = await fetchJSON(`${API_BASE}/stop/${s.stop}`);
          return {
            seq: s.seq,
            stop: s.stop,
            name_tc: stopData.data?.name_tc || s.stop,
            name_en: stopData.data?.name_en || "",
          };
        } catch {
          return {
            seq: s.seq,
            stop: s.stop,
            name_tc: s.stop,
            name_en: "",
          };
        }
      })
    );

    // 按 seq 排序
    stopsWithName.sort((a, b) => Number(a.seq) - Number(b.seq));
    state.stops = stopsWithName;

    // 下拉選單
    stopSelect.innerHTML = `<option value="">— 請選擇車站 —</option>`;
    stopsWithName.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.stop;
      opt.textContent = `${s.seq}. ${s.name_tc}`;
      stopSelect.appendChild(opt);
    });

    // 列表（方便手機點選）
    stopList.innerHTML = "";
    stopsWithName.forEach((s) => {
      const div = document.createElement("div");
      div.className = "stop-item";
      div.innerHTML = `
        <span class="seq">${s.seq}</span>
        <span class="name">${s.name_tc}</span>
      `;
      div.onclick = () => selectStop(s);
      stopList.appendChild(div);
    });
  } catch (err) {
    console.error(err);
    stopList.innerHTML = `<div class="error">載入車站失敗：${err.message}</div>`;
  }
}

// 下拉選單變更
stopSelect.addEventListener("change", () => {
  const stopId = stopSelect.value;
  if (!stopId) return;
  const s = state.stops.find((x) => x.stop === stopId);
  if (s) selectStop(s);
});

// ========== Step 3 → 4: 選擇車站並查 ETA ==========
function selectStop(stop) {
  state.selectedStop = stop;
  stopSelect.value = stop.stop; // 同步下拉

  etaRouteInfo.innerHTML = `
    <strong>${state.route}</strong>　${state.selectedDir.orig_tc} → ${state.selectedDir.dest_tc}<br>
    車站：${stop.seq}. ${stop.name_tc}
  `;

  showStep(4);
  loadETA();
}

async function loadETA() {
  etaResult.innerHTML = `<div class="loading">載入到站時間...</div>`;

  const { route, selectedDir, selectedStop } = state;
  if (!selectedStop) return;

  try {
    const data = await fetchJSON(
      `${API_BASE}/eta/${selectedStop.stop}/${route}/${selectedDir.service_type}`
    );

    // 過濾同一方向（有時會回多個）
    let etas = (data.data || []).filter(
      (e) => e.dir === selectedDir.bound && e.eta
    );

    // 若過濾後沒有，就用全部有 eta 的
    if (etas.length === 0) {
      etas = (data.data || []).filter((e) => e.eta);
    }

    // 只取最近 3 班
    etas = etas.slice(0, 3);

    if (etas.length === 0) {
      etaResult.innerHTML = `
        <div class="eta-empty">
          目前沒有預計到站時間<br>
          <small>可能剛過站、末班車已過，或此站暫時無資料</small>
        </div>`;
      return;
    }

    etaResult.innerHTML = etas
      .map((e, i) => {
        const time = formatTime(e.eta);
        const mins = minsFromNow(e.eta);
        const dest = e.dest_tc || "";
        return `
          <div class="eta-item">
            <div>
              <div class="eta-time">${time}</div>
              <div class="eta-mins">${mins || ""}</div>
            </div>
            <div class="eta-dest">
              ${i === 0 ? "最近" : `第 ${i + 1} 班`}<br>
              ${dest ? `往 ${dest}` : ""}
            </div>
          </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    etaResult.innerHTML = `<div class="error">無法取得到站時間<br>${err.message}</div>`;
  }
}

refreshEtaBtn.addEventListener("click", loadETA);

// 初始聚焦
routeInput.focus();

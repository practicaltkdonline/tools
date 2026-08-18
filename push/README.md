# PWA Push 通知測試頁面

純前端測試工具，可在本地 (`localhost`) 或 GitHub Pages 使用。

## 檔案說明

| 檔案 | 用途 |
|------|------|
| `index.html` | 主頁面（請求權限、訂閱、顯示訂閱 JSON） |
| `sw.js` | Service Worker（接收 push 並顯示通知） |
| `manifest.json` | PWA Manifest（讓網站可「加入主畫面」） |

## 快速開始

### 本地測試（推薦）

1. 進入此資料夾
2. 用任何靜態伺服器啟動（必須是 `localhost`，不能用 `file://`）

```bash
# 方法 1：Python
python3 -m http.server 8080

# 方法 2：Node
npx serve -p 8080
```

3. 用 Chrome / Edge 開啟 `http://localhost:8080`

### GitHub Pages

把整個資料夾推到 GitHub repo，開啟 Pages 即可（記得必須是 HTTPS）。

## 測試步驟

1. 開啟頁面 → 確認 Service Worker 狀態變成「已啟用」
2. 點 **「1. 請求通知權限」** → 允許
3. 點 **「2. 訂閱 Push 通知」**
4. 複製下方的訂閱 JSON（之後給後端用）
5. （可選）點「本地模擬通知」確認顯示效果

### 用 Chrome DevTools 模擬真正的 Push

1. 開啟 DevTools → Application → Service Workers
2. 找到本頁的 Service Worker
3. 點 **Push** 按鈕（可輸入 JSON payload 測試）

## VAPID 金鑰（測試用）

目前頁面內建的測試公鑰：

```
Public Key:
BM7pdoTTyl900tFwHcevpZvF_GK-sW88MShDXeOvTcd_37sQWI19Qk1Le4lSBpl7T12_-bNHbLgwrGtg11jUbF4
```

對應的私鑰（**只給後端發送時使用，絕對不要放到前端**）：

```
Private Key:
XMI5uHdbjHaR6kjTyduTmnXbgrR-i4O80yhPIeeoqHU
```

> 正式環境請自己重新產生一組：
> ```bash
> npx web-push generate-vapid-keys
> ```

## iOS 注意事項

- 必須把網站「加入主畫面」
- 從主畫面圖示開啟 App 後，才能正常請求通知權限
- 一般 Safari 分頁無法使用 Web Push

## 下一步（獨發通知）

1. 把訂閱 JSON 存到你的後端資料庫（建議綁定使用者 ID）
2. 後端使用 `web-push` 套件 + 私鑰發送：

```js
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  '公鑰',
  '私鑰'
);

await webpush.sendNotification(subscription, JSON.stringify({
  title: '比賽結果更新',
  body: '你的選手已出線！',
  url: '/results'
}));
```

有需要我可以再幫你做一個簡單的 Node.js 發送範例。

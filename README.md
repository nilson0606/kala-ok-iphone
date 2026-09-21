# 唱一下：桌機本機技術原型

目標：看 YouTube 播放器唱歌，音訊在使用者電腦處理，最終只保留歌名與分數。

## 目前功能

- YouTube 原生嵌入播放與播放時間。
- 桌機麥克風選擇、音高、音名、音分、音量、最近八秒曲線。
- 直接音訊存取診斷，沒有伺服器代理或第三方轉檔服務。
- 手動 BPM 節拍燈與時間補償工具。
- 音訊中斷、裝置改變、頁面隱藏時停止收音。

尚未完成 yt2mp3、人聲分離、歌曲主旋律／節拍擷取、歌曲基準與評分。沒有基準就不給分。直接讀取失敗可能由 CORS、網路或阻擋造成，診斷不會武斷區分。

麥克風分析不使用 MediaRecorder、不上傳、不寫入檔案、localStorage 或 IndexedDB。短暫音高數值在記憶體中；停止即清除。正式版演唱紀錄才會儲存歌名與分數。YouTube 播放與診斷仍會連線到 Google / YouTube。

## 執行

Node.js 20+，不需安裝套件：

```sh
npm start
npm test
```

桌面使用 http://localhost:4173 。iPhone 請使用 GitHub Pages 的 HTTPS 網址，以 Safari 開啟。電腦 localhost 不是 iPhone localhost；一般 HTTP 區網位址不能作為手機麥克風測試環境。

## iPhone 驗收

1. 貼 YouTube 影片網址，載入並在播放器內點播放。
2. 點「測試此網址的音訊存取」，查看實際成功／失敗的階段。這是存取可行性測試，不是完整的下載器；未處理播放器簽章、登入或驗證挑戰。
3. 戴耳機，允許麥克風，持續唱單音看音高線。安靜時不應產生音符；伴奏外放、和聲、雜訊可能影響分析。
4. 測試拒絕權限、等待授權時按停止、收音後停止／重啟、切換 App、鎖屏、耳機切換。
5. 手機、有線、藍牙分別測試。系統未通知裝置切換時，手動重啟收音並重新校正。

## 延遲與節拍

手動補償目前只改變比對時間的顯示，不影響播放、不消除硬體延遲，也不參與評分。正值代表從播放器時間扣除。瀏覽器輸入延遲可能未知；本頁 AudioContext 輸出延遲不等於 YouTube iframe 的實際延遲，因此不會自動填入補償。

節拍燈依手動 BPM 運作，不是歌曲自動拍點，不發聲。音高採單音 YIN 類演算法，範圍 65–1000 Hz，不能當成混音歌曲的人聲分離。

## 測試

- node:test：44.1/48 kHz 人聲音域及諧波、靜音／DC／噪音、網址白名單、時間補償方向、外部 JSON 純解析。
- tests/browser-check.mjs：使用內建 Playwright 與無頭 Edge，輸入合成 A4 音訊，不取得實體麥克風。驗證音高、停止、節拍燈、存取診斷、390 px 版面與零持久儲存。需可用的 Playwright 套件；可用 PLAYWRIGHT_PACKAGE_ROOT 指向其 package.json 所在父套件。
- 桌面瀏覽器與手機尺寸測試不代表 iPhone Safari 或藍牙真機通過。

## GitHub Pages

工作流程僅發布 index.html、style.css、app.mjs、audio.mjs。main 更新先執行單元測試，再發布 Pages。儲存庫 Pages 的來源需設為 GitHub Actions。無音訊伺服器、資料庫、上傳 API 或秘密金鑰。

## 桌機優先開發（原型 02）

先使用桌機 Edge／Chrome。麥克風授權後可選擇輸入裝置；切換會停止收音並重設時間補償。新 scoring.mjs 是尚未接入介面的實驗評分核心，需匹配影片 ID 的旋律參考；暫定音準 70%、演唱覆蓋率 30%，不是節奏評分。未唱與未完成的段落保留在分母，禁止重複採樣累加分數。沒有有效旋律基準時，網頁仍不給分。已選擇本機 yt-dlp 與 Demucs 路徑，詳見下方。


## 本機取得音訊與人聲分離（已實測）

GitHub Pages 只提供網頁。yt-dlp、FFmpeg、Demucs 都在使用者電腦執行；音訊不上傳。這一階段的命令列流程已完成，尚未與網頁按鈕連接，也尚未建立歌曲基準。

需要 Node.js 22+、Python 3.12、FFmpeg/ffprobe（在 PATH）。第一次安裝：

```powershell
.\setup-local.ps1
# 若沒有 Python Launcher，可指定 Python 3.12：
.\setup-local.ps1 -PythonPath 'C:\path\to\python.exe'
```

先測前 15 秒，預設會取得音訊、完整解碼驗證、分離並驗證兩軌：

```powershell
.\run-local-audio.ps1 -Url 'https://www.youtube.com/watch?v=VIDEO_ID'
# 僅取得音訊
.\run-local-audio.ps1 -Url 'https://www.youtube.com/watch?v=VIDEO_ID' -DownloadOnly
# 完整歌曲，上限 15 分鐘
.\run-local-audio.ps1 -Url 'https://www.youtube.com/watch?v=VIDEO_ID' -Seconds 0
```

工具位於 `.runtime/venv`，模型位於 `.runtime/models`，每次輸出位於 `.runtime/jobs/<id>`。三者不會提交到 GitHub 或 Pages。重新開機不會刪除這些檔案；重灌、系統重設或搬到新電腦可能須重跑 setup。模型權重可保留重用，不必每次重新下載。Python 虛擬環境依賴基礎 Python 路徑，因此即使 D 槽保留，重灌後仍應重建環境。

成功測試的音訊目前暫留本機供檢查；失敗的工作會清除該工作產生的檔案。正式評分流程需在結束後清除成功工作的音訊與基準，只保存歌名及分數；這個生命週期尚未串接。程式不刪除 `--input` 指定的原始檔案。

實測：YouTube 官方播放器示範影片的前 15 秒取得 MP3（48 kHz、雙聲道、15.024 秒），FFmpeg 完整解碼成功；CPU htdemucs 分成 vocals.wav 與 no_vocals.wav，兩者均為 44.1 kHz、雙聲道、14.993515 秒，可完整解碼。驗證與分離約 15.94 秒（這台電腦、此次短片段）；不能外推完整歌曲耗時，也不代表已驗證真實歌曲的分離品質或評分準確度。

Python URL 測試：`.runtime/venv/Scripts/python.exe tools/test_audio_pipeline.py`。

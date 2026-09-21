# 唱一下：桌機本機練唱版

網址：https://nilson0606.github.io/kala-ok-iphone/

桌機 Windows + Chrome／Edge 優先。GitHub Pages 提供介面；YouTube 音訊取得、格式驗證、人聲分離、旋律／節拍估計，以及麥克風評分都在自己的電腦執行。iPhone 尚未完成這套本機工具流程。

## 使用方式

1. 先安裝 Node.js 22+、Python 3.12 與 FFmpeg／ffprobe（放入 PATH）。下載儲存庫 ZIP 並解壓縮到固定位置。
2. 在工具資料夾執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-local.ps1`。只需初次安裝；模型第一次分離時才下載。
3. 執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1`，工具會在背景啟動並開啟網站。若網站詢問麥克風／本機網路權限，請允許。
4. 點「檢查本機工具」，貼 YouTube 歌曲網址，選擇完整歌曲或前 15／30／60 秒，點「準備歌曲基準」。需要原唱清楚的影片；純伴奏通常無法建立旋律基準。完整歌曲最長 15 分鐘，不支援直播。
5. 戴耳機，開啟麥克風。基準就緒後點「從頭開始唱」，或直接按 YouTube 播放。暫停／緩衝會暫停評分。片段分析只評該片段；跳過或提早結束的段落算漏唱。
6. 結束後只在該瀏覽器保存歌名與分數。清除紀錄可用頁面按鈕。再唱一次需重新準備基準。

結束本機工具：`powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1`。

重開機不會移除安裝，但需要重新啟動工具。Windows 重設／重灌或搬到新電腦後應重建 Python 虛擬環境，即使原工具資料夾仍在。若沒有 Python Launcher，可用 `setup-local.ps1 -PythonPath 'C:\path\to\python.exe'` 指定 Python 3.12。

## 評分與顯示

- 音準 60%、旋律起音的進拍 25%、完整度 15%。前奏／間奏中沒有可辨識旋律的格子不列入音準分母。
- 預設允許高／低八度，適合不同音域唱同一旋律；保留嚴格原調模式。其他音高偏差仍扣分。模式演唱開始後固定。
- 25 cents 內音準滿分，至 200 cents 逐漸降為零。旋律起音配對容許最多約 350 ms，80 ms 內不扣進拍分；這些都是可調的練習規則。
- 綠線是麥克風音高，藍線是原唱參考，容許八度時不必重疊。顯示原唱音名、即時偏高／偏低、音量與節拍燈。
- 旋律基準每 100 ms 一格。麥克風採單音 YIN 類演算法，65–1000 Hz。重複採樣／回放不會累加同一時間格的分數。
- 手動延遲補償會改變評分比對時間；正值從播放器時間扣除。補償不能消除耳機硬體延遲。分析視窗的中心延遲另行扣除。裝置變更時補償歸零。
- 自動 BPM／節拍燈只是伴奏節奏的估計；進拍分數使用旋律起音。兩者可能受混音、和聲、氣音、切分與變速影響。沒有辨識到節拍時可用手動節拍燈。

這是練習評分，尚未經過真人演唱資料集與人工標註驗證，不能宣稱專業準確度。不辨識歌詞，也不能判定情感、音色或唱法好壞。伴奏外放進入麥克風可能造成誤判，建議戴耳機。

## 資料生命週期

- `.runtime/venv` 是安裝的工具，`.runtime/models` 是可重用的模型。
- 網頁啟動的工作先在 `.runtime/jobs/<id>` 暫存下載及分離音檔；建立數值基準後立即刪除音訊，數值基準移入本機工具與頁面記憶體，磁碟工作目錄也刪除。
- 唱完／取消／切換歌曲會釋放旋律基準並通知工具清理。網頁關閉時也嘗試清理；未送達時，持續執行的工具約 15 分鐘閒置後清理工作。突然斷電時，殘留暫存由工具下次啟動／定期清理處理。
- 麥克風不使用 MediaRecorder，不上傳也不寫入音檔。停止收音即釋放麥克風資料。
- localStorage 僅保存最近 100 筆 `{title, score}`，不保存音訊、基準、時間戳或影片 ID。
- YouTube 播放／取得音訊，以及第一次安裝／下載模型仍需要網路。沒有音訊上傳 API、雲端分離或第三方轉檔網站。

本機服務只綁定 `127.0.0.1:4174`，檢查 Host 與 Origin，工作 API 需要頁面向本機取得的記憶體權杖。允許來源為本站 GitHub Pages origin 與本機開發頁面。GitHub Pages 同帳號的網站共享 origin，請將該帳號下網站視為同一信任範圍。

## 開發及測試

```powershell
npm start
npm test
.runtime\venv\Scripts\python.exe -m unittest discover -s tools -p "test_*.py"
node tests/browser-check.mjs
node tests/flow-check.mjs
# 需先啟動 helper；會連網取得 30 秒測試歌曲，完成後刪除音訊及基準：
node tests/local-pipeline-check.mjs
```

開發頁面為 http://localhost:4173。瀏覽器測試需要 Playwright；`PLAYWRIGHT_PACKAGE_ROOT` 可指定含 Playwright 依賴的 package.json。`BROWSER_CHANNEL=chrome` 可切換流程測試至 Chrome，預設 Edge。測試使用合成音訊，不開啟實體麥克風。流程測試模擬播放器與本機回應；網路管線測試另行驗證真實下載及 Demucs。手機寬度檢查不代表 iPhone Safari 真機通過。

已驗證：11 項 JavaScript 單元測試（頻率、噪音、網址、分數、八度差、唱晚及補償）；5 項 Python 測試（網址、旋律及已知節拍）。Edge 流程測試的合成低八度聲音在允許模式 98 分、嚴格模式 15 分，含暫停、緩衝、取消和紀錄欄位驗證。Chrome 同流程也通過，允許模式 100 分、嚴格模式 15 分。數值可能因瀏覽器採樣時序略變。

真實本機管線測試：Twinkle Twinkle Little Star（Super Simple Songs）前 30 秒，在這台電腦約 21 秒完成下載、驗證、CPU Demucs 分離及參考分析。長度 29.994 秒，估計有音高的區間 10.1 秒、88.2 BPM；生成後磁碟工作目錄已清除，DELETE 後記憶體基準不可再讀。這證明流程可通，不代表擷取的每個音符均正確。

## 部署

推送 main 後，GitHub Actions 執行單元測試，僅發布 `index.html`、`style.css`、`app.mjs`、`audio.mjs`、`session.mjs`、`scoring.mjs`。本機工具、測試檔案與 `.runtime` 不進 Pages。網頁程式更新後可能需 Ctrl+F5；本機工具更新後需重新啟動。

`run-local-audio.ps1` 是開發診斷指令，會留下輸出供檢查，不是一般網頁流程；使用後自行清除該工作目錄。原始 `--input` 檔案不會被刪除。

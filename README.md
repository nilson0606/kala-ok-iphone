# 唱一下：桌機本機練唱版

網址：https://nilson0606.github.io/kala-ok-iphone/

桌機 Windows + Chrome／Edge 優先。GitHub Pages 提供介面；YouTube 音訊取得、格式驗證、人聲分離、旋律／節拍估計，以及麥克風評分都在自己的電腦執行。iPhone 尚未完成這套本機工具流程。

## 使用方式

1. 先安裝 Node.js 22+、Python 3.12 與 FFmpeg／ffprobe（放入 PATH）。下載儲存庫 ZIP 並解壓縮到固定位置。
2. 在工具資料夾執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-local.ps1`。只需初次安裝；模型第一次分離時才下載。
3. 執行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1`，工具會在背景啟動並開啟網站。若網站詢問麥克風／本機網路權限，請允許。
4. 點「檢查本機工具」，第一次先按「選擇資料夾」（或輸入完整路徑後按「使用此位置」）指定歌曲庫，再貼 YouTube 歌曲網址，選擇完整歌曲或前 15／30／60 秒，點「準備歌曲基準」。需要原唱清楚的影片；純伴奏通常無法建立旋律基準。完整歌曲最長 15 分鐘，不支援直播。
5. 戴耳機，開啟麥克風。基準就緒後點「從頭開始唱」，或直接按 YouTube 播放。暫停／緩衝會暫停評分。片段分析只評該片段；預設「只比已演唱範圍」，僅評開始至停止的播放區間，區間內的漏唱及跳過仍計入；改選「整首歌曲」才會把提前結束的剩餘段落算漏唱。不論先播放或先開麥克風，兩者與基準都就緒時會開始評分。停止收音、裝置中斷或切到背景，都會保留這次演唱資料，「結束並結算」仍可按；中途停止需手動按結算才保存分數；YouTube 實際播完仍會自動結算。結算只清除本輪演唱資料，保留已載入的歌曲基準與試聽，直接按「從頭開始唱」即可再唱；不必再分離或載入。手動停止收音會暫停播放器並回到 0 秒，且仍可結算。此時「從頭開始唱」可直接按，會重新啟動麥克風並等待 YouTube 確認回到 0 秒，再清除上一輪資料並開始新一輪。播到分析範圍結尾只提示、不強制停止影片、不自動結算；超出基準範圍的聲音不再計分。沒有開始歌曲評分的試收音不產生分數。
6. 歌曲庫位置由每台電腦各自設定，記在本機 `.runtime/library-settings.json`；不寫死開發者路徑。初次升級若找到舊 `.runtime/library` 會建議使用，確認後即可沿用。切換歌曲庫不搬動或刪除舊資料；歌曲載入期間需先取消／卸載再切換。基準自動保存在指定資料夾；同一影片及分析範圍下次直接載入，不用再分離。展開「本機歌單」點歌曲名稱即可載入，並自動卸載前一首的暫存工作（不刪除已保存歌曲）；點目前歌曲不會重複載入。每筆顯示容量，也可刪除；15／30／60 秒與完整歌曲分開保存。
7. 「保留分離音軌，供本機試聽」預設勾選，仍可自行取消；完成後展開「分離結果試聽」，可切換人聲／伴奏。試聽會暫停 YouTube，唱歌時會停止試聽。若舊基準沒有音軌，試聽區會明確提示；按「補建試聽音軌」即可沿用該歌曲與分析範圍重新分離並保存，不必刪歌。進行中的演唱需先結束並結算，再補建。要重做現有結果可按「重新分離並覆蓋」：跳過快取重新處理該首歌與分析範圍，完整結果寫好後才替換舊基準／音軌；失敗的新產物會清除，其他歌曲不受影響。取消勾選保留音軌後重做，成功時該首會只留下新基準。
8. 演唱結束後在瀏覽器保存歌名與分數；從頭開始唱預設另存使用者歌聲，可選混入分離伴奏或不錄音。歌曲庫刪除會移除該歌曲基準及保留的試聽檔，不影響成績。

結束本機工具：`powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1`。

重開機不會移除安裝，但需要重新啟動工具。Windows 重設／重灌或搬到新電腦後應重建 Python 虛擬環境，即使原工具資料夾仍在。若沒有 Python Launcher，可用 `setup-local.ps1 -PythonPath 'C:\path\to\python.exe'` 指定 Python 3.12。

## 主唱／和音分離（選用）

「聲曲分離模式」預設仍是人聲／伴奏。選「主唱／和音分離」時，先用所選的 Demucs、BS-RoFormer 或 Mel-Band RoFormer 取得全部人聲，再用 [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) 的 Mel Band Roformer Karaoke 模型 `mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt` 估計主唱與和音；旋律基準只從主唱擷取。伴奏節拍分析維持原方式。這不是歌手身分辨識，齊唱、二重唱、疊軌仍可能分錯，請用試聽判斷是否適合該歌。

第一次需額外下載約 913 MB 模型，保存於 `.runtime/models/lead`；之後重用。現有安裝先停止工具、更新程式碼、重跑 `setup-local.ps1` 再啟動，會安裝配對 TorchVision 0.20.1、audio-separator 0.47.0 與相關依賴。此模型的推論使用 PyTorch CUDA（可用時）；CPU ONNX Runtime 是套件匯入所需，不代表 Roformer 只能用 CPU。GPU 錯誤會用獨立 CPU 程序重試。

勾選保留音軌時，主唱模式保存人聲、伴奏、主唱、和音四條本機 MP3。一般與主唱模式使用不同歌曲庫 ID，互不覆蓋；舊歌曲視為一般人聲模式。重新分離僅覆蓋所選模式，缺少任一必要音軌時不發布新結果。變更模式後需按「準備歌曲基準」或「重新分離並覆蓋」才生效。

[HTML 操作手冊](https://nilson0606.github.io/kala-ok-iphone/manual.html) 可從主畫面上方的「操作手冊 ↗」開新分頁，涵蓋安裝、歌曲庫、分離試聽、評分範圍、再唱與常見問題。

## GPU 加速

安裝腳本預設偵測 NVIDIA 顯示卡，安裝配對的 PyTorch／TorchAudio 2.5.1 CUDA 12.4 版（約 2.5 GB）；未偵測到則使用 CPU 版。既有 CPU 安裝可先停止本機工具，重新執行 `setup-local.ps1` 再啟動；模型與歌曲庫不會移除。可用 `setup-local.ps1 -Device cpu` 指定 CPU 套件，或 `-Device cuda` 指定 CUDA 套件。

每次新分離會檢查 CUDA 是否可用；可用時優先使用 GPU。GPU 記憶體不足或 CUDA 執行失敗時，自動以新的 CPU 程序重試一次，進度歸零並顯示原因；一般檔案或下載錯誤不會誤當 GPU 故障。進度區顯示實際 GPU／CPU；已保存歌曲仍直接載入快取，不重新分析。需要強制 CPU 診斷時可執行 `audio_pipeline.py --input <檔案> --separate --device cpu`。加速幅度取決於硬體與歌曲長度，不影響評分權重。

在 RTX 4060 Laptop GPU（8 GB）上，以相同 30 秒合成音訊驗證：GPU 約 6.2 秒、CPU 約 17.7 秒，包含本機檔案驗證、分離及兩軌完整解碼驗證；不含下載與旋律分析。此短片段測試約快 2.9 倍，不代表每首歌的固定加速比。自動測試另涵蓋無 CUDA、GPU 記憶體不足後 CPU 重試，以及重試進度歸零。

## 評分與顯示

- 音準 60%、旋律起音的進拍 25%、完整度 15%。前奏／間奏中沒有可辨識旋律的格子不列入音準分母。
- 預設允許高／低八度，適合不同音域唱同一旋律；保留嚴格原調模式。其他音高偏差仍扣分。模式演唱開始後固定。
- 評分難度預設「標準」，完整沿用原有門檻：25 cents 內音準滿分，至 200 cents 逐漸降為零；進拍 80 ms 內滿分，至 350 ms 歸零。「嚴格」為音準 15–100 cents、進拍 40–200 ms；「寬鬆」為音準 50–300 cents、進拍 120–500 ms。三種皆維持 60%／25%／15% 權重及相同漏唱算法，與八度容許、評分範圍獨立。每輪開始後固定，結算標示該輪難度；不需重做歌曲基準。這是自訂練習規則，尚未以真人評分校準。歷史仍只存歌名與分數，不額外存難度。
- 綠線是麥克風音高，藍線是原唱參考，容許八度時不必重疊。顯示原唱音名、即時偏高／偏低、音量與節拍燈。
- 旋律基準每 100 ms 一格。麥克風採單音 YIN 類演算法，65–1000 Hz。重複採樣／回放不會累加同一時間格的分數。
- 手動延遲補償會改變評分比對時間；正值從播放器時間扣除。補償不能消除耳機硬體延遲。分析視窗的中心延遲另行扣除。裝置變更時補償歸零。
- 自動 BPM／節拍燈只是伴奏節奏的估計；進拍分數使用旋律起音。兩者可能受混音、和聲、氣音、切分與變速影響。沒有辨識到節拍時可用手動節拍燈。

這是練習評分，尚未經過真人演唱資料集與人工標註驗證，不能宣稱專業準確度。不辨識歌詞，也不能判定情感、音色或唱法好壞。伴奏外放進入麥克風可能造成誤判，建議戴耳機。

## 五音延遲測試（選用）

展開「Do Re Mi Fa Sol 五音延遲測試」，開啟麥克風後選 C4–G4 或 C3–G3 音域，按「播放五音並測試」。每音相隔 1.2 秒，音長約 0.6 秒。

- 跟唱：戴耳機跟唱，可高／低八度。測到的時間差包含人的反應時間，不能宣稱是純硬體延遲。
- 聲音回收：耳機或喇叭靠近麥克風，讓它收到測試音，不用唱。這是本頁 Web Audio 播放到收音的往返延遲，可能與 YouTube 播放路徑不同。
- 至少 4/5 音穩定匹配，且時間差散布不超過 250 ms，才提供中位數補償建議。辨識失敗或太不穩定不提供套用；需按「套用建議補償」才改數值。
- 不保存測試聲音。更換收音裝置應重新測試；套用後仍可手動調整。

## 資料生命週期

- `.runtime/venv` 是安裝的工具，`.runtime/models` 是可重用的模型。
- 網頁啟動的工作先在 `.runtime/jobs/<id>` 暫存下載及分離音檔；建立數值基準後立即刪除音訊，數值基準保存到所選歌曲庫的 `<影片_範圍_版本>/reference.json`；勾選試聽時同時保存 128 kbps MP3 人聲與伴奏。原始混音、大型 WAV 及磁碟工作目錄會刪除。
- 結算只釋放本輪演唱資料，保留歌曲基準以供再唱；取消／切換歌曲才釋放本次歌曲記憶體工作，已保存歌曲庫保留到手動刪除。網頁關閉時也嘗試清理本次工作；未送達時，持續執行的工具約 15 分鐘閒置後清理暫存工作。突然斷電時，殘留暫存由工具下次啟動／定期清理處理。歌曲庫不會被閒置清理。
- 麥克風不使用 MediaRecorder，不上傳也不寫入音檔。停止收音即釋放麥克風資料。
- localStorage 僅保存最近 100 筆 `{title, score}`，不保存音訊、基準、時間戳或影片 ID。
- YouTube 播放／取得音訊，以及第一次安裝／下載模型仍需要網路。沒有音訊上傳 API、雲端分離或第三方轉檔網站。

本機服務只綁定 `127.0.0.1:4174`，檢查 Host 與 Origin，工作 API 需要頁面向本機取得的記憶體權杖。允許來源為本站 GitHub Pages origin 與本機開發頁面。GitHub Pages 同帳號的網站共享 origin，請將該帳號下網站視為同一信任範圍。

## 本次主唱模式驗證

22 項 JavaScript 單元測試、15 項 Python 測試通過；Edge／Chrome 已驗證一般／主唱模式切換、四條音軌的瀏覽器解碼播放、重做、卸載，以及手冊新分頁與手機寬度排版。模擬管線確認一般模式使用全部人聲、主唱模式使用主唱建立基準，並清除未選擇保留的暫存產物。

另以 8 秒合成音訊實際執行新模型，主唱及和音輸出均為 8 秒、44.1 kHz 雙聲道，完整解碼通過。此為短片段功能測試，沒有驗證整首歌的長時間負載或真人歌曲分離品質。

## 開發及測試

```powershell
npm start
npm test
.runtime\venv\Scripts\python.exe -m unittest discover -s tools -p "test_*.py"
node tests/browser-check.mjs
node tests/flow-check.mjs
node tests/calibration-browser-check.mjs
# 需先啟動 helper；會連網取得 30 秒測試歌曲，保存 30 秒歌曲及試聽檔，供後續瀏覽器測試：
node tests/local-pipeline-check.mjs
node tests/library-browser-check.mjs
```

開發頁面為 http://localhost:4173。瀏覽器測試需要 Playwright；`PLAYWRIGHT_PACKAGE_ROOT` 可指定含 Playwright 依賴的 package.json。`BROWSER_CHANNEL=chrome` 可切換流程測試至 Chrome，預設 Edge。測試使用合成音訊，不開啟實體麥克風。流程測試模擬播放器與本機回應；網路管線測試另行驗證真實下載及 Demucs。手機寬度檢查不代表 iPhone Safari 真機通過。

已驗證：14 項 JavaScript 單元測試（頻率、噪音、網址、分數、八度差、唱晚、歌曲庫及五音量測）；5 項 Python 測試（網址、旋律及已知節拍）。Edge 流程測試的合成低八度聲音在允許模式 98 分、嚴格模式 15 分，含暫停、緩衝、取消和紀錄欄位驗證。Chrome 同流程也通過，允許模式 100 分、嚴格模式 15 分。數值可能因瀏覽器採樣時序略變。

真實本機管線測試：Twinkle Twinkle Little Star（Super Simple Songs）前 30 秒，在這台電腦約 21 秒完成下載、驗證、CPU Demucs 分離及參考分析。長度 29.994 秒，估計有音高的區間 10.1 秒、88.2 BPM；生成後暫存工作目錄已清除；新版另將基準與選用試聽存入歌曲庫，實測快取命中可直接載入。這證明流程可通，不代表擷取的每個音符均正確。五音瀏覽器測試透過合成 Web Audio 回收路徑插入已知 200 ms 延遲，辨識 5/5 音、建議 +200 ms；這不等同真人或藍牙硬體實測。

## 部署

推送 main 後，GitHub Actions 執行單元測試，使用 `node build-site.mjs` 將 CSS 與所有前端模組放入依內容產生的 `assets/<版本>/` 目錄；HTML 及模組相對匯入都指向同一版本，避免舊快取忽略新選項。只發布 `index.html`、`manual.html`、`navigation.mjs`、`style.css`、`app.mjs`、`audio.mjs`、`session.mjs`、`scoring.mjs`、`calibration.mjs`。本機工具、測試檔案與 `.runtime` 不進 Pages。網頁程式更新後可能需 Ctrl+F5；本機工具更新後需重新啟動。

`run-local-audio.ps1` 是開發診斷指令，會留下輸出供檢查，不是一般網頁流程；使用後自行清除該工作目錄。原始 `--input` 檔案不會被刪除。

使用限制：本機測試用途，不得商用。請尊重著作權，只處理有權使用或已取得授權的內容；本工具不提供歌曲內容或使用授權。自動分析與評分僅供測試參考，不保證準確性。

資料夾選擇會開啟可見的 Windows 選擇視窗；網頁上的「取消資料夾選擇」只取消這個視窗，不需要卸載歌曲，也不刪除已保存的歌曲庫。等待超過一分鐘會自動解除，之後可重試或直接輸入路徑。

歌曲準備顯示取得音訊、聲曲分離、建立基準、完成等階段（主唱模式另含主唱／和音分離）。分離百分比來自 Demucs 或 RoFormer 實際完成的推論片段；沒有可靠百分比的階段顯示不定進度，並非依時間假造百分比。資料夾選擇使用 Windows 檔案總管式視窗，只將使用者選定的路徑回傳網頁。


## 可選 BS-RoFormer 模型

「聲曲分離模型」提供 Demucs／htdemucs（預設）與 BS-RoFormer／Viperx 1297。後者固定使用 `model_bs_roformer_ep_317_sdr_12.9755.ckpt`，約 639 MB，首次自動下載至 `.runtime/models/bs-roformer`。另可選 Mel-Band RoFormer／Kim 人聲，使用 Kimberley Jensen 的原始 [MelBandRoformer](https://github.com/KimberleyJensen/Mel-Band-Roformer-Vocal-Model) checkpoint（約 913 MB），固定作者版本 `ac9b0614ab3cd7f77219e18ba494dfd93956c348`，以 audio-separator 目錄名稱 `vocals_mel_band_roformer.ckpt` 保存於 `.runtime/models/mel-roformer`；這與主唱／和音專用 Karaoke 模型不同。三者皆可搭配主唱／和音分離；RoFormer 共用既有 audio-separator 依賴，batch 1、segment 256、overlap 4。模型下載先寫暫存檔，完整收到才發布，斷線重試且失敗不留下可被誤認為完整的模型。

既有歌曲沿用原目錄，不做遷移；沒有 `separationModel` 的舊資料視為 `demucs`。BS-RoFormer 的快取 ID 多 `_bs-roformer`，Mel-Band RoFormer 多 `_mel-roformer`，同影片、範圍與人聲模式可並存。覆蓋及刪除只影響對應版本；歌單、就緒及試聽訊息標示模型。補建試聽保持目前載入的模型。新版頁面遇到不支援模型選擇的舊本機工具會明確要求更新，不會默默使用 Demucs。

本次驗證：26 項 JavaScript、18 項 Python 測試；Edge／Chrome 的正式版資產通過模型切換、舊庫載入、試聽、主唱模式、覆蓋、舊工具攔截與手冊檢查。另以 8 秒合成音訊實際執行 BS-RoFormer，兩條 WAV 都輸出 8 秒、44.1 kHz 雙聲道並完整解碼。短測只確認功能，不代表真人歌曲分離品質或長時間負載驗證。


### BS-RoFormer MP3 匯出修正

audio-separator 0.47 的 soundfile writer 會沿用輸入 subtype，MP3 的 `MPEG_LAYER_III` 在輸出 WAV 時造成 `Supported file format but unsupported encoding`，發生於推論完成之後。`tools/roformer_audio.py` 現在先將壓縮來源解碼為浮點 WAV，合法 PCM／float WAV 則直接使用；暫存解碼檔在成功或失敗後均清理。沒有更換模型或改寫既有歌曲庫。

回歸測試使用真正 MP3、FFmpeg、soundfile 與套件原本的 WAV writer，確認兩條輸出可保存；另以 8 秒 MP3 實際執行 BS-RoFormer，兩條浮點 WAV 及試聽 MP3 完整解碼通過。先前僅用 WAV 的短測無法覆蓋這個錯誤。helper 現在也記錄工作 ID、快取版本、處理階段與失敗摘要到本機 stdout 日誌，避免前端清除工作後失去錯誤線索；不記錄音訊或認證權杖。


### 多段不計分遮罩

播放器下方可輸入秒數／分:秒，或以播放器位置標記起訖後新增，多段可刪除／全部清除，預設為空。保存至歌曲庫 `.masks/<videoId>_<rangeSeconds>.json` 的 `masks: [{start,end}]`；同一影片及分析範圍跨分離模型、模式、音高方式共用。只在最終評分／顯示時套用，不修改旋律原始 frames 或試聽音檔。舊庫尚無共用檔時讀取最近保存且非空的舊 reference 遮罩；修改後寫入共用檔（空清單也會覆蓋舊遮罩）。換模型／重新分離不需重標，刪除單一模型不刪共用遮罩。

遮罩以相交時間格排除音準、進拍與完整度，起點包含、終點不包含；不允許跨遮罩配對起音。藍色基準線中斷、右側原唱音符顯示休息；影片不跳過或靜音。每輪建立獨立快照，期間禁止編輯；全遮罩或僅休息的演唱不產生分數。保存成功才在頁面套用。

本機工具增加 `score-masks` capability 與已驗證來源／session token 保護的 `POST /library/:id/masks`。原子替換 JSON，最多 100 段，排序合併重疊或相接區間；同筆分離／保存進行中回覆 409。更新後需重新啟動本機工具，既有庫不需重新分離。操作步驟見 HTML 手冊「選用：不計分遮罩」。

遮罩驗證：32 項 JavaScript 測試通過，涵蓋全遮罩不產生分數、區間端點、三種難度／兩種範圍、起音不能跨遮罩匹配、原子保存及工具重啟後載入。Edge／Chrome 正式版資產通過多段新增、位置標記、保存失敗、載入／模型隔離、休息顯示、演唱中鎖定、刪除／清除及桌機／窄螢幕版面檢查。


### RMVPE 音高選項

`pitchMethod` 為 `yin`（舊版及預設）或 `rmvpe`，API 與前端都驗證；`pitch-methods` capability 防止舊工具靜默回傳 YIN。快取 ID 只對新方法增加 `_rmvpe`，歌單／就緒訊息標示方法。分離模型與人聲模式仍獨立選擇；遮罩則依上述原始時間軸共用。

已有同影片／範圍／分離模型／模式的另一種音高版本，且保留音軌時，`reference_worker.py` 直接從保存的 MP3 建立新基準及複製試聽，不重新下載或分離。不保留音軌的舊歌需完整處理；明確按「重新分離並覆蓋」仍會重新分離。新版本失敗不覆蓋舊版本。新舊基準的輸入可能分別為保存 MP3 和原始分離 WAV，這是重用方案的取捨。

RMVPE 權重為 181,184,272 bytes（約 181 MB / 172.8 MiB），共用路徑 `.runtime/models/rmvpe/rmvpe.pt`。下載驗證固定 SHA-256，權重以 `weights_only=True` 讀取；來源與 Apache-2.0 程式碼授權見 `tools/vendor/rmvpe/NOTICE.md`。使用既有 torch/librosa，不需另裝整套聲音轉換工具。推論每段核心 8 秒、前後各 1 秒上下文，保留原始時間，將 10 ms 預測以多數有效及中位数映射到 100 ms 格線；限制 65–1000 Hz，不把不確定音高強制補滿。優先 GPU，相關 GPU 錯誤才重試 CPU，失敗不默默改成 YIN。試聽音軌與麥克風即時 YIN 不變。

RMVPE 驗證：33 項 JavaScript、24 項 Python 測試；Edge／Chrome 的正式版資產通過新選項、舊工具攔截、歌單方法辨識與跨模型共用遮罩。實際以 3 秒合成訊號跑 CPU，及從已存《吻別》音軌取 8 秒跑推論／本機 HTTP 工作完整流程，確認重用音軌、80 格基準、保存、遮罩繼承、原試聽 bytes 不變及第二次直接載入快取；沒有重新下載歌曲或重新分離。短測確認流程，沒有宣稱整首歌音高更準或長時間負載已驗證。

### 試聽版本確認

試聽依已載入 `reference.cacheId` 取得音檔；Demucs／BS／Mel 使用不同 ID。試聽區固定顯示實際歌曲、模型與模式。改選尚未套用的分離模型／人聲模式會停止並清除舊 blob，停用試聽直到準備完成；只切換音高方式不改音軌。前端取檔也明確 `cache: no-store`（本機 API 原有 `Cache-Control: no-store`）。Edge／Chrome 回歸測試使用不同音訊 bytes 模擬三種模型，逐一核對實際請求 ID 和 audio 元件 blob 雜湊，包含切回 Demucs。

另在本機實際比對《老鼠愛大米》Demucs／BS 的試聽 API bytes 與歌曲庫檔案一致、雜湊不同；取第 45、90、180 秒各 8 秒解碼後，三段 PCM 都不同，排除只差檔案標頭。此檢查證明音軌有切換，不代表 BS 分離品質一定更好。


## 伴奏二次分離與反向相減（選用）

「歌曲基準處理流程」預設 `single`，保持原有分離管線；`residual` 使用所選 Demucs、BS-RoFormer 或 Mel-Band RoFormer 連續處理原曲和第一輪伴奏，再計算 `V = M - I2`。不是把第一輪伴奏直接相減，也不是將人聲再淨化。可與主唱／和音、YIN／RMVPE 組合；主唱分離放在相減後。

新流程先將來源轉為 44.1 kHz 雙聲道浮點 WAV，兩輪輸出禁用獨立音量正規化／削波。Demucs 由 `tools/demucs_lossless.py` 在子程序內改用 float writer；BS worker 的 `--preserve-gain` 關閉輸入及輸出峰值縮放，不修改已安裝的套件。`tools/residual_separation.py` 驗證相同樣本長度、聲道與取樣率，以區塊相減並拒絕非有限數值。未對齊不默默截切或補零。

歌曲 metadata 新增 `separationMethod`；舊資料缺欄位視為 `single`。新 cache ID 在 `_v1` 前加 `_residual`，模型、模式與音高方式各自區隔。跨 YIN／RMVPE 重用音軌限於同一流程；遮罩仍以影片和分析範圍共用。API capability 為 `residual-separation`，舊 helper 必須更新重啟，前端會明確提示。

進度新增第二輪伴奏與反向相減，第二輪從 0% 開始；相減沒有假造進度。整體等待上限新流程為 60 分鐘，單次仍為 30 分鐘，單個模型子程序仍有原本逾時限制。兩種流程在歌單與試聽來源均有標示；改選但未載入時停用舊試聽。新流程不保證較乾淨，需以實際歌曲比較。

本次驗證：35 項 JavaScript、30 項 Python 測試通過；Edge／Chrome 驗證單次／二次流程切換、實際載入的試聽 bytes、第二輪進度、舊 helper 攔截、遮罩與 YIN／RMVPE 組合。另以 2 秒合成雙聲道音訊在 CPU 實際跑完 Demucs 與 BS-RoFormer 各兩輪，88200 個樣本保持對齊，`V + I2` 與混音最大誤差低於 2e-7。這些只驗證流程和波形運算，不代表整首長時間負載或真人歌曲分離品質驗證。短測另外發現 Windows 的空 CUDA 裝置遮罩會產生 available=true、count=0；BS worker 已選定 CPU 時改用明確的 -1 遮罩，預設 GPU 選擇不變。

### 第三種人聲分離模型（2026-09-23）

預設仍為 Demucs，新增 Mel-Band RoFormer／Kim 人聲，可搭配單次或伴奏二次分離＋反向相減。固定同一影片與分析範圍時，3 模型 × 2 流程 × 2 人聲模式 × 2 音高方式，共 24 種結果可各自保留，全部共用同一份遮罩。新模型有獨立 `mel-roformer` helper capability，舊工具會要求更新，不會誤用原模型。手冊含切換與試聽步驟。

模型下載器修正 GitHub 壓縮回應的長度判定：串流已解壓縮時，不拿壓縮 Content-Length 與解壓後的位元組數比較；仍拒絕空檔，未壓縮的截斷回應和串流中斷仍會重試，完成前不發布模型檔。

驗證：36 項 JavaScript、32 項 Python 測試通過；24 組合的遮罩共用、快取隔離、覆蓋後保留遮罩均有回歸測試。以原作者 SHA-256 `87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e` 核對下載的 Mel checkpoint，並在 CPU 實跑 2 秒雙聲道音訊的單次與二次分離，88200 個樣本均可讀且對齊；二次結果與伴奏相加重建混音的最大誤差約 7.5e-14。修正 Kim 配置以 `other` 命名伴奏的對應，避免推論完成卻找不到試聽來源。短測不代表整首歌曲的品質或長時間負載驗證。

### 演唱錄音與分數勾選刪除

`recording.mjs` 以 MediaRecorder 保存本輪歌聲，Web Audio 只將麥克風及選用的本機伴奏送進錄音 destination，不把伴奏接入音高分析或喇叭。預設 voice，mix 取已載入 cacheId 的 accompaniment，off 關閉保存。從頭開始唱先結束上一筆、載入伴奏並同步播放器，再在 PLAYING 開始；暫停/緩衝暫停錄製，續播/跳轉重新對齊伴奏。停止收音、結算、影片結束、卸載/換歌均結束當筆；直接點 YouTube 播放不另建錄音。

`recording-store.mjs` 將每秒音訊 chunk 與 metadata 以 IndexedDB transaction 原子寫入，完整結束標記 complete；崩潰時保留已提交片段。每段有獨立 ID，不覆蓋重唱前的錄音。空間或寫入失敗時保留記憶體音訊並提供下載；錄音與 localStorage 分數、歌曲庫彼此獨立。分數勾選依清單位置區分同名紀錄，刪除前核對已渲染快照，避免另一分頁修改後錯刪。

驗證：36 項 JavaScript 測試通過。Edge／Chrome 使用實際 MediaRecorder + IndexedDB，440 Hz 麥克風與 660 Hz 伴奏解碼比對，確認 voice 不含伴奏、mix 同時包含兩者；測過每秒落盤、暂停續播、跳出伴奏範圍、停止收音後結算不重複、播完自動保存、重唱另存、off 不建立 MediaRecorder 並記住選擇、儲存額度不足時下載備份、重新載入後保留、下載及個別刪除。同名分數勾選刪除／全清除不影響錄音；原評分流程與分離試聽的瀏覽器回歸測試也通過。

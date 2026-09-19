# UI Fix 0.3.2 — 実際の検証範囲

`node tests/ui-worker.cjs`

Node VMの小さなDOMアダプターとworker_threadsを用い、配布するboot.js/app.js/worker.jsと実際のRD/暗号/APNG処理を実行します。実ブラウザではありません。

- app.js読込失敗が起動エラーとして表示され、ボタンは無効のまま。
- 正常起動で文字数欄が更新され、生成ハンドラーが登録される。
- 生成ボタン処理から実worker.jsでHELLO TURINGのAPNG生成が完了し、保存/プレビューが有効になる。
- 復号ボタン処理から実worker.jsで本文が完全一致する。
- Worker constructor失敗を画面表示し、入力操作が再度可能になる。

実際の結果・時間はtests/ui-worker-results.json。暗号/RDの既存24項目を本UI版で全再実行したわけではありません。core/organic/transform/tables/apng/motion-payload/transport/zipは元統合版とbyte一致を確認しています。

CSSは#generate / #decodeへmargin-top:16pxを追加。ブラウザでの最終描画・使用者の元環境の直接原因は未検証です。

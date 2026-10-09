# 開発状況・引き継ぎ

- 更新日：2026-10-09（Asia/Tokyo）

## GitHubとブランチ運用

- 利用者指定のリポジトリはhttps://github.com/takahiyo/WithViewer。
- 初回アップロードはmain/devに同じ実装を反映し、以後の開発はdevを基本とする。方針はAGENTS.mdにも記録する。
- .env、Cloudflareの認証情報・個人設定、録音・画像・テスト結果、ビルド出力、依存パッケージとキャッシュはGit管理から除外する。

## Cloudflare Pages公開版の進捗

- 本人だけが使う公開版を実装。cloudflare/worker.jsで静的画面と全APIを認証前に遮断し、cloudflare/auth.jsでCloudflare AccessのRS256署名・issuer・AUD・期限・本人メールを検証する。PUBLIC_ORIGIN以外のプレビューURL・別Originも拒否する。
- 既存Gemini APIをcloudflare/api.jsへ共通化し、ローカルserver.jsとPages Workerの双方で使う。音声入力・保存・映像切り替えは維持する。公開版にはログアウトリンクと認証期限切れの案内を追加。
- npm testは30件、npm run test:browserは7件成功。npm run build:pages成功。Wrangler/Workersローカルランタイムで、認証設定がない画面・設定API・文字起こしAPI・workletがすべて503となることを確認。
- Cloudflare CLIは未認証。Pagesへの必要な権限（account:read/user:read/pages:write）に絞ってOAuthを開始。認証待ちセッション71446。公開URL、実Accessアプリ、Secret登録、実デプロイは未完了。Cloudflare上でのGemini・タブ共有・音声対話は未検証。
- 手順はdocs/CLOUDFLARE_PAGES.md。利用者が許可した本人メールは.gitignore対象cloudflare.private.jsonに保存。APIキーはフロントエンドへ埋め込まずSecretへ設定する。
- OAuth認証情報・ログは.gitignore対象.wrangler内に保存するnpm run cloudflareラッパーを使用する。CloudflareのPages上限時のFail closed設定と本番Accessの設定も公開前に確認する。
- 担当：Codex
- 計画：[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
- 状態：ローカルWeb検証版の実装・自動検証完了／実音声の受け入れ試験待ち。
- 作業場所：E:\Local_Storage\GitHub\WithViewer
- Git状態：Gitリポジトリではない。基準コミット・ブランチなし。コミット・push・公開は未実施。
- 共有状態：ローカル保存のみ。

## 完了済み

- server.js：localhost限定サーバー、サーバー側APIキー管理、制限付き一時トークン発行、会議文字起こし・途中要約API。
- src/audio.js・public/pcm-worklet.js：独立した会議／マイク入力、PCM・WAV変換、サンプル数による連続分割、音声再生と割り込み時の停止。
- src/live.js：音声相談の開始・終了、会議文脈の追加、相談の文字起こし保存、会議記録検索ツール、接続失敗時のマイク・出力停止。
- src/core.js・src/storage.js：会議記録と相談履歴の分離、IndexedDBへの会議・音声保存、検索、JSON復元の入力元検証。
- src/app.js・index.html・src/style.css：日本語UI、独立した録音・相談操作、Alt + Shift + C、会議メモ、再試行、要約、検索、JSON書き出し／読み込み、WAV保存。
- テキスト相談：/api/chat、入力欄・送信ボタン・Ctrl + Enter、会議文脈と音声の相談履歴の共有、音声からテキストへの切り替え、失敗時の質問保持。会議録音は継続する。
- 映像の読取り：共有タブの静止画を最大1280×720 JPEGとして読む/api/observe-frame、記録中のオン・オフ、15/30/60秒間隔、単発操作、送信枚数、時刻付きの別記録・画像保存。音声には読取り文、オン時のチャットには最新画像も渡す。429では自動読取りを停止する。
- IndexedDBをバージョン2へ更新して画像用ストアを追加。既存の会議・音声を保持する移行テストを追加した。
- README.md・.env.example・docs/VOICE_ACCEPTANCE.md：起動・設定方法、制約、実機試験手順。
- 既存のVIBE_STARTER_KIT_REVISED.mdは変更していない。

## 検証結果

対象は上記ファイルの現在の保存内容。Windows／Node.js 24.19.0／インストール済みChromeで実行。

| コマンド・確認 | 結果 |
|---|---|
| npm test | 26件成功。映像入力・画像添付、オフ時の自動送信防止、キャプチャ中のオフ、重複防止、429での自動停止を追加確認。 |
| npm run test:browser | 7件成功。音声APIの429時の自動送信停止・録音継続と保存・失敗理由の保存・手動再試行に加え、映像オン・オフ、画像添付、単発読取り、既存DBの移行を確認。実行時のビルドも成功。 |
| npm run build | 成功。 |
| インストール時のnpm監査 | 既知の脆弱性0件と報告。 |
| 画面確認 | test-resultsのPC・狭い画面のPNGを確認。ファイル入力が意図せず表示される問題を修正し、ブラウザーテストを再実施。 |
| Geminiへの実接続 | node scripts/check-gemini.js --liveが成功。合成した無音WAVで文字起こしAPIの応答を確認し、Live APIのsetup handshakeを確認。実際の発言の認識品質・音声対話・T1〜T9は未検証。無音への応答本文は評価していない。 |
| テキスト相談の実API確認 | node scripts/check-chat.jsが成功。固定の合成会議（A案100万円・2週間、B案80万円・4週間）への質問に、根拠の時刻を参照し事実と見解を分けた日本語の回答を確認。最初の確認は処理失敗、再試行では成功。利用者の保存会議は送信していない。 |
| 映像の実API確認 | node scripts/check-vision.jsで合成画像を一枚送信したが429（利用枠・頻度の上限）で失敗。実APIの画像理解は未確認。これ以上の自動試行はしていない。 |
| 音声文字起こし再停止の調査 | 稼働中サーバーで429が複数回記録されている。映像未使用でも音声APIが上限に達している。アプリは上限時に自動文字起こしを停止し、録音を保存し続ける。利用枠の回復そのものは未確認で、実APIへの追加確認送信はしていない。 |
| 429の詳細確認 | scripts/check-quota.jsで.envのキーを使い、合成無音を一回だけ送信。GenerateRequestsPerDayPerProjectPerModel-FreeTier、quotaValue 20、gemini-3.8-flashが返った。キーは.envと一致（キーは表示していない）。利用者の画像はOCRforEPUB/Tier 1/RPD 27/10000であり適用枠が不一致。APIキーの所属プロジェクトと課金状態の確認が必要。 |
| 利用者の上限解除後の音声API確認 | 稼働中サーバーにnode scripts/check-gemini.jsで合成無音を一度送信し、/api/transcribeの成功を確認。実際の会議発言の精度は未確認。利用者画像には以前の429によるアプリの文字起こし停止状態が残っているため、保存済み区間の再試行または今後の文字起こし再開が必要。 |

最初のnpmインストールは既定キャッシュへの書き込み権限で失敗した。--cache .npm-cacheで作業フォルダー内へ変更して成功。Windows上のブラウザーテストのサーバー終了待ちを解消するため、scripts/test-browser.jsで直接起動した子プロセスを終了する方式に変更した。再実施では正常終了した。

## 重要な判断・残る制約

- 利用者のYouTube録音でgemini-2.5-flashが新規利用不可という404を返した。公式音声入力文書を確認し、文字起こし・要約の既定値・.env・設定例をgemini-3.8-flashへ変更。Liveはgemini-3.8-live。両モデルの存在と、文字起こしAPI・Live接続成立を実APIで確認。
- SDKの生エラーをHTTPステータス付きの場合に転送する不具合を修正。モデル利用不可・認証・利用枠の案内を日本語へ変換し、SDKの詳細を返さない。
- 無音では正常終了STOPでもtextがない場合があると実APIで確認。その場合は空の文字起こしとして扱い、安全性による停止等を成功扱いしない。
- 開発サーバーとテストサーバーのVite WebSocketポートが衝突する問題を確認したため、ブラウザーテストはビルド済みアプリで実行する方式へ変更。再実施で2件成功。
- 会議音声を相談セッションへ直接送らず、別処理の文字起こしを参照データとして追加する。相談の切断は録音を止めない。
- 観察対象は共有タブの音声と、オンまたは単発操作時の静止画。映像の連続動作や未取得の場面は扱わない。手入力メモと映像のAI読取りは原発言と区別する。
- 文脈更新には約10秒とAPI処理分の遅れがある。区間境界の認識、長時間記録、音声の回り込み、割り込みの遅延は実機検証が必要。
- 自動再接続は未実装。履歴を保存し、ボタンで再開する。
- 強制終了では直近の未保存音声が失われる可能性がある。JSONは音声を含まず、WAVは別途保存する。
- 記録の正本はそのブラウザーのIndexedDB。必要な記録は書き出して保管する。

## 次の作業

1. 実APIで429が出ているため、利用者の利用枠・頻度上限を確認する。上限が解消したら単発画像で実APIの読取りを確認する。キーを会話や文書へ転記しない。
2. docs/VOICE_ACCEPTANCE.mdに沿って、まずT1、T2、T4、T6、T7を実音声で確認し、実測と不合格の再現手順を残す。
3. T3、T5、T8、T9まで確認し、必要に応じて区間境界・文脈更新の遅延・再接続を改善する。

## 実行中・結果未確認の処理

- 開発用サーバーを映像観察反映後にnpm run devで再起動済み。URL：http://127.0.0.1:5173。現在の実行セッションIDは3852。APIキーと新モデルの設定を読み込み済み。再開時は稼働状態を確認し、同じポートへ二重起動しない。
- ブラウザーテストの5174番ポート用サーバーはテスト終了時に停止済み。
- 接続確認で合成した無音音声と固定の試験文脈をGeminiへ送信した。利用者の保存会議音声をこちらから送信する操作はしていない。実会話の受け入れ試験は未実施。

# Googleログイン付きCloudflare Pages公開版

画面とGemini APIをPagesのAdvanced mode（`dist/_worker.js`）で配信します。Firebase AuthenticationでGoogleログインし、WorkerはIDトークンの署名・発行者・プロジェクト・有効期限・Google認証・確認済みメールを検証します。許可メールは一件です。画面と公開Firebase設定はログイン前にも配信しますが、有料APIは認証が必要です。Firebaseのサービスアカウント秘密鍵は使用しません。

## 1. Firebase

WithViewer専用プロジェクトでWebアプリを登録します。SDKの選択は「npm」です。Authentication → ログイン方法でGoogleを有効にし、サポート用メールを選びます。Authentication → 設定 → 承認済みドメインへ、実際に使うホスト（`withviewer.pages.dev`、独自ドメインならそのホスト）を追加します。URLやパスは入力しません。

Webアプリの設定からapiKey、authDomain、projectId、appIdを使用します。Analytics、Firestore、Storageは今回のログインには不要です。Firebase WebのapiKeyは公開設定であり、Geminiの秘密キーとは用途が異なります。APIの利用権限はWorkerが別途検証します。

## 2. Pagesの環境変数

Workers & Pages → withviewer → Settings → Variables and Secretsで次をProductionに登録し、再デプロイします。個人設定はGit管理対象外です。

| 名前 | 値 |
|---|---|
| FIREBASE_WEB_CONFIG | Firebase Web設定のJSON。apiKey、authDomain、projectId、appIdを含む一つの文字列 |
| ALLOWED_EMAIL | 利用を許可するGoogleアカウントのメール |
| PUBLIC_ORIGIN | `https://withviewer.pages.dev`（末尾スラッシュなし） |
| GEMINI_API_KEY | ローカルで動作確認したGeminiキー。Secretとして登録 |

Firebase設定の形式は次のとおりです。実際の値は管理対象外の`cloudflare.private.json`に保存します。

```json
{"apiKey":"Webアプリの値","authDomain":"プロジェクト.firebaseapp.com","projectId":"プロジェクトID","appId":"Webアプリの値"}
```

GEMINI_API_KEYをVITE_で始まる変数へ登録しないでください。ブラウザーへはLive用の一回限りの短期トークンを渡します。CF_ACCESS_TEAM_DOMAINとCF_ACCESS_AUDはこの版では使用しません。Cloudflare Accessを既に設定している場合、その認証が先に表示されるため、Firebaseだけでログインする構成では解除します。

独自ドメインを使う場合はPagesへそのドメインを登録し、PUBLIC_ORIGINとFirebase承認済みドメインを合わせます。会議APIはPUBLIC_ORIGIN以外のホストを拒否します。ハッシュ付きプレビューURLではなく、設定した正式なURLで確認してください。devプレビューを使う場合はPreview側にも変数を登録し、PUBLIC_ORIGINを`https://dev.withviewer.pages.dev`に、Firebase承認済みドメインを`dev.withviewer.pages.dev`に設定します。

## 3. ビルドと公開

Git連携のPages設定は次のとおりです。

| 項目 | 値 |
|---|---|
| 本番ブランチ | main |
| フレームワーク | なし |
| ビルドコマンド | `npm run build:pages` |
| 出力ディレクトリ | `dist` |
| ルートディレクトリ | 空欄（リポジトリ直下） |

ビルドコマンドが空欄だとdistが生成されず失敗します。通常の`npm run build`はWorkerを作らないため、Pagesには使用しません。

```powershell
npm ci
npm test
npm run test:browser
npm run build:pages
```

開発はdevで進め、本番への反映はmainに変更を取り込んだ後に行います。CLIを使う場合は`npm run cloudflare -- login --scopes account:read user:read pages:write`で認証し、`npm run cloudflare -- pages deploy dist --project-name withviewer --branch dev`でdevプレビューへ送れます。認証情報はGit管理対象外の.wranglerに保存されます。

Functionsが利用上限に達した場合の動作はFail closedにします。Workerを通さず有料APIを公開しない構成を維持します。

## 4. 公開後の確認

1. 正式URLでGoogleログイン画面が表示される。
2. 許可アカウントでログインすると会議画面が開く。
3. 別Googleアカウントでは会議操作に進めず、トークンなしのAPIは401になる。
4. 実際の共有タブ音声、映像オン・オフ、テキスト相談、マイク相談を試す。
5. ログアウト時は録音と相談を終了して保存し、再ログインが必要になる。

認証はタブのセッションに保存します。IDトークンはAPI送信時にFirebase SDKから取得し、必要時に更新します。期限切れや通信障害で処理に失敗した場合、保存済み音声を保ち、ページを開き直してログイン後に再試行します。実際のGoogleログインと公開版Gemini接続はデプロイ後に別途確認が必要です。

## 記録と費用

会議記録・音声・画像は各ブラウザーのIndexedDBに保存します。localhost、pages.dev、独自ドメインは別の保存領域です。テキスト履歴はJSONの書き出し・読み込みで移せますが、録音音声・画像はJSONに含まれません。端末間同期はありません。

Geminiの課金・利用枠はサーバーのキーに対応するプロジェクトに適用されます。映像オフでは新しい定期画像送信が止まります。アプリ内の金額上限機能はありません。タブ音声共有の対応はブラウザーに依存します。

## 公式資料

- [FirebaseのGoogleログイン](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase IDトークンの検証](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Pages Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)

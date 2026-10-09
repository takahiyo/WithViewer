# 自分専用のCloudflare Pages公開版

画面とGemini APIをPagesのAdvanced mode（`dist/_worker.js`）で配信します。Cloudflare Accessでログインし、Workerでも署名・発行者・対象アプリ・有効期限・メールアドレスを検証します。許可メールは一件です。設定が欠けている状態は503、認証なしは401になり、Geminiには接続しません。

## 1. Cloudflareへの認証とプロジェクト作成

```powershell
npm run cloudflare -- login --scopes account:read user:read pages:write
npm run cloudflare -- whoami
npm run cloudflare -- pages project create withviewer --production-branch main
```

`withviewer`が使用済みなら別のプロジェクト名を選び、wrangler.jsoncのnameも合わせます。既存の別サイトへ上書きデプロイしないでください。OAuthの認証情報は.gitignore対象の.wrangler内に保存されます。APIキーやOAuthトークンはチャットに貼る必要はありません。

## 2. 本番URLをCloudflare Accessで保護

Cloudflare Zero TrustでSelf-hostedアプリを作成し、`withviewer.pages.dev`全体（パス限定なし）を対象にします。AllowポリシーのEmails条件には自分のメールアドレスを一件だけ指定します。メールのOne-time PINでログインできます。Everyone、Bypass、Service Authを許可しないでください。

AccessアプリのApplication Audience (AUD)と、チームドメイン（`https://チーム名.cloudflareaccess.com`）を控えます。

Pages設定の「Enable access policy」はプレビュー用です。本番のpages.devや独自ドメインも対象になるとは限りません。本番用Accessアプリを明示的に作成します。このWorkerはPUBLIC_ORIGIN以外のプレビューURL・別ドメインを403で拒否します。独自ドメインに変えるときはAccess対象とPUBLIC_ORIGINを一緒に更新してください。

## 3. PagesのSecrets

Workers & Pages → 対象プロジェクト → Settings → Variables and Secretsで、Productionに次を設定します。アクセス設定とメールもSecretとして登録すると、公開ソースに個人情報を残しません。

| 名前 | 値 |
|---|---|
| GEMINI_API_KEY | ローカルで動作確認したGeminiキー |
| CF_ACCESS_TEAM_DOMAIN | `https://チーム名.cloudflareaccess.com`（末尾スラッシュなし） |
| CF_ACCESS_AUD | Accessアプリの64桁のAUD |
| ALLOWED_EMAIL | ログインを許可する自分のメールアドレス |
| PUBLIC_ORIGIN | `https://withviewer.pages.dev`（実際の公開URL・末尾スラッシュなし） |

wrangler.jsoncにはモデル名だけが入ります。.envや.dev.varsはアップロードしません。GEMINI_API_KEYをVITE_で始まる変数に入れないでください。ブラウザーにはLive用の一回限りの短期トークンだけを渡します。

## 4. ビルドと公開

```powershell
npm test
npm run test:browser
npm run build:pages
npm run cloudflare -- pages deploy dist --project-name withviewer --branch main
```

最後のビルドは必ずbuild:pagesを使います。通常のbuildはローカル向けで、Workerを作りません。Git連携を使用する場合もBuild commandは`npm run build:pages`、Output directoryは`dist`です。Advanced modeはWranglerでデプロイし、ダッシュボードにdistを単純ドラッグ＆ドロップする方式は使用しません。

WorkersのFree枠を使う場合は、PagesのFunctions設定で上限時の動作をFail closedに設定してください。認証を担当するWorkerが実行されないときに静的ファイルを公開しないためです。Accessのログイン制限も別に維持します。

## 5. 公開後の確認

1. 未ログインのブラウザーでは本番URLにAccessのログイン画面が出る。
2. 本人メールのログイン後に、画面・/api/config・PCM workletが読み込める。
3. 別メールでは画面とAPIを使えない。
4. ランダムなプレビューURLはWorkerから403または未設定の503となる。
5. 実際の共有タブ音声で文字起こし、映像オン・オフ、テキスト相談、マイク相談を試す。
6. ログアウト後は再ログインが必要。ログインの有効期限が切れたときも録音は保存し、ページを開き直して再ログインする。

公開の実確認が終わるまでは「公開済み・実動作確認済み」とは扱いません。

## 記録と費用

会議記録・音声・画像は各ブラウザーのIndexedDBに保存されます。公開版とlocalhostは別の保存領域なので、localhostの履歴は自動では移りません。JSONの書き出し・読み込みでテキスト履歴を移せますが、録音音声・画像そのものはJSONに含まれません。端末間同期はありません。

許可した本人のリクエストだけがサーバーキーを利用できます。Geminiの課金・利用枠はそのキーのプロジェクトに適用されます。アプリ内に金額単位の上限機能はまだありません。必要ならGemini側の支出上限も設定します。ブラウザーによるタブ音声共有の対応差は公開後もあります。

## 公式資料

- [Pages Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [AccessのJWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Self-hostedアプリの設定](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [プレビューと本番のアクセス制限](https://developers.cloudflare.com/pages/configuration/preview-deployments/)

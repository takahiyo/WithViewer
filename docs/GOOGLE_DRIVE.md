# Google Driveへの会議一式保存

公開版のGoogleログイン後、「Google Driveへの自動保存」でDrive接続・フォルダ選択を行い、自動保存を有効化する。会議終了時に会議ごとのZIPを保存する。終了後の文字起こし・清書・相談・要約も同じファイルへ更新する。連続更新は30秒以上の間隔を設ける。

## ZIPの内容

- 記録JSON：文字起こし、会議メモ、相談履歴、要約、作成済み清書、画像読取り。
- 議事録HTML・Markdown：清書、音声原本、スクショ。
- `音声/`：区間ごとの元の録音WAV。未変換・失敗区間も含む。
- `スクショ/`：保存された全画像。
- JSON内`archive`：音声・画像のID、時刻、ファイル名の対応表と本体のない記録一覧。

保存先直下に`会議名_開始日_会議一式.zip`を置く。同じ会議は同じファイルIDを更新する。別会議の同名ファイルは別ID。清書の生成は「議事録を作成・更新」で行う。Drive保存自体はAIを呼ばない。

通信切断は受信位置を確認し、最大3回、2・5・15秒後に再試行する。失敗時は「今すぐ保存」で再試行でき、端末内原本は削除しない。保存完了まではページを開く。ページ終了後のアップロードは行わない。Drive連携・保存先・自動保存設定はGoogleアカウント、ブラウザー、公開URLごと。別端末では再設定する。連携解除はDrive上のファイルを削除しない。

ZIPは音声・画像の合計512MBまで。原本のないJSON復元記録は不足を対応表へ記載する。ZIP内JSONだけを読み込んでも音声・画像本体は復元しない。ZIP全体のアプリ内復元・Drive会議一覧の読込みは未実装。

## Google Cloudの設定

Firebaseと同じ`withviewer-4f4d4`を使用できる。OAuthクライアントとPicker APIキーは同じGoogle Cloudプロジェクトで用意する。

1. APIライブラリで **Google Drive API** と **Google Picker API** を有効化。
2. Google Auth Platformでアプリ名・サポートメール・対象ユーザーを設定。テスト中は本人をテストユーザーへ追加。
3. ウェブアプリケーション用OAuthクライアントを作成。Firebaseログインのクライアントとは別でもよい。
4. 承認済みJavaScript生成元へ使用環境のURLを追加：`https://dev.withviewer.pages.dev`、`https://withviewer.pages.dev`。
5. リダイレクトURIへ使用環境のURLを完全一致で追加：`https://dev.withviewer.pages.dev/api/drive/callback`、`https://withviewer.pages.dev/api/drive/callback`。独自ドメインも同様に追加し、`PUBLIC_ORIGIN`と一致させる。
6. データアクセスへ`openid`、`email`、`https://www.googleapis.com/auth/drive.file`を登録。Drive全体への権限は不要。
7. Picker用APIキーを作成。API制限はGoogle Picker API、ウェブサイト制限は使用URLの`/*`。Firebase APIキーの流用は不要。

公式：[限定スコープとPicker](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker)。一般公開時はGoogleのアプリ確認・公開手順を確認する。テストモードでは更新トークンの期限により再接続が必要になる場合がある。

## Cloudflare Pagesの設定

「設定 → 変数とシークレット」で開発はプレビュー、本番はプロダクションを選び、次を登録する。既存のFirebase・Gemini設定も必要。

|名前|値|
|---|---|
|`GOOGLE_DRIVE_CLIENT_ID`|作成したウェブOAuthクライアントID|
|`GOOGLE_DRIVE_CLIENT_SECRET`|OAuthクライアントSecret。シークレットとして登録|
|`GOOGLE_DRIVE_PICKER_API_KEY`|Picker用APIキー。ブラウザーへ提供するためGoogle側で制限|
|`DRIVE_TOKEN_SECRET`|32文字以上の十分な乱数。シークレットとして登録|

暗号化鍵はパスワード管理アプリなどで32バイト以上の乱数から作成する。秘密情報はチャットやGitへ貼らない。鍵を変更するとDriveへ再接続が必要。

登録・再デプロイ後、アプリでDrive接続・フォルダ選択・自動保存を有効化。短いテスト会議を終了し、DriveのZIPを展開して記録・音声・画像を確認する。

## 認可と公開範囲

Firebaseログインとは別にDrive保存の許可を求め、同じGoogleアカウントを確認する。更新トークンはAES-GCMで暗号化しSecure・HttpOnly・SameSite属性付きCookieへ最長180日保存。JavaScriptやJSONバックアップへ渡さない。保存時はサーバーで短期アクセストークンを取得し、ブラウザーからGoogleへZIPを直接送る。Cloudflareへ録音一式を送らない。

許可の取り消し、Cookie削除、期限切れ、鍵変更の場合は再接続する。Google側の権限を取り消す場合はGoogleアカウントのサードパーティ接続管理で解除する。

現在の公開版は`ALLOWED_EMAIL`による本人専用運用。一般販売用の複数ユーザー認可・端末内記録のユーザー別分離・課金・利用量管理は別途実装する。

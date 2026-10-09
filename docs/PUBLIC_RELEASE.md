# OAuth表示と公開前の仕上げ

プライバシーポリシー・利用規約は `public/privacy.html`、`public/terms.html`。運営者はFlateight。問い合わせメールは本人の指定待ちで「準備中」と明記し、開発版として用意した。一般公開の完成版・法的審査済みという意味ではない。

Google Auth Platform → ブランディング → アプリのドメインに、以下を設定する。

- 開発版ホームページ：`https://dev.withviewer.pages.dev/`
- プライバシーポリシー：`https://dev.withviewer.pages.dev/privacy.html`
- 利用規約：`https://dev.withviewer.pages.dev/terms.html`

本番は本番の公開URLに置き換える。mainに未反映のページURLは登録しない。一般公開・ブランド審査では所有権を確認できる独自ドメインと、開発用とは別の本番Googleプロジェクトを用意する。

公開前に具体化する項目：

- 専用問い合わせメールと受付方法（削除・訂正・開示等も含む）。両HTMLの末尾と開発版注記を更新し、Googleのサポートメールも一致させる。
- Gemini APIの課金状態とGoogle側のデータ処理条件を確認し、機密会議向けに有償プロジェクトを使用する。無償APIで個人情報・機密情報を送らない。現在のポリシーは課金状態を断定していない。
- 一般公開向けの複数ユーザー認証・ローカルデータのユーザー分離、利用量・課金制御。現在は個人検証向けの許可アカウント方式。
- 有料販売を始める場合、料金・解約・返金・販売者情報等を定め、販売形態に応じて特定商取引法等の必要な表示を追加する。現時点で販売条件を捏造しない。

参照した公式資料：

- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://developers.google.com/terms/api-services-user-data-policy
- https://ai.google.dev/gemini-api/terms

# CLAUDE.md

## プロジェクト概要

北大医学部の学内試験対策向け問題演習Webサービス。
hokui-qb-old（Python/FastAPI）を Cloudflare Workers に移植したバージョン。

## ロードマップ

**フェーズ1（今作るもの）**
ダミー問題のJSONを使い、ログイン・演習・正誤確認が動く状態を作る。

**フェーズ2（将来）**
hokui.net のPDFから問題を手動またはAI支援でJSONに起こし、実問題を投入する。

**フェーズ3（さらに将来）**
hokui.net にAPIを追加して問題データを自動連携。ユーザー統合（SSO）も検討する。
当面は `quiz.hokui.net` のようなサブドメインで独立運用し、デザインのみ統一感を持たせる。

## 技術スタック

- **ランタイム**: Cloudflare Workers（TypeScript）
- **フレームワーク**: Hono
- **フロントエンド**: HTML + CSS + Vanilla JS（フレームワークなし）
- **問題データ**: `src/questions.json`（Workerにバンドル）
- **認証**: Cookie ベース（`logged_in=1`）、共通パスワード方式

## ディレクトリ構成

```
hokui-qb/
├── CLAUDE.md
├── wrangler.toml        # Cloudflare Workers 設定
├── package.json
├── tsconfig.json
├── .dev.vars            # ローカル開発用の環境変数（git 管理外）
├── .gitignore
├── src/
│   ├── index.ts         # Hono アプリ本体（全ルート）
│   └── questions.json   # 問題データ
└── public/              # 静的ファイル（Workers Assets として配信）
    ├── login.html
    ├── quiz.html
    ├── subject.html
    ├── quiz_play.html
    ├── style.css
    └── app.js
```

## ルーティング設計

| メソッド | パス | 処理 |
|---|---|---|
| GET | / | /quiz か /login にリダイレクト |
| GET | /login | assets が login.html を配信 |
| POST | /api/login | パスワード検証 → Cookie セット |
| GET | /logout | Cookie 削除 → /login にリダイレクト |
| GET | /quiz | assets が quiz.html を配信（auth は JS 側） |
| GET | /quiz/:subject | Worker が auth チェック → subject.html を配信 |
| GET | /quiz/:subject/:year | Worker が auth チェック → quiz_play.html を配信 |
| GET | /api/subjects | 科目一覧 JSON |
| GET | /api/questions/:subject/:year | 問題一覧 JSON |

## Cloudflare Workers Assets の落とし穴

### assets ルーターと Worker の競合

`[assets] directory = "./public"` を設定すると、assets ルーターが一部のリクエストを
Worker より先に処理する。具体的には：

- GET /login → `login.html` に自動マッチ → assets が配信（Worker を素通り）
- GET /quiz → `quiz.html` に自動マッチ → assets が配信（Worker を素通り）
- POST /login → `login.html` にマッチ → assets が **405** を返す（Workerに届かない）

### 解決策

1. **ログインの POST 先を `/api/login` にする**（`/login` は assets に取られるため）
2. **`/quiz` の認証ガードは JS 側に任せる**（Worker が介入できないため）
   - `quiz.html` の JS が `/api/subjects` を fetch → 401 なら `/login` にリダイレクト
3. **`/quiz/:subject`, `/quiz/:subject/:year` は Worker が処理する**
   - 動的パスは静的ファイルと競合しないので Worker に届く → auth チェック可能

### Cookie の設定順序（Hono）

Hono では `setCookie()` を `c.redirect()` より **前** に呼ぶ必要がある。

```ts
// NG: redirect 後に setCookie しても Response に反映されない
const res = c.redirect('/quiz')
setCookie(c, 'logged_in', '1', ...)
return res

// OK
setCookie(c, 'logged_in', '1', ...)
return c.redirect('/quiz')
```

### ASSETS binding の使い方

`wrangler.toml` で `binding = "ASSETS"` を設定すると、Worker から
`env.ASSETS.fetch()` で静的ファイルを取得できる。

```ts
// subject.html を Worker 経由で配信する例
function serveAsset(c: Context<Env>, path: string) {
  const url = new URL(path, c.req.url)
  return c.env.ASSETS.fetch(new Request(url.toString()))
}
```

### ローカル開発の環境変数

`wrangler dev` では shell 変数（`QUIZ_PASSWORD=test npx wrangler dev`）は
`c.env` に渡らない。`.dev.vars` ファイルを使う。

```
# .dev.vars（git 管理外）
QUIZ_PASSWORD=test
```

## ローカル起動方法

```bash
# 依存インストール
npm install

# .dev.vars にパスワードを書く（初回のみ）
echo "QUIZ_PASSWORD=yourpassword" > .dev.vars

# 起動
npm run dev

# ブラウザで開く
http://localhost:8787
```

## デプロイ方法

```bash
# Cloudflare アカウント認証（初回のみ）
npx wrangler login

# 本番パスワードを Secret として登録（初回のみ）
npx wrangler secret put QUIZ_PASSWORD

# デプロイ
npm run deploy
```

## 開発方針

- **1ファイル・1機能**を原則とする
- 読んで意味がわかるコードを優先する
- コメントは日本語でOK
- 外部ライブラリは必要最小限（Hono のみ）

## Claude Codeへの指示方針

- 一度に大きな実装を頼まない。**1ファイルずつ**依頼する
- 実装後は必ず「何をしているか」を日本語で説明させる
- わからない部分は実装前に質問させる（勝手に進めない）
- リファクタリングや最適化は、基本動作が確認できてから行う

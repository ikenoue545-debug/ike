# 法人税申告書AIアシスタント（Phase 1・2）

日本の中小法人向けに、決算データ（試算表・仕訳帳）から法人税申告書のドラフトを作り、税務調整と不備の確認を支援する Web アプリです。最終的な申告内容の確定・承認は、税理士等が行う前提です。電子申告の送信・電子署名・納税はしません。

- 設計書：[docs/01_設計書.md](docs/01_設計書.md)
- 使い方：[docs/02_使い方.md](docs/02_使い方.md)
- 対応範囲（対応済み・未対応）と検証結果：[docs/03_対応範囲と検証結果.md](docs/03_対応範囲と検証結果.md)
- 税制改正時の更新方法：[docs/04_税制改正時の更新方法.md](docs/04_税制改正時の更新方法.md)
- DB 定義：[backend/db/schema.sql](backend/db/schema.sql)（`app/models.py` から生成）

## できること（この版）

| 段階 | 内容 |
| --- | --- |
| Phase 1 | 顧問先管理、法人基本情報（法人番号の検査、本店所在地から地方税の申告先の候補）、CSV・Excel の取込（列の自動マッピングと確認）、試算表の表示と科目分類、整合性の検証（各科目の増減・貸借・BS と PL の利益・仕訳帳との照合）、必要資料のチェックリスト |
| Phase 2 | 税務調整（規則による候補の抽出、採用／理由付きの不要、確認済み）、別表四・五(一)・五(二)・一（本表・次葉一・次葉二）、法人税額・地方法人税額・防衛特別法人税額、別表六(一)・七(一)・十五、自動連動と再計算、欄の上書き（理由・履歴）、承認（重大エラーがあれば不可）、翌期への引継ぎ、Excel・CSV 出力 |

申告書の行番号は国税庁「令和8年4月1日以後終了事業年度等分」の様式に合わせています。税率などのルールは版で管理し、根拠資料と適用期間を持ちます（画面「税率・法令」）。

## 構成

```
hojinzei/
  backend/          Python 3.13 / FastAPI / SQLAlchemy（PostgreSQL・SQLite）
    taxengine/      計算エンジン（DB・HTTP に依存しない）。rules/data/*.json が年度別のルール
    app/            API（routers）・取込や検証など（services）・DB モデル
    tests/          事例テスト・単体テスト・回帰テスト（golden/）・API の結合テスト
    db/             schema.sql（PostgreSQL 用 DDL）と生成スクリプト
  frontend/         Next.js 15 / React 19 / TypeScript / Tailwind CSS 4
    e2e/flow.mjs    画面の通し確認（Playwright）
  samples/          サンプル法人（すべて架空）の試算表・仕訳帳と、その生成スクリプト
  scripts/e2e.sh    一時的な DB でサーバーを起動して E2E を流す
  docs/             設計書・使い方・対応範囲と検証結果・税制改正時の更新方法
```

## セットアップ（開発）

前提：Python 3.12 以上、Node.js 20 以上。

```sh
# バックエンド
cd hojinzei/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:create_app --factory --reload --port 8000
#   既定は SQLite（backend/hojinzei-dev.db）。初回起動時にデモ用の架空データを入れます。

# フロントエンド（別の端末で）
cd hojinzei/frontend
npm ci
npm run dev            # http://localhost:3000
```

デモ用の利用者（開発時だけ作成。すべて架空）：

| メールアドレス | 役割 | パスワード |
| --- | --- | --- |
| staff@example.com | 担当者 | `demo-pass-2026`（環境変数 `HOJINZEI_DEMO_PASSWORD` で変更可） |
| reviewer@example.com | レビュー担当者 | 同上 |
| admin@example.com | 管理者 | 同上 |

デモの顧問先：株式会社みなと企画（9月決算・黒字・繰越欠損金・源泉所得税・延滞税・役員報酬の改定あり）、合同会社さくら研究所（設立初年度6か月・防衛特別法人税の課税事業年度・Excel と Shift_JIS の取込）、株式会社やまびこ商店（未着手）。

### PostgreSQL で動かす

```sh
docker compose -f hojinzei/docker-compose.yml up -d     # PostgreSQL 16（ユーザー hojinzei）
cd hojinzei/backend
DATABASE_URL=postgresql+psycopg://hojinzei:hojinzei_dev@localhost:5432/hojinzei \
  .venv/bin/uvicorn app.main:create_app --factory --port 8000
```

テーブルは起動時に作成します（`create_all`）。DDL は `backend/db/schema.sql`。マイグレーション（Alembic）は未導入で、本番運用の前に入れる予定です。

### 環境変数

| 変数 | 既定 | 内容 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///backend/hojinzei-dev.db` | DB の接続先 |
| `HOJINZEI_ENV` | `dev` | `prod` にするとデモデータを入れない |
| `HOJINZEI_DATA_DIR` | `backend/data` | アップロードしたファイルの保存先 |
| `HOJINZEI_SEED_DEMO` | dev は `1` | デモデータを入れるか |
| `HOJINZEI_TOKEN_HOURS` | `12` | ログインの有効時間 |
| `HOJINZEI_MAX_UPLOAD_MB` | `20` | アップロードの上限 |
| `BACKEND_URL`（フロント） | `http://127.0.0.1:8000` | `/api` の中継先。`next build` の時点で決まります |

本番では、最初の管理者をコマンドで作り、あとは画面「利用者」で追加します。

```sh
cd hojinzei/backend
HOJINZEI_ENV=prod DATABASE_URL=... .venv/bin/python -m app.cli create-user --email you@example.jp --name "管理者" --role admin
```

## テスト

```sh
cd hojinzei/backend
.venv/bin/python -m pytest -q                       # 計算エンジン・API（SQLite）
TEST_DATABASE_URL=postgresql+psycopg://hojinzei:hojinzei_dev@localhost:5432/hojinzei_test \
  .venv/bin/python -m pytest -q tests/test_api.py   # API を PostgreSQL で

cd ../frontend
npx tsc --noEmit && npx eslint src && npm run build
cd .. && scripts/e2e.sh                             # 画面の通し確認（Playwright と Chromium が必要）
```

計算を意図して変えたときは、`UPDATE_GOLDEN=1 .venv/bin/python -m pytest tests/test_engine_regression.py` で回帰テストの期待値を作り直し、差分を人が確認してからコミットします。

## セキュリティ（この版で実装したこと・していないこと）

- 実装：ログイン（scrypt・期限付きトークン・トークンはハッシュで保存）、役割（担当者・レビュー担当者・管理者）、会社単位のアクセス権（権限のない会社は存在も見せない）、承認はレビュー担当者・管理者のみ、監査ログ（金額・会社名・個人情報は記録しない）、会社とデータの削除（管理者）、アップロードの SHA-256 記録、CSV・Excel 出力の数式インジェクション対策、外部 AI への送信なし。
- 本番で必要（未実装）：HTTPS の終端（リバースプロキシ）、保存データの暗号化（ディスク暗号化や列の暗号化）、DB とアップロードファイルのバックアップ（例：`pg_dump` と `HOJINZEI_DATA_DIR` の定期退避）、パスワード再設定、多要素認証、ログイン試行の制限。

サンプルの会社名・取引先・金額はすべて架空です。実在の会社・個人とは関係ありません。

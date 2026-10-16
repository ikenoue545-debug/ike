// 画面の通し確認（Playwright）。scripts/e2e.sh から呼ぶ。
//   取込（列マッピング）→ 税務調整の判断 → 上書きと取消し → 承認 → 翌期への引継ぎ
import { createRequire } from "module";
import { mkdirSync, readFileSync } from "fs";
import { resolve } from "path";

const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
  try {
    ({ chromium } = require(p));
    break;
  } catch {
    /* 次を試す */
  }
}
if (!chromium) throw new Error("playwright が見つかりません（npm i -D playwright）");

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const OUT = resolve(process.env.E2E_OUT ?? "e2e-shots");
const SAMPLES = resolve(process.env.E2E_SAMPLES ?? "../samples");
const PW = process.env.HOJINZEI_DEMO_PASSWORD ?? "demo-pass-2026";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !m.text().includes("409") && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const step = (s) => console.log(`- ${s}`);

async function login(email) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", PW);
  await page.click('button:has-text("ログイン")');
  await page.locator('h1:has-text("顧問先一覧")').waitFor();
}

async function header(text) {
  await page.locator(`h2:has-text("${text}")`).first().waitFor();
}

try {
// 1 担当者でログイン、顧問先一覧（未解決エラー数が計算済み）
await login("staff@example.com");
await page.locator("text=重大 ").first().waitFor();
step("顧問先一覧に未解決エラー数が出る");

// 2 新しい顧問先 → 事業年度 → 試算表の取込（列の対応の確認）
await page.click('button:has-text("新しい顧問先")');
await page.fill('input[placeholder="株式会社〇〇"]', "株式会社とりこみ確認（架空）");
await page.locator("label:has-text('本店所在地') input").fill("東京都千代田区丸の内一丁目（架空）");
await page.locator("label:has-text('本店所在地') input").blur();
await page.locator("text=地方税の申告先の候補：東京都 千代田区").waitFor();
await page.click('button:has-text("登録して会社情報へ")');
await page.locator('h1:has-text("株式会社とりこみ確認（架空）")').waitFor();
await page.click('button:has-text("事業年度を追加")');
await page.locator("label:has-text('開始日') input").fill("2025-10-01");
await page.locator("label:has-text('終了日') input").fill("2026-09-30");
await page.click('button:has-text("追加して作業を始める")');
await page.locator("text=次にやること").waitFor();
await page.click('nav >> text=1 資料');
await header("資料");
await page.locator("label:has-text('資料の種類') select").selectOption("trial_balance");
// パスを渡すと日本語のファイル名で失敗する環境があるため、中身を読んで渡す（ファイル名は日本語のまま）
await page.locator("input.text-sm[type=file]").setInputFiles({
  name: "試算表_貸借対照表_2026-09.csv",
  mimeType: "text/csv",
  buffer: readFileSync(`${SAMPLES}/minato/試算表_貸借対照表_2026-09.csv`),
});
await page.locator("text=列の対応を推定しました").waitFor();
await page.click('button:has-text("読み取り結果を確認")');
await page.locator("text=すべての科目の分類を推定できました").waitFor();
await shot("e2e-01-mapping");
await page.click('button:has-text("この内容で取り込む")');
await page.locator("text=取り込みました").waitFor();
await page.click("nav >> text=2 試算表");
await header("試算表");
await page.locator('button:has-text("繰越利益剰余金")').first().waitFor();
step("CSV を列の対応を確認して取り込み、試算表に表示");

// 3 みなと企画：資料不足の候補を「調整不要」にする → 重大エラー 0
await page.goto(`${BASE}/`);
await page.click("text=株式会社みなと企画（架空）");
await page.locator("text=次にやること").waitFor();
const fyUrl = page.url();
await page.goto(`${fyUrl}/adjustments`);
await header("税務調整");
await page.locator("tr:has-text('減価償却の償却超過額') >> button:has-text('詳細')").click();
await page.fill('input[placeholder="例：固定資産台帳で償却限度額以内を確認"]', "固定資産台帳で償却限度額以内を確認（E2E）");
await page.click('button:has-text("調整不要にする")');
await page.locator("text=重大エラー 0").first().waitFor();
await shot("e2e-02-adjustments");
step("資料不足の候補を理由付きで調整不要にし、重大エラーが0になる");

// 4 申告書：欄を押して計算過程 → 上書き → 取消し
await page.goto(`${fyUrl}/return?cell=b1%3A13%3Avalue`);
await page.locator("text=(9)−(10)−(11)−(12)（100円未満切捨て）").waitFor();
await page.goto(`${fyUrl}/return?cell=b1%3A14%3Avalue`);
await page.locator("text=この欄は入力値です").waitFor();
await page.click("summary:has-text('手入力で上書き')");
await page.locator("details input[inputmode=numeric]").fill("200000");
await page.locator("details input[inputmode=numeric]").blur();
await page.fill('input[placeholder="例：中間申告書の控えで確認"]', "E2E の確認");
await page.click('button:has-text("上書きする")');
await page.locator("aside >> text=手入力で上書き").first().waitFor();
await page.locator("text=計算値 210,000 円を上書き").waitFor();
await shot("e2e-03-override");
await page.click('button:has-text("上書きを取り消す")');
await page.locator("text=← 使用中").waitFor({ state: "detached" });
step("欄の上書き（理由必須）と取消し");

// 5 レビュー担当者で承認 → 翌期を作って引き継ぐ
await page.click('button:has-text("ログアウト")');
await login("reviewer@example.com");
await page.goto(`${fyUrl}/review`);
await header("最終チェック");
await page.click('button:has-text("承認する")');
await page.locator("text=承認しました").waitFor();
await page.locator("text=この年度は承認済です").waitFor();
await shot("e2e-04-approved");
await page.click('button:has-text("翌期を作って引き継ぐ")');
await header("期首情報（前期からの引継ぎ）");
await page.locator("td:has-text('減価償却超過額')").waitFor();
await page.locator("text=100,000").first().waitFor();
await shot("e2e-05-next-year");
step("承認して翌期を作り、期首情報（減価償却超過額 100,000 円）を引き継ぐ");

} catch (e) {
  console.error(e);
  await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => undefined);
  console.error("失敗時の画面:", `${OUT}/failure.png`, "URL:", page.url(), "ブラウザのエラー:", errors);
  await browser.close();
  process.exit(1);
}
await browser.close();
if (errors.length) {
  console.error("ブラウザのエラー:", errors);
  process.exit(1);
}
console.log("OK");

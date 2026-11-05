// 页面语言检查（不调用 API）：按浏览器语言自动选择、手动切换后刷新仍保持、截图首屏
import { chromium } from "playwright-core";
import { resolve } from "node:path";
const BASE = process.env.BASE_URL || "http://localhost:8787";
const OUT = resolve(import.meta.dirname, "../../../outputs/e2e");
const browser = await chromium.launch({ channel: "msedge" });
for (const locale of ["zh-CN", "en-US", "ja-JP"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  const first = await page.evaluate(() => [document.documentElement.lang, document.title, document.querySelector("h1").textContent, document.getElementById("lang").textContent]);
  await page.click("details.info summary");
  await page.screenshot({ path: `${OUT}/i18n_${locale}.png`, fullPage: true });
  await page.click("#lang");
  await page.reload();
  const after = await page.evaluate(() => [document.documentElement.lang, document.querySelector("h1").textContent, document.getElementById("analyze").textContent]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(locale, "首次:", first.join(" | "), "→ 切换并刷新后:", after.join(" | "), overflow ? "【横向溢出】" : "", errors.length ? `错误: ${errors}` : "");
  await ctx.close();
}
await browser.close();

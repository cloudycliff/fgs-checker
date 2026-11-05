// 端到端测试：用本机的 Edge 打开页面，上传照片，等待报告图生成并截图。
// 每张照片会真实调用一次大模型（产生少量费用）。
// 用法：先 `npm run dev`，再 `npm run e2e -- <照片路径>...`
// 浏览器语言默认 zh-CN，可用环境变量 E2E_LOCALE=en-US 测英文界面
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:8787";
const LOCALE = process.env.E2E_LOCALE || "zh-CN";
const SUFFIX = LOCALE.startsWith("zh") ? "" : `_${LOCALE}`;
const OUT = resolve(import.meta.dirname, "../../../outputs/e2e");
const photos = process.argv.slice(2);
if (!photos.length) {
  console.error("用法：npm run e2e -- <照片路径>...");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: LOCALE });
let failed = 0;

for (const photo of photos) {
  const name = basename(photo, extname(photo)) + SUFFIX;
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.setInputFiles("#file", photo);
  await page.waitForFunction(() => !document.getElementById("analyze").disabled);
  const started = Date.now();
  await page.click("#analyze");
  await page.waitForFunction(
    () => !document.getElementById("report").hidden || document.getElementById("status").classList.contains("error"),
    null,
    { timeout: 200_000 },
  );
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const status = await page.textContent("#status");

  if (await page.isVisible("#report")) {
    await page.waitForFunction(() => document.getElementById("report-img").complete);
    const png = await page.evaluate(async () => {
      const blob = await (await fetch(document.getElementById("report-img").src)).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    writeFileSync(`${OUT}/${name}_report.png`, Buffer.from(png, "base64"));
    console.log(`[成功] ${name} ${secs}s → outputs/e2e/${name}_report.png`);
  } else {
    console.log(`[未出报告] ${name} ${secs}s：${status}`);
  }
  await page.screenshot({ path: `${OUT}/${name}_page.png`, fullPage: true });
  if (errors.length) {
    failed++;
    console.log(`  页面脚本错误：${errors.join(" | ")}`);
  }
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);

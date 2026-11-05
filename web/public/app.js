import { ITEMS, GROUPS, colorOf } from "./fgs.js";
import { solvePow } from "./pow.js";
import { LANGS, t, detectLang, bandText, noticeText, adjustedText } from "./i18n.js";
import qrcode from "./vendor/qrcode.mjs";

const LONG_EDGE = 1280; // 发给模型前缩放到的长边
const LANG_KEY = "fgs-lang"; // 手动选过的语言记在本机浏览器里
const SITE_URL = `${location.origin}/`; // 报告图底部二维码指向的网址：用户当前访问的地址，换域名后自动跟着变
const $ = (id) => document.getElementById(id);

let photo = null; // 缩放并摆正后的照片（canvas），模型坐标和报告都基于它
let reportUrl = null;
let lastReport = null; // { result, summary }，切换语言时用它重画报告
let status = null; // { render: () => 文字, isError }，切换语言时重新生成
let lang = initialLang();

// ---------- 语言 ----------

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* 隐私模式等情况下读不到，按浏览器语言 */ }
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

function applyLang() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t(lang, "page.title");
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(lang, el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-alt]")) el.alt = t(lang, el.dataset.i18nAlt);
  $("fgs-items").replaceChildren(...t(lang, "fgs.items").map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
  const other = lang === "zh" ? "en" : "zh";
  $("lang").textContent = t(lang, "lang.switch");
  $("lang").lang = other === "zh" ? "zh-CN" : "en";
  $("download").download = t(lang, "report.filename");
  if (status) showStatus();
  if (lastReport) showReport(lastReport); // 报告上的界面文字换成新语言；模型写的观察文字保持原样
}

$("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* 记不住也不影响使用 */ }
  applyLang();
});

applyLang();

// ---------- 状态提示 ----------

function setStatus(render, isError = false) {
  status = render ? { render, isError } : null;
  showStatus();
}

function showStatus() {
  $("status").textContent = status ? status.render() : "";
  $("status").classList.toggle("error", !!status?.isError);
}

/** 后端返回的错误：有 code 就按当前语言翻译，否则显示后端给的文字。 */
class ApiError extends Error {
  constructor(data, httpStatus) {
    super(data?.error || `HTTP ${httpStatus}`);
    this.code = data?.code;
    this.params = data?.params ?? {};
    this.httpStatus = httpStatus;
    this.fallback = data?.error || data?.reason;
  }
}

function errorText(err) {
  if (err instanceof ApiError) {
    if (err.code) return t(lang, `err.${err.code}`, err.params);
    return err.fallback || t(lang, "status.httpError", { status: err.httpStatus });
  }
  if (err instanceof TypeError) return t(lang, "status.network"); // fetch 网络失败
  return err.message;
}

async function getJson(url, options) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || data.error) throw new ApiError(data, resp.status);
  return data;
}

// ---------- 选择照片、分析 ----------

$("file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  resetReport();
  setStatus(null);
  $("analyze").disabled = true;
  try {
    photo = await loadPhoto(file);
  } catch {
    photo = null;
    setStatus(() => t(lang, "status.readFail"), true);
    return;
  }
  $("preview").src = photo.toDataURL("image/jpeg", 0.8);
  $("preview").hidden = false;
  $("pick-text").dataset.i18n = "pick.change";
  $("pick-text").textContent = t(lang, "pick.change");
  $("analyze").disabled = false;
});

$("analyze").addEventListener("click", analyze);

$("again").addEventListener("click", () => {
  resetReport();
  $("pick").hidden = false;
  $("file").value = "";
  $("file").click();
});

async function analyze() {
  if (!photo) return;
  $("analyze").disabled = true;
  $("file").disabled = true;
  $("preview-wrap").classList.add("scanning");
  const started = Date.now();
  let phase = "status.verifying";
  const render = () => t(lang, "status.elapsed", { phase: t(lang, phase), s: Math.round((Date.now() - started) / 1000) });
  setStatus(render);
  const timer = setInterval(showStatus, 1000);

  try {
    // 防滥用的算力验证：先领一道题，在本机算出答案（通常 1–2 秒），随照片一起提交
    const q = `?lang=${lang}`; // 模型按这个语言写观察文字
    const challenge = await getJson(`/api/challenge${q}`, { cache: "no-store" });
    const nonce = await solvePow(challenge.salt, challenge.difficulty);
    phase = "status.analyzing";
    showStatus();

    const data = await getJson(`/api/analyze${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: photo.toDataURL("image/jpeg", 0.88), pow: { ...challenge, nonce } }),
    });
    if (data.rejected) throw new ApiError(data, 200);

    await showReport({ result: data.result, summary: data.summary });
    $("report").hidden = false;
    $("pick").hidden = true;
    setStatus(null);
  } catch (err) {
    console.error(err);
    setStatus(() => errorText(err), true);
  } finally {
    clearInterval(timer);
    $("preview-wrap").classList.remove("scanning");
    $("analyze").disabled = false;
    $("file").disabled = false;
  }
}

async function showReport(report) {
  lastReport = report;
  const canvas = renderReport(photo, report.result, report.summary);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (reportUrl) URL.revokeObjectURL(reportUrl);
  reportUrl = URL.createObjectURL(blob);
  $("report-img").src = reportUrl;
  $("download").href = reportUrl;
}

function resetReport() {
  if (reportUrl) URL.revokeObjectURL(reportUrl);
  reportUrl = null;
  lastReport = null;
  $("report").hidden = true;
  $("report-img").removeAttribute("src");
}

/** 按 EXIF 方向摆正并缩放。模型看到的和报告里画的必须是同一张图。 */
async function loadPhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const scale = Math.min(1, LONG_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---------- 报告图 ----------

const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const C = {
  ink: "#1F2A37", muted: "#6B7280", body: "#374151", line: "#E5E7EB",
  accent: "#1F7A68", accentBg: "#E8F4F1", warn: "#B45309", warnBg: "#FEF3E2", warnInk: "#7C2D12",
  alert: "#B42318", alertBg: "#FEE4E2", na: "#9CA3AF",
};
// 总分卡片配色：超线红、边界橙、其他绿
const TONES = { high: [C.alert, C.alertBg], mid: [C.warn, C.warnBg] };
const font = (size, bold = false) => `${bold ? 700 : 400} ${size}px ${FONT}`;

const NO_LINE_START = "，。、；：！？）》”’,.;:!?)"; // 不放在行首的标点
// 英文单词（连同后面的标点）作为整体换行，中文逐字换行
const TOKEN = /[A-Za-z0-9À-ɏ'’\-/]+[.,;:!?)%]*|\s+|./gsu;

function wrap(ctx, text, width) {
  const lines = [];
  let line = "";
  for (const token of String(text).match(TOKEN) ?? []) {
    const blank = /^\s+$/.test(token);
    if (!line && blank) continue;
    if (line && !blank && !NO_LINE_START.includes(token) && ctx.measureText(line + token).width > width) {
      lines.push(line.trimEnd());
      line = token;
    } else {
      line += token;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** 画二维码：深色模块 + 四周留白，size 为最大边长，返回实际边长（按整像素对齐，避免模块之间出现细缝）。 */
function drawQr(ctx, text, x, y, size) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const cell = Math.floor(size / (n + quiet * 2));
  const real = cell * (n + quiet * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, real, real);
  ctx.fillStyle = "#111827";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell, cell);
    }
  }
  return real;
}

function drawLandmarks(ctx, landmarks, top, w, h) {
  const r = Math.max(9, Math.round(Math.max(w, h) * 0.0115));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(Math.round(r * 1.05), true);
  for (const p of landmarks) {
    if (!p.visible) continue;
    const x = (p.x / 1000) * w;
    const y = top + (p.y / 1000) * h;
    const color = colorOf(p.id);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (p.uncertain) { // 位置不确定的点画成空心
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.lineWidth = Math.max(2, Math.round(r / 3));
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = color;
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r / 5);
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
    }
    ctx.fillText(String(p.id), x, y + 1);
  }
}

export function renderReport(photoCanvas, result, summary) {
  const W = 1080, M = 48;
  const ph = Math.round((photoCanvas.height * W) / photoCanvas.width);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 96 + ph + 3200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, canvas.height);

  // 标题栏
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, W, 96);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = font(36, true);
  ctx.fillText(t(lang, "report.title"), M, 49);
  ctx.textAlign = "right";
  ctx.fillStyle = "#C9D1DA";
  ctx.font = font(26);
  ctx.fillText(t(lang, "report.tag"), W - M, 50);

  // 照片和关键点
  ctx.drawImage(photoCanvas, 0, 96, W, ph);
  drawLandmarks(ctx, result.landmarks, 96, W, ph);
  let y = 96 + ph + 28;

  // 图例
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = font(26);
  GROUPS.forEach((g, i) => {
    const x = M + i * 196;
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.arc(x + 11, y + 17, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.fillText(t(lang, `group.${g.key}`), x + 30, y + 18);
  });
  y += 64;

  // 总分卡片（结论文字较长时卡片自动加高）
  const [tone, toneBg] = TONES[summary.level] ?? [C.accent, C.accentBg];
  const total = summary.scaled === null ? "—" : String(summary.scaled);
  ctx.font = font(84, true);
  const tx = M + 44 + ctx.measureText(total).width;
  const bx = tx + 90;
  ctx.font = font(28, true);
  const bandLines = wrap(ctx, bandText(lang, summary.level), W - M - 24 - bx).slice(0, 4);
  const cardH = Math.max(150, 88 + bandLines.length * 36 + 10);
  ctx.fillStyle = toneBg;
  ctx.beginPath();
  ctx.roundRect(M, y, W - M * 2, cardH, 20);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.fillStyle = tone;
  ctx.font = font(84, true);
  ctx.fillText(total, M + 32, y + cardH / 2 + 3);
  ctx.font = font(34);
  ctx.fillText("/ 10", tx, y + cardH / 2 + 19);
  ctx.fillStyle = C.muted;
  ctx.font = font(26);
  ctx.fillText(t(lang, "report.validLine", { valid: summary.valid, raw: summary.raw }), bx, y + 46);
  ctx.fillStyle = tone;
  ctx.font = font(28, true);
  bandLines.forEach((line, i) => ctx.fillText(line, bx, y + 88 + i * 36));
  y += cardH + 28;

  // 提示：打哈欠等情况的改分说明、可评估项少、照片不清晰
  if (summary.notices?.length) {
    ctx.font = font(26);
    const lines = summary.notices.flatMap((n) => wrap(ctx, `· ${noticeText(lang, n)}`, W - M * 2 - 48));
    const h = 70 + lines.length * 38;
    ctx.fillStyle = C.warnBg;
    ctx.beginPath();
    ctx.roundRect(M, y, W - M * 2, h, 16);
    ctx.fill();
    ctx.textBaseline = "top";
    ctx.fillStyle = C.warn;
    ctx.font = font(28, true);
    ctx.fillText(t(lang, "report.notices"), M + 24, y + 20);
    ctx.fillStyle = C.warnInk;
    ctx.font = font(26);
    lines.forEach((line, i) => ctx.fillText(line, M + 24, y + 62 + i * 38));
    y += h + 28;
  }

  // 五项评分
  ctx.textBaseline = "top";
  for (const key of ITEMS) {
    const item = result.fgs[key];
    const valid = item.score !== "NA";
    ctx.textAlign = "left";
    ctx.fillStyle = C.ink;
    ctx.font = font(32, true);
    ctx.fillText(t(lang, `item.${key}`), M, y);
    ctx.textAlign = "right";
    ctx.fillStyle = valid ? C.accent : C.na;
    ctx.fillText((valid ? `${item.score} / 2` : t(lang, "report.na")) + (item.adjusted ? t(lang, "report.adjusted") : ""), W - M, y);
    ctx.textAlign = "left";
    y += 50;
    ctx.fillStyle = C.muted;
    ctx.font = font(26);
    for (const line of wrap(ctx, item.adjusted ? adjustedText(lang, item) : item.evidence, W - M * 2)) {
      ctx.fillText(line, M, y);
      y += 38;
    }
    y += 12;
    ctx.fillStyle = C.line;
    ctx.fillRect(M, y, W - M * 2, 2);
    y += 22;
  }

  // 文字说明（模型按分析时的语言写的）
  const sections = [
    ["report.observations", result.observations],
    ["report.suggestions", result.suggestions.map((s) => s.replace(/[。；;.\s]+$/, "")).join(t(lang, "report.listSep"))],
    ["report.caveats", result.caveats],
  ];
  for (const [title, body] of sections) {
    if (!body) continue;
    ctx.fillStyle = C.ink;
    ctx.font = font(30, true);
    ctx.fillText(t(lang, title), M, y);
    y += 46;
    ctx.fillStyle = C.body;
    ctx.font = font(26);
    for (const line of wrap(ctx, body, W - M * 2)) {
      ctx.fillText(line, M, y);
      y += 38;
    }
    y += 18;
  }

  // 免责声明
  y += 8;
  ctx.fillStyle = C.muted;
  ctx.font = font(22);
  for (const line of wrap(ctx, t(lang, "report.disclaimer"), W - M * 2)) {
    ctx.fillText(line, M, y);
    y += 32;
  }

  // 底部二维码：分享报告图时，别人扫码就能打开网站
  y += 20;
  ctx.fillStyle = C.line;
  ctx.fillRect(M, y, W - M * 2, 2);
  y += 28;
  const qrSize = drawQr(ctx, SITE_URL, M, y, 220);
  const qx = M + qrSize + 32;
  const qw = W - M - qx;
  let qy = y + 24;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = C.ink;
  ctx.font = font(34, true);
  ctx.fillText(t(lang, "report.qrTitle"), qx, qy);
  qy += 56;
  ctx.fillStyle = C.muted;
  ctx.font = font(24);
  for (const line of wrap(ctx, t(lang, "report.qrHint"), qw)) {
    ctx.fillText(line, qx, qy);
    qy += 34;
  }
  qy += 6;
  ctx.fillStyle = C.accent;
  ctx.font = font(28, true);
  for (const line of wrap(ctx, SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, ""), qw)) {
    ctx.fillText(line, qx, qy);
    qy += 38;
  }
  y = Math.max(y + qrSize, qy) + 8;

  const out = document.createElement("canvas");
  out.width = W;
  out.height = y + 32;
  out.getContext("2d").drawImage(canvas, 0, 0);
  return out;
}

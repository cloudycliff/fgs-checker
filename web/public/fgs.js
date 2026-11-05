// FGS 评分规则、关键点分组和模型输出清洗。后端（Worker）和前端共用这一份。
// 这里不放界面文字：提示、分档、改分原因都返回代码，由 i18n.js 翻译成当前语言。

export const ITEMS = ["ear_position", "orbital_tightening", "muzzle_tension", "whiskers_change", "head_position"];

// 关键点编号 1–48 的分组，与 prompts/fgs_system.md 的定义一致
export const GROUPS = [
  { key: "ears", from: 1, to: 10, color: "#8B5CF6" },
  { key: "eyes", from: 11, to: 26, color: "#22A7E0" },
  { key: "nose", from: 27, to: 34, color: "#F59E0B" },
  { key: "mouth", from: 35, to: 38, color: "#F0567A" },
  { key: "cheeks", from: 39, to: 48, color: "#34C38F" },
];

export const MIN_VALID_ITEMS = 2; // 有效项少于此数不给总分。产品以娱乐为主，尽量给分
export const ANALGESIA_THRESHOLD = 4; // FGS 原论文（Evangelista 等，2019）：总分 > 0.39（满分 1）建议镇痛，约合 4/10
export const BORDERLINE_FROM = 3; // 3 到 5 之间为边界区间，避免一分之差结论相反
export const HIGH_FROM = 5;

// 猫当时在做什么。模型只负责识别；受影响的项由代码统一按 0 分（放松）计，分数宁低勿高。
export const ACTIVITIES = {
  none: [],
  yawning: ["orbital_tightening", "muzzle_tension", "whiskers_change"],
  mouth_open: ["muzzle_tension", "whiskers_change"],
  eating_grooming: ["muzzle_tension", "whiskers_change"],
  sleeping: ["orbital_tightening"],
};

// 头的支撑情况：头靠在物体上时头部姿态按 0 分计；看不到肩部时不评估
export const HEAD_SUPPORT = ["free", "resting", "shoulders_not_visible"];

export function colorOf(id) {
  return GROUPS.find((g) => id >= g.from && id <= g.to)?.color ?? "#888888";
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** 去掉可能包裹 JSON 的 Markdown 代码块，再解析。 */
export function parseModelJson(content) {
  let s = String(content ?? "").trim();
  if (s.startsWith("```")) s = s.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
  return JSON.parse(s);
}

/** 把模型输出整理成固定结构：非法分数视为 NA，越界或缺失的点视为不可见。 */
export function sanitizeResult(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("模型返回的不是 JSON 对象");
  }
  const fgs = {};
  for (const key of ITEMS) {
    const item = raw.fgs?.[key] ?? {};
    fgs[key] = {
      score: [0, 1, 2].includes(item.score) ? item.score : "NA",
      evidence: text(item.evidence, 160),
    };
  }

  const seen = new Set();
  const landmarks = [];
  for (const p of Array.isArray(raw.landmarks) ? raw.landmarks : []) {
    const id = Number(p?.id);
    if (!Number.isInteger(id) || id < 1 || id > 48 || seen.has(id)) continue;
    seen.add(id);
    const x = p.x == null ? NaN : Number(p.x);
    const y = p.y == null ? NaN : Number(p.y);
    const placed = p.visible !== false && x >= 0 && x <= 1000 && y >= 0 && y <= 1000;
    landmarks.push(placed
      ? { id, x, y, visible: true, uncertain: p.uncertain === true }
      : { id, x: null, y: null, visible: false, uncertain: false });
  }
  landmarks.sort((a, b) => a.id - b.id);

  const activity = Object.hasOwn(ACTIVITIES, raw.facial_activity) ? raw.facial_activity : "none";
  const headSupport = HEAD_SUPPORT.includes(raw.head_support) ? raw.head_support : "free";
  applyStateRules(fgs, activity, headSupport);

  return {
    is_cat: raw.is_cat === true,
    face_visible: raw.face_visible === true,
    image_quality: ["good", "fair", "poor"].includes(raw.image_quality) ? raw.image_quality : "fair",
    facial_activity: activity,
    head_support: headSupport,
    landmarks,
    fgs,
    // 英文比中文长，上限按英文定；中文回答本身受提示词字数限制
    observations: text(raw.observations, 400),
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : [])
      .map((s) => text(s, 160)).filter(Boolean).slice(0, 3),
    caveats: text(raw.caveats, 300),
  };
}

/**
 * 按猫当时的状态改写受影响的项。改动过的项带 adjusted、模型原分 model_score 和原因代码 reason
 * （打哈欠等动作代码，或 head_resting / shoulders_not_visible），说明文字由 i18n.adjustedText 生成。
 */
function applyStateRules(fgs, activity, headSupport) {
  const adjust = (key, score, reason) => {
    fgs[key] = { score, evidence: "", adjusted: true, model_score: fgs[key].score, reason };
  };
  for (const key of ACTIVITIES[activity]) {
    if (fgs[key].score !== 0) adjust(key, 0, activity);
  }
  const head = fgs.head_position.score;
  if (headSupport === "resting" && head !== 0) adjust("head_position", 0, "head_resting");
  else if (headSupport === "shoulders_not_visible" && head !== "NA") adjust("head_position", "NA", "shoulders_not_visible");
}

/**
 * 总分由代码计算；有 NA 时按有效项比例折算到 10 分。
 * level：unknown / low / mid / high；notices：需要提醒用户的事项（代码，由 i18n.noticeText 翻译）。
 */
export function summarize(result) {
  const valid = ITEMS.map((key) => result.fgs[key].score).filter((s) => s !== "NA");
  const raw = valid.reduce((a, b) => a + b, 0);
  const notices = [];

  const affected = ACTIVITIES[result.facial_activity] ?? [];
  if (affected.length) notices.push({ code: "activity", activity: result.facial_activity, items: affected });
  if (result.head_support === "resting") notices.push({ code: "head_resting" });
  if (result.image_quality === "poor") notices.push({ code: "poor_quality" });

  if (valid.length < MIN_VALID_ITEMS) return { raw, valid: valid.length, scaled: null, level: "unknown", notices };
  if (valid.length < 4) notices.push({ code: "few_items", valid: valid.length });
  const scaled = Math.round((raw / (valid.length * 2)) * 100) / 10;
  const level = scaled >= HIGH_FROM ? "high" : scaled >= BORDERLINE_FROM ? "mid" : "low";
  return { raw, valid: valid.length, scaled, level, notices };
}

// 界面和报告图的文字（中文、英文）。前端、Worker 和 Python 测试脚本（经 apply_rules.mjs）共用。
// 模型写的观察文字不在这里：前端把语言传给后端，后端让模型直接用该语言写。

export const LANGS = ["zh", "en"];

const zh = {
  "page.title": "猫咪疼痛表情小测",
  "page.heading": "猫咪疼痛表情小测",
  "page.intro": "拍一张猫咪的正脸照片，AI 会像兽医那样看看它的耳朵、眼睛、嘴巴、胡须和头部姿势，给表情打个分，看看它是不是有点不舒服。",
  "lang.switch": "English",
  "fgs.title": "FGS 是什么？",
  "fgs.p1": "FGS（Feline Grimace Scale，猫疼痛表情量表）是加拿大蒙特利尔大学兽医团队 2019 年发表的一套方法。猫疼的时候，脸上会出现一些固定的变化，兽医可以据此判断它要不要止痛。",
  "fgs.p2": "它看五个地方，每项 0–2 分：",
  "fgs.items": [
    "耳朵：有没有向两边撇开",
    "眼睛：有没有眯起来",
    "口鼻：有没有绷紧、变成椭圆形",
    "胡须：有没有变直、往前伸",
    "头部：有没有低于肩膀",
  ],
  "fgs.p3": "五项合计折算成满分 10 分。研究中，总分达到约 4 分时建议考虑止痛。",
  "fgs.p4": "这里是让 AI 按这套方法看照片打分，结果仅供娱乐和日常观察参考。猫打哈欠、张嘴、睡觉时表情会失真，会自动按放松计算。",
  "tips.title": "拍照小贴士",
  "tips.body": "正对猫脸、光线充足；在猫安静放松时拍；最好能拍到肩膀。",
  "pick.choose": "点击选择照片",
  "pick.change": "点击更换照片",
  "pick.previewAlt": "已选择的照片",
  "btn.analyze": "开始分析",
  "btn.save": "保存报告图",
  "btn.again": "换一张照片",
  "report.alt": "分析报告图",
  "report.hint": "手机上也可以长按报告图保存。",
  "report.filename": "猫咪疼痛表情小测.png",
  "footer.source": "源代码在 GitHub 上开放",
  "footer": "结果由 AI 根据单张照片生成，关键点为近似定位，仅供娱乐和日常观察参考，不构成诊断，也不能排除疼痛或疾病。担心猫咪健康请咨询兽医。照片只用于本次分析，服务器不保存。",

  "status.verifying": "正在做安全验证",
  "status.analyzing": "分析中",
  "status.elapsed": "{phase}，已用 {s} 秒（通常需要 15–40 秒，请不要离开页面）",
  "status.readFail": "这张照片无法读取，请换一张 JPEG 或 PNG 照片",
  "status.network": "网络连接失败，请检查网络后重试",
  "status.httpError": "服务器返回错误（{status}）",

  "err.method_not_allowed": "只支持 POST 请求",
  "err.server_error": "服务器内部错误，请稍后重试",
  "err.config": "服务器配置有误，请稍后再试",
  "err.too_large": "照片太大，请换一张",
  "err.bad_request": "请求格式错误",
  "err.bad_image": "请上传 JPEG、PNG 或 WebP 格式的照片",
  "err.pow_invalid": "安全验证失败，请刷新页面重试",
  "err.pow_expired": "安全验证已过期，请重新点击开始分析",
  "err.pow_reused": "安全验证已失效，请重新点击开始分析",
  "err.busy": "服务繁忙，请稍后再试",
  "err.daily_full": "今天的免费分析名额已经用完了，明天再来吧",
  "err.ip_day": "你今天的分析次数已达上限，明天再来吧",
  "err.ip_burst": "操作太频繁，请 {minutes} 分钟后再试",
  "err.upstream_unreachable": "连接模型服务失败或超时，请稍后重试",
  "err.upstream_error": "模型服务返回错误（{status}），请稍后重试",
  "err.truncated": "模型输出过长被截断，请重试或换一张更清晰的正脸照片",
  "err.bad_output": "模型返回的数据无法解析，请重试",
  "err.not_cat": "照片里没有识别到猫，请换一张猫的照片",
  "err.no_face": "没有看清猫的脸，请换一张能看到正脸的照片",

  "report.title": "猫咪疼痛表情小测",
  "report.tag": "FGS · 48 点定位",
  "group.ears": "耳部", "group.eyes": "眼部", "group.nose": "鼻部", "group.mouth": "口部", "group.cheeks": "颊部",
  "item.ear_position": "耳位",
  "item.orbital_tightening": "眼眶收紧",
  "item.muzzle_tension": "口鼻紧张",
  "item.whiskers_change": "胡须状态",
  "item.head_position": "头部姿态",
  "report.validLine": "{valid} 项可判断，原始 {raw} 分",
  "report.na": "无法判断",
  "report.adjusted": "（已校正）",
  "report.notices": "提示",
  "report.observations": "观察",
  "report.suggestions": "建议",
  "report.caveats": "照片局限",
  "report.listSep": "；",
  "report.disclaimer": "仅供娱乐和日常观察参考。基于单张照片的 AI 观察，关键点为近似定位，结果可能有误，不构成诊断，也不能排除疼痛或疾病。担心猫咪健康请咨询兽医。",

  "band.unknown": "能评估的项太少，无法给出总分，请换一张能看清正脸的照片",
  "band.low": "未见明显疼痛表情",
  "band.mid": "处于边界区间，建议换几张照片再看，并留意食欲、精神和活动",
  "band.high": "超过参考线，建议请兽医评估",

  "activity.yawning": "打哈欠",
  "activity.mouth_open": "张嘴（叫、哈气或喘气）",
  "activity.eating_grooming": "进食或舔毛",
  "activity.sleeping": "睡觉",
  "notice.activity": "猫正在{activity}，{items}会受动作影响，已按放松（0 分）计算，总分可能偏低。想看得更准，请换一张猫表情放松时的照片。",
  "notice.head_resting": "猫的头靠在物体上，头部姿态已按放松（0 分）计算。",
  "notice.poor_quality": "照片不够清晰，结果可能不准。",
  "notice.few_items": "只有 {valid} 项能评估，分数参考性较低。",
  "notice.itemSep": "、",
  "adjusted.activity": "猫正在{activity}，此项受动作影响，按放松计 0 分",
  "adjusted.head_resting": "头靠在物体上，不代表头部下垂，按放松计 0 分",
  "adjusted.shoulders_not_visible": "照片里看不到肩部，无法比较头和肩的高低",
};

const en = {
  "page.title": "Cat Pain Face Check",
  "page.heading": "Cat Pain Face Check",
  "page.intro": "Take a clear photo of your cat's face. AI looks at the ears, eyes, muzzle, whiskers and head position the way vets do, and scores the expression to see whether your cat might be uncomfortable.",
  "lang.switch": "中文",
  "fgs.title": "What is the FGS?",
  "fgs.p1": "The Feline Grimace Scale (FGS) was published in 2019 by a veterinary team at the Université de Montréal in Canada. Cats in pain show typical changes in their faces, and vets use these changes to decide whether a cat needs pain relief.",
  "fgs.p2": "It looks at five areas, each scored 0–2:",
  "fgs.items": [
    "Ears: pulled apart and turned outwards",
    "Eyes: narrowed or squinting",
    "Muzzle: tense and oval-shaped",
    "Whiskers: straight and pointing forward",
    "Head: lower than the shoulders",
  ],
  "fgs.p3": "The five scores are combined into a total out of 10. In the study, a total of about 4 or more suggested that pain relief should be considered.",
  "fgs.p4": "Here, AI applies the same method to a photo. Results are for fun and everyday observation only. Yawning, an open mouth or sleeping distorts the expression, so those items are scored as relaxed automatically.",
  "tips.title": "Photo tips",
  "tips.body": "Face the cat straight on in good light, take the photo while the cat is calm, and include the shoulders if you can.",
  "pick.choose": "Tap to choose a photo",
  "pick.change": "Tap to change the photo",
  "pick.previewAlt": "Selected photo",
  "btn.analyze": "Analyze",
  "btn.save": "Save report",
  "btn.again": "Try another photo",
  "report.alt": "Analysis report",
  "report.hint": "On a phone you can also long-press the report to save it.",
  "report.filename": "cat-pain-face-check.png",
  "footer.source": "Source code on GitHub",
  "footer": "Results are generated by AI from a single photo, and the landmarks are approximate. For fun and everyday observation only. This is not a diagnosis and cannot rule out pain or illness. If you are worried about your cat, please see a vet. Your photo is used only for this analysis and is not stored on the server.",

  "status.verifying": "Running a security check",
  "status.analyzing": "Analyzing",
  "status.elapsed": "{phase}… {s}s so far (usually 15–40 seconds, please stay on this page)",
  "status.readFail": "This photo can't be read. Please try a JPEG or PNG photo.",
  "status.network": "Network error. Please check your connection and try again.",
  "status.httpError": "Server error ({status})",

  "err.method_not_allowed": "Only POST requests are supported",
  "err.server_error": "Something went wrong on the server. Please try again later.",
  "err.config": "The server is misconfigured. Please try again later.",
  "err.too_large": "The photo is too large. Please try another one.",
  "err.bad_request": "Invalid request",
  "err.bad_image": "Please upload a JPEG, PNG or WebP photo",
  "err.pow_invalid": "Security check failed. Please reload the page and try again.",
  "err.pow_expired": "The security check expired. Please tap Analyze again.",
  "err.pow_reused": "The security check is no longer valid. Please tap Analyze again.",
  "err.busy": "The service is busy. Please try again later.",
  "err.daily_full": "Today's free analyses have all been used. Please come back tomorrow.",
  "err.ip_day": "You've reached today's limit. Please come back tomorrow.",
  "err.ip_burst": "Too many requests. Please try again in {minutes} min.",
  "err.upstream_unreachable": "Couldn't reach the AI service, or it timed out. Please try again later.",
  "err.upstream_error": "The AI service returned an error ({status}). Please try again later.",
  "err.truncated": "The AI's answer was cut off. Please try again, or use a clearer front-facing photo.",
  "err.bad_output": "The AI's answer couldn't be read. Please try again.",
  "err.not_cat": "No cat was found in this photo. Please try a photo of a cat.",
  "err.no_face": "The cat's face isn't clear enough. Please try a photo that shows its face.",

  "report.title": "Cat Pain Face Check",
  "report.tag": "FGS · 48 landmarks",
  "group.ears": "Ears", "group.eyes": "Eyes", "group.nose": "Nose", "group.mouth": "Mouth", "group.cheeks": "Cheeks",
  "item.ear_position": "Ear position",
  "item.orbital_tightening": "Orbital tightening",
  "item.muzzle_tension": "Muzzle tension",
  "item.whiskers_change": "Whiskers change",
  "item.head_position": "Head position",
  "report.validLine": "{valid} items scored, raw total {raw}",
  "report.na": "Can't tell",
  "report.adjusted": " (adjusted)",
  "report.notices": "Notes",
  "report.observations": "Observations",
  "report.suggestions": "Suggestions",
  "report.caveats": "Photo limitations",
  "report.listSep": "; ",
  "report.disclaimer": "For fun and everyday observation only. AI observation of a single photo with approximate landmarks; results may be wrong. Not a diagnosis, and it cannot rule out pain or illness. If you are worried about your cat, please see a vet.",

  "band.unknown": "Too few items could be scored to give a total. Please try a photo that clearly shows the face.",
  "band.low": "No clear signs of pain in the expression",
  "band.mid": "Borderline. Try a few more photos, and keep an eye on appetite, energy and activity.",
  "band.high": "Above the reference line. Consider having a vet check your cat.",

  "activity.yawning": "yawning",
  "activity.mouth_open": "open-mouthed (meowing, hissing or panting)",
  "activity.eating_grooming": "eating or grooming",
  "activity.sleeping": "sleeping",
  "notice.activity": "The cat is {activity}, which affects {items}. These were scored as relaxed (0), so the total may be on the low side. For a more accurate result, use a photo where the cat looks relaxed.",
  "notice.head_resting": "The cat's head is resting on something, so head position was scored as relaxed (0).",
  "notice.poor_quality": "The photo isn't very clear, so the result may be inaccurate.",
  "notice.few_items": "Only {valid} items could be scored, so the total is less reliable.",
  "notice.itemSep": ", ",
  "adjusted.activity": "The cat is {activity}; this item is affected, so it is scored as relaxed (0)",
  "adjusted.head_resting": "The head is resting on something, which doesn't mean it is drooping; scored as relaxed (0)",
  "adjusted.shoulders_not_visible": "The shoulders aren't visible, so head height can't be compared",
};

const DICTS = { zh, en };

/** 取文字并替换 {参数}。缺失时退回中文，再退回 key 本身。 */
export function t(lang, key, params = {}) {
  const value = DICTS[lang]?.[key] ?? zh[key] ?? key;
  return typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : value;
}

/** 首次访问按浏览器首选语言选：中文环境用中文，其他用英文。 */
export function detectLang(languages = []) {
  return String(languages[0] ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export const bandText = (lang, level) => t(lang, `band.${level}`);

/** summarize() 返回的提示代码 → 文字 */
export function noticeText(lang, notice) {
  if (notice.code === "activity") {
    let items = notice.items.map((k) => t(lang, `item.${k}`)).join(t(lang, "notice.itemSep"));
    if (lang === "en") items = items.toLowerCase();
    return t(lang, "notice.activity", { activity: t(lang, `activity.${notice.activity}`), items });
  }
  return t(lang, `notice.${notice.code}`, notice);
}

/** 被规则改过的项的说明文字 */
export function adjustedText(lang, item) {
  if (item.reason === "head_resting" || item.reason === "shoulders_not_visible") return t(lang, `adjusted.${item.reason}`);
  return t(lang, "adjusted.activity", { activity: t(lang, `activity.${item.reason}`) });
}

/** 测试用：两种语言的 key 必须一致 */
export const _dicts = DICTS;

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, sanitizeResult, summarize, ITEMS, colorOf } from "../public/fgs.js";

const fgsWith = (...scores) =>
  Object.fromEntries(ITEMS.map((key, i) => [key, { score: scores[i], evidence: "x" }]));
const scoresOf = (r) => ITEMS.map((k) => r.fgs[k].score);

test("总分按有效项折算，NA 不计入", () => {
  const s = (...v) => summarize(sanitizeResult({ fgs: fgsWith(...v) }));
  assert.equal(s(0, 0, 0, 0, 0).scaled, 0);
  assert.equal(s(2, 2, 2, 2, 2).scaled, 10);
  assert.equal(s(1, 1, 0, 0, 0).scaled, 2);
  assert.equal(s(0, 1, 0, 2, "NA").scaled, 3.8);
  assert.equal(s(2, "NA", "NA", "NA", 0).scaled, 5); // 2 项即可给分
  assert.equal(s(2, "NA", "NA", "NA", "NA").scaled, null);
});

test("三档结论：3 以下、3 到 5、5 及以上", () => {
  const lv = (...v) => summarize(sanitizeResult({ fgs: fgsWith(...v) })).level;
  assert.equal(lv(1, 0, 0, 0, 0), "low"); // 1.0
  assert.equal(lv(1, 1, 1, 0, 0), "mid"); // 3.0
  assert.equal(lv(1, 1, 1, 1, 0), "mid"); // 4.0
  assert.equal(lv(1, 1, 1, 1, 1), "high"); // 5.0
  assert.equal(lv(2, 2, "NA", "NA", "NA"), "high");
});

test("打哈欠：眼眶、口鼻、胡须按 0 分计，并给出提示", () => {
  const r = sanitizeResult({ facial_activity: "yawning", fgs: fgsWith(1, 2, 2, "NA", 0) });
  assert.deepEqual(scoresOf(r), [1, 0, 0, 0, 0]);
  assert.deepEqual([r.fgs.orbital_tightening.adjusted, r.fgs.orbital_tightening.model_score, r.fgs.orbital_tightening.reason], [true, 2, "yawning"]);
  assert.equal(r.fgs.whiskers_change.model_score, "NA");
  assert.equal(r.fgs.ear_position.adjusted, undefined);
  const sum = summarize(r);
  assert.equal(sum.scaled, 1);
  assert.deepEqual(sum.notices[0], { code: "activity", activity: "yawning", items: ["orbital_tightening", "muzzle_tension", "whiskers_change"] });
});

test("张嘴只影响口鼻和胡须；睡觉只影响眼眶；原本 0 分的不标记校正", () => {
  const m = sanitizeResult({ facial_activity: "mouth_open", fgs: fgsWith(0, 1, 2, 0, 0) });
  assert.deepEqual(scoresOf(m), [0, 1, 0, 0, 0]);
  assert.equal(m.fgs.whiskers_change.adjusted, undefined);
  const z = sanitizeResult({ facial_activity: "sleeping", fgs: fgsWith(0, 2, 1, 0, 0) });
  assert.deepEqual(scoresOf(z), [0, 0, 1, 0, 0]);
});

test("头部支撑：靠着按 0 分，看不到肩记 NA，未知值按 free 处理", () => {
  const rest = sanitizeResult({ head_support: "resting", fgs: fgsWith(0, 0, 0, 0, 2) });
  assert.equal(rest.fgs.head_position.score, 0);
  assert.equal(rest.fgs.head_position.reason, "head_resting");
  assert.ok(summarize(rest).notices.some((n) => n.code === "head_resting"));
  const hidden = sanitizeResult({ head_support: "shoulders_not_visible", fgs: fgsWith(0, 0, 0, 0, 1) });
  assert.equal(hidden.fgs.head_position.score, "NA");
  const odd = sanitizeResult({ facial_activity: "dancing", head_support: "x", fgs: fgsWith(0, 0, 0, 0, 2) });
  assert.deepEqual([odd.facial_activity, odd.head_support, odd.fgs.head_position.score], ["none", "free", 2]);
});

test("可评估项少于 4 项时提示参考性低", () => {
  const sum = summarize(sanitizeResult({ fgs: fgsWith(0, 1, "NA", "NA", 0) }));
  assert.ok(sum.notices.some((n) => n.code === "few_items" && n.valid === 3));
  assert.deepEqual(summarize(sanitizeResult({ fgs: fgsWith(0, 0, 0, 0, 0) })).notices, []);
});

test("非法分数视为 NA", () => {
  const r = sanitizeResult({ fgs: fgsWith("1", 3, -1, null, 1.5) });
  assert.deepEqual(scoresOf(r), ["NA", "NA", "NA", "NA", "NA"]);
});

test("关键点：去重、越界和缺失坐标视为不可见、按编号排序", () => {
  const r = sanitizeResult({
    landmarks: [
      { id: 3, x: 10, y: 20, visible: true },
      { id: 1, x: 1005, y: 20, visible: true },
      { id: 2, x: null, y: null, visible: true },
      { id: 3, x: 99, y: 99, visible: true },
      { id: 49, x: 1, y: 1 },
      { id: 4, x: 5, y: 6, visible: true, uncertain: true },
      { id: 5, x: 5, y: 6, visible: false },
    ],
  });
  assert.deepEqual(r.landmarks.map((p) => [p.id, p.visible, p.x]), [
    [1, false, null], [2, false, null], [3, true, 10], [4, true, 5], [5, false, null],
  ]);
  assert.equal(r.landmarks[3].uncertain, true);
});

test("is_cat / face_visible 必须明确为 true", () => {
  assert.equal(sanitizeResult({ is_cat: "true" }).is_cat, false);
  assert.equal(sanitizeResult({ is_cat: true, face_visible: true }).face_visible, true);
});

test("解析带代码块的 JSON，拒绝非对象", () => {
  assert.deepEqual(parseModelJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => sanitizeResult(parseModelJson("[1,2]")));
  assert.throws(() => parseModelJson(""));
});

test("文字截断，建议最多 3 条", () => {
  const r = sanitizeResult({ observations: "长".repeat(900), suggestions: ["a", "", "b", "c", "d", 5] });
  assert.equal(r.observations.length, 400);
  assert.deepEqual(r.suggestions, ["a", "b", "c"]);
});

test("关键点分组颜色", () => {
  assert.equal(colorOf(1), "#8B5CF6");
  assert.equal(colorOf(26), "#22A7E0");
  assert.equal(colorOf(48), "#34C38F");
});

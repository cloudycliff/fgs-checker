import { test } from "node:test";
import assert from "node:assert/strict";
import { _dicts, t, detectLang, noticeText, adjustedText, bandText } from "../public/i18n.js";
import { ITEMS, GROUPS, ACTIVITIES } from "../public/fgs.js";

test("中英文的 key 完全一致，参数占位符一致", () => {
  const { zh, en } = _dicts;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  const params = (v) => (typeof v === "string" ? (v.match(/\{\w+\}/g) ?? []).sort() : v.length);
  for (const key of Object.keys(zh)) assert.deepEqual(params(en[key]), params(zh[key]), key);
});

test("规则里用到的代码都有翻译", () => {
  for (const lang of ["zh", "en"]) {
    for (const k of ITEMS) assert.notEqual(t(lang, `item.${k}`), `item.${k}`);
    for (const g of GROUPS) assert.notEqual(t(lang, `group.${g.key}`), `group.${g.key}`);
    for (const a of Object.keys(ACTIVITIES).filter((a) => a !== "none")) assert.notEqual(t(lang, `activity.${a}`), `activity.${a}`);
    for (const level of ["unknown", "low", "mid", "high"]) assert.notEqual(bandText(lang, level), `band.${level}`);
  }
});

test("首次访问按浏览器首选语言", () => {
  assert.equal(detectLang(["zh-CN", "en"]), "zh");
  assert.equal(detectLang(["zh-TW"]), "zh");
  assert.equal(detectLang(["en-US", "zh-CN"]), "en");
  assert.equal(detectLang(["ja"]), "en");
  assert.equal(detectLang([]), "en");
});

test("提示和改分说明的翻译", () => {
  const n = { code: "activity", activity: "yawning", items: ["orbital_tightening", "muzzle_tension"] };
  assert.equal(noticeText("zh", n).startsWith("猫正在打哈欠，眼眶收紧、口鼻紧张会受动作影响"), true);
  assert.match(noticeText("en", n), /^The cat is yawning, which affects orbital tightening, muzzle tension\./);
  assert.equal(noticeText("en", { code: "few_items", valid: 3 }), "Only 3 items could be scored, so the total is less reliable.");
  assert.match(adjustedText("en", { reason: "mouth_open" }), /open-mouthed/);
  assert.match(adjustedText("zh", { reason: "head_resting" }), /头靠在物体上/);
  assert.equal(t("en", "err.ip_burst", { minutes: 7 }), "Too many requests. Please try again in 7 min.");
});

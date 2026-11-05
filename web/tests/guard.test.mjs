import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { leadingZeroBits, solvePow, checkPow } from "../public/pow.js";
import { admit, beijingDayStart, ensureSchema, ipKey, issueChallenge, verifyChallenge, CHALLENGE_TTL_MS } from "../src/limits.js";

const SECRET = "test-secret";
const LIMITS = { daily: 5, ipDay: 3, ip10min: 2 };

/** 用 Node 自带的 SQLite 模拟 Durable Object 的 sql.exec */
function memorySql() {
  const db = new DatabaseSync(":memory:");
  const sql = (query, ...bindings) => {
    const st = db.prepare(query);
    return st.columns().length ? st.all(...bindings) : (st.run(...bindings), []);
  };
  ensureSchema(sql);
  return sql;
}

let saltSeq = 0;
const call = (sql, ip, now) => admit(sql, { ip, salt: `s${saltSeq++}`, saltExpires: now + CHALLENGE_TTL_MS, now, limits: LIMITS });

test("前导零位数", () => {
  assert.equal(leadingZeroBits(new Uint8Array([0, 0, 0x0f, 0xff])), 20);
  assert.equal(leadingZeroBits(new Uint8Array([0x80])), 0);
  assert.equal(leadingZeroBits(new Uint8Array([0, 1])), 15);
});

test("算力题：求解后能通过校验，篡改、过期、难度不足都不通过", async () => {
  const now = Date.now();
  const c = await issueChallenge(SECRET, 8, now);
  const nonce = await solvePow(c.salt, c.difficulty);
  assert.ok(await checkPow(c.salt, nonce, 8));
  assert.equal(await verifyChallenge(SECRET, { ...c, nonce }, 8, now), null);
  assert.equal(await verifyChallenge("other-secret", { ...c, nonce }, 8, now), "invalid");
  assert.equal(await verifyChallenge(SECRET, { ...c, nonce, difficulty: 9 }, 8, now), "invalid"); // 改难度导致签名不符
  assert.equal(await verifyChallenge(SECRET, { ...c, nonce }, 10, now), "invalid"); // 低于要求的难度
  assert.equal(await verifyChallenge(SECRET, { ...c, nonce }, 8, now + CHALLENGE_TTL_MS + 1), "expired");
  let wrong = nonce + 1;
  while (await checkPow(c.salt, wrong, 8)) wrong++;
  assert.equal(await verifyChallenge(SECRET, { ...c, nonce: wrong }, 8, now), "invalid");
  for (const bad of [null, {}, { ...c, nonce: -1 }, { ...c, nonce: "1" }, { ...c, salt: "x", nonce }]) {
    assert.equal(await verifyChallenge(SECRET, bad, 8, now), "invalid");
  }
});

test("同一道题只能用一次", () => {
  const sql = memorySql();
  const now = Date.now();
  const args = { ip: "1.1.1.1", salt: "abc", saltExpires: now + CHALLENGE_TTL_MS, limits: LIMITS };
  assert.equal(admit(sql, { ...args, now }).ok, true);
  assert.equal(admit(sql, { ...args, now: now + 1 }).code, "pow_reused");
});

test("每个 IP 10 分钟内限次，过了窗口恢复", () => {
  const sql = memorySql();
  const t0 = beijingDayStart(Date.now()) + 3_600_000;
  assert.equal(call(sql, "1.1.1.1", t0).ok, true);
  assert.equal(call(sql, "1.1.1.1", t0 + 60_000).ok, true);
  const r = call(sql, "1.1.1.1", t0 + 120_000);
  assert.equal(r.code, "ip_burst");
  assert.equal(r.retryAfterSec, 480);
  assert.equal(call(sql, "2.2.2.2", t0 + 120_000).ok, true); // 其他 IP 不受影响
  assert.equal(call(sql, "1.1.1.1", t0 + 600_001).ok, true);
});

test("每个 IP 每天限次", () => {
  const sql = memorySql();
  const t0 = beijingDayStart(Date.now()) + 3_600_000;
  for (let i = 0; i < 3; i++) assert.equal(call(sql, "1.1.1.1", t0 + i * 700_000).ok, true);
  assert.equal(call(sql, "1.1.1.1", t0 + 3 * 700_000).code, "ip_day");
});

test("全站每天上限，北京时间 0 点重置", () => {
  const sql = memorySql();
  const day = beijingDayStart(Date.now());
  for (let i = 0; i < 5; i++) assert.equal(call(sql, `10.0.0.${i}`, day + 3_600_000 + i).ok, true);
  assert.equal(call(sql, "10.0.0.99", day + 3_600_000 + 10).code, "daily_full");
  assert.equal(call(sql, "10.0.0.99", day + 86_400_000).ok, true); // 第二天
});

test("北京时间的“当天”起点", () => {
  // 2026-11-05 15:59:59 UTC = 北京时间 23:59:59，仍属 11-05；16:00 UTC 是 11-06 0 点
  assert.equal(beijingDayStart(Date.UTC(2026, 10, 5, 15, 59, 59)), Date.UTC(2026, 10, 4, 16));
  assert.equal(beijingDayStart(Date.UTC(2026, 10, 5, 16)), Date.UTC(2026, 10, 5, 16));
});

test("IP 计数键：IPv4 原样，IPv6 取 /64", () => {
  assert.equal(ipKey("1.2.3.4"), "1.2.3.4");
  assert.equal(ipKey("2408:8207:1234:5678:aaaa:bbbb:cccc:dddd"), "2408:8207:1234:5678::/64");
  assert.equal(ipKey("2408:8207:1234:5678::1"), "2408:8207:1234:5678::/64");
  assert.equal(ipKey("2408:8207::1"), "2408:8207:0:0::/64");
  assert.equal(ipKey("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(ipKey(null), "unknown");
});

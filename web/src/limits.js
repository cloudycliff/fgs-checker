// 防滥用：算力验证题目的签发和校验、按 IP 与全站的调用次数限制。
// 计数逻辑写成纯函数，传入 sql(query, ...bindings) => rows，Durable Object 和单元测试都能用。
import { checkPow } from "../public/pow.js";

const enc = new TextEncoder();
const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 3_600_000;
const WINDOW_MS = 10 * 60_000; // 按 IP 的短时间窗口：10 分钟
export const CHALLENGE_TTL_MS = 5 * 60_000;

/** 北京时间当天 0 点对应的时间戳。“每天”的额度按北京时间重置。 */
export function beijingDayStart(now) {
  return Math.floor((now + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
}

/** 计数用的 IP 键。IPv6 用户通常拥有整个 /64 网段，按前 64 位计数，防止换地址绕过。 */
export function ipKey(ip) {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // ::ffff:1.2.3.4 这类 IPv4 映射地址
  const [head, tail] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return `${full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// ---------- 算力验证题目 ----------

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const signed = (c) => enc.encode(`${c.salt}.${c.difficulty}.${c.expires}`);

/** 签发题目。签名防篡改，服务器不用保存未使用的题目。 */
export async function issueChallenge(secret, difficulty, now) {
  const challenge = { salt: toHex(crypto.getRandomValues(new Uint8Array(16))), difficulty, expires: now + CHALLENGE_TTL_MS };
  challenge.sig = toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), signed(challenge)));
  return challenge;
}

/** 校验提交的答案。通过返回 null，否则返回 "invalid" 或 "expired"。是否重复使用由 admit 检查。 */
export async function verifyChallenge(secret, pow, minDifficulty, now) {
  if (!pow || typeof pow !== "object") return "invalid";
  const { salt, difficulty, expires, sig, nonce } = pow;
  if (typeof salt !== "string" || !/^[0-9a-f]{32}$/.test(salt)) return "invalid";
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return "invalid";
  if (!Number.isInteger(difficulty) || difficulty < minDifficulty || difficulty > 32) return "invalid";
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(nonce) || nonce < 0) return "invalid";
  if (expires < now) return "expired";
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), fromHex(sig), signed(pow)))) return "invalid";
  return (await checkPow(salt, nonce, difficulty)) ? null : "invalid";
}

// ---------- 次数限制 ----------

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS hits (ip TEXT NOT NULL, ts INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS hits_ip_ts ON hits (ip, ts)",
  "CREATE INDEX IF NOT EXISTS hits_ts ON hits (ts)",
  "CREATE TABLE IF NOT EXISTS used_salts (salt TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
];

export function ensureSchema(sql) {
  for (const statement of SCHEMA) sql(statement);
}

/**
 * 判断这次调用能否放行；放行时记一次数并把题目标记为已用。
 * 中间没有 await，在 Durable Object 里整个过程是原子的。
 * limits = { daily, ipDay, ip10min }
 */
export function admit(sql, { ip, salt, saltExpires, now, limits }) {
  sql("DELETE FROM hits WHERE ts < ?", now - 2 * DAY_MS);
  sql("DELETE FROM used_salts WHERE expires < ?", now);
  if (sql("SELECT 1 FROM used_salts WHERE salt = ?", salt).length) return { ok: false, code: "pow_reused" };

  const dayStart = beijingDayStart(now);
  const count = (where, ...args) => sql(`SELECT COUNT(*) AS n FROM hits WHERE ${where}`, ...args)[0].n;
  if (count("ts >= ?", dayStart) >= limits.daily) return { ok: false, code: "daily_full" };
  if (count("ip = ? AND ts >= ?", ip, dayStart) >= limits.ipDay) return { ok: false, code: "ip_day" };
  if (count("ip = ? AND ts > ?", ip, now - WINDOW_MS) >= limits.ip10min) {
    const oldest = sql("SELECT MIN(ts) AS t FROM hits WHERE ip = ? AND ts > ?", ip, now - WINDOW_MS)[0].t;
    return { ok: false, code: "ip_burst", retryAfterSec: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)) };
  }

  sql("INSERT INTO used_salts (salt, expires) VALUES (?, ?)", salt, saltExpires);
  sql("INSERT INTO hits (ip, ts) VALUES (?, ?)", ip, now);
  return { ok: true };
}

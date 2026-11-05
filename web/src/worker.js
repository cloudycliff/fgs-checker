// Cloudflare Worker：托管静态网页，提供 /api/challenge（算力验证题目）和 /api/analyze（转发到大模型）。
import { DurableObject } from "cloudflare:workers";
import SYSTEM_PROMPT from "../../prompts/fgs_system.md";
import PROVIDERS from "../../config/providers.json";
import { parseModelJson, sanitizeResult, summarize } from "../public/fgs.js";
import { LANGS, t } from "../public/i18n.js";
import { admit, ensureSchema, ipKey, issueChallenge, verifyChallenge } from "./limits.js";

/** 全站唯一的计数器（SQLite 版 Durable Object）。所有调用次数都记在这里。 */
export class Guard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = (query, ...bindings) => ctx.storage.sql.exec(query, ...bindings).toArray();
    ensureSchema(this.sql);
  }

  admit(args) {
    return admit(this.sql, { ...args, now: Date.now() });
  }
}

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 前端已缩放到长边 1280，正常不到 1 MB
const IMAGE_PREFIX = /^data:image\/(jpeg|png|webp);base64,/;
const UPSTREAM_TIMEOUT_MS = 180_000;

// 模型写观察文字所用的语言（前端通过 ?lang= 传入）
const USER_PROMPTS = {
  zh: "请分析这张照片，按要求输出 JSON。",
  en: "Analyze this photo and output the JSON as specified. Write every text field (evidence, observations, suggestions, caveats) in English: evidence under 20 words, observations under 40 words, each suggestion under 20 words, caveats under 25 words. Keep all enum values and JSON keys exactly as specified.",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const lang = LANGS.includes(url.searchParams.get("lang")) ? url.searchParams.get("lang") : "zh";
    const fail = failer(lang);
    if (url.pathname === "/api/challenge") {
      if (!env.CHALLENGE_SECRET) {
        console.error("CHALLENGE_SECRET is not set");
        return fail("config", 500);
      }
      return json(await issueChallenge(env.CHALLENGE_SECRET, powDifficulty(env), Date.now()));
    }
    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") return fail("method_not_allowed", 405);
      try {
        return await analyze(request, env, lang, fail);
      } catch (err) {
        console.error("analyze failed", err);
        return fail("server_error", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

/** 按 LLM_MODEL 在 config/providers.json 里找到提供方。 */
function findProvider(model) {
  for (const [name, cfg] of Object.entries(PROVIDERS)) {
    if (!name.startsWith("_") && cfg.models?.[model]) return cfg;
  }
  return null;
}

async function analyze(request, env, lang, fail) {
  const provider = findProvider(env.LLM_MODEL);
  const apiKey = provider && env[provider.key_env];
  if (!provider || !apiKey || !env.CHALLENGE_SECRET) {
    console.error("config error", { model: env.LLM_MODEL, provider: !!provider, apiKey: !!apiKey, secret: !!env.CHALLENGE_SECRET });
    return fail("config", 500);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return fail("too_large", 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request", 400);
  }
  const image = body?.image;
  if (typeof image !== "string" || !IMAGE_PREFIX.test(image.slice(0, 40))) return fail("bad_image", 400);
  if (image.length > MAX_BODY_BYTES) return fail("too_large", 413);

  // 防滥用：先验算力答案，再按 IP 和全站计数。计数服务出错时拒绝调用，宁可暂停也不多花钱。
  const powError = await verifyChallenge(env.CHALLENGE_SECRET, body.pow, powDifficulty(env), Date.now());
  if (powError) return fail(powError === "expired" ? "pow_expired" : "pow_invalid", 403);
  let gate;
  try {
    gate = await env.GUARD.get(env.GUARD.idFromName("global")).admit({
      ip: ipKey(request.headers.get("CF-Connecting-IP")),
      salt: body.pow.salt,
      saltExpires: body.pow.expires,
      limits: {
        daily: intVar(env.DAILY_LIMIT, 300),
        ipDay: intVar(env.IP_LIMIT_DAY, 20),
        ip10min: intVar(env.IP_LIMIT_10MIN, 5),
      },
    });
  } catch (err) {
    console.error("guard failed", err);
    return fail("busy", 503);
  }
  if (!gate.ok) {
    console.warn("rate limited", gate.code);
    const params = gate.code === "ip_burst" ? { minutes: Math.ceil(gate.retryAfterSec / 60) } : {};
    return fail(gate.code, gate.code === "pow_reused" ? 403 : 429, params);
  }

  const payload = {
    model: env.LLM_MODEL,
    temperature: 0.1,
    max_tokens: 8000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          // 有的提供方（如智谱）要求不带 data: 前缀的纯 base64
          { type: "image_url", image_url: { url: provider.image_format === "raw_base64" ? image.split(",", 2)[1] : image } },
          { type: "text", text: USER_PROMPTS[lang] },
        ],
      },
    ],
  };
  if (provider.json_mode) payload.response_format = { type: "json_object" };
  if (env.LLM_THINKING === "on" || env.LLM_THINKING === "off") {
    const on = env.LLM_THINKING === "on";
    if (provider.thinking_style === "enable_thinking") payload.enable_thinking = on; // 千问
    else payload.thinking = { type: on ? "enabled" : "disabled" }; // 智谱、DeepSeek
  }

  const started = Date.now();
  let resp;
  try {
    resp = await fetch(`${provider.base_url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("upstream fetch failed", err);
    return fail("upstream_unreachable", 502);
  }

  if (!resp.ok) {
    console.error("upstream error", resp.status, (await resp.text()).slice(0, 500));
    return fail("upstream_error", 502, { status: resp.status });
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  const meta = { model: data.model, elapsedMs: Date.now() - started, usage: data.usage };
  if (choice?.finish_reason === "length") {
    return fail("truncated", 502, {}, { meta });
  }

  let result;
  try {
    result = sanitizeResult(parseModelJson(choice?.message?.content));
  } catch (err) {
    console.error("bad model output", err, String(choice?.message?.content).slice(0, 300));
    return fail("bad_output", 502, {}, { meta });
  }
  // 不是猫或看不清脸：正常响应，但不出报告
  if (!result.is_cat) return json({ rejected: true, code: "not_cat", reason: t(lang, "err.not_cat"), meta });
  if (!result.face_visible) return json({ rejected: true, code: "no_face", reason: t(lang, "err.no_face"), meta });
  return json({ result, summary: summarize(result), meta });
}

function intVar(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const powDifficulty = (env) => Math.min(24, intVar(env.POW_DIFFICULTY, 17));

/** 错误响应：code 给前端翻译用，error 是对应语言的文字（前端认不出 code 时直接显示）。 */
const failer = (lang) => (code, status, params = {}, extra = {}) =>
  json({ code, params, error: t(lang, `err.${code}`, params), ...extra }, status);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

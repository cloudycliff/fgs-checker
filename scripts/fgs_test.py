#!/usr/bin/env python3
"""批量评测：调用看图大模型，取回 48 点和 FGS 评分，叠加到原图生成竖版报告。

提供方和模型在 config/providers.json 里配置，Key 写在 .env。
结果保存在 outputs/<模型>[_思考开关]/<照片名>/。

用法:
  python scripts/fgs_test.py test_photos/                          # 默认 DeepSeek
  python scripts/fgs_test.py test_photos/ --model glm-4.6v-flash   # 换模型（自动找到提供方）
  python scripts/fgs_test.py a.jpg --runs 3                        # 同图跑 3 次，看稳定性
  python scripts/fgs_test.py a.jpg --thinking off                  # 关闭思考（on/off/default）
  python scripts/fgs_test.py a.jpg --render-only r.json            # 不调 API，只按已有结果出图
"""
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PROVIDERS = {k: v for k, v in json.loads(
    (ROOT / "config" / "providers.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}
LONG_EDGE = 1280
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

GROUPS = [
    ("耳部", range(1, 11), "#8B5CF6"),
    ("眼部", range(11, 27), "#22A7E0"),
    ("鼻部", range(27, 35), "#F59E0B"),
    ("口部", range(35, 39), "#F0567A"),
    ("颊部", range(39, 49), "#34C38F"),
]
ITEMS = [
    ("ear_position", "耳位"),
    ("orbital_tightening", "眼眶收紧"),
    ("muzzle_tension", "口鼻紧张"),
    ("whiskers_change", "胡须状态"),
    ("head_position", "头部姿态"),
]
RULES_SCRIPT = ROOT / "web" / "scripts" / "apply_rules.mjs"  # 评分规则只维护一份，在 web/public/fgs.js


def find_provider(model):
    for name, cfg in PROVIDERS.items():
        if model in cfg["models"]:
            return name, cfg
    sys.exit(f"config/providers.json 里没有模型 {model}")


def load_key(env_name):
    key = os.environ.get(env_name)
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{env_name}="):
                key = line.split("=", 1)[1].strip()
    if not key:
        sys.exit(f"缺少 API Key：请在 .env 里加一行 {env_name}=你的Key")
    return key


def estimate_cost(usage, price):
    """按配置里的单价估算一次调用的费用（元）。"""
    prompt = usage.get("prompt_tokens", 0)
    cached = usage.get("prompt_cache_hit_tokens",
                       (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)) or 0
    out = usage.get("completion_tokens", 0)
    return ((prompt - cached) * price["input"] + cached * price["cached_input"]
            + out * price["output"]) / 1e6


def load_image(path):
    """按 EXIF 摆正并缩放。小程序端也要做同样处理，否则坐标会错位。"""
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((LONG_EDGE, LONG_EDGE))
    return img


def pad_square(img, fill=(128, 128, 128)):
    """补灰边成正方形，返回新图和 (左边距, 上边距, 边长)。"""
    side = max(img.size)
    ox, oy = (side - img.width) // 2, (side - img.height) // 2
    canvas = Image.new("RGB", (side, side), fill)
    canvas.paste(img, (ox, oy))
    return canvas, (ox, oy, side)


def unpad_landmarks(result, img, pad):
    """把正方形图上的 0-1000 坐标换算回原图的 0-1000 坐标。"""
    ox, oy, side = pad
    for p in result.get("landmarks", []):
        if p.get("x") is None or p.get("y") is None:
            continue
        p["x"] = round((p["x"] / 1000 * side - ox) / img.width * 1000, 1)
        p["y"] = round((p["y"] / 1000 * side - oy) / img.height * 1000, 1)
    return result


def call_llm(img, provider, model, key, temperature, thinking):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    b64 = base64.b64encode(buf.getvalue()).decode()
    image = b64 if provider["image_format"] == "raw_base64" else f"data:image/jpeg;base64,{b64}"
    system = (ROOT / "prompts" / "fgs_system.md").read_text(encoding="utf-8")
    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": 8000,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image}},
                {"type": "text", "text": "请分析这张照片，按要求输出 JSON。"},
            ]},
        ],
    }
    if provider["json_mode"]:
        body["response_format"] = {"type": "json_object"}
    if thinking != "default":
        if provider.get("thinking_style") == "enable_thinking":  # 千问
            body["enable_thinking"] = thinking == "on"
        else:  # 智谱、DeepSeek
            body["thinking"] = {"type": "enabled" if thinking == "on" else "disabled"}
    req = urllib.request.Request(f"{provider['base_url']}/chat/completions", json.dumps(body).encode(), {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
    })
    for attempt in range(5):
        start = time.time()
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                return json.load(resp), time.time() - start
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:800]
            if e.code in (429, 500, 502, 503) and attempt < 4:  # 限流或临时故障：等一会儿重试
                wait = 15 * 2 ** attempt
                print(f"  API {e.code}，{wait} 秒后重试：{detail[:120]}")
                time.sleep(wait)
                continue
            raise RuntimeError(f"API 错误 {e.code}: {detail}") from e


def parse_content(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(text)


def apply_rules(results):
    """调用 web/public/fgs.js（经 node）清洗、按状态改分并算总分，返回 [{result, summary}]。"""
    proc = subprocess.run(["node", str(RULES_SCRIPT)], input=json.dumps(results, ensure_ascii=False),
                          capture_output=True, text=True, encoding="utf-8")
    if proc.returncode:
        raise RuntimeError(f"评分规则脚本出错：{proc.stderr[:500]}")
    return json.loads(proc.stdout)


def score_summary(result):
    """总分由 fgs.js 计算，规则和网页完全一致。"""
    return apply_rules([result])[0]["summary"]


def check_landmarks(result):
    """只查结构问题；点位准不准要看图判断。"""
    points = result.get("landmarks", [])
    ids = [p.get("id") for p in points]
    placed = [p for p in points
              if p.get("visible") and p.get("x") is not None and p.get("y") is not None]
    coords = [(p["x"], p["y"]) for p in placed]
    return {
        "missing_ids": sorted(set(range(1, 49)) - set(ids)),
        "repeated_ids": len(ids) - len(set(ids)),
        "out_of_range": sum(not (0 <= x <= 1000 and 0 <= y <= 1000) for x, y in coords),
        "repeated_coords": len(coords) - len(set(coords)),
        "placed": len(placed),
        "uncertain": sum(bool(p.get("uncertain")) for p in placed),
    }


def font(size, bold=False):
    name = "msyhbd.ttc" if bold else "msyh.ttc"
    return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)


NO_LINE_START = "，。、；：！？）》”’,.;:!?)"  # 不放在行首的标点


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for ch in text:
        if line and ch not in NO_LINE_START and draw.textlength(line + ch, font=fnt) > width:
            lines.append(line)
            line = ch
        else:
            line += ch
    return lines + [line] if line else lines


def draw_landmarks(img, landmarks):
    out = img.copy()
    d = ImageDraw.Draw(out)
    r = max(9, round(max(out.size) * 0.0115))
    fnt = font(max(9, round(r * 1.05)), bold=True)
    color_of = {i: c for _, ids, c in GROUPS for i in ids}
    for p in landmarks:
        if not p.get("visible") or p.get("x") is None or p.get("y") is None:
            continue
        x, y = p["x"] / 1000 * out.width, p["y"] / 1000 * out.height
        color = color_of.get(p.get("id"), "#888888")
        box = (x - r, y - r, x + r, y + r)
        if p.get("uncertain"):  # 不确定的点用空心
            d.ellipse(box, fill="white", outline=color, width=max(2, r // 3))
            d.text((x, y), str(p["id"]), font=fnt, fill=color, anchor="mm")
        else:
            d.ellipse(box, fill=color, outline="white", width=max(1, r // 5))
            d.text((x, y), str(p["id"]), font=fnt, fill="white", anchor="mm")
    return out


def render_report(img, result):
    W, M = 1080, 48
    INK, MUTED, LINE, ACCENT = "#1F2A37", "#6B7280", "#E5E7EB", "#1F7A68"
    TONE = {"high": ("#B42318", "#FEE4E2"), "mid": ("#B45309", "#FEF3E2")}
    ruled = apply_rules([result])[0]
    result, summary = ruled["result"], ruled["summary"]
    tone, tone_bg = TONE.get(summary["level"], (ACCENT, "#E8F4F1"))
    photo = draw_landmarks(img, result.get("landmarks", []))
    photo = photo.resize((W, round(photo.height * W / photo.width)), Image.LANCZOS)

    canvas = Image.new("RGB", (W, photo.height + 2400), "white")
    d = ImageDraw.Draw(canvas)
    d.rectangle((0, 0, W, 96), fill=INK)
    d.text((M, 48), "猫疼痛表情观察  FGS · 48 点定位", font=font(36, True), fill="white", anchor="lm")
    canvas.paste(photo, (0, 96))
    y = 96 + photo.height + 28

    x = M
    for name, _, color in GROUPS:
        d.ellipse((x, y + 6, x + 22, y + 28), fill=color)
        d.text((x + 30, y + 17), name, font=font(26), fill=MUTED, anchor="lm")
        x += 196
    y += 64

    d.rounded_rectangle((M, y, W - M, y + 150), 20, fill=tone_bg)
    total = "—" if summary["scaled"] is None else f"{summary['scaled']:g}"
    d.text((M + 32, y + 75), total, font=font(84, True), fill=tone, anchor="lm")
    tx = M + 44 + d.textlength(total, font=font(84, True))
    d.text((tx, y + 92), "/ 10", font=font(34), fill=tone, anchor="lm")
    d.text((tx + 90, y + 46), f"{summary['valid']} 项有效，原始 {summary['raw']} 分",
           font=font(26), fill=MUTED, anchor="lm")
    band_lines = wrap(d, summary["band"], font(28, True), W - M - 24 - (tx + 90))
    for i, line in enumerate(band_lines[:2]):
        d.text((tx + 90, y + 84 + i * 36), line, font=font(28, True), fill=tone, anchor="lm")
    y += 178

    if summary["notices"]:
        lines = [ln for n in summary["notices"] for ln in wrap(d, "· " + n, font(26), W - M * 2 - 48)]
        h = 70 + len(lines) * 38
        d.rounded_rectangle((M, y, W - M, y + h), 16, fill="#FEF3E2")
        d.text((M + 24, y + 20), "提示", font=font(28, True), fill="#B45309")
        for i, line in enumerate(lines):
            d.text((M + 24, y + 62 + i * 38), line, font=font(26), fill="#7C2D12")
        y += h + 28

    for key, label in ITEMS:
        item = result["fgs"].get(key, {})
        score = item.get("score", "NA")
        valid = score in (0, 1, 2)
        d.text((M, y), label, font=font(32, True), fill=INK)
        mark = "（已校正）" if item.get("adjusted") else ""
        d.text((W - M, y), (f"{score} / 2" if valid else "无法判断") + mark, font=font(32, True),
               fill=ACCENT if valid else MUTED, anchor="ra")
        y += 48
        for line in wrap(d, item.get("evidence", ""), font(26), W - M * 2):
            d.text((M, y), line, font=font(26), fill=MUTED)
            y += 36
        y += 12
        d.line((M, y, W - M, y), fill=LINE, width=2)
        y += 20

    sections = [
        ("观察", result.get("observations", "")),
        ("建议", "；".join(x.rstrip("。；;. ") for x in result.get("suggestions", []))),
        ("照片局限", result.get("caveats", "")),
    ]
    for title, body in sections:
        if not body:
            continue
        d.text((M, y), title, font=font(30, True), fill=INK)
        y += 46
        for line in wrap(d, body, font(26), W - M * 2):
            d.text((M, y), line, font=font(26), fill="#374151")
            y += 36
        y += 18

    y += 8
    notice = "仅供娱乐和日常观察参考。基于单张照片的 AI 观察，点位为近似定位，结果可能有误，不构成诊断，也不能排除疼痛或疾病。担心猫咪健康请咨询兽医。"
    for line in wrap(d, notice, font(22), W - M * 2):
        d.text((M, y), line, font=font(22), fill=MUTED)
        y += 30
    return canvas.crop((0, 0, W, y + 32))


def collect_images(paths):
    files = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXTS)
        else:
            files.append(p)
    return files


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--temperature", type=float, default=0.1)
    ap.add_argument("--model", default="deepseek-flash", help="config/providers.json 里的模型名")
    ap.add_argument("--thinking", choices=["default", "on", "off"], default="default")
    ap.add_argument("--pad-square", action="store_true", help="补灰边成正方形后再发给模型")
    ap.add_argument("--render-only", help="已有的结果 JSON，不调用 API")
    ap.add_argument("--out", default=str(ROOT / "outputs"))
    args = ap.parse_args()

    files = collect_images(args.images)
    if not files:
        sys.exit("没有找到照片")
    provider_name, provider = find_provider(args.model)
    price = provider["models"][args.model]
    key = None if args.render_only else load_key(provider["key_env"])
    variant = args.model + ("" if args.thinking == "default" else f"_thinking-{args.thinking}")
    print(f"提供方 {provider_name}，模型 {args.model}，思考 {args.thinking}，输出 outputs/{variant}/")
    stats = {"calls": 0, "ok": 0, "rejected": 0, "failed": 0, "secs": [], "cost": 0.0, "out_tokens": []}

    for path in files:
        img = load_image(path)
        out_dir = Path(args.out) / variant / path.stem
        out_dir.mkdir(parents=True, exist_ok=True)
        for run in range(1, args.runs + 1):
            tag = f"run{run}"
            if args.render_only:
                result = json.loads(Path(args.render_only).read_text(encoding="utf-8"))
            else:
                sent, pad = pad_square(img) if args.pad_square else (img, None)
                try:
                    stats["calls"] += 1
                    data, secs = call_llm(sent, provider, args.model, key, args.temperature, args.thinking)
                except (RuntimeError, OSError) as e:
                    stats["failed"] += 1
                    print(f"[{path.name} {tag}] 调用失败: {e}")
                    continue
                (out_dir / f"{tag}_response.json").write_text(
                    json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
                choice = data["choices"][0]
                usage = data.get("usage") or {}
                cost = estimate_cost(usage, price)
                stats["secs"].append(secs)
                stats["cost"] += cost
                stats["out_tokens"].append(usage.get("completion_tokens", 0))
                print(f"[{path.name} {tag}] {secs:.1f}s finish={choice.get('finish_reason')} "
                      f"输入 {usage.get('prompt_tokens')} 输出 {usage.get('completion_tokens')} token，"
                      f"约 {cost:.4f} 元")
                try:
                    result = parse_content(choice["message"]["content"])
                    if pad:
                        unpad_landmarks(result, img, pad)
                except (json.JSONDecodeError, TypeError, IndexError, AttributeError) as e:
                    stats["failed"] += 1
                    print(f"  JSON 解析失败: {e}，原始响应见 {tag}_response.json")
                    continue

            if not result.get("is_cat") or not result.get("face_visible"):
                print(f"  模型判定无法分析: is_cat={result.get('is_cat')} "
                      f"face_visible={result.get('face_visible')}")
                (out_dir / f"{tag}_rejected.json").write_text(
                    json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
                stats["rejected"] += 1
                continue
            stats["ok"] += 1
            (out_dir / f"{tag}_result.json").write_text(
                json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
            report = out_dir / f"{tag}_report.png"
            render_report(img, result).save(report)
            ruled = apply_rules([result])[0]
            scores = {k: ruled["result"]["fgs"][k]["score"] for k, _ in ITEMS}
            print(f"  点位 {check_landmarks(result)}")
            print(f"  状态 {ruled['result']['facial_activity']} / {ruled['result']['head_support']}")
            print(f"  评分（已按规则校正）{scores} -> {ruled['summary']['scaled']} {ruled['summary']['band']}")
            print(f"  报告 {report}")

    if stats["calls"]:
        secs = sorted(stats["secs"]) or [0]
        n = len(stats["out_tokens"]) or 1
        print(f"\n汇总：调用 {stats['calls']} 次，出报告 {stats['ok']}，判定不可分析 {stats['rejected']}，"
              f"失败 {stats['failed']}；耗时中位数 {secs[len(secs) // 2]:.1f}s，最长 {secs[-1]:.1f}s；"
              f"平均输出 {sum(stats['out_tokens']) / n:.0f} token；合计约 {stats['cost']:.3f} 元")


if __name__ == "__main__":
    main()

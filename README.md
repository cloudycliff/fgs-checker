# 猫咪疼痛表情小测 · Cat Pain Face Check

上传一张猫咪的正脸照片，AI 按猫疼痛表情量表（[Feline Grimace Scale, FGS](https://www.nature.com/articles/s41598-019-55693-8)）给五项打分，并在原图上标出 48 个面部关键点，生成一张竖版报告图。支持中文和英文。

结果仅供娱乐和日常观察参考，不构成诊断。

## 目录

| 路径 | 内容 |
|---|---|
| `web/` | Cloudflare Worker 项目：网页（`public/`）+ 后端接口（`src/`） |
| `web/public/` | 前端页面；`fgs.js` 评分规则（前后端共用）、`i18n.js` 中英文文字、`pow.js` 算力验证 |
| `web/src/worker.js` | `/api/challenge` 出题、`/api/analyze` 调用大模型；`Guard` 计数器（Durable Object） |
| `web/src/limits.js` | 防滥用：算力验证、按 IP 和全站限次 |
| `prompts/fgs_system.md` | 系统提示词（打包进 Worker，测试脚本也用） |
| `config/providers.json` | 大模型提供方配置（接口地址、Key 变量名、单价） |
| `scripts/fgs_test.py` | 批量评测脚本：直接调用模型 API，对比不同模型的效果和费用 |
| `docs/design.md` | 设计文档、各模型测试结论、待办 |

Worker 会打包上一级的 `prompts/` 和 `config/`，所以部署时需要整个仓库，不能只拿 `web/` 目录。

## 本地运行

需要 Node.js 22 以上。

```bash
cd web
npm install
cp .dev.vars.example .dev.vars   # 填入 QWEN_API_KEY 和 CHALLENGE_SECRET
npm run dev                      # 打开 http://localhost:8787
```

| 命令（在 `web/` 下） | 作用 | 是否调用模型 |
|---|---|---|
| `npm test` | 单元测试 | 否 |
| `npm run e2e:i18n` | 浏览器检查语言自动选择和切换（需先 `npm run dev`，使用本机 Edge） | 否 |
| `npm run e2e -- <照片>...` | 浏览器完整流程，报告保存到 `outputs/e2e/`；`E2E_LOCALE=en-US` 测英文 | 每张 1 次 |

## 部署到 Cloudflare

当前模型是千问 `qwen3.8-flash`（关闭思考），每次约 0.006 元。

### 方式一：命令行

```bash
cd web
npx wrangler login
npx wrangler secret put QWEN_API_KEY
npx wrangler secret put CHALLENGE_SECRET
npx wrangler deploy
```

### 方式二：连接 GitHub 自动部署（Workers Builds）

在 Cloudflare 控制台 Workers & Pages → Create → Import a repository，选择本仓库，然后：

- Root directory：`web`
- Deploy command：`npx wrangler deploy`
- 在 Worker 的 Settings → Variables and Secrets 里添加密钥 `QWEN_API_KEY`、`CHALLENGE_SECRET`

### 可调整的配置（`web/wrangler.jsonc` 的 `vars`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `LLM_MODEL` | `qwen3.8-flash` | 使用的模型，需在 `config/providers.json` 里有配置 |
| `LLM_THINKING` | `off` | 模型思考模式：`default` / `on` / `off` |
| `DAILY_LIMIT` | `300` | 全站每天最多调用次数（北京时间 0 点重置） |
| `IP_LIMIT_DAY` / `IP_LIMIT_10MIN` | `20` / `5` | 每个 IP 每天、每 10 分钟的次数 |
| `POW_DIFFICULTY` | `17` | 算力验证难度（二进制位数，加 1 计算量翻倍） |

### 上线前注意

- 中国大陆访问：`*.workers.dev` 默认域名在国内基本打不开，需要绑定自己的域名，并用三大运营商网络实测。
- 费用兜底：模型账户只放少量余额并开启余额预警；网站单独用一个 API Key，泄露时可以作废重建。

## 测试脚本（可选）

`scripts/fgs_test.py` 需要 Python 3 和 Pillow，Key 写在仓库根目录的 `.env`（参考 `.env.example`）。测试照片放在 `test_photos/`，输出写到 `outputs/`，这两个目录都不提交。

```bash
python scripts/fgs_test.py test_photos/ --model qwen3.8-flash --thinking off
```

## 说明

- 关键点由大模型直接给出，是近似定位。专用的猫脸关键点模型（CatFLW）效果更好，但其权重为 CC BY-NC 4.0（禁止商用），本仓库没有包含。
- 报告图底部的二维码由 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4（MIT，Kazuhiko Arase）生成，文件在 `web/public/vendor/qrcode.mjs`。二维码指向用户当前访问的网址，绑定自定义域名后会自动使用新域名。
- FGS 来源：Evangelista M. C. et al. *Facial expressions of pain in cats: the development and validation of a Feline Grimace Scale.* Scientific Reports 9, 19128 (2019).

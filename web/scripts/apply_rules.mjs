// 给 Python 测试脚本用：从标准输入读一组模型原始输出（JSON 数组），
// 按网页同一套规则清洗、改分、算总分，输出 [{result, summary}]。保证两边规则一致。
// Python 只出中文报告，这里把代码翻译成中文：summary.band、summary.notices 是文字，改过分的项填上说明。
import { sanitizeResult, summarize } from "../public/fgs.js";
import { adjustedText, bandText, noticeText } from "../public/i18n.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const out = JSON.parse(input).map((raw) => {
  const result = sanitizeResult(raw);
  const summary = summarize(result);
  for (const item of Object.values(result.fgs)) {
    if (item.adjusted) item.evidence = adjustedText("zh", item);
  }
  return {
    result,
    summary: { ...summary, band: bandText("zh", summary.level), notices: summary.notices.map((n) => noticeText("zh", n)) },
  };
});
process.stdout.write(JSON.stringify(out));

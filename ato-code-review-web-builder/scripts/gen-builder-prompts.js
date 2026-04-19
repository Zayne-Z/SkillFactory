#!/usr/bin/env node
/**
 * 可选：从 ato-code-review-web/prompts 仅同步「技术栈」子 Builder（01）。
 *
 * 02–08 为 web-builder 手工维护（四位合并专家 + fix + report），运行本脚本不会覆盖它们。
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'ato-code-review-web', 'prompts');
const OUT = path.join(REPO, 'ato-code-review-web-builder', 'builder-prompts', 'subagents');

function headerPhase(phase, id) {
  const outNote =
    phase === 7
      ? '必须将结果写入 `{{REPORT_PATH}}`（最终报告）。'
      : '必须将结果写入 `{{OUTPUT_PATH}}`。';
  return (
    `> **子 Builder**：\`${id}\` | Phase ${phase}  
> 将本文件内容粘贴到 VS Code AI 插件中该 Builder 的系统提示词。  
> **完成约定**：执行完毕后` +
    outNote +
    `主 Builder 通过检查目标文件是否存在且内容完整来判断任务是否完成。若你遇到上下文超长，优先将**已完成的部分结果**写入文件，然后停止。

---

`
  );
}

if (!fs.existsSync(SRC)) {
  console.error('缺少源目录:', SRC);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

{
  let md = fs.readFileSync(path.join(SRC, 'tech-stack-analysis.md'), 'utf8');
  md = md.replace(/\r\n/g, '\n');
  md = headerPhase(3, 'web-codereview-tech-stack') + md;
  fs.writeFileSync(path.join(OUT, '01-tech-stack.md'), md, 'utf8');
}

console.log('已更新:', path.join(OUT, '01-tech-stack.md'));
console.log('未改动: 02-task-plan.md … 08-report-synthesizer.md（合并专家版，请直接编辑 repo 内文件）');

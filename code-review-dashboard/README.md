# AI 代码检视月度看板

该生成器把固定结构的代码检视统计 Markdown 转换为独立、离线可打开的 HTML 看板。

## 每月生成

保持 Markdown 的章节与列名不变，在三张版本表中加入新日期后执行：

```bash
node code-review-dashboard/scripts/render-dashboard.js \
  --md code-review-statistics-restored.md \
  --out code-review-skill-dashboard.html
```

如需使用另一份模板：

```bash
node code-review-dashboard/scripts/render-dashboard.js \
  --md path/to/statistics.md \
  --template code-review-dashboard/templates/dashboard.html \
  --out path/to/dashboard.html
```

## Markdown 要求

生成器读取以下固定章节：

- `## 一、各版本汇总`
- `## 三、前端 vs 后端汇总`
- `### 各版本前后端对比`
- `## 四、趋势分析`

三张包含日期的表必须拥有完全相同、不可重复的 `YYYYMMDD` 日期集合。趋势表的 `检出版本数` 会按原表含义显示为“检视报告数”，也兼容列名 `检视报告数` 和 `报告数`。

生成器会校验严重级别、有效率、平均每报告检出以及前后端数据闭合。校验失败时命令返回非零状态，并保留已有 HTML。

## 展示规则

- 最大日期自动成为最近版本，并与前一个日期比较。
- 趋势图显示最近 8 个版本，横向历史表保留全部版本。
- 柱状检出数与折线有效率使用上下两个独立轨道，避免标签互相覆盖。
- 报告数不超过 1 时显示“小样本”。检出为 0 时有效率显示为 `—`。
- 团队总体覆盖使用“前端 vs 后端汇总”章节；版本历史行使用“各版本前后端对比”。两种口径累计不一致时在页脚披露。
- 原始总计与逐版本合计冲突时，图表使用逐版本可闭合合计，并自动生成说明。
- 历史表每行包含报告数/平均每报告检出、检出、接收、有效率、C/H/M/L 和前后端情况；移动端在表格内部横向滚动。
- 最近版本和团队覆盖通过进度条与颜色编码展示，有效率仍保留文字数值，避免只依赖颜色。

## 验证

```bash
node --test tests/code-review-dashboard.test.js
```

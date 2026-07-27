# Code Review Dashboard 浅色编辑风重设计

## 目标

将看板视觉改为高端简约的浅色编辑风，并去掉标题区与顶栏的重复信息展示。

## 决策

| 项 | 选择 |
| --- | --- |
| 视觉方向 | A · 浅色编辑风 |
| 信息去重 | 顶栏保留品牌 + 统计期间；标题区价值句 +「N 期 · M 份报告」 |
| 实现范围 | 方案 1：模板 CSS 重做 + 渲染文案去重 |

## 视觉 token

- Paper / 页底：`#FAFAF8`；卡片：`#FFFFFF`
- Ink：`#1A1A1A`；Mute：`#6B6B6B`；Rule：`#E6E4DF`
- Accent（唯一强调）：`#1F4B43`
- Severity：Critical `#A33B32` · High `#9A6B1F` · Medium `#3D5A80` · Low `#8A8A8A`
- 顶栏：白底 + 底边细线，去掉深蓝大色块
- 标题用系统衬线克制出现；正文/数字无衬线 + mono
- 圆角 4–6px；弱阴影或无阴影

## 文案

- 顶栏：`代码检视质量看板` + `统计期间 {{PAGE_PERIOD}}`
- h1：`让代码问题更早被看见`
- 副标题：`{N} 期 · {M} 份检视报告`（不再含「统计期间」）
- 趋势 `panel-note` 若与最近一期 insight 字面重复则删短或去掉

## 文件

- `templates/dashboard.html`
- `scripts/render-dashboard.js`
- `tests/code-review-dashboard.test.js`

## 非目标

- 不改 Markdown 契约 / CLI / 区块顺序与口径逻辑

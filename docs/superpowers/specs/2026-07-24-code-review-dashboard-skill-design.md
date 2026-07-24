# Code Review Dashboard Skill 设计

## 目标

把现有 `code-review-dashboard` 生成器改造成可触发的项目 Skill：agent 根据仓库根目录的 `代码检视统计总览.md`，调用既有 Node 脚本生成独立 HTML 看板。不重写解析/校验/渲染逻辑，不引入 package 发布壳。

## 决策摘要

| 项 | 选择 |
| --- | --- |
| 落点 | 就地改造 `code-review-dashboard/`（方案 1：薄 Skill 壳） |
| 默认输入 | 工作区根目录 `代码检视统计总览.md` |
| 默认输出 | `{md 基名}-{最近版本日}.html`，与 md 同目录 |
| 日期来源 | Markdown 数据中的最大版本日（`YYYYMMDD`） |
| 不在范围 | `package.json`、版本检查脚本、纯 agent 手写 HTML |

## 目录与职责

```text
code-review-dashboard/
├── SKILL.md                         # 新增：触发条件 + agent 工作流
├── README.md                        # 更新：默认路径与命名规则
├── templates/
│   └── dashboard.html               # 不变
└── scripts/
    └── render-dashboard.js          # 增强：--out 可选 + 自动命名
```

| 部分 | 职责 |
| --- | --- |
| `SKILL.md` | 何时触发；默认输入；跑脚本；失败只报告，不手写 HTML |
| `render-dashboard.js` | 解析、校验、渲染；无 `--out` 时按最近版本日自动命名 |
| 模板 | 视觉与结构不变 |

## 触发与 Agent 工作流

**触发语境（写入 description）**  
用户提到代码检视看板、统计总览转 HTML、质量观测站、根据「代码检视统计总览」生成看板时使用本 skill。

**固定步骤**

1. 确认输入：默认根目录 `代码检视统计总览.md`；用户给出路径则用用户路径。文件不存在则停止并说明。
2. 从仓库根执行：
   ```bash
   node code-review-dashboard/scripts/render-dashboard.js --md 代码检视统计总览.md
   ```
   不传 `--out` → 脚本写出 `代码检视统计总览-YYYYMMDD.html`（`YYYYMMDD` = `model.latest.date`）。
3. 成功：回报输出路径；用户需要时可打开该 HTML。
4. 失败：原样报告脚本校验错误；不手写/修补 HTML；不覆盖已有输出（沿用现有原子写）。

用户显式指定输出路径或 `--out` 时，尊重覆盖。

## CLI 行为变更

仅改 `parseArgs` / `main` 的参数层：

- `--md`：必填。
- `--out`：可选。省略时解析完成后计算：
  `path.join(path.dirname(mdPath), `${path.basename(mdPath, path.extname(mdPath))}-${model.latest.date}.html`)`。
- `--template`：可选，默认 `templates/dashboard.html`。

解析、校验、渲染、原子写入逻辑不变。成功时 stdout 打印输出路径与摘要（含 `latest=`）。

## 数据契约

沿用既有四章节与闭合校验：

1. `## 一、各版本汇总`
2. `## 三、前端 vs 后端汇总`
3. `### 各版本前后端对比`
4. `## 四、趋势分析`

缺章节、列不齐、严重级别/有效率/前后端不闭合 → 非零退出，不写输出文件。

## 测试

在 `tests/code-review-dashboard.test.js` 增补：

1. 省略 `--out` 时，输出路径为 `{md 基名}-{latest.date}.html`，且位于 md 同目录。
2. 显式传入 `--out` 时仍写入指定路径。

现有解析、校验、渲染用例保持通过。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 输入文件不存在 | 脚本或 skill 报错退出 |
| Markdown 契约失败 | stderr + exit 1，保留已有 HTML |
| 模板占位未替换 | 同现有：抛错，不写成品 |
| Agent 侧 | 只转发错误，禁止自行生成看板 HTML |

## 非目标

- 不对齐 `ato-code-review-*` 的 package / 版本检查发布流程。
- 不改变看板视觉语言或 Markdown 章节结构。
- 不删除既有示例产出 `code-review-skill-dashboard.html`（可保留作参考；新默认命名规则另起文件）。

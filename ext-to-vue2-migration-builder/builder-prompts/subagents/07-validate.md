> **子 Builder**：`ext-vue2-validate` | Phase 6  
> **完成约定**：生成 `{{VALIDATION_REPORT_PATH}}`（Markdown）。主 Builder 以该文件存在为完成条件。

---

# 校验迁移质量

对已迁移文件做检查并输出报告。

## 输入变量

- `{{SKILL_ROOT}}`：可选读 `docs/reference-common-issues.md`
- `{{TARGET_PATH}}`：目标项目根
- `{{MIGRATED_FILES}}`：待校验文件列表（逗号分隔或 JSON）
- `{{ROUTER_PATH}}`：路由文件路径（相对目标项目或绝对）
- `{{SOURCE_PROJECT}}`：用于对照源行为（可选）
- `{{GUIDE_PATH}}`：`.migration/conversion-guide.md`（行为一致性对照，绝对路径或相对 `{PROJECT_ROOT}`）
- `{{VALIDATION_REPORT_PATH}}`：校验报告输出路径（建议 `{PROJECT_ROOT}/.migration/validation-report.md`）

## 执行步骤

1. **Ext 残留**：在已迁移目录对 `.vue`/`.js` 搜索 `Ext.`、`xtype:` 等（Windows：`Select-String`）。
2. **JSP 标签**：搜索 `<%`、`<jsp:`、JSTL 等。
3. **SFC 完整性**：`template` / `script` / `export default` / `data()` 等。
4. **Import**：解析 import 路径，检查目标文件是否存在。
5. **路由**：读 `{{ROUTER_PATH}}`，确认页面已注册且路径合理。
6. **ESLint**（可选）：`npx eslint` 若环境可用。
7. **行为一致性**（若可访问源）：对照 `{{SOURCE_PROJECT}}` 与 `{{GUIDE_PATH}}` 做下拉/表格/日期语义抽查。

## 输出

写入 `{{VALIDATION_REPORT_PATH}}`，使用以下 Markdown 骨架（可增删小节，但建议保留 1–7 与修复建议）：

```markdown
# 校验报告

## 检查时间：YYYY-MM-DD HH:mm
## 检查文件数：N
## 总体结果：✅ 全部通过 / ⚠️ 有警告 / ❌ 有错误

## 1. Ext 代码残留 — ✅/❌
## 2. JSP 标签残留 — ✅/❌
## 3. Vue SFC 完整性 — ✅/❌
## 4. Import 引用 — ✅/❌
## 5. 路由注册 — ✅/❌
## 6. ESLint — ✅/⚠️/❌
## 7. 行为一致性 — ✅/⚠️/❌
（对照 `{{GUIDE_PATH}}` 与源：下拉静态/异步、表格列与字段、日期是否擅自合并等）

## 修复建议
```

## 注意事项

- 区分 **错误**（须修）与 **警告**（建议）
- 校验幂等，可多次运行

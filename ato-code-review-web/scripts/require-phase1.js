/**
 * Phase 2+ 脚本入口门禁：Phase 1 六项须已确认（review_options.user_confirmed === true）
 */
const fs = require('fs');
const path = require('path');

const PHASE1_MESSAGE = `
PHASE1_REQUIRED: 尚未完成 Phase 1 六项确认，禁止执行检视脚本。

主编排器可以分多轮收集 Phase 1 六项，但进入 Phase 2 前必须全部有合法值。
用户跳过任一项时采用默认值：
  1) BRANCH1 / BRANCH2：当前分支 / master
  2) severity_mode：critical_high_only
  3) skip_low_risk_files：true
  4) generate_html_report：true
  5) max_lines_per_batch：1200
  6) deep_doubt_analysis：true

确认后执行：
  node "{SKILL_ROOT}/scripts/update-state.js" --branch1 <b1> --branch2 <b2> \\
    --set review_options.severity_mode=<mode> \\
    --set review_options.skip_low_risk_files=<bool> \\
    --set review_options.generate_html_report=<bool> \\
    --set review_options.max_lines_per_batch=<n> \\
    --set review_options.deep_doubt_analysis=<bool> \\
    --set review_options.user_confirmed=true \\
    --phase diff_analysis --checkpoint phase1_done

若六项未收齐或未应用默认值就开始检视，说明未执行 SKILL.md §0.2；Phase 2 脚本会报 PHASE1_REQUIRED。
`.trim();

function phase1Problems(state) {
  const problems = [];
  const opts = state.review_options || {};
  if (state.review_options?.user_confirmed !== true) {
    problems.push(`review_options.user_confirmed=${JSON.stringify(state.review_options?.user_confirmed)}`);
  }
  if (!state.branches?.branch1) problems.push('branches.branch1 is empty');
  if (!state.branches?.branch2) problems.push('branches.branch2 is empty');
  if (!['all', 'critical_high_only'].includes(opts.severity_mode)) {
    problems.push(`review_options.severity_mode=${JSON.stringify(opts.severity_mode)}`);
  }
  if (typeof opts.skip_low_risk_files !== 'boolean') {
    problems.push(`review_options.skip_low_risk_files=${JSON.stringify(opts.skip_low_risk_files)}`);
  }
  if (typeof opts.generate_html_report !== 'boolean') {
    problems.push(`review_options.generate_html_report=${JSON.stringify(opts.generate_html_report)}`);
  }
  if (!Number.isInteger(opts.max_lines_per_batch) || opts.max_lines_per_batch <= 0) {
    problems.push(`review_options.max_lines_per_batch=${JSON.stringify(opts.max_lines_per_batch)}`);
  }
  if (typeof opts.deep_doubt_analysis !== 'boolean') {
    problems.push(`review_options.deep_doubt_analysis=${JSON.stringify(opts.deep_doubt_analysis)}`);
  }
  return problems;
}

function assertPhase1Complete(options = {}) {
  const statePath = path.resolve(options.statePath || '.codereview/state.json');
  const force = options.force === true || options.force === 'true';

  if (force) return;

  if (!fs.existsSync(statePath)) {
    console.error(PHASE1_MESSAGE);
    console.error(`(state missing: ${statePath})`);
    process.exit(2);
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    console.error(PHASE1_MESSAGE);
    console.error(`(invalid state json: ${statePath})`);
    process.exit(2);
  }

  const problems = phase1Problems(state);
  if (problems.length) {
    console.error(PHASE1_MESSAGE);
    console.error(`(${problems.join(', ')}, phase=${state.current_phase})`);
    process.exit(2);
  }
}

module.exports = { assertPhase1Complete, PHASE1_MESSAGE };

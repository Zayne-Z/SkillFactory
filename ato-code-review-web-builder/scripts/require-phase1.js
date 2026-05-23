/**
 * Phase 2+ 脚本入口门禁：Phase 1 四项须已确认（review_options.user_confirmed === true）
 */
const fs = require('fs');
const path = require('path');

const PHASE1_MESSAGE = `
PHASE1_REQUIRED: 尚未完成 Phase 1 四项确认，禁止执行检视脚本。

主编排 Agent 必须向用户一次收齐并复述确认：
  1) BRANCH1 / BRANCH2
  2) severity_mode (all | critical_high_only)
  3) skip_low_risk_files (true | false)
  4) generate_html_report (true | false)

确认后执行：
  node "{SKILL_ROOT}/scripts/update-state.js" --branch1 <b1> --branch2 <b2> \\
    --set review_options.severity_mode=<mode> \\
    --set review_options.skip_low_risk_files=<bool> \\
    --set review_options.generate_html_report=<bool> \\
    --set review_options.user_confirmed=true \\
    --phase diff_analysis --checkpoint phase1_done

若只问了分支就开始检视，说明未执行 `SKILL.md` §0.2；Phase 2 脚本会报 `PHASE1_REQUIRED`。
`.trim();

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

  if (state.review_options?.user_confirmed !== true) {
    console.error(PHASE1_MESSAGE);
    console.error(
      `(user_confirmed=${JSON.stringify(state.review_options?.user_confirmed)}, phase=${state.current_phase})`
    );
    process.exit(2);
  }

  if (!state.branches?.branch1) {
    console.error(PHASE1_MESSAGE);
    console.error('(branches.branch1 is empty)');
    process.exit(2);
  }
}

module.exports = { assertPhase1Complete, PHASE1_MESSAGE };

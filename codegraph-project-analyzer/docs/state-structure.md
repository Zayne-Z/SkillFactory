# State Structure

State lives at `.projectanalysis/state.json` and is the only resume signal.

Phases:

`scope_confirm -> environment_check -> inventory -> graph_index -> module_planning -> overview_analysis -> overview_rendering -> deep_scope_confirm -> deep_task_planning -> deep_parallel_analysis -> deep_synthesis -> final_rendering -> completed`

Important fields:

- `scope.user_confirmed`: false until the user confirms full-project Java/Web analysis defaults.
- `options.index_storage`: V1 is `json`.
- `options.codegraph_policy`: `ask` by default. Allowed values are `no-codegraph`, `codegraph-enhanced`, `codegraph-first`, and `ask`.
- `mcp.codegraph`: `available` only when CodeGraph can answer graph queries for the target project; otherwise `unavailable`.
- `paths.deep_tasks`: resumable deep-analysis task plan at `.projectanalysis/deep-tasks.json`.
- `paths.deep_results_dir`: one JSON result per selected deep task.
- `deep_analysis.selection_mode`: `awaiting_user`, `selected_modules`, `selected_tasks`, `all`, or `skipped`.
- `scripts/select-deep-tasks.js`: records the user's choice in `deep-tasks.json` without manual JSON editing.
- `agent_progress.parallel_analysis`: compatibility field for overview workers: `module_summaries`, `entrypoints_routes`, `domain_data_model`, `dependency_hotspots`, `config_runtime`, `reading_path`.
- `synthesis.report_path` and `synthesis.html_report_path`: final human deliverables.

If an overview agent is `in_progress` during resume, check its fixed output JSON. If valid, mark `completed`; otherwise reset to `pending` and rerun. If deep analysis is interrupted, resume from `.projectanalysis/deep-tasks.json`: skip `completed`, retry eligible `failed`, and run remaining `pending` tasks in batches.

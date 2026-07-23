#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveIssues, writeResolvedArtifacts } = require('./issue-resolver');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`unknown argument: ${key}`);
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`missing value for ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv);
    const state = args.state || '.codereview/state.json';
    const inventory = args.inventory || '.codereview/file-inventory.json';
    const results = args.results || '.codereview/results';
    const output = args.output || (args.batch
      ? path.join(results, `${args.batch}-resolved.json`)
      : '.codereview/resolved-issues.json');
    const discarded = args['discarded-output'] || '.codereview/discarded-issues.json';
    let previousDiscarded = [];
    if (args.batch && fs.existsSync(discarded)) {
      try {
        previousDiscarded = JSON.parse(fs.readFileSync(discarded, 'utf8')).discarded_issues || [];
      } catch {
        previousDiscarded = [];
      }
    }
    const result = resolveIssues({
      state,
      inventory,
      results,
      batch: args.batch,
      kind: args.kind,
      diffDir: args['diff-dir'],
    });
    const ok = result.missing_batches.length === 0;
    if (ok) writeResolvedArtifacts(result, output, discarded);
    if (args.batch && previousDiscarded.length) {
      const merged = [
        ...previousDiscarded.filter((item) => item.batchId !== args.batch && item.batch_id !== args.batch),
        ...result.discarded_issues,
      ];
      fs.writeFileSync(discarded, `${JSON.stringify({
        version: result.version,
        generated_at: result.generated_at,
        count: merged.length,
        discarded_issues: merged,
      }, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify({
      ok,
      output: path.resolve(output),
      discardedOutput: path.resolve(discarded),
      resolvedIssues: result.issues.length,
      discardedIssues: result.discarded_issues.length,
      missingBatches: result.missing_batches,
    }));
    if (!ok) process.exit(2);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

if (require.main === module) main();

#!/usr/bin/env node
const { parseArgs, runQuery } = require('./lib/index-utils');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command) throw new Error('Usage: node query-index.js <command> --index .projectanalysis/index');
  const indexDir = args.index || '.projectanalysis/index';
  const result = runQuery(indexDir, command, args);
  console.log(JSON.stringify(result, null, 2));
}

main();

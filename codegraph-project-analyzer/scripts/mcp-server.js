#!/usr/bin/env node
const readline = require('node:readline');
const { parseArgs, TOOL_NAMES, runQuery } = require('./lib/index-utils');

const args = parseArgs(process.argv.slice(2));
const indexDir = args.index || '.projectanalysis/index';

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, error) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } }) + '\n');
}

function hasId(request) {
  return Object.prototype.hasOwnProperty.call(request, 'id');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    const notification = !hasId(request);
    if (request.method === 'initialize') {
      if (notification) return;
      respond(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'codegraph-project-analyzer', version: '1.0.0' } });
      return;
    }
    if (notification) return;
    if (request.method === 'tools/list') {
      respond(request.id, {
        tools: TOOL_NAMES.map((name) => ({
          name,
          description: `Query codegraph-project-analyzer JSON index with ${name}.`,
          inputSchema: { type: 'object', additionalProperties: true },
        })),
      });
      return;
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name;
      const params = request.params?.arguments || {};
      const data = runQuery(indexDir, name, params);
      respond(request.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
      return;
    }
    fail(request.id, new Error(`Method not found: ${request.method}`));
  } catch (error) {
    fail(request?.id || null, error);
  }
});

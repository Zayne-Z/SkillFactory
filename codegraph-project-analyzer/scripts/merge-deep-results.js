#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  parseArgs,
  readJson,
  writeJson,
} = require('./lib/index-utils');

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dir, file));
}

function normalizeFeature(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw.feature ? raw : raw.feature_implementation;
  if (!item || typeof item !== 'object') return null;
  const hasSubstance = item.feature || (Array.isArray(item.implementation_flow) && item.implementation_flow.length);
  if (!hasSubstance) return null;
  return {
    task_id: item.task_id || raw.task_id || '',
    module_id: item.module_id || raw.module_id || '',
    feature: item.feature || item.title || '未命名功能',
    business_goal: item.business_goal || '',
    triggers: Array.isArray(item.triggers) ? item.triggers : [],
    implementation_flow: Array.isArray(item.implementation_flow) ? item.implementation_flow : [],
    async_mechanism: item.async_mechanism || '',
    external_calls: Array.isArray(item.external_calls) ? item.external_calls : [],
    state_storage: Array.isArray(item.state_storage) ? item.state_storage : [],
    data_writes: Array.isArray(item.data_writes) ? item.data_writes : [],
    cleanup_jobs: Array.isArray(item.cleanup_jobs) ? item.cleanup_jobs : [],
    key_code: Array.isArray(item.key_code) ? item.key_code : [],
    evidence: Array.isArray(item.evidence) ? item.evidence : [],
    confidence: item.confidence || 'medium',
    open_questions: Array.isArray(item.open_questions) ? item.open_questions : [],
    codegraph_mcp_used: Boolean(item.codegraph_mcp_used),
    mysql_mcp_used: Boolean(item.mysql_mcp_used),
  };
}

function dedupe(features) {
  const seen = new Set();
  const result = [];
  for (const feature of features) {
    const key = feature.task_id || `${feature.module_id}:${feature.feature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(feature);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const analysisPath = path.resolve(args.analysis || '.projectanalysis/analysis-result.json');
  const resultsDir = path.resolve(args['results-dir'] || '.projectanalysis/deep-results');
  const output = path.resolve(args.output || '.projectanalysis/feature-implementations.json');
  const analysis = readJson(analysisPath, {});
  const features = dedupe(listJsonFiles(resultsDir)
    .map((file) => normalizeFeature(readJson(file)))
    .filter(Boolean));

  const payload = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    source_dir: resultsDir,
    feature_implementations: features,
  };
  writeJson(output, payload);
  writeJson(analysisPath, {
    ...analysis,
    feature_implementations: features,
    feature_implementations_path: output,
  });
  console.log(JSON.stringify({ ok: true, output, analysis: analysisPath, feature_implementations: features.length }));
}

main();

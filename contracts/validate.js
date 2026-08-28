#!/usr/bin/env node
/**
 * validate.js — Execution Contract Validator (V4.1)
 *
 * Pipeline: Markdown file → Parser (extract frontmatter) → Validator (enforce schema) → Report
 *
 * Parser responsibility: READ. Extract key:value pairs from the YAML-like frontmatter.
 * Validator responsibility: CHECK. Enforce schema rules (mirrored from contract.schema.json).
 *
 * Two responsibilities are intentionally separate — parser must not silently fix invalid data.
 * This file has zero runtime dependencies (Node built-ins only).
 *
 * Usage:
 *   node validate.js                          # validates ./mock_contract.md
 *   node validate.js path/to/contract.md      # validates the given file
 *
 * Exit codes:
 *   0 — pass
 *   1 — validation error (details printed to stderr)
 *   2 — file not found
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA (mirrors contract.schema.json — kept inline to avoid runtime deps)
// ─────────────────────────────────────────────────────────────────────────────
const SCHEMA = {
  required: [
    'BOUNTY_ID', 'TARGET_MODULE', 'EVIDENCE_TYPE',
    'SIGNAL_SCORE', 'LEVERAGE_SCORE', 'PAIN_RECURRENCE',
    'DIFFICULTY', 'ASSET_CLASS', 'PRIMARY_STACK',
  ],
  fields: {
    BOUNTY_ID:        { type: 'string',       regex: /^BTY-\d{4}-\d{4}-\d{2}$/ },
    TARGET_MODULE:    { type: 'string',       minLength: 3, maxLength: 64, regex: /^[a-z][a-z0-9_]*$/ },
    EVIDENCE_TYPE:    { type: 'string',       enum: ['EXTERNAL_MARKET', 'INTERNAL_TELEMETRY'] },
    SIGNAL_SCORE:     { type: 'number',       min: 0, max: 10, multipleOf: 0.1 },
    LEVERAGE_SCORE:   { type: 'number',       min: 0, max: 10, multipleOf: 0.1 },
    PAIN_RECURRENCE:  { type: 'string',       enum: ['LOW', 'MEDIUM', 'HIGH'] },
    DIFFICULTY:       { type: 'string',       enum: ['LOW', 'MEDIUM', 'HIGH'] },
    ASSET_CLASS:      { type: 'string',       enum: ['B2B_CORE_LICENSE', 'B2B_TOOL', 'RESEARCH_ARTIFACT', 'INFRASTRUCTURE'] },
    PRIMARY_STACK:    { type: 'string',       enum: ['TYPESCRIPT', 'JAVASCRIPT', 'RUST', 'PYTHON', 'GO', 'CPP'] },
    ABSTRACTION_HASH: { type: 'stringOrNull', regexIfString: /^[a-f0-9]{64}$/, default: null },
    PAIN_CLUSTER_ID:  { type: 'stringOrNull', regexIfString: /^PCL-\d{4}-\d{4}$/, default: null },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — extract frontmatter from .md file
// Responsibility: READ. Never mutate. Never silently fix.
// ─────────────────────────────────────────────────────────────────────────────
function parseFrontmatter(mdContent) {
  const lines = mdContent.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') {
    throw new Error('file does not start with "---" frontmatter delimiter');
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) {
    throw new Error('no closing "---" delimiter found');
  }
  const body = lines.slice(1, endIdx).join('\n');
  const parsed = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue; // skip blank and comment lines
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(`line has no key:value separator: "${rawLine}"`);
    }
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // parse null
    if (value === 'null' || value === '') {
      parsed[key] = null;
      continue;
    }
    // parse number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      parsed[key] = parseFloat(value);
      continue;
    }
    parsed[key] = value;
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR — enforce schema rules
// Responsibility: CHECK. Never mutate. Never read the .md file directly.
// ─────────────────────────────────────────────────────────────────────────────
function validate(parsed) {
  const errors = [];
  // 1. Required fields
  for (const field of SCHEMA.required) {
    if (!(field in parsed)) {
      errors.push(`MISSING required field: ${field}`);
    }
  }
  // 2. Unknown fields (additionalProperties: false)
  for (const key of Object.keys(parsed)) {
    if (!SCHEMA.fields[key]) {
      errors.push(`UNKNOWN field: ${key} (schema is closed — additionalProperties=false)`);
    }
  }
  // 3. Type & constraint checks per field
  for (const [key, value] of Object.entries(parsed)) {
    const rule = SCHEMA.fields[key];
    if (!rule) continue; // already reported as unknown
    if (rule.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${key}: expected string, got ${typeof value}`);
        continue;
      }
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${key}: value "${value}" not in enum [${rule.enum.join(', ')}]`);
      }
      if (rule.regex && !rule.regex.test(value)) {
        errors.push(`${key}: value "${value}" does not match pattern ${rule.regex}`);
      }
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(`${key}: too short (min ${rule.minLength})`);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(`${key}: too long (max ${rule.maxLength})`);
      }
    } else if (rule.type === 'number') {
      if (typeof value !== 'number') {
        errors.push(`${key}: expected number, got ${typeof value}`);
        continue;
      }
      if (rule.min !== undefined && value < rule.min) {
        errors.push(`${key}: value ${value} below min ${rule.min}`);
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push(`${key}: value ${value} above max ${rule.max}`);
      }
      if (rule.multipleOf !== undefined) {
        const ratio = value / rule.multipleOf;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
          errors.push(`${key}: value ${value} not a multiple of ${rule.multipleOf}`);
        }
      }
    } else if (rule.type === 'stringOrNull') {
      if (value !== null && typeof value !== 'string') {
        errors.push(`${key}: expected string or null, got ${typeof value}`);
        continue;
      }
      if (typeof value === 'string' && rule.regexIfString && !rule.regexIfString.test(value)) {
        errors.push(`${key}: value "${value}" does not match pattern ${rule.regexIfString}`);
      }
    }
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const target = process.argv[2] || path.join(__dirname, 'mock_contract.md');
  if (!fs.existsSync(target)) {
    console.error(`✗ FAIL: file not found: ${target}`);
    process.exit(2);
  }
  console.log(`Validating: ${target}`);
  const md = fs.readFileSync(target, 'utf8');
  let parsed;
  try {
    parsed = parseFrontmatter(md);
  } catch (e) {
    console.error(`✗ FAIL (parser stage): ${e.message}`);
    process.exit(1);
  }
  console.log('Parsed metadata:');
  for (const [k, v] of Object.entries(parsed)) {
    console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
  const errors = validate(parsed);
  if (errors.length === 0) {
    console.log('\n✓ PASS: contract metadata is valid against schema.');
    process.exit(0);
  } else {
    console.error(`\n✗ FAIL: ${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

main();

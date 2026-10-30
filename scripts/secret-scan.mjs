#!/usr/bin/env node
// Fails if any staged (or, with --all, tracked) file contains something that looks like an API key.
// Runs automatically from .githooks/pre-commit (enable with: git config core.hooksPath .githooks).
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const all = process.argv.includes('--all');
const list = execSync(all ? 'git ls-files' : 'git diff --cached --name-only --diff-filter=ACM', {
  encoding: 'utf8',
})
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const PATTERNS = [
  [/sk-ant-[a-zA-Z0-9_-]{16,}/, 'Anthropic API key'],
  [/sk-[a-zA-Z0-9]{32,}/, 'Generic sk- secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'Private key'],
  [/ANTHROPIC_API_KEY\s*=\s*['"]?[A-Za-z0-9_-]{12,}/, 'Hard-coded ANTHROPIC_API_KEY'],
];

let bad = 0;
for (const file of list) {
  if (/^\.env($|\.)/.test(file) && file !== '.env.example') {
    console.error(`✖ ${file}: .env files must never be committed`);
    bad++;
    continue;
  }
  if (!existsSync(file) || /\.(task|wasm|png|jpg|woff2?|ico)$/.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) {
      console.error(`✖ ${file}: possible ${label}`);
      bad++;
    }
  }
}

if (bad) {
  console.error(`\nSecret scan failed (${bad} finding${bad > 1 ? 's' : ''}). Remove secrets before committing.`);
  process.exit(1);
}
console.log(`✔ Secret scan clean (${list.length} file${list.length === 1 ? '' : 's'} checked).`);

#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { parse } from 'jsonc-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const folder = path.join(__dirname, '..', 'src', 'lang');

function sortKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  } else if (obj && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

if (!fs.existsSync(folder)) {
  console.log(`Folder ${folder} does not exist.`);
  process.exit(0);
}

console.log(`Sorting JSON files in ${folder} ...`);

for (const file of fs.readdirSync(folder)) {
  if (!file.endsWith('.json')) continue;

  const filePath = path.join(folder, file);
  const original = fs.readFileSync(filePath, 'utf8');

  try {
    const parsed = parse(original);
    const sorted = JSON.stringify(sortKeys(parsed), null, 2) + '\n';

    fs.writeFileSync(filePath, sorted, 'utf8');
    console.log(`→ Sorted ${file}`);
  } catch (err) {
    console.error(`❌ Failed to sort ${file}: ${err.message}`);
    process.exit(1);
  }
}

console.log('✅ Sorting complete.');

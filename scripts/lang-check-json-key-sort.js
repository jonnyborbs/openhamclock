const fs = require('fs');
const path = require('path');
const { parse } = require('jsonc-parser'); // VSCode's JSON parser

const folder = path.join('src', 'lang');

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

let failed = false;
if (!fs.existsSync(folder)) {
  console.log(`Folder ${folder} does not exist. Skipping check.`);
  process.exit(0);
}

for (const file of fs.readdirSync(folder)) {
  if (file.endsWith('.json')) {
    const filePath = path.join(folder, file);
    const original = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
      parsed = parse(original);
    } catch (err) {
      console.error(`❌ Invalid JSON in ${file}: ${err.message}`);
      failed = true;
      continue;
    }
    const sorted = JSON.stringify(sortKeys(parsed), null, 2) + '\n';
    if (original !== sorted) {
      console.error(`❌ Keys in ${file} are not as VSCode sorts them.`);
      failed = true;
    }
  }
}

if (failed) {
  console.error(`Some JSON files in src/lang have unsorted keys, use 'npm run lang:sort' to fix.`);
  process.exit(1);
} else {
  console.log('✅ All JSON files in src/lang are sorted.');
}

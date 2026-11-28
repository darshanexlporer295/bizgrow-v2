// Rebuilds supabase/run-all-pending.sql from the separate patch files, in order.
// Usage: node supabase/build-run-all.cjs          (writes the file)
//        node supabase/build-run-all.cjs --check  (exits 1 if the file is out of date)
// The header (everything before the first BEGIN marker) is kept as it is in the file.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const target = path.join(dir, 'run-all-pending.sql');
const patches = ['patch-08.sql', 'patch-09.sql', 'patch-11.sql', 'patch-12.sql', 'patch-13.sql', 'patch-14.sql', 'patch-15.sql', 'patch-16.sql', 'patch-17.sql', 'patch-18.sql', 'patch-19.sql'];

const current = fs.readFileSync(target, 'utf8');
const cut = current.indexOf('-- ==================== BEGIN ');
if (cut < 0) throw new Error('no BEGIN marker found in run-all-pending.sql');
const header = current.slice(0, cut);

let out = header;
for (const name of patches) {
  const body = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\s+$/, '');
  out += `-- ==================== BEGIN ${name} ====================\n${body}\n-- ==================== END ${name} ====================\n\n`;
}
out = out.replace(/\n+$/, '\n');

if (process.argv.includes('--check')) {
  if (out !== current) { console.error('run-all-pending.sql is out of date; run: node supabase/build-run-all.cjs'); process.exit(1); }
  console.log('run-all-pending.sql matches the patch files');
} else {
  fs.writeFileSync(target, out);
  console.log('wrote run-all-pending.sql');
}

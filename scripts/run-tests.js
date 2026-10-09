import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(filename) : entry.isFile() && entry.name.endsWith('.test.js') ? [filename] : [];
  });
}
const files = collect(path.join(root, 'src')).sort();
if (!files.length) throw new Error('No source tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd:root, stdio:'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

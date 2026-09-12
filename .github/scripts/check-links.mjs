/**
 * Markdown の相対リンクが実在するかを見る。
 *
 *   node .github/scripts/check-links.mjs
 *
 * 外部(https:)リンクは見ない。参照実装や判断基準の記事は GitHub の URL で指しているので、
 * それらが切れても CI は気付かない。**URL を変えたら手でたどる。**
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = process.cwd();

const md = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) md.push(p);
  }
})(ROOT);

const broken = [];
let checked = 0;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

for (const file of md) {
  for (const m of readFileSync(file, 'utf8').matchAll(LINK)) {
    const raw = m[1];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = raw.split('#')[0];
    if (!target) continue;
    checked++;
    if (!existsSync(resolve(dirname(file), target))) {
      broken.push(`${relative(ROOT, file)} -> ${raw}`);
    }
  }
}

console.log(`Markdown ${md.length} ファイル / 相対リンク ${checked} 件を検査`);
if (broken.length) {
  console.error(`::error::リンク切れが ${broken.length} 件あります`);
  broken.forEach((b) => console.error('  ' + b));
  process.exit(1);
}
console.log('OK: リンク切れなし');

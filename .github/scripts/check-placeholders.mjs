// **`templates/` にプロジェクト固有の名前が残っていないことを検査する。**
//
// 雛形は参照実装(audio-shop-ec)から一般化して置く。一般化し忘れた固有名は、
// 採用先へコピーしたあと「別プロジェクトのスタック名を指している」形で静かに残る。
// 人が読んで見つけるのは無理な量なので、機械で止める。
//
// 禁止するもの:
//   - 参照実装のプロジェクト名(audio-shop-ec / mybatis / neo-audio / record-shop)
//   - 参照実装の所有者名(cosugi-system-organization)
//   - 12 桁の数字(AWS アカウント ID の形)
//
// 参照実装へ言及したいときは、雛形の中では「参照実装」と書き、URL は README に集める。
// 固有名を書き換える場所には `<app-repo>` `<infra-repo>` `<stack-name>` のような山括弧の
// プレースホルダを使う(採用手順で grep しやすいように)。

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGET_DIR = 'templates';
const FORBIDDEN = [
  { re: /audio-shop-ec/gi, why: '参照実装のプロジェクト名' },
  { re: /mybatis/gi, why: '参照実装のアプリ名' },
  { re: /neo-audio/gi, why: '姉妹プロジェクト名' },
  { re: /record-shop/gi, why: '姉妹プロジェクト名' },
  { re: /cosugi-system-organization/g, why: '参照実装の所有者名' },
  { re: /\b\d{12}\b/g, why: 'AWS アカウント ID の形' },
];

const files = [];
(function walk(d) {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(join(ROOT, TARGET_DIR));

const hits = [];
for (const file of files) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  for (const { re, why } of FORBIDDEN) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(`${rel}:${line} 「${m[0]}」(${why})`);
    }
  }
}

console.log(`templates/ ${files.length} ファイルを検査`);
if (hits.length) {
  console.error(`::error::プロジェクト固有の名前が ${hits.length} 件残っています`);
  hits.forEach((h) => console.error('  ' + h));
  process.exit(1);
}
console.log('OK: 固有名なし');

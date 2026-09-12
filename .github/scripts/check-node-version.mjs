// **Node の下限が、ファイル間で食い違っていないことを検査する。**
//
// `package.json` の `engines.node`(`>=N`)を「正」とし、
// 追跡対象の md / sh / ps1 / yml / mjs に書かれた「Node.js N 以上」「Node N+」が
// すべてその N になっているかを見る。
//
// なぜ機械で見るのか(参照実装での実績): Node 20 が EOL したとき、バージョンの記述が
// 12 箇所に散っていた。手で数えて直したつもりが 4 箇所しか直っておらず、残りは自動レビューが
// 見つけた。「次からは全部数える」で守れるものではないので、検査に落とす。
//
// **CI と推奨環境のバージョン(`.nvmrc`)は、この下限とは別物。**
// 下限は「まだ生きている LTS のうち最も古いもの」で、`.nvmrc` より緩くてよい。
// だから `.nvmrc` の値とは突き合わせない。
//
// このリポジトリの文書では、そもそもバージョンを書かないのが第一の手。
// 書くなら `package.json` の下限に揃える。

import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SOURCE = 'package.json';

const engines = JSON.parse(fs.readFileSync(SOURCE, 'utf8')).engines?.node ?? '';
const found = /^>=\s*(\d+)/.exec(engines);
if (!found) {
  console.error(`::error file=${SOURCE}::engines.node が ">=N" の形で見つかりません(今の値: "${engines}")`);
  process.exit(1);
}
const min = found[1];

// 追跡対象と、まだ追跡していない新規ファイルを見る(node_modules は除外される)。
const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && /\.(sh|ps1|md|ya?ml|mjs)$/.test(f) && fs.existsSync(f));

// 「Node.js 22 以上」「Node 22+」「Nodejs 22+」「Node.js22以上」を拾う。
// **`js` は任意グループ `(?:js)?` にする。** `js?` と書くと `j` が必須になり、
// `Node 22+` の形だけがすり抜ける(参照実装で自動レビューが見つけた誤り)。
const PATTERN = /Node\.?(?:js)? ?(\d+) ?(以上|\+)/g;

const bad = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const hit of text.matchAll(PATTERN)) {
    if (hit[1] !== min) {
      bad.push({ file, line: text.slice(0, hit.index).split('\n').length, found: hit[0] });
    }
  }
}

if (bad.length > 0) {
  console.error(`::error::Node の下限は ${SOURCE} の ${min} が正です。食い違う記述があります。`);
  for (const b of bad) {
    console.error(`::error file=${b.file},line=${b.line}::「${b.found}」 — ${min} に揃えてください`);
  }
  process.exit(1);
}

console.log(`OK: Node の下限は ${min} で揃っています(${files.length} ファイルを検査)`);

// **Node の下限が、ファイル間で食い違っていないことを検査する。**
//
// `scripts/lib/common.mjs` の `checkNode` が持つ下限を「正」とし、
// 追跡対象の *.sh / *.ps1 / *.md に書かれた「Node.js N 以上」「Node N+」が
// すべてその N になっているかを見る。
//
// なぜ機械で見るのか(参照実装での実績): Node の LTS が EOL したとき、バージョンの記述が
// 12 箇所に散っていた。手で数えて直したつもりが 4 箇所しか直っておらず、
// 残りは自動レビューが見つけた。「次からは全部数える」で守れるものではないので、検査に落とす。
//
// **CI と推奨環境のバージョン(`.nvmrc` の値)は、この下限とは別物。**
// 下限は「まだ生きている LTS のうち最も古いもの」で、`.nvmrc` より緩くてよい。
// だから `.nvmrc` の値とは突き合わせない。
//
// このスクリプトは参照実装のものをそのまま前提にしている(`scripts/lib/common.mjs` に
// `checkNode` が無ければ SOURCE を書き換える。採用先で用意する)。

import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SOURCE = 'scripts/lib/common.mjs';

const source = fs.readFileSync(SOURCE, 'utf8');
const found = source.match(/major < (\d+)/);
if (!found) {
  console.error(`::error file=${SOURCE}::checkNode の下限(major < N)が見つかりません`);
  process.exit(1);
}
const min = found[1];

// node_modules と cdk.out を確実に外すため、追跡対象だけを見る。
const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(sh|ps1|md)$/.test(f));

// 「Node.js 22 以上」「Node 22+」「Nodejs 22+」「Node.js22以上」を拾う。
// **`js` は任意グループ `(?:js)?` にする。** `js?` と書くと `j` が必須になり、
// **`Node 22+` の形だけがすり抜ける**(この誤りは自動レビューが見つけた)。
const PATTERN = /Node\.?(?:js)? ?(\d+) ?(以上|\+)/g;

const bad = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const hit of text.matchAll(PATTERN)) {
    if (hit[1] !== min) {
      bad.push({
        file,
        line: text.slice(0, hit.index).split('\n').length,
        found: hit[0],
      });
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

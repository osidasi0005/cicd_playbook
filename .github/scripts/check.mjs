// このリポジトリの検証コマンド。CI と手元で同じものを走らせる。
//
//   node .github/scripts/check.mjs
//
// 4 つの検査を順に実行し、1 つでも落ちたら非ゼロで終わる(全部走らせてから集計する)。
// 検査を足したら CLAUDE.md の一覧も更新する。

import { spawnSync } from 'node:child_process';

const CHECKS = [
  ['リンク切れ', '.github/scripts/check-links.mjs'],
  ['Node の下限表記', '.github/scripts/check-node-version.mjs'],
  ['YAML / JSON の構文', '.github/scripts/check-yaml.mjs'],
  ['雛形の固有名', '.github/scripts/check-placeholders.mjs'],
];

const failed = [];
for (const [label, script] of CHECKS) {
  console.log(`\n=== ${label} (${script}) ===`);
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(label);
}

console.log('');
if (failed.length) {
  console.error(`FAIL: ${failed.join(' / ')}`);
  process.exit(1);
}
console.log('PASS: すべての検査を通過');

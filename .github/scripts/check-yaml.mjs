// **`.github/` と `templates/` の YAML / JSON が、少なくとも構文として読めることを検査する。**
//
// `templates/` のワークフローはこのリポジトリでは実行されない(`.github/workflows/` の外にある)ので、
// GitHub 側の構文検査も掛からない。壊れたまま採用先へコピーされるのを、ここで止める。
//
// 見るもの:
//   - すべての *.yml / *.yaml が YAML として読める(CloudFormation の短縮タグ `!Sub` などは読めるようにしてある)
//   - `workflows/` 配下のファイルは `on` と `jobs` を持つ
//   - `action.yml` / `action.yaml` は `runs` を持つ
//   - *.json が JSON として読める(SCP など)
//
// 見ないもの: ワークフローの意味(存在しない action、入力の型)。それは actionlint の領分で、
// この PC には未導入。採用先で実際に走らせるまで分からないと思っておく。

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const TARGET_DIRS = ['.github', 'templates'];

// CloudFormation の短縮形タグ。js-yaml は未知のタグで落ちるので、Fn:: の形に読み替える型を足す。
const CFN_TAGS = [
  'Ref', 'Sub', 'GetAtt', 'If', 'Equals', 'FindInMap', 'Join', 'Select', 'Not', 'And', 'Or',
  'Condition', 'Base64', 'Split', 'ImportValue', 'GetAZs', 'Cidr', 'Transform',
];
const CFN_TYPES = CFN_TAGS.flatMap((tag) =>
  ['scalar', 'sequence', 'mapping'].map(
    (kind) => new yaml.Type(`!${tag}`, { kind, construct: (data) => ({ [`Fn::${tag}`]: data }) }),
  ),
);
const SCHEMA = yaml.DEFAULT_SCHEMA.extend(CFN_TYPES);

const files = [];
(function walk(d) {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return; // ディレクトリがまだ無い(templates/ を作る前)
  }
  for (const e of entries) {
    if (e.name === 'node_modules') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ya?ml|json)$/.test(e.name)) files.push(p);
  }
})(ROOT);
// walk は ROOT から始めると docs/ も拾うので、対象ディレクトリだけに絞る
const targets = files.filter((f) => TARGET_DIRS.some((d) => relative(ROOT, f).split(/[\\/]/)[0] === d));

const errors = [];
for (const file of targets) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  try {
    if (file.endsWith('.json')) {
      JSON.parse(text);
      continue;
    }
    const docs = yaml.loadAll(text, undefined, { schema: SCHEMA, filename: rel });
    const doc = docs[0];
    if (/\/workflows\//.test(rel)) {
      if (!doc || typeof doc !== 'object' || !('on' in doc) || !('jobs' in doc)) {
        errors.push(`${rel}: ワークフローに on / jobs がありません`);
      }
    }
    if (/^action\.ya?ml$/.test(basename(file))) {
      if (!doc || typeof doc !== 'object' || !('runs' in doc)) {
        errors.push(`${rel}: composite action に runs がありません`);
      }
    }
  } catch (e) {
    errors.push(`${rel}: ${e.message.split('\n')[0]}`);
  }
}

console.log(`YAML / JSON ${targets.length} ファイルを検査`);
if (errors.length) {
  console.error(`::error::読めないファイルが ${errors.length} 件あります`);
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('OK: すべて読めます');

// templates/aws/ に置いた CloudFormation テンプレートを検査する。
//
// このディレクトリは **IaC アプリの外**にある想定(CDK なら bin/ のアプリに含めない)。
// そのため、アプリ側の CI が持つ「説明文に非 ASCII 文字が無いこと」の検査は
// 合成後のテンプレート(cdk.out 相当)しか見ておらず、ここのファイルは素通りする。
// 日本語を入れてしまっても synth も型チェックも動かず、
// 手元で `aws cloudformation deploy` を実行して初めて CREATE_FAILED になる。
//
// IAM の Description は ASCII 印字可能文字と Latin-1 補助しか受け付けない
// (CloudFormation のテンプレート Description や Parameters の Description は別物で、
//  そちらは日本語で構わない。だから「どこの Description か」を見分ける必要がある)。
//
// **参照実装は js-yaml 5 系(defineScalarTag などの新 API)で書かれていたが、
// このリポジトリの package.json は js-yaml ^4.1.0 を固定している(check-yaml.mjs と同じ)。**
// 5 系の関数は 4 系には存在せず import の時点で落ちるため、ここでは 4 系の
// `DEFAULT_SCHEMA.extend` + `new yaml.Type(tag, { kind, construct })` に合わせてある。
// 採用先で js-yaml 5 を使うなら、check-yaml.mjs も含めて 5 系の書き方に揃えること。
//
// 対象ディレクトリは引数で渡せる(既定は「このスクリプトの 1 つ上のディレクトリ」、
// つまり採用先でこのファイルをコピーしたときの templates/aws/ 相当)。
//   node check-infra-templates.mjs [対象ディレクトリ]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 既定値: このスクリプトが scripts/check-infra-templates.mjs としてコピーされている前提で、
// 1 つ上(= templates/aws/ 相当)を対象にする。引数を渡せば任意のディレクトリを検査できる。
const DIR = process.argv[2] ?? path.resolve(__dirname, '..');

// CloudFormation の短縮タグ(!Ref / !Sub ...)は素の YAML では未知のタグになる。
// 中身の検査には使わないので、構造さえ保てれば良い
// (どの形で書かれていても `{ "Fn::<tag>": 中身 }` に包んで、構造だけ残す)。
const CFN_TAGS = [
  'Ref', 'Sub', 'GetAtt', 'If', 'Equals', 'Join', 'Select', 'Split', 'FindInMap',
  'Base64', 'Cidr', 'ImportValue', 'Not', 'And', 'Or', 'Condition', 'GetAZs', 'Transform',
];
const CFN_TYPES = CFN_TAGS.flatMap((tag) =>
  ['scalar', 'sequence', 'mapping'].map(
    (kind) => new yaml.Type(`!${tag}`, { kind, construct: (data) => ({ [`Fn::${tag}`]: data }) }),
  ),
);
const SCHEMA = yaml.DEFAULT_SCHEMA.extend(CFN_TYPES);

/** 説明文に非 ASCII を入れるとデプロイ時に落ちるリソース。 */
const CHECKED_TYPE = /^AWS::(IAM::|EC2::SecurityGroup)/;
const KEYS = ['Description', 'GroupDescription'];
const NON_ASCII = /[^\x00-\x7F]/;

if (!fs.existsSync(DIR)) {
  console.log(`OK: ${DIR} はありません`);
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
const bad = [];

for (const file of files) {
  const full = path.join(DIR, file);
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(full, 'utf8'), { schema: SCHEMA });
  } catch (e) {
    console.error(`::error file=${full}::YAML として読めません: ${e.message}`);
    process.exit(1);
  }

  for (const [id, res] of Object.entries(doc?.Resources ?? {})) {
    if (typeof res?.Type !== 'string' || !CHECKED_TYPE.test(res.Type)) continue;
    const props = res.Properties ?? {};
    for (const key of KEYS) {
      if (typeof props[key] === 'string' && NON_ASCII.test(props[key])) {
        bad.push(`${full}  ${id}(${res.Type}).${key} = ${props[key].trim().slice(0, 60)}`);
      }
    }
    // SecurityGroup のルールは配列の中に Description を持つ。
    for (const rule of [].concat(props.SecurityGroupIngress ?? [], props.SecurityGroupEgress ?? [])) {
      if (typeof rule?.Description === 'string' && NON_ASCII.test(rule.Description)) {
        bad.push(`${full}  ${id} のルール = ${rule.Description.trim().slice(0, 60)}`);
      }
    }
  }
}

if (bad.length > 0) {
  console.error('::error::IAM / SecurityGroup の説明文に非 ASCII 文字があります。デプロイで CREATE_FAILED になります。');
  bad.forEach((b) => console.error(b));
  process.exit(1);
}

console.log(`OK: ${DIR} の説明文はすべて ASCII です(${files.length} ファイル)`);

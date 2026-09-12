# templates/aws

push から本番までを到達形(アプリ側リポジトリの push が起点、prod / stage は別 AWS アカウント)
に合わせて動かすための AWS 側の土台。3 つの雛形と、Organizations の SCP からなる。

```
github-oidc.yaml   OIDC プロバイダ + デプロイロール + (stage だけ)ECR push ロール
ecr-repository.yaml  アプリのイメージ用 ECR リポジトリ(アプリのスタックの外)
scp/                Organizations の SCP 3 本(この土台とは別に、管理アカウントから適用する)
scripts/            この 2 つの YAML を検査するスクリプト(check-infra-templates.mjs)
```

固有名は書いていない。`<owner>` `<app-repo>` `<infra-repo>` `<project>` `<stack-name>`
`<app-ecr-repo>` のような山括弧のプレースホルダを、採用先の値に置き換えて使う。

## 3 つの関係

- **`github-oidc.yaml`** — GitHub Actions が AWS を OIDC で引き受けるための入り口。
  prod / stage それぞれのアカウントに 1 回ずつ流す。stage のときだけ、Environment を
  経由しない「CI から ECR へ push するためだけの」例外ロールも同じテンプレートで作る
- **`ecr-repository.yaml`** — アプリのイメージを置く ECR リポジトリ。
  アプリのスタックとは別に、prod / stage それぞれのアカウントに 1 回ずつ流す。
  stage 側は、prod のデプロイロールに pull を許可するリポジトリポリシーを追加で持つ
  (`github-oidc.yaml` の出力を受け取る)
- **`scp/`** — Organizations の管理アカウントから、prod / stage が属する OU へ直接適用する。
  上の 2 つとは適用者(管理アカウント vs 各ワークロードアカウント)も適用先も別なので、
  依存関係は無い。手順は `scp/README.md` を参照

## 適用する順番

`ecr-repository.yaml` の stage 側が `github-oidc.yaml`(prod)の出力を必要とするので、
**prod → stage → (stage の ECR に prod の出力を渡す)** の順で進める。

1. **prod アカウントで `github-oidc.yaml` を適用する**(OIDC プロバイダをこのアカウントで
   初めて作るなら `CreateOidcProvider=true`。他プロジェクトで作成済みなら `false` にして
   `ExistingOidcProviderArn` を渡す)。`TargetEnvironment=prod`。
   出力の `DeployRoleArn` を控える(手順 4 で stage 側の ECR リポジトリポリシーに使う)
2. **stage アカウントで `github-oidc.yaml` を適用する**。`TargetEnvironment=stage`。
   このアカウントで初めて OIDC プロバイダを作るなら `CreateOidcProvider=true`。
   出力の `DeployRoleArn` と `EcrPushRoleArn` を控える
3. **prod アカウントで `ecr-repository.yaml` を適用する**。`TargetEnvironment=prod`、
   `ProdDeployRoleArn` は空のままでよい(prod は他アカウントに読ませない)
4. **stage アカウントで `ecr-repository.yaml` を適用する**。`TargetEnvironment=stage`、
   `ProdDeployRoleArn` に手順 1 で控えた ARN を渡す(pull を許可するリポジトリポリシーが付く)
5. **GitHub 側に、控えた ARN を Variables として登録する**(下の表)

先に ECR だけ作って後から `github-oidc.yaml` を作り直しても動く(パラメータはどちらも
リソース ARN を文字列として組み立てるだけで、CloudFormation の Export/Import は使っていない)。
ただし stage の ECR リポジトリポリシーだけは prod のロール ARN が要るので、
**そこだけ prod の `github-oidc.yaml` が先**になる。

## パラメータの取り方

`GitHubOwnerId` / `AppRepositoryId` / `InfraRepositoryId` は GitHub が発行する OIDC トークンの
`sub` に入る数値 ID。`gh api` で取る。

```bash
# 組織なら orgs/<owner>、個人アカウントなら users/<owner>
gh api orgs/<owner> --jq .id

gh api repos/<owner>/<app-repo> --jq .id
gh api repos/<owner>/<infra-repo> --jq .id
```

`StageAccountId` は stage アカウントの 12 桁 ID(`aws sts get-caller-identity` を stage の
資格情報で実行するか、Organizations の管理アカウントから `aws organizations list-accounts` で見る)。

## 適用後に GitHub の Variables へ登録する値

Settings → Secrets and variables → Actions → Variables。ARN は秘密ではないので Secrets ではなく
Variables に置く(引き受けられるのは信頼ポリシーの `sub` に一致するジョブだけ)。

デプロイロールの ARN は **Environment ごとの変数**にする(同じ名前 `AWS_DEPLOY_ROLE_ARN` を
`production` と `staging` の Environment にそれぞれ登録する)。ワークフローは `environment:` を
指定したジョブでこの変数を読むので、prod と stage で名前を変えずに済み、
`environment:` の指定を間違えたジョブは AssumeRole で弾かれる(名前を分けると、staging のジョブに
prod の ARN を差すだけで本番を触れる穴になる)。

| 登録先 | 変数名 | 値 |
|---|---|---|
| app / infra 両方の Environment `production` | `AWS_DEPLOY_ROLE_ARN` | `github-oidc.yaml`(prod)の `DeployRoleArn` |
| app / infra 両方の Environment `staging` | `AWS_DEPLOY_ROLE_ARN` | `github-oidc.yaml`(stage)の `DeployRoleArn` |
| app 側のリポジトリ変数 | `AWS_ECR_PUSH_ROLE_ARN` | `github-oidc.yaml`(stage)の `EcrPushRoleArn` |
| app / infra 両方のリポジトリ変数 | `AWS_REGION` | 例: `ap-northeast-1` |
| app 側の Environment `production` | `STAGE_ECR_REGISTRY` | stage の `ecr-repository.yaml` の `RepositoryUri` からリポジトリ名を除いた `<account>.dkr.ecr.<region>.amazonaws.com`。本番昇格が pull する元 |
| app 側の Environment `production` | `PROD_ECR_REGISTRY` | prod 側の同じ形。本番昇格が push する先 |

stage へのデプロイ(`deploy-stage.yml`)は ECR ログイン時に返るレジストリをそのまま使うので、stage 用のレジストリ変数は要らない。

`templates/github/workflows/` 側の雛形はこの名前で読む。

## Mappings の値は手で置き換える

`github-oidc.yaml` の `EnvironmentConfig`(Mappings)には `StackName` / `TaskRoleName` /
`ExecutionRoleName` がプレースホルダのまま入っている。**CloudFormation の Mappings は値に
`!Sub` などの組み込み関数を使えない**ので、`ProjectName` パラメータからは自動で埋まらない。
採用時にこのファイルを直接編集して、実際のスタック名・ロール名に書き換えること
(`<stack-name>` → 実際の CloudFormation スタック名、`<project>-task-prod` → 実際の ECS タスクロール名、など)。
ずれると、AssumeRole 自体は通るのに個々の API 呼び出しが権限不足で落ちる(気づきにくい)。

## 検査

```bash
node scripts/check-infra-templates.mjs .
```

IAM の `Description` に非 ASCII 文字(日本語など)が無いことを確かめる。IAM は ASCII 印字可能文字
しか受け付けず、日本語を混ぜると `aws cloudformation deploy` が `CREATE_FAILED` になる
(CloudFormation テンプレート自体の `Description` は日本語でよい。別の制約)。
このリポジトリの `node .github/scripts/check.mjs` は `templates/` の YAML 構文と固有名の残留は見るが、
この ASCII 制約までは見ていないので、`templates/aws/` を変更したときは合わせて実行する。

## 確かめていないこと

`aws cloudformation validate-template` や実際の `deploy` はここでは実行していない
(採用先のアカウントで初めて確かめられる)。`check-yaml.mjs` が見るのは YAML として読めることと
最低限の構造だけで、IAM ポリシーの意味(ARN の組み立てが正しいか、権限が過不足ないか)までは見ない。

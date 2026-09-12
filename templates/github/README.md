# templates/github

push から本番までを到達形(アプリ側リポジトリの push が起点、Stage は常時稼働、
本番はタグ昇格 + 承認ゲート)に合わせて動かすための GitHub Actions の雛形。

固有名は書いていない。下の「プレースホルダの一覧」の山括弧を、採用先の値に置き換えて使う。
`templates/aws/`(OIDC ロール・ECR リポジトリ・SCP)と対になっているので、
AWS 側を先に(または並行して)入れる場合は `templates/aws/README.md` も読む。

## 中身とどのリポジトリに置くか

前提は 2 リポジトリ構成。**アプリ側リポジトリ(`<app-repo>`)がデプロイパイプラインの起点**、
**インフラ側リポジトリ(`<infra-repo>`)はスタック定義を持つ**(1 リポジトリで両方兼ねる場合は
`workflows/app/` と `workflows/infra/` の中身を 1 つの `.github/workflows/` にまとめ、
`actions/setup-aws` の checkout の要・不要をそれに合わせて調整する)。

```
workflows/
  app/                    <app-repo>/.github/workflows/ に置く
    ci.yml                PR と master push。決定的テスト(ビルド・単体)・E2E・イメージビルド(push しない)
    deploy-stage.yml       master push で起動。イメージを stage の ECR へ push → <infra-repo> を
                           checkout → cdk deploy → スモーク → 失敗ならロールバック
    promote-prod.yml       タグ v* の push で起動。production Environment の承認ゲート →
                           stage の ECR からダイジェスト指定で pull → prod へ push → cdk deploy
    security.yml            Trivy 3 段(fs / Dockerfile config / image)
    claude-review.yml       PR の差分レビュー(event=COMMENT 固定)
  infra/                  <infra-repo>/.github/workflows/ に置く
    ci.yml                 型チェック・テスト・cdk synth・生成テンプレートの非 ASCII 検査・Node 下限検査
    deploy-infra.yml        初期構築(手動、workflow_dispatch のみ)
    release-infra.yml       インフラ定義だけを変えるときの手動起動
    security.yml            Trivy 2 段(fs / 手書き IaC の config)
    claude-review.yml       app 側と同じ内容(採用先が別リポジトリなので複製してある)
actions/
  setup-aws/action.yml     <infra-repo> に置く複合アクション(Node 用意 + OIDC 認証)。
                           <app-repo> 側のワークフローは <infra-repo> を checkout したあと
                           `uses: ./<infra-repo>/.github/actions/setup-aws` の形で呼ぶ
scripts/
  check-node-version.mjs   <infra-repo>(または両方)の CI に置く、Node 下限表記の検査
dependabot.yml             <app-repo> と <infra-repo> の両方に置く(使わないブロックは削る)
```

## プレースホルダの一覧と置き換え方

すべて grep で見つけられる山括弧の形にしてある。

```bash
grep -rn '<[a-z-]*>' templates/github/
```

| プレースホルダ | 意味 |
|---|---|
| `<owner>` | GitHub の所有者(組織名またはユーザー名) |
| `<app-repo>` | アプリ側リポジトリ名 |
| `<infra-repo>` | インフラ側リポジトリ名(スタック定義を持つ) |
| `<project>` | ロール名・ECR リポジトリ名などの接頭辞に使う短い名前 |
| `<stack-name>` | CloudFormation / CDK のスタック名(prod 側。stage 側は `<stack-name>Stage` の形を想定) |
| `<aws-region>` | デプロイ先のリージョン |
| `<app-ecr-repo>` | アプリのイメージを置く ECR リポジトリ名(`templates/aws/ecr-repository.yaml` の `RepositoryName` と揃える) |

コマンドやパスは `<build command>` `<test command>` `<e2e command>` のような英語の
プレースホルダにしてある(参照実装での実例はコメントに「例:」として残してある)。
主なものを `workflows/app/ci.yml` から挙げる: `<build command>` `<test command>`
`<test report path>` `<build output path>` `<db image>` `<db port>` `<e2e setup command>`
`<app start command>` `<health check url>` `<healthy response marker>` `<e2e command>`
`<e2e report paths>`。`deploy-stage.yml` / `promote-prod.yml` の `<smoke test command>`
`<rollback command>` も同様。

## Variables / Secrets / Environments の一覧

Settings → Secrets and variables → Actions。ARN やレジストリのホスト名は秘密ではないので
Secrets ではなく Variables に置く(引き受けられるのは信頼ポリシーの `sub` に一致する
ジョブだけ)。値の作り方は `templates/aws/README.md` を参照。

### Environments

| 名前 | 保護ルール | 登録先 |
|---|---|---|
| `staging` | 無し | `<app-repo>` と `<infra-repo>` の両方 |
| `production` | required reviewers。Deployment branches and tags に `v*` を許可 | `<app-repo>` と `<infra-repo>` の両方 |

`<infra-repo>` にも同じ 2 つの Environment を作る理由: インフラ定義だけを変える
`release-infra.yml` / `deploy-infra.yml` は `<infra-repo>` 側から直接 `environment:` を
経由して OIDC ロールを引き受けるため。`templates/aws/github-oidc.yaml` の
`GitHubDeployRole` は、`<app-repo>` と `<infra-repo>` の両方の該当 Environment を信頼する
前提で作ってある。

### Variables

| 変数名 | 登録先 | 値 |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `<app-repo>` と `<infra-repo>` の両方、各 Environment(`staging` / `production`) | そのアカウントの `GitHubDeployRole` の ARN |
| `AWS_ECR_PUSH_ROLE_ARN` | `<app-repo>` のリポジトリ変数(Environment ではない) | stage アカウントの `GitHubEcrPushRole` の ARN |
| `AWS_REGION` | `<app-repo>` と `<infra-repo>` の両方、リポジトリ変数 | デプロイ先リージョン |
| `STAGE_ECR_REGISTRY` | `<app-repo>` の `production` Environment 変数 | `<stage アカウント ID>.dkr.ecr.<region>.amazonaws.com`(promote-prod.yml が stage から pull する先) |
| `PROD_ECR_REGISTRY` | `<app-repo>` の `production` Environment 変数 | `<prod アカウント ID>.dkr.ecr.<region>.amazonaws.com`(promote-prod.yml が prod へ push する先) |

`AWS_ECR_PUSH_ROLE_ARN` だけ Environment ではなくリポジトリ変数にする理由:
`deploy-stage.yml` の ECR push ジョブは `environment:` を宣言しない(信頼条件が
`ref:refs/heads/master` だけで、承認ゲートを経由しないため)。

### Secrets

| 名前 | 登録先 | 備考 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | `<app-repo>` と `<infra-repo>` の両方 | `claude` を起動して `/install-github-app` でしか登録できない(`claude setup-token` の出力を `gh secret set` に渡す経路は 401 になる) |
| `INFRA_REPO_TOKEN` | `<app-repo>` のみ | `deploy-stage.yml` / `promote-prod.yml` が `<infra-repo>` を checkout するための fine-grained PAT(Contents:Read)。`GITHUB_TOKEN` は別リポジトリには届かない |

## Ruleset の必須チェックにする名前

ジョブの `name:` がそのまま Required status checks の候補名になる。

- `<app-repo>`:「ビルドとテスト」「E2E(クリティカルパス)」「差分レビュー」
- `<infra-repo>`:「ビルドとテスト」「差分レビュー」

`security.yml` の Trivy(脆弱性スキャン / イメージの脆弱性スキャン / 手書き IaC の
設定不備)は必須チェックに**しない**。自分のコードの誤りではなく「世の中で新しく
見つかった脆弱性」で赤くなるため、マージそのものを止めると身動きが取れなくなる。

## 標準どおりにしない点(雛形のコメントに理由を残してある)

- Claude レビューはマージの門番にしない。`claude-review.yml` は `event="COMMENT"` 固定
- ECR へ push するロールは stage アカウントにしか作らない。`sub` は
  `ref:refs/heads/master` だけを信頼する(PR では引けない)
- prod へは、承認ゲートを通った後に prod 側のジョブが stage からダイジェスト指定で
  pull する(タグではなく中身の同一性で確かめる)。ビルドは master マージ後の
  1 回だけ(build once, deploy many)
- `release-infra.yml` に `confirm` 入力は足さない(課金の確認は `deploy-infra.yml` だけ)
- `app_ref`(壊れ方を注入する検証用の入力)は `deploy-stage.yml` だけが持つ。
  stage 専用で、`promote-prod.yml` には同じ入力を作らない

## 一般化の状態

- `workflows/` と `actions/` の YAML は、このリポジトリの `node .github/scripts/check.mjs`
  で構文と固有名の残留を検査している。**ワークフローの意味(存在しない action、入力の
  型)までは見ていない。** `templates/` はこのリポジトリの `.github/workflows/` の外に
  あるため GitHub 側の構文検査も掛からない。採用先で実際に走らせるまで「動く」とは
  言えない
- `scripts/deploy.mjs` / `scripts/release.mjs` / `scripts/lib/common.mjs` /
  `.github/scripts/check-infra-templates.mjs` は参照実装の分担をそのまま前提にした
  スクリプト名で、実体はここには無い。採用先で用意する
- Dockerfile・E2E・DB のようなアプリ固有の中身(`<build command>` 等の中身)は
  当然ここには無い。採用先のスタックに合わせて埋める

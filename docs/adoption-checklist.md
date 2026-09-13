# 新しいプロジェクトに入れるときの手順と確認項目

[pipeline.md](pipeline.md) の流れを新しいプロジェクトへ入れる順番。依存関係があるので、この順で入れる。
**それぞれ 1 本の PR にする**(既定ブランチの保護を先に入れるため)。

標準の優先順位([ci-cd/ecommerce-aws-github.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/ecommerce-aws-github.md))は
OIDC → アカウント分離 → build once → IaC → 既定ブランチ保護 → 承認ゲート → 自動ロールバック。ここでもその順に沿う。

**CI/CD の時間は実装ではなく検証に消える**
([time-goes-to-verification.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/time-goes-to-verification.md))。
実機でしか出ない欠陥は事前の丁寧さでは減らないので、**早い段階で 1 回だけまとめて**実機を通す(手順 6 の直後)。

---

## 0. 決めること(作業ではない)

- [ ] **stage を常時稼働にする**(月額の増分を受け入れる)。これが無いと手順 7 以降が成立しない
- [ ] 本番は手動起動と承認ゲートを残す
- [ ] リポジトリの境界: アプリ(`<app-repo>`)とインフラ(`<infra-repo>`)を分けるか、1 つにするか
  ([repository-boundaries.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/repository-boundaries.md)。
  「そのコードの検証は、相手の PR を止める必要があるか」で決める)。雛形は分けた前提
- [ ] [decisions.md](decisions.md) の「採用時に決めること」: スモーク失敗の通知先、CI 用 ECR の置き場、E2E の範囲、インフラ定義の自動反映の有無
- [ ] プレースホルダの値を決める: `<owner>` `<app-repo>` `<infra-repo>` `<project>` `<stack-name>` `<aws-region>` `<app-ecr-repo>`

## 1. AWS アカウントを分け、SCP を敷く

- [ ] Organizations で management / prod / stage の 3 アカウント。**management にワークロードを置かない**(SCP が効かない)
- [ ] `templates/aws/scp/` の 3 本を Workloads OU へ(手順は同ディレクトリの README)。**`FullAWSAccess` は外さない**
- [ ] 効いていることを**両方向で**確かめる: 未許可リージョンで `s3 mb` が Deny / 未許可リージョンで `sts get-caller-identity` が成功 / 許可リージョンで `ec2 describe-vpcs` が成功
- [ ] 手元は IAM Identity Center の SSO プロファイル。長期のアクセスキーを作らない

## 2. OIDC と ECR の土台(prod と stage でそれぞれ 1 回)

- [ ] `gh api users/<owner> --jq .id`(組織なら `orgs/<owner>`)、`gh api repos/<owner>/<repo> --jq .id` で数値 ID を取る(app と infra の両方)
- [ ] `cdk bootstrap` を手元から(デプロイロールに bootstrap の権限は与えない)
- [ ] `templates/aws/ecr-repository.yaml` を stage → prod の順に流す(stage 側には prod のデプロイロール ARN が要るので、実際は OIDC → ECR → OIDC の更新、の往復になる。同ディレクトリの README の順番に従う)
- [ ] `templates/aws/github-oidc.yaml` を prod と stage で流す。**`TargetEnvironment` を取り違えない**(片方のアカウントにもう片方の環境を信頼するロールができる)
- [ ] OIDC プロバイダはアカウントに 1 つ。別プロジェクトが先に作っていれば `CreateOidcProvider=false`。**そちらのスタックを destroy するとプロバイダごと消える**ことを両側の README に書く
- [ ] 出力の `DeployRoleArn` を両リポジトリの Environment 変数 `AWS_DEPLOY_ROLE_ARN` へ、stage の `EcrPushRoleArn` を `<app-repo>` のリポジトリ変数 `AWS_ECR_PUSH_ROLE_ARN` へ登録する(Secrets ではなく Variables でよい。ARN は秘密ではない)
- [ ] 信頼ポリシーを疑うときは、推測せず実物の `sub` を見る(`ACTIONS_ID_TOKEN_REQUEST_URL` からトークンを取り、payload の `sub` だけを出す使い捨てワークフロー。トークン本体は出さない)

## 3. GitHub 側の設定(両リポジトリ)

- [ ] Environment `staging`(保護ルールなし)と `production`(required reviewers。**Deployment branches and tags に `v*` を許可**)。
  Free プランでは private リポジトリに保護ルールを作れない(組織を Team にするか、public にする)
- [ ] Ruleset「既定ブランチ保護」: PR 必須、承認者 0 人、削除 / force push 禁止、bypass なし。
  必須チェックは決定的なものだけ(アプリ側「ビルドとテスト」「E2E(クリティカルパス)」「差分レビュー」/ インフラ側「ビルドとテスト」「差分レビュー」)。
  Trivy は入れない。**Free プランでは private リポジトリに Ruleset を作れない**
- [ ] **必須チェックは、`allow_auto_merge` を有効にするより先に Ruleset へ入れる。** 必須チェックが
  1 つも無い状態で auto-merge を有効にすると、PR がチェックの結果を待たずに即マージされる
  (採用先で実際に起きた)。チェック名は CI が一度も走っていなくても Ruleset に直接書ける
  (`name:` の文字列をそのまま入力する。候補一覧に出るのを待たなくてよい)ので、
  「4. CI を入れる」で CI の PR を出す前に、この Ruleset の設定を済ませておく
- [ ] `allow_auto_merge` を有効にする(同じく Free の private では使えない)
- [ ] Variables: `AWS_REGION`、`STAGE_ECR_REGISTRY` / `PROD_ECR_REGISTRY`(`<account>.dkr.ecr.<region>.amazonaws.com`)
- [ ] Secrets: `CLAUDE_CODE_OAUTH_TOKEN` は `/install-github-app` でしか登録できない(`claude setup-token` の出力を `gh secret set` する経路は 401)
- [ ] Secrets: `<app-repo>` に `INFRA_REPO_TOKEN`(`<infra-repo>` を checkout するための fine-grained PAT、Contents: Read だけ)。`GITHUB_TOKEN` は別リポジトリに届かない。期限が切れると stage への反映と本番昇格が両方止まるので、期限を控えておく
- [ ] `templates/github/dependabot.yml` を置く。**composite action のディレクトリは別項目として書かないと見てもらえない**

## 4. CI を入れる(PR 1 本目)

- [ ] `templates/github/workflows/app/ci.yml` / `security.yml` / `claude-review.yml` を `<app-repo>` へ、`infra/` の同名を `<infra-repo>` へ。プレースホルダを置換する(`grep -rn '<[a-z-]*>' .github/`)
- [ ] `templates/github/actions/setup-aws/` と `templates/github/scripts/check-node-version.mjs` を `<infra-repo>` へ
- [ ] E2E はクリティカルパスだけ。**並列しない・リトライしない**(不安定さを隠さない)
- [ ] PR で Docker イメージがビルドされること(push はしない)。Trivy の image スキャンがそのイメージを見ていること
- [ ] Node のバージョンは `.nvmrc` が正。ワークフローに直接書かない。文書に「Node N 以上」を書くなら下限に揃える(検査が止める)

## 5. 既定ブランチ push で stage の ECR へ push する(PR 2 本目)

- [ ] `templates/github/workflows/app/deploy-stage.yml` を置く。**この時点ではまだデプロイには使わない**(`cdk deploy` のジョブは無効にしておく)
- [ ] push できること、`security.yml` の image スキャンが **push したそのイメージ**(`image-ref` に ECR の URI)を見ていることを確かめる
- [ ] PR 時点のジョブが資格情報を取っていないことをログで確かめる

## 6. スタックを既存イメージ参照に変える(PR 3 本目)

- [ ] `<infra-repo>` のスタックを `DockerImageAsset` から `ecs.ContainerImage.fromEcrRepository`(コンテキスト `imageRef`。SHA タグ、または `sha256:` 始まりのダイジェスト)へ。CI のダミー Dockerfile が消える
- [ ] `release-infra.yml` にイメージ URI の入力を足し、手動起動のまま「CI が焼いたイメージで stage に出る」ことを確かめる
- [ ] デプロイスクリプトに「ECR に無ければ手元で焼いて push」を足す(初期構築用)
- [ ] **ここで一度、実機で Blue/Green が回ることを確かめる。** イメージの出所が変わるだけで、CI が緑でもデプロイでしか出ない失敗はある
  ([aws/fails-only-at-deploy.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/aws/fails-only-at-deploy.md))
- [ ] Blue/Green の 4 点: green のターゲットグループ / 切り替え点のリスナールール / `bakeTime` / `deploymentAlarms`。**どれか 1 つ欠けても synth は通る**。テストで本数を固定する

## 7. 既定ブランチ push で stage へ自動反映する(PR 4 本目)

- [ ] `deploy-stage.yml` の `cdk deploy` ジョブを有効にする
- [ ] スモークが落ちたときのロールバックを **Actions から** 一度流す(`app_ref` で壊したアプリを出す)。手元から流すと実行者の資格情報で通ってしまい、ロールの権限不足に気付けない
- [ ] 通知先が決まっていること(決まっていないなら、このステップを入れない)

**参照値(採用先で実測したもの。冒頭の「早い段階で 1 回だけまとめて実機を通す」の見積もりに使える。
アカウントの状態やスタックの規模で変わるので目安):**

- 手順 5〜7 の初回 stage 構築(VPC / RDS / ALB / CloudFront / ECS 一式が何も無い状態から): イメージ push 1 分 + `cdk deploy` 10 分
- 手順 7 のロールバック検証(サーキットブレーカー発動 → `UPDATE_ROLLBACK_COMPLETE` まで): 20 分
- 手順 9 の本番昇格(ダイジェスト指定でのコピー + 初回構築): 12 分

## 8. auto-merge を有効にする(設定変更)

- [ ] PR を開いたら auto-merge を有効にする運用。Dependabot の PR は対象外
- [ ] ここで初めて「push から stage まで人が押さない」になる

## 9. 本番の昇格をタグに変える(PR 5 本目)

- [ ] `templates/github/workflows/app/promote-prod.yml` を置く。`production` Environment にタグ `v*` を許可
- [ ] stage の ECR にリポジトリポリシー(prod のロールに pull)、prod のデプロイロールに ECR の identity ベース権限。**両アカウントでスタックの更新まで**(テンプレートを直しただけでは権限は変わらない)
- [ ] **入れた PR で、Actions から一度 prod まで通す。** ダイジェストが一致することをジョブ要約で確かめる
- [ ] `release-infra.yml` から `app_ref` の入力を外す(`deploy-stage.yml` へ移った)

## 10. 後片付け

- [ ] リリース用スクリプトのテスト再実行を外す(手元経路を残すならそこだけ)
- [ ] DORA の集計(デプロイ頻度・変更失敗率)が Actions の実行履歴を読めること。失敗の分類先を決める
- [ ] 両リポジトリの CLAUDE.md に「変更したら追従させるもの」を書く(OIDC テンプレートの更新は**スタックの更新まで**、IAM の説明文は ASCII、など)

---

## 採用のたびに踏む穴(参照実装で実測したもの)

| 症状 | 原因 | 対処 |
|---|---|---|
| 手元では通るのに Actions からだけ AccessDenied | 手元は管理者権限。ロールの権限不足は Actions でしか出ない | Actions から本物を流すまで「直った」と言わない |
| `simulate-principal-policy` が allowed なのに実物は拒否 | シミュレータは条件キーをサービスが実際に評価するかまで見ない。タグ条件は渡した値しか見ない | 実物のタグ(`list-role-tags`)と、実物の実行の両方で確かめる |
| IAM ロールをスタック名のタグで絞ったのに一致しない | CloudFormation の自動タグは IAM ロールに付かない。`iam:PassRole` はタグで絞れない(AWS が名指しで禁止) | ロール名を自分で決めて ARN で絞る。`iam:PassedToService` で閉じる |
| `ecs:ListTasks` / `RegisterTaskDefinition` が暗黙拒否 | リソースレベルの権限を持たない API | `Resource: *` にして条件キー(`ecs:cluster`)で絞る |
| ロールバックが「INACTIVE」で失敗する | Blue/Green では古いタスク定義のリビジョンが deregister される | 戻す先を番号ではなく中身で控えて登録し直す |
| CloudFormation が CREATE_FAILED(IAM) | IAM の説明文に日本語 | 説明は英語。検査(`check-infra-templates.mjs`)で止める |
| 別プロジェクトを destroy したら OIDC が通らなくなった | OIDC プロバイダはアカウントに 1 つで、先に作った側が持っている | 両側の README に書く。`CreateOidcProvider=false` で既存を指す |
| メトリクスが黙って 0、アラームが鳴らない | インフラ側のメトリクスフィルタがアプリのログ文字列を直接見ている | 数えるのは「アプリがログにしか出さない語」。両側の CLAUDE.md に相互参照 |
| 同じ SHA で別の中身が載った | ECR のタグが可変 | イミュータブル。同一性はダイジェストで |
| `docker build` の `COPY` が Permission denied で落ちる(CI の `chmod +x` は通っているのに) | `subtree` や zip 経由で取り込んだファイル(`mvnw` など)が git 上 100644(実行不可)のままで、`COPY` は git のファイルモードをそのままイメージへ持ち込む。CI ジョブ内で `chmod +x` してもそのジョブのファイルシステム上でしか効かず、リポジトリ側のモードには反映されない | `git update-index --chmod=+x <path>` でリポジトリ側の実行ビットを直してコミットする |
| ECS のタスクのログが CloudWatch Logs に出ない(ロググループが無い) | ロール名を固定するために `taskDefinition` を自分で用意して `ApplicationLoadBalancedFargateService` などの ecs_patterns construct に渡すと、`taskImageOptions` 経由の既定で付いていた awslogs のログ設定が付かなくなる | コンテナ定義で `logging: ecs.LogDrivers.awsLogs(...)` を明示する |

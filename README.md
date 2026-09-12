# cicd_playbook

push から本番までの CI/CD の型を、**次のプロジェクトにそのまま持ち込める形**でまとめたリポジトリ。

audio-shop-ec で設計した「push → CI → 自動マージ → stage 自動反映 → タグで本番昇格」の流れは、
今は 3 か所に分かれている。新しいプロジェクトを始めるたびに拾い集めることになるので、
その間に立つ「持ち込める実装」の置き場としてここを作った。

| 場所 | 中身 | 性格 |
|---|---|---|
| [development-strategy](https://github.com/cosugi-system-organization/development-strategy) の `ci-cd/` | 判断基準の記事(なぜそうするか)と Terraform 版の雛形 | 一般論。記事は「次のプロジェクトでも効く判断基準」を書く場所で、実装を置く場所ではない |
| [audio-shop-ec-cdk](https://github.com/cosugi-system-organization/audio-shop-ec-cdk) / [audio-shop-ec-mybatis](https://github.com/cosugi-system-organization/audio-shop-ec-mybatis) | 動いている実装(CDK スタック、workflow、スクリプト、OIDC テンプレート) | プロジェクト固有。スタック名・リポジトリ名・アカウントが埋め込まれている |
| **このリポジトリ** | 到達形の流れ、標準どおりにしない点と理由、採用手順、固有名を消した雛形 | **持ち込める実装** |

## 中身

```
docs/
  pipeline.md             到達形の流れ(push から本番まで)
  decisions.md            標準どおりにしない点と、その理由
  adoption-checklist.md   新プロジェクトに入れるときの手順と確認項目
templates/
  github/
    workflows/            ci / build-and-push / deploy-stage / promote-prod / release-infra / security / claude-review
    actions/setup-aws/    複合アクション(checkout → Node → npm ci → OIDC → 前提確認)
    scripts/              CI が md と workflow を検査するスクリプト
    dependabot.yml
  aws/
    github-oidc.yaml      OIDC プロバイダとデプロイロール(CloudFormation)
    scp/                  Organizations の SCP 3 本
```

`templates/` はコピーして固有名を置き換えて使う。置き換える場所は `<app-repo>` のような
山括弧のプレースホルダで書いてあり、CI(`.github/scripts/check-placeholders.mjs`)が
参照実装の固有名が残っていないことを見ている。

CDK の construct(Blue/Green + alarms)とデプロイスクリプトは、まだ一般化していない。
量が多く、採用先が 2 つ目になるまでは audio-shop-ec-cdk を参照実装として指すだけにしてある
([repository-boundaries.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/repository-boundaries.md):
一緒に変わるものだけを同居させる)。

## 採用の手順

`docs/adoption-checklist.md` に着手順と確認項目をまとめる(次の PR で入る)。
先に `docs/pipeline.md` で流れを、`docs/decisions.md` で「なぜ標準どおりにしないか」を読む。

## 参照実装

このリポジトリの雛形と文書は、次の実物から一般化した。雛形の中では固有名を書けないので、URL はここに集める。

| 実物 | 何を取ったか |
|---|---|
| [push-to-deploy-target-design.md](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/docs/push-to-deploy-target-design.md) | 到達形の全文。`docs/pipeline.md` の元 |
| [audio-shop-ec-cdk/.github/workflows](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/tree/master/.github/workflows) | ci / deploy / release / security / claude-review の実装 |
| [audio-shop-ec-mybatis/.github/workflows](https://github.com/cosugi-system-organization/audio-shop-ec-mybatis/tree/master/.github/workflows) | アプリ側の ci(E2E をゲートに載せる形)/ security(Trivy 3 段) |
| [setup-aws/action.yml](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/.github/actions/setup-aws/action.yml) | 複合アクション |
| [infra/github-oidc.yaml](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/infra/github-oidc.yaml) | OIDC プロバイダとデプロイロール。`sub` の形、権限を絞ったときに踏んだ穴 |
| [infra/scp](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/tree/master/infra/scp) | SCP 3 本と、効いていることの確かめ方 |
| [audio-shop-ec-cdk/CLAUDE.md](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/CLAUDE.md) | レビューで見るもの、Actions から動かすときの約束 |

## 判断基準

なぜそうするかは [development-strategy](https://github.com/cosugi-system-organization/development-strategy) の記事にある。
このリポジトリは記事を書き換えず、参照する。

| 記事 | 関係 |
|---|---|
| [ci-cd/ecommerce-aws-github.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/ecommerce-aws-github.md) | 標準の本体。優先順位(OIDC → アカウント分離 → build once → IaC → main 保護 → 承認ゲート → 自動ロールバック)、タグ昇格、Blue/Green、DORA |
| [ci-cd/repository-boundaries.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/repository-boundaries.md) | 何を同居させ、何を分けるか |
| [ci-cd/e2e-as-a-merge-gate.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/e2e-as-a-merge-gate.md) | E2E をゲートに載せる基準 |
| [ci-cd/dependency-updates-and-scanning.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/dependency-updates-and-scanning.md) | スキャンは必須にしない、Dependabot は Secret を読めない |
| [ci-cd/time-goes-to-verification.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/time-goes-to-verification.md) | CI/CD の時間は実装でなく検証に消える |
| [claude-code/reviewing-your-own-work.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/claude-code/reviewing-your-own-work.md) | 一人開発のレビュー 3 層 |
| [claude-code/where-to-write-knowledge.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/claude-code/where-to-write-knowledge.md) | ここで得た一般則は development-strategy へ、実装はここへ |

## このリポジトリの検証

```bash
node .github/scripts/check.mjs
```

リンク切れ、Node の下限表記の食い違い、YAML / JSON の構文、雛形に残った固有名の 4 つを見る。
ワークフローの意味(存在しない action など)までは見ないので、雛形は採用先で走らせるまで「動く」とは言えない。

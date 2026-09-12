# push から本番までの流れ(到達形)

「push したら自動テストと自動レビュー、通ったら自動マージ、マージしたら stage へ自動反映、
本番へはタグで昇格」を、GitHub Actions + AWS(ECS Fargate、CDK)で実装したときの流れ。
audio-shop-ec 向けに設計した到達形([元の設計文書](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/docs/push-to-deploy-target-design.md))から
プロジェクト固有の名前を消したもの。**なぜ標準どおりにしない点があるか**は [decisions.md](decisions.md)、
**新しいプロジェクトへ入れる手順**は [adoption-checklist.md](adoption-checklist.md)。

標準の根拠は development-strategy の
[ci-cd/ecommerce-aws-github.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/ecommerce-aws-github.md)
(優先順位、5 章パイプライン設計、12 章ロードマップ)。本文はそちらを読む。ここでは流れだけを書く。

---

## 登場するもの

| 名前 | 意味 |
|---|---|
| `<app-repo>` | アプリ本体のリポジトリ。Docker イメージの元。**パイプラインの起点はこちら** |
| `<infra-repo>` | インフラ定義(CDK)のリポジトリ。スタック定義とデプロイスクリプトを持つ。アプリ側のワークフローが checkout して使う |
| stage アカウント / prod アカウント | 別々の AWS アカウント。**常時稼働**(stage も)。行き先を決めるのは OIDC で引き受けるロールだけ |
| ECR リポジトリ `<app-ecr-repo>` | アプリのイメージ置き場。**各アカウントに 1 つ、アプリのスタックの外**に置く。タグはイミュータブル |
| Environment `staging` | `<app-repo>` と `<infra-repo>` の両方に作る。保護ルールなし(自動で通す) |
| Environment `production` | 同上。required reviewers あり。Deployment branches and tags でタグ `v*` を許可 |
| Ruleset | 既定ブランチへの直 push を禁止。PR 必須、必須チェックは決定的なものだけ、承認者数 0 |

前提は次の 2 つ。どちらも「決める」ことであって作業ではない。

- **stage は常時稼働にする。** 検証のときだけ立てる運用のまま push ごとに反映すると、環境がもう一組ぶん増えたのと同じ月額になる
- **本番は手動起動と承認ゲートを残す。** stage まで自動、本番は人が押す

---

## 全体像

```
feature ブランチ ──最初の push で PR──▶ PR 上で push ごとに
                                          ci.yml            決定的テスト / E2E(クリティカルパス) / イメージをビルド(push しない)
                                          security.yml      Trivy(必須チェックにしない)
                                          claude-review.yml 差分レビュー(コメントするだけ)
                                                │
                                   必須チェックが緑 → auto-merge(squash)
                                                │
                            既定ブランチへの push ──▶ deploy-stage.yml
                                                      イメージを焼き、SHA タグで stage の ECR へ push
                                                      <infra-repo> を checkout → staging のロール → cdk deploy(Blue/Green)
                                                      スモーク → 失敗なら退避した定義へロールバック
                                                │
                              stage で確認 → その SHA にタグ v* ──▶ promote-prod.yml
                                                      production の承認ゲートで止まる
                                                      承認後: stage の ECR からダイジェスト指定で pull → prod の ECR へ push
                                                      ダイジェスト一致を確認 → cdk deploy → スモーク
                                                      ビルドしない(stage に載ったものと同じイメージ)
```

---

## 1. 着手

1. 既定ブランチから feature ブランチを切る
2. **最初の push の時点で PR を開く。Draft にしない。**
   自動レビューは PR イベントでしか走らず、Draft のうちは走らない。
   PR を開かずに push しても何も起きないので、「push したら指摘が来る」は「PR 上の push」に限られる

## 2. PR 上の検証(push ごとに自動)

3. `ci.yml` が決定的なテストを流す
   - `<app-repo>`: ビルドと単体テスト、E2E(クリティカルパスだけ。基準は
     [e2e-as-a-merge-gate.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/e2e-as-a-merge-gate.md))
   - `<infra-repo>`: 型チェック、単体テスト、`cdk synth`、生成テンプレートの非 ASCII 検査、Node 下限の表記検査
4. **`<app-repo>` の `ci.yml` が Docker イメージをビルドする。PR の時点では ECR へ push しない。**
   PR で焼くのは検査(E2E の起動、Trivy のイメージスキャン)のため。
   ECR へ push するのは既定ブランチにマージされた後のジョブ(手順 11)で、そこで焼いたイメージに
   コミット SHA をタグに付け、以降そのまま stage、本番へ載る(build once, deploy many)。
   PR 時点で push しないのは、承認ゲートも Ruleset も通っていない段階で AWS へ書き込む経路を作らないため
5. `security.yml` が Trivy で依存と、手順 4 のイメージを検査する。**必須チェックにはしない**
   (自分の変更ではなく「世の中で新しく見つかった脆弱性」で赤くなる性質のもの。赤は「見て判断する合図」)。
   既定ブランチにマージした後に push したイメージも、同じジョブで `image-ref` に ECR の URI を指定してもう一度見る
6. `claude-review.yml` が差分をレビューして PR にコメントする。approve も request changes もしない
7. 指摘を直して再 push する。手順 3 から 6 が再び走る

## 3. マージ(自動)

8. Ruleset の必須チェックは決定的なものだけにする。
   「Claude が指摘を出したらマージを止める」はしない(理由は [decisions.md](decisions.md))
9. **PR を開いたら auto-merge を有効にする。** 必須チェックが全部緑になった時点で GitHub が squash マージする
10. **Dependabot の PR は auto-merge しない。** Secret が読めず Claude レビューがスキップされる
    (必須チェックは緑のまま)ので、目視で確認してからマージする

## 4. stage への反映(マージ契機で自動)

11. **`<app-repo>` の既定ブランチへの push で、`deploy-stage.yml` が起動する。**
    まずイメージを焼いてコミット SHA のタグで **stage アカウントの ECR** へ push する。
    このジョブが引き受けるのは ECR への push だけができるロールで、信頼するのは `ref:refs/heads/<default-branch>` の `sub` だけ。
    既定ブランチは Ruleset(PR 必須・必須チェック)を通らないと動かないので、
    **ECR への push は「CI が緑になった差分」に限られる**
12. 続けて `<infra-repo>` を checkout し、OIDC で `staging` Environment のデプロイ用ロールを引き受ける。
    `staging` には承認ゲートが無いので、ここで止まらない。
    手順 11 で push 済みのイメージ URI(`<registry>/<app-ecr-repo>:<sha>`)をコンテキストで渡して `cdk deploy` する。
    **テストは CI で済んでいるので再実行しない。Docker のビルドも走らない**
13. ECS のネイティブ Blue/Green で切り替える。bake time 中に `deploymentAlarms` が鳴れば ECS が自分で戻す
14. スモークテストを流し、失敗したら退避しておいたタスク定義へロールバックする。
    **戻す先はリビジョン番号ではなく中身で控える**(Blue/Green では古いリビジョンが deregister されるので、番号で戻す方式は成立しない)。
    スキーマ変更を含む回は戻さず、通知して止める
15. 結果をジョブ要約と、スタック出力の `AppCommit` に残す

## 5. 本番への昇格(手動)

16. stage で確認できたら、**`<app-repo>` のその SHA にタグ `v*` を打つ。**
    stage で検証されたのは `<app-repo>` 側のコミットで、ECR のイメージもその SHA をタグに持つので、タグを打つ先も `<app-repo>`。
    **本番昇格のワークフロー(`promote-prod.yml`)も `<app-repo>` に置く**(`on: push: tags: v*`)。
    `<infra-repo>` に置いたままでは、別リポジトリのタグ push では発火しないので繋がらない。
    ブランチや手入力の SHA で昇格させない(標準の 1 章「タグで昇格」)
17. `promote-prod.yml` が `production` Environment の承認ゲートで止まる。
    承認後に本番のロールを引き受け、**stage の ECR からダイジェスト指定で pull し、prod の ECR へ push してから**
    `<infra-repo>` を checkout して手順 12 から 15 と同じ処理を流す。
    ビルドはしない。stage に載ったものと同じイメージが載る。
    prod と stage は別アカウントで ECR はアカウントごとのリソースなので、「同じイメージ」は自動には成立しない。
    **同一性はタグではなくダイジェストで確かめる**(タグは付け替えられる)。`cdk deploy` にもダイジェスト(`@sha256:...`)で渡す

---

## インフラ定義だけを変えるとき

`<infra-repo>` のスタック定義だけを変える(アプリは変わらない)ときは、`<infra-repo>` 側の `release-infra.yml` を人が手動で起動する。
インフラ定義の変更は頻度が低く、`cdk diff` を人が見てから出したいことが多いので、**自動にしない**。
入力は環境(`prod` / `stage`)と `dry_run` だけで、`confirm` の文字入力は足さない
(同じ人が同じ画面で続けて打つだけで歯止めにならない。本番の歯止めは Environment の承認ゲートに寄せる)。

空のアカウントに一から作るときは `deploy-infra.yml`。ECR にイメージがまだ無い(鶏と卵)ので、
デプロイスクリプト側に「そのアカウントの ECR に指定 SHA のイメージが無ければ、手元で焼いて push する」工程を持たせる。
stage の初回はこれで、prod の初回は stage からのコピー(手順 17 と同じ経路)で埋める。
`deploy`(初期構築)と `release`(既に立っている環境へ反映)は、やり直しの安全性が違うので分けたままにする。

## わざと壊したアプリを stage へ出す(ロールバックの検証)

スモーク失敗時のロールバックが実際に効くかは、壊れたアプリを一度 stage へ出さないと確かめられない。
そのために `deploy-stage.yml` に `workflow_dispatch` の入力 `app_ref` を残す。指定した ref を焼いて
`test-` 接頭辞のタグで stage の ECR へ push してから stage に出す。

- **stage 専用。** `promote-prod.yml` には同じ入力を作らない
- **既定ブランチのワークフローとして起動し、焼く対象の ref は入力で受け取る。**
  OIDC の `sub` はワークフローを起動したブランチで決まるので、push ロールの信頼条件(`ref:refs/heads/<default-branch>` だけ)と衝突しない。
  逆に、壊れたブランチ側からワークフローを起動する形にしてはいけない(`sub` が変わって弾かれる。弾かれるのが正しい)
- 「PR 時点で push しない」原則の例外になるが、人が手動で起動し、stage だけ、タグで見分けがつく、の 3 点で許容する

---

## どのファイルがどこで動くか

| ファイル(`templates/github/workflows/` 配下) | 置く先 | 契機 |
|---|---|---|
| `app/ci.yml` | `<app-repo>` | PR、既定ブランチへの push |
| `app/security.yml` | `<app-repo>` | PR、既定ブランチへの push、毎週月曜 |
| `app/claude-review.yml` | `<app-repo>` | PR(Draft を除く) |
| `app/deploy-stage.yml` | `<app-repo>` | 既定ブランチへの push、`workflow_dispatch`(`app_ref`) |
| `app/promote-prod.yml` | `<app-repo>` | タグ `v*` の push |
| `infra/ci.yml` | `<infra-repo>` | PR、既定ブランチへの push |
| `infra/security.yml` | `<infra-repo>` | PR、既定ブランチへの push、毎週月曜 |
| `infra/claude-review.yml` | `<infra-repo>` | PR(Draft を除く) |
| `infra/deploy-infra.yml` | `<infra-repo>` | 手動(初期構築) |
| `infra/release-infra.yml` | `<infra-repo>` | 手動(インフラ定義だけの反映) |

AWS 側の土台(OIDC プロバイダ、デプロイロール、push ロール、ECR、SCP)は `templates/aws/` にあり、
**一度だけ手元から管理者資格情報で**流す。prod と stage で別アカウントなので、それぞれ 1 回ずつ。

## 記録と DORA

自動化するほど手元実行が減り、**Actions の実行履歴が正になる。** DORA の指標は
「デプロイ頻度」と「変更失敗率」の 2 つだけを数え、失敗は分類する(自分の変更が原因か、外部要因か)。
記録が Actions とリリースノートの 2 か所に割れるなら、集計で突き合わせる
(参照実装: [dora/README.md](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/dora/README.md))。

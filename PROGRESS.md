# 進捗メモ — cicd_playbook

このファイルはセッションや反復をまたぐ唯一の記憶。着手時に読み、作業の区切りと最終報告の前に更新する。
次のセッションがこのファイルだけで続きから始められる状態を保つ。

起点の引き継ぎ文書は `C:\AIの作業場\HANDOVER-cicd-standard-repo.md`(2026-09-13 作成。git 管理外)。
そこにある「1〜7 の進め方」のうち、このリポジトリの初回スコープは 1〜5(完了)。6〜7 は残課題。

## 目的

audio-shop-ec で設計した「push → CI → 自動マージ → stage 自動反映 → タグで本番昇格」の型を、
次のプロジェクトにそのまま持ち込める形(文書 3 本 + 固有名を消した雛形)で 1 リポジトリにまとめる。

## 完了条件

1. `node .github/scripts/check.mjs` が PASS する(手元と CI の両方) — 済
2. `docs/pipeline.md` を読めば、push から本番までの流れが固有名なしで分かる — 済
3. `docs/decisions.md` に「標準どおりにしない点」が根拠つきで載っている — 済
4. `docs/adoption-checklist.md` に、新プロジェクトへ入れる着手順と確認項目が載っている — 済
5. `templates/github/workflows/` に、参照実装から一般化した workflow が揃っている(app: ci / security / claude-review / deploy-stage / promote-prod、infra: ci / security / claude-review / deploy-infra / release-infra) — 済
6. `templates/aws/github-oidc.yaml` が app / infra の複数リポジトリを信頼できる形になっていて、SCP 3 本が写してある — 済
7. すべて PR 経由で master に入っている — 済。public 化後に Ruleset「master 保護」(PR 必須、必須チェック「検査」、削除 / force push 禁止、squash のみ)と auto-merge を有効化した

## 検証コマンド

```bash
node .github/scripts/check.mjs
```

`templates/aws/` を変えたら加えて `node templates/aws/scripts/check-infra-templates.mjs templates/aws`(IAM の説明文が ASCII か)。

## 前提(自分で決めたこと)

- リポジトリは `osidasi0005/cicd_playbook`(public、個人アカウント。Free プランで Ruleset を使うため同日 private から変更)。ローカルは `C:\AI_loop_engineer\cicd_playbook`。ユーザー指示(2026-09-13)
- 参照実装への導線は GitHub の URL(引き継ぎの `../` 相対参照は、兄弟ディレクトリに無いので使えない)。ユーザー指示
- 検証は Markdown / YAML の決定的な検査 4 つ(リンク切れ、Node 下限表記、YAML/JSON 構文、雛形の固有名)。`actionlint` は未導入なので入れない
- Node 下限の正は `package.json` の `engines.node`(参照実装の `common.mjs` に相当するものがここには無い)
- `templates/` に参照実装の固有名を書かない。CI で機械的に止める(一般化し忘れを人が読んで見つけるのは無理な量)
- 雛形は到達形(設計文書)を実装した形にした。今の参照実装のコピーではない(参照実装は到達形の手前)
- 未決事項のうち雛形で既定を置いたもの: stage 起動はアプリ側で完結(a 案)/ インフラ定義だけの変更は手動のまま / CI 用 ECR は stage アカウント / 同一性はダイジェスト突き合わせと `cdk deploy` へのダイジェスト渡しの両方
- `STAGE_ECR_REGISTRY` / `PROD_ECR_REGISTRY` は app 側の `production` Environment 変数。stage デプロイは ECR ログインが返すレジストリを使う
- ECR push ロールには同じリポジトリの pull(`BatchGetImage` / `GetDownloadUrlForLayer`)も持たせる(security.yml の image-scan が push 済みの実物を読むため)
- CDK construct とスクリプトの一般化(引き継ぎの 6)、audio-shop-ec への適用(7)は今回やらない

## 進捗

### 2026-09-13

**やったこと**
- PR #1 箱: 検査スクリプト 4 本 + check.mjs、CI(ジョブ名「検査」)、Dependabot、CLAUDE.md、PROGRESS.md
- PR #2 docs 3 本: pipeline / decisions / adoption-checklist
- PR #4 AWS 雛形: github-oidc.yaml(app / infra 信頼 + stage 専用 ECR push ロール + prod だけ ECR 権限)、ecr-repository.yaml、SCP 3 本、check-infra-templates.mjs(js-yaml 4 系)
- PR #5 GitHub 雛形: workflows app 5 本 / infra 5 本、setup-aws、check-node-version.mjs、dependabot.yml、README。あわせて README・AWS 側 README・adoption-checklist の整合

**分かったこと**
- 個人アカウントの Free プランでは、private リポジトリに Ruleset も auto-merge も作れない(403 / 設定が false のまま)。ユーザーが public に変更し、その後は両方作れた(同日)
- Dependabot が初日に js-yaml 4 → 5 のメジャー更新(PR #3)を出した。5 系は `yaml.Type` / `DEFAULT_SCHEMA.extend` の API が変わり、検査スクリプトが落ちる(CI が赤)。マージしていない
- 検証コマンドを `| tail -1` で切ると終了コードが隠れる。チェーンでは直接実行する
- security.yml の image-scan は deploy-stage の push と競走する(同じ master push で起動)。雛形にはコメントで注意を書き、確実にするなら後続ジョブへ移す

**次にやること**
- 引き継ぎの 7(audio-shop-ec への適用)。着手順は `docs/adoption-checklist.md`。stage を立て直すところから(2026-09-13 時点で 3 アカウントとも稼働リソースなし)

**費用・所要**
- AWS 雛形(Sonnet サブエージェント): 140k トークン、25 ツール呼び出し、約 8 分
- GitHub 雛形(Sonnet サブエージェント): 230k トークン、57 ツール呼び出し、約 16 分
- 指揮役(Fable 5.1)は docs 3 本と箱を自分で書き、雛形 2 系統をレビュー(修正 5 点)

## 採用 1: record_shop_ec_mono(引き継ぎの 7)

対象はユーザー決定(2026-09-13)で `osidasi0005/record_shop_ec_mono`(public、main、モノレポ: mybatis / cdk / docs / spec / tests)。
ローカルは `C:\AIの作業場\record_shop_ec_mono`。AWS は audio-shop と同じ prod / stage アカウント(SSO `audio-prod` / `audio-stage`)。

**決めたこと(ユーザー)**: 検証のあいだだけ立てて終わったら destroy / 通知は Actions のメール / Blue/Green は今回入れない(案 B。ローリング更新 + サーキットブレーカー)/ Claude レビューは workflow だけ置きトークン登録は後で。
**制約**: 手元の AWS CLI は `amazon/aws-cli` コンテナ。読み取りは通るが **CloudFormation deploy などの書き込みは自動モードの分類器に拒否される** → ユーザーが実行する(コマンドは `C:\AIの作業場\record-shop-ec-aws-commands.md`、手順は `record-shop-ec-cdk/infra/README.md`)。

### 2026-09-13(深夜)

**やったこと**
- GitHub 設定: Ruleset「main 保護」(必須チェック 4 つ: ビルドとテスト / インフラのビルドとテスト / イメージをビルドする(push しない) / 差分レビュー)、Environments `staging` / `production`(承認者 osidasi0005、`v*` と `main` を許可)、auto-merge
- PR #1 CI 一式(ci / security / claude-review / dependabot / CLAUDE.md / .nvmrc)。必須チェックが無い状態で auto-merge したため即マージされた(以後は必須チェックあり)
- PR #6 cdk の作り直し(env で prod / stage、`imageRef` で ECR 参照、サーキットブレーカー、ロール名固定、awslogs、タグ、jest 15 件)と `infra/`(OIDC + ECR のテンプレートを埋めたもの)。mvnw の実行ビット(Docker ビルドが Permission denied で落ちた)
- AWS: 両アカウントの OIDC プロバイダと bootstrap(v32)は済み。record-shop のリソースは未作成

**分かったこと(雛形へ戻すもの)**
- モノレポでは別リポジトリの checkout とトークンが要らず、OIDC の sub も app 側の 2 つだけでよい。雛形にモノレポの読み替えを 1 節足す
- スタック側は `imageUri`(フル URI)より `imageRef`(タグまたはダイジェスト)+ `fromEcrRepository` の方がよい。実行ロールに pull 権限が自動で付き、ダイジェストも自動判別される。雛形の deploy-stage / promote-prod のコンテキスト名を合わせる
- タスク定義を自作にすると ecs_patterns の既定 awslogs が消える。construct 化(6)のときの注意点
- Ruleset の必須チェックは CI の PR より先に入れないと、auto-merge が即マージする(必須チェック名は CI が一度走らないと候補に出ないが、名前を直接書けば先に入れられる)
- git の実行ビット: subtree で取り込んだ mvnw が 100644 のままで、Docker の COPY には CI の chmod が効かない
- Trivy: alpine の openssl / libexpat と netty に HIGH / CRITICAL(修正版あり)。必須チェックにしていないので止まらない。Dependabot の PR で上がる分はユーザーが目視でマージ

### 2026-09-13(朝)— 端から端まで実機で通った

**やったこと**
- AWS の 4 回(ECR prod → OIDC prod → OIDC stage → ECR stage)はユーザーが実行。出力の ARN と Variables(`gh api` で登録)が一致することを確認
- PR #7 deploy-stage / promote-prod / setup-aws をマージ → 初回は setup-aws の絶対パスで落ちた(PR #10 で相対パスに修正)→ 再実行で **stage 構築成功**(push 1 分 + deploy 10 分、`/actuator/health` UP)
- ロールバック検証: 壊したイメージ(起動直後に exit 1)を `workflow_dispatch` の `app_ref` で出す → ECS サーキットブレーカー発動 → `UPDATE_ROLLBACK_COMPLETE` → 元のイメージで稼働継続(20 分)
- タグ `v0.1.0` → production の承認(ユーザー)→ stage からダイジェスト指定で pull → prod へ push → **ダイジェスト一致** → prod 構築 → UP(12 分)。prod の `v0.1.0` と stage の SHA タグは同一ダイジェスト
- Dependabot: PR #2/#5/#3(rebase 後)をマージ、#4(MyBatis major)は閉じて #8 で ignore
- 文書の追従(mono PR #11)、雛形への戻し 8 点(このリポジトリ、下の PR)

**分かったこと(雛形へ戻したもの)**
- `actions/setup-node` の `node-version-file` は作業ディレクトリからの相対で解決され、絶対パスは二重になる → setup-aws は `infra-dir` 入力(既定 `.`)からの相対に
- `imageUri` より `imageRef` + `fromEcrRepository`(pull 権限が自動、ダイジェスト自動判別)
- 必須チェックは auto-merge より先に Ruleset へ(無いと即マージ)/ subtree 取り込みの `mvnw` は 100644 で Docker COPY に効かない / タスク定義自作で awslogs が消える / モノレポの読み替え / 実測値 3 つ

**片付け(同日)**
- stage と prod を `npx cdk destroy <スタック名> --context env=<env> --context imageRef=x --profile <profile>` で削除(手元の CDK + SSO で通った。自動モードの拒否は出なかった)。両方 `DELETE_COMPLETE`
- 2 つを同時に流すと `cdk.out` の synth ロックで片方が動かない(終了コード 0 で「Another CLI is currently synthing」)。`--output` を分けるか直列にする
- 残っているのは ECR(イメージ数枚)、OIDC ロール 2 スタック、CDKToolkit。稼働課金なし。ECR は次の採用でそのまま使える

**残り**
- `CLAUDE_CODE_OAUTH_TOKEN` の登録(`/install-github-app`。ユーザー)。登録するまで差分レビューはスキップ(緑)
- Blue/Green とアラームは未導入(案 B)。6(construct 化)で持ち込む

**費用・所要**
- サブエージェント(Sonnet): CI 一式 139k / cdk 作り直し 136k / deploy-stage 等 99k / 文書追従 130k / 雛形への戻し 148k トークン。調査(Haiku)80k
- AWS: stage と prod を立てている間、1 環境あたり月 60〜90 ドル相当の日割り

## 残課題

- js-yaml は 4 系に留めている(`dependabot.yml` で major を ignore。PR #3 はユーザー指示で閉じた)。5 系へ上げるなら検査スクリプト 2 本の移行作業として別に計画する
- **順番は 7 → 6**(ユーザー決定、2026-09-13)。6 は 7 で動いた形を切り出す
- 引き継ぎの 7: **済**(採用先は audio-shop-ec ではなく record_shop_ec_mono。上の「採用 1」)。audio-shop-ec への適用は別件として未着手(cdk / mybatis の 2 リポジトリ構成なので、雛形の 2 リポジトリ前提をそのまま使う形になる)
- 引き継ぎの 6: CDK の Blue/Green + alarms を construct に切り出す / スクリプトの固有値を設定ファイルへ。**7 の後**。置き方は npm パッケージではなく `templates/cdk/` にコピーして使うファイルから始める
- 雛形は実際に走らせていない(構文と固有名の検査だけ)。`actionlint` を入れると意味の検査が少し増える
- ECR の prod 側タグ(`v*`)は immutable なので、promote-prod を同じタグで再実行したときに push が通るか(同じダイジェストなら通るはず)は実機で確認する
- 未決事項(採用時に決める): スモーク失敗の通知先 / インフラ定義の自動反映 / 共有用アカウントの要否

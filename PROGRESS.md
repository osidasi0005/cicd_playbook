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
7. すべて PR 経由で master に入っている — 済(ただし Ruleset は Free プランの private リポジトリでは作れず、直 push は機械的には止まっていない)

## 検証コマンド

```bash
node .github/scripts/check.mjs
```

`templates/aws/` を変えたら加えて `node templates/aws/scripts/check-infra-templates.mjs templates/aws`(IAM の説明文が ASCII か)。

## 前提(自分で決めたこと)

- リポジトリは `osidasi0005/cicd_playbook`(private、個人アカウント)。ローカルは `C:\AI_loop_engineer\cicd_playbook`。ユーザー指示(2026-09-13)
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
- 個人アカウントの Free プランでは、private リポジトリに Ruleset も auto-merge も作れない(403 / 設定が false のまま)。public にするか Pro にするかはユーザー判断
- Dependabot が初日に js-yaml 4 → 5 のメジャー更新(PR #3)を出した。5 系は `yaml.Type` / `DEFAULT_SCHEMA.extend` の API が変わり、検査スクリプトが落ちる(CI が赤)。マージしていない
- 検証コマンドを `| tail -1` で切ると終了コードが隠れる。チェーンでは直接実行する
- security.yml の image-scan は deploy-stage の push と競走する(同じ master push で起動)。雛形にはコメントで注意を書き、確実にするなら後続ジョブへ移す

**次にやること**
- 引き継ぎの 7(audio-shop-ec への適用)。着手順は `docs/adoption-checklist.md`。stage を立て直すところから(2026-09-13 時点で 3 アカウントとも稼働リソースなし)

**費用・所要**
- AWS 雛形(Sonnet サブエージェント): 140k トークン、25 ツール呼び出し、約 8 分
- GitHub 雛形(Sonnet サブエージェント): 230k トークン、57 ツール呼び出し、約 16 分
- 指揮役(Fable 5.1)は docs 3 本と箱を自分で書き、雛形 2 系統をレビュー(修正 5 点)

## 残課題

- Ruleset / auto-merge が無い(Free の private)。public 化か Pro か、当面は PR 運用を手で守る
- js-yaml は 4 系に留めている(`dependabot.yml` で major を ignore。PR #3 はユーザー指示で閉じた)。5 系へ上げるなら検査スクリプト 2 本の移行作業として別に計画する
- 引き継ぎの 6: CDK の Blue/Green + alarms を construct に切り出す / スクリプトの固有値を設定ファイルへ(2 つ目の採用先ができてから)
- 引き継ぎの 7: 最初の採用先として audio-shop-ec に適用する(実機検証込み。これをやらないと docs と雛形は机上のまま)
- 雛形は実際に走らせていない(構文と固有名の検査だけ)。`actionlint` を入れると意味の検査が少し増える
- ECR の prod 側タグ(`v*`)は immutable なので、promote-prod を同じタグで再実行したときに push が通るか(同じダイジェストなら通るはず)は実機で確認する
- 未決事項(採用時に決める): スモーク失敗の通知先 / インフラ定義の自動反映 / 共有用アカウントの要否

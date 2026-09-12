# 進捗メモ — cicd_playbook

このファイルはセッションや反復をまたぐ唯一の記憶。着手時に読み、作業の区切りと最終報告の前に更新する。
次のセッションがこのファイルだけで続きから始められる状態を保つ。

起点の引き継ぎ文書は `C:\AIの作業場\HANDOVER-cicd-standard-repo.md`(2026-09-13 作成。git 管理外)。
そこにある「1〜7 の進め方」のうち、このリポジトリの初回スコープは 1〜5。6〜7 は残課題。

## 目的

audio-shop-ec で設計した「push → CI → 自動マージ → stage 自動反映 → タグで本番昇格」の型を、
次のプロジェクトにそのまま持ち込める形(文書 3 本 + 固有名を消した雛形)で 1 リポジトリにまとめる。

## 完了条件

1. `node .github/scripts/check.mjs` が PASS する(手元と CI の両方)
2. `docs/pipeline.md` を読めば、push から本番までの流れが固有名なしで分かる
3. `docs/decisions.md` に「標準どおりにしない点」が根拠つきで載っている
4. `docs/adoption-checklist.md` に、新プロジェクトへ入れる着手順と確認項目が載っている
5. `templates/github/workflows/` に、参照実装から一般化した workflow が揃っている(ci / build-and-push / deploy-stage / promote-prod / release-infra / security / claude-review)
6. `templates/aws/github-oidc.yaml` が app / infra の複数リポジトリを信頼できる形になっていて、SCP 3 本が写してある
7. すべて PR 経由で master に入っている(Ruleset で直 push を止める)

## 検証コマンド

```bash
node .github/scripts/check.mjs
```

## 前提(自分で決めたこと)

- リポジトリは `osidasi0005/cicd_playbook`(private、個人アカウント)。ローカルは `C:\AI_loop_engineer\cicd_playbook`。ユーザー指示(2026-09-13)
- 参照実装への導線は GitHub の URL(引き継ぎの `../` 相対参照は、兄弟ディレクトリに無いので使えない)。ユーザー指示
- 検証は Markdown / YAML の決定的な検査 4 つ(リンク切れ、Node 下限表記、YAML/JSON 構文、雛形の固有名)。`actionlint` は未導入なので入れない
- Node 下限の正は `package.json` の `engines.node`(参照実装の `common.mjs` に相当するものがここには無い)
- `templates/` に参照実装の固有名を書かない。CI で機械的に止める(一般化し忘れを人が読んで見つけるのは無理な量)
- CDK construct とスクリプトの一般化(引き継ぎの 6)、audio-shop-ec への適用(7)は今回やらない

## 進捗

### 2026-09-13

**やったこと**
- 雛形を配置し、箱(package.json / .nvmrc / 検査スクリプト 4 本 + check.mjs / CI / Dependabot / README / CLAUDE.md)を作った

**分かったこと**
- 個人アカウントの `plan` は API で null。private リポジトリで Ruleset が作れるかは作ってみるまで分からない

**次にやること**
- リポジトリ作成、Ruleset、PR 1(箱)
- docs 3 本(PR 2、3)
- workflow 雛形(PR 4、Sonnet のサブエージェント)、OIDC / SCP(PR 5、Sonnet のサブエージェント)

**費用・所要**
- (サブエージェントを使ったら、返ってくるトークン数・所要・モデルを 1 行で)

## 残課題

- 引き継ぎの 6: CDK の Blue/Green + alarms を construct に切り出す / スクリプトの固有値を設定ファイルへ(2 つ目の採用先ができてから)
- 引き継ぎの 7: 最初の採用先として audio-shop-ec に適用する(実機検証込み。これをやらないと 2〜5 は机上のまま)
- 未決事項(採用時に決める): stage 起動をアプリ側で完結させるか中継するか / cdk 側の変更を stage へ自動で出すか / スモーク失敗の通知先 / prod へコピーしたイメージの同一性の確かめ方 / CI 用 ECR の置き場

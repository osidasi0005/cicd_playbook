# cicd_playbook の開発ルール

このプロジェクトの Claude Code 向け設定。PC 全体のルール(`~/.claude/CLAUDE.md`、loop_engineer 由来)に加えて適用する。

push から本番までの CI/CD の型を、次のプロジェクトへ持ち込める形でまとめたリポジトリ。
何のためにあるかと参照先は `README.md`、進捗と残課題は `PROGRESS.md`。

## 検証コマンド(これだけが真実)

```bash
node .github/scripts/check.mjs
```

変更のあとは必ずこれを実行し、PASS を確認してから完了とする。「できました」だけでは完了扱いにしない。
初回は `npm install` で `js-yaml` を入れる(Windows の実行ポリシーが Restricted なら `npm.cmd install`)。

検査の中身(足したら `.github/scripts/check.mjs` の一覧とここを更新する):

1. `check-links.mjs` — Markdown の相対リンクが実在する。**外部 URL は見ない**ので、参照実装の URL を変えたら手でたどる
2. `check-node-version.mjs` — 「Node N 以上」の表記が `package.json` の `engines.node` と揃っている。
   **文書にバージョンを書かないのが第一の手**。書くなら下限に揃える
3. `check-yaml.mjs` — `.github/` と `templates/` の YAML / JSON が読める。ワークフローに `on` / `jobs`、composite action に `runs` がある
4. `check-placeholders.mjs` — `templates/` に参照実装の固有名(audio-shop-ec / mybatis / 所有者名 / 12 桁のアカウント ID)が残っていない

## 進捗メモ

- `PROGRESS.md` がセッションや反復をまたぐ唯一の記憶。着手時に読み、作業の区切りと最終報告の前に更新する
- 完了条件、自分で決めた前提、残課題は会話ではなく `PROGRESS.md` に書く

## このリポジトリでの約束

- **`templates/` に固有名を書かない。** 置き換える場所は `<app-repo>` `<infra-repo>` `<stack-name>` のような山括弧のプレースホルダにする。
  参照実装へ言及するときは「参照実装」と書き、URL は `README.md` に集める(CI が固有名を止める)
- **`templates/` のワークフローはここでは実行されない。** `.github/workflows/` の外にあるので GitHub の構文検査も掛からない。
  雛形を変えたら、少なくとも `check-yaml.mjs` が通ることを確かめ、意味の検証は採用先で走らせるまで済んでいないと書く
- **判断基準の記事(development-strategy)は書き換えず参照する。** ここで得た一般則は development-strategy へ、実装はここへ
  ([where-to-write-knowledge.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/claude-code/where-to-write-knowledge.md))
- **文書の主張は実物で裏を取ってから書く。** 参照実装の設定(Environment の保護ルール、auto-merge の有効無効、必須チェック)は
  `gh api` と実ファイルで確かめる。自動レビューは「文書が実物と矛盾していないか」を突いてくる
- **参照実装への導線は GitHub の URL で書く**(`../` の相対パスは使わない。このリポジトリは参照実装と兄弟ディレクトリに無い)
- 1 本ずつ PR にする。チェックが緑になったらマージし、自動レビューの残りの指摘は追補 1 本にまとめる
- 依存パッケージは検査に要るものだけ(今は `js-yaml`)。雛形の動作に依存を足さない

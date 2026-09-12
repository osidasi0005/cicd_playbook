# 標準どおりにしない点と、その理由

[pipeline.md](pipeline.md) の流れは、標準([ci-cd/ecommerce-aws-github.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/ecommerce-aws-github.md))を
そのまま実装したものではない。**一人開発**、**アプリとインフラが別リポジトリ**、**prod と stage が別 AWS アカウント**という
前提から、標準どおりにしない(できない)点がいくつかある。ここにはその結論と根拠だけを書く。
本文は [元の設計文書](https://github.com/cosugi-system-organization/audio-shop-ec-cdk/blob/master/docs/push-to-deploy-target-design.md) の 2〜4 章。

**採用先の前提が違えば、ここの結論も変わる。** 各項目に「前提」を書いてあるので、当てはまらなければ標準に戻す。

---

## 一覧

| # | 決めたこと | 前提 |
|---|---|---|
| 1 | Claude レビューはマージの門番にしない | 一人開発、AI レビューを使う |
| 2 | パイプラインの起点はアプリ側リポジトリ | アプリとインフラが別リポジトリ |
| 3 | ECR へ push するロールは stage アカウントにだけ、`sub` は既定ブランチだけ | prod と stage が別アカウント |
| 4 | prod への届け方は「承認後に prod 側が stage から pull」 | 同上 |
| 5 | ECR リポジトリはアプリのスタックの外、タグはイミュータブル | 環境を destroy する運用がある |
| 6 | 初期構築は「ECR に無ければ手元で焼いて push」 | build once と、空のアカウントからの再構築を両立する |
| 7 | `app_ref`(わざと壊したアプリを stage へ出す)は stage 専用の手動入力として残す | ロールバック検証を実機で行う |
| 8 | リリース用スクリプトのテスト再実行は外す | 起点が「CI を通った既定ブランチ」に限られる |
| 9 | インフラ定義だけの変更は自動で出さない | 頻度が低く、diff を人が見たい |
| 10 | 脆弱性スキャンは必須チェックにしない | (標準どおり。念のため) |

---

## 1. Claude レビューはマージの門番にしない

`claude-review.yml` は `event="COMMENT"` 固定で、approve も request changes もしない。
Ruleset の必須チェックに入れるのは「レビューが実行できたか」であって、指摘の有無ではない。

「Claude が OK と言ったら自動マージ」にすると、次の 3 つに当たる。

- **同じ差分でも結果が揺れる。** 決定的でないものをゲートにすると、「たまたま通った」「たまたま止まった」が起きる
  ([reviewing-your-own-work.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/claude-code/reviewing-your-own-work.md))
- **PR の本文やコード内の文章で誘導される余地がある。** 差分そのものが入力なので、レビューを黙らせる文章を差分に含めることができる
- **一人開発では人間の承認を必須にできない。** GitHub は自分の PR を自分で承認できない。
  Ruleset の承認者数を 1 人にすると、自分の PR がマージできなくなる

だから通す判断は決定的テストに任せ、Claude は「読んで判断する材料」のままにする。
どうしても機械的に効かせたいなら、`[要修正]` が付いたときだけジョブを落とす「ブロック方向にだけ効く」形に限る。それでも上の 1 つ目と 2 つ目は残る。

**前提が変わるとき:** チーム開発で人間の承認を必須にできるなら、標準どおり「決定的テスト + 人間の承認」でよい。それでも AI レビューは助言に留める。

## 2. パイプラインの起点はアプリ側リポジトリ

変更の大半はアプリ側で起きる。**アプリの既定ブランチにマージしても、インフラ側のワークフローは何も知らない**
(別リポジトリのタグ push や既定ブランチへの push では発火しない)。
標準の型でも、アプリのリポジトリがデプロイパイプラインを持つ。インフラのリポジトリはインフラ定義の変更を反映するためのもので、
アプリの変更のたびに触るものではない。

だから `deploy-stage.yml` と `promote-prod.yml` は `<app-repo>` に置き、そこから `<infra-repo>` を checkout して `cdk deploy` する。
Environment(承認ゲート)も `<app-repo>` 側に作る。

**採らなかった案:** `<app-repo>` から `repository_dispatch` を投げて `<infra-repo>` 側のワークフローが受ける。
インフラ側のスクリプトと OIDC の設定をそのまま使えるが、**承認ゲートをインフラ側で通す形になり、投げる側にインフラ側リポジトリへの書き込みトークンが要る**。

これは [repository-boundaries.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/repository-boundaries.md) の
「一緒に変わるものを分けた」形の一つ。**全面統合はせず、起点だけをアプリ側へ移す。**

**前提が変わるとき:** アプリとインフラが同じリポジトリなら、この項目は消える。

## 3. ECR へ push するロールは stage アカウントにだけ、`sub` は既定ブランチだけ

デプロイ用ロールは `environment:staging` / `environment:production` の `sub` だけを信頼する
(ワイルドカードにしない。`environment:*` にすると、承認ゲートの無い Environment を作るだけで本番ロールを引ける)。

ECR へ push するジョブは Environment を通らない。**例外を作る以上、範囲を狭める。**

- **信頼する `sub` は `ref:refs/heads/<default-branch>` だけ。`pull_request` は信頼しない。**
  PR を開いただけで AWS へ書き込める経路にはしない。既定ブランチへの push は Ruleset を通らないと起きないので、
  ECR への push は「CI が緑になった差分」に限られる。PR 時点のジョブはイメージを焼いて検査するだけで、資格情報を取らない
- **権限は ECR の 1 リポジトリへの push だけ。** それ以外(CloudFormation・ECS・Secrets Manager)は一切付けない
- **ECR リポジトリはタグをイミュータブルにする。** push ロールが漏れても「検証済みの SHA と同じタグで別の中身を置く」ことはできない

**このロールは stage アカウントにしか作らない。** prod の ECR への push 権限を Environment を通らないジョブに持たせると、
「承認ゲートの無い経路から本番のロールを引けないようにする」設計が崩れる。

それでも「PR を通せば stage の ECR に書ける」こと自体は残る。stage への自動反映を入れると決めた時点で受け入れる性質のもので、
**受け入れるのは stage アカウントまで**、が線引き。

## 4. prod への届け方は「承認後に prod 側が stage から pull」

prod と stage は別アカウントで、ECR はアカウントごとのリソース。「同じイメージ」は自動には成立しない。

承認後に prod 側のジョブが、stage の ECR から**ダイジェスト指定で pull**し、prod の ECR へ push してからデプロイする。
**stage 側は読まれるだけ、prod 側は自分で書く。** 同一性はタグではなくダイジェストで確かめる(タグは付け替えられる)。

**採らなかった案(どちらも「承認前に本番へ書き込む経路」を作る):**

- CI から両アカウントへ直接 push する
- ECR のレプリケーションで stage から prod へ自動複製する

**このコピーには権限が 2 か所要る。片方だけでは通らない。**

- **stage 側**: ECR のリポジトリポリシーで prod のデプロイ用ロールに pull(`BatchGetImage` / `GetDownloadUrlForLayer` / `BatchCheckLayerAvailability`)を許可する
- **prod 側**: デプロイ用ロールに identity ベースで `ecr:GetAuthorizationToken`(リソースポリシーでは代替できない)、
  stage のリポジトリ ARN への pull、prod のリポジトリ ARN への push を足す

手元は管理者権限で通ってしまうので、この種の漏れは Actions からの本番昇格で初めて出る
([aws/iam-scoping-only-fails-in-ci.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/aws/iam-scoping-only-fails-in-ci.md))。
**入れた PR で、Actions から一度 prod まで通す。**

## 5. ECR リポジトリはアプリのスタックの外、タグはイミュータブル

- destroy で消えると、再構築のたびに ECR が空になる(初回の `cdk deploy` がタスクを起動できずに詰まる)
- イミュータブルにしないと、検証済み SHA と同じタグで別の中身を置ける

`templates/aws/ecr-repository.yaml` を、OIDC のテンプレートと同じく「一度だけ手元から」流す。`cdk bootstrap` と同列の前準備。

## 6. 初期構築は「ECR に無ければ手元で焼いて push」

空のアカウントでは、スタックが参照するイメージがまだ ECR に無い(鶏と卵)。
デプロイスクリプトに「そのアカウントの ECR に指定 SHA のイメージが無ければ、手元で焼いて push する」工程を足す
(既存の「済んでいれば飛ばす」の一つとして)。stage の初回はこれで、prod の初回は stage からのコピー(4 と同じ経路)で埋める。

**採らなかった案:** 初期構築のときだけ `cdk deploy` の中でイメージを焼く(`DockerImageAsset`)。
「初回だけ別の出所のイメージが載る」ので build once が初回に限って崩れる。

`deploy`(初期構築)と `release`(既に立っている環境へ反映)の分離は変えない。やり直しの安全性が違う。

## 7. `app_ref` は stage 専用の手動入力として残す

スモーク失敗時のロールバックが効くかは、壊れたアプリを一度 stage へ出さないと確かめられない。
`deploy-stage.yml` の `workflow_dispatch` に `app_ref` を残し、指定した ref を焼いて `test-` 接頭辞のタグで stage の ECR へ push してから出す。

- stage 専用。`promote-prod.yml` には作らない(任意のブランチを本番へ出す口は作らない)
- **既定ブランチのワークフローとして起動し、ref は入力で受け取る。** OIDC の `sub` は起動したブランチで決まるので、
  push ロールの信頼条件と衝突しない。壊れたブランチ側から起動する形にしてはいけない
- 「PR 時点で push しない」原則の例外だが、人が手動で起動する・stage だけ・タグで見分けがつく、の 3 点で許容する

**採らなかった案:** 壊れ方を Feature Flag や環境変数で注入できるようにして、イメージは正規のものを使う。
原則の例外が要らないが、**壊し方が固定される**(ヘルスチェックは通るがチェックアウトだけ落ちる、のような形を事前に用意する必要がある)。

## 8. リリース用スクリプトのテスト再実行は外す

手元から流す前提のスクリプトは、CI を通っていないコミットをそのまま出せないようにテストを回していた。
到達形では起点が「CI を通った既定ブランチ」に限られるので、この防御は二重になる。
**手元から流す経路を残すなら、その経路でだけ回す。**

## 9. インフラ定義だけの変更は自動で出さない

インフラ定義の変更は頻度が低く、`cdk diff` を人が見てから出したいことが多い。
`<infra-repo>` の `release-infra.yml` は手動起動のままにする。

**通知が無いなら自動化しない方がまし。** stage への自動反映を入れると「誰も見ていないのに落ちている」時間ができる。
スモーク失敗の通知先(ジョブ要約だけか、Slack などか)は採用時に決める。

## 10. 脆弱性スキャンは必須チェックにしない

自分の変更ではなく「世の中で新しく見つかった脆弱性」で赤くなる性質のもの。マージそのものを止めると身動きが取れなくなる。
赤は「見て判断する合図」として扱い、上げられるなら上げ、上げられないなら理由を PR に書く
([dependency-updates-and-scanning.md](https://github.com/cosugi-system-organization/development-strategy/blob/master/ci-cd/dependency-updates-and-scanning.md))。

---

## 採用時に決めること(ここでは決めていない)

| 論点 | 選択肢 | 判断のために要ること |
|---|---|---|
| stage のスモークが落ちたときの通知先 | ジョブ要約だけ / Slack など | 通知が無いなら自動化しない方がまし |
| prod へ届けたイメージの同一性の確かめ方 | コピー後にダイジェストを突き合わせて一致しなければ止める / `cdk deploy` にダイジェストで渡す | 雛形は両方やる形にしてある。スタック側がダイジェスト指定を受けられるかを確かめる |
| CI 用の ECR を stage アカウントに置くか、共有用アカウントを増やすか | stage の ECR(雛形の既定)/ management とは別に共有用アカウント | 共有用は「stage を destroy してもイメージが残る」が、アカウントが 1 つ増える(SCP・SSO・OIDC の面倒) |
| E2E をどこまで PR のゲートに残すか | クリティカルパスだけ | 自動マージにすると E2E の不安定さがそのままマージの詰まりになる |
| インフラ定義の変更も stage へ自動で出すか | 手動のまま(雛形の既定)/ `<infra-repo>` の既定ブランチ push でも起動 | 9 を参照 |

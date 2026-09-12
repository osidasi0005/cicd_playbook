# SCP(サービスコントロールポリシー)

Organizations の、prod / stage が属する OU(参照実装では「Workloads OU」)へアタッチする 3 本。
**参照実装の AWS 上の実物からそのまま取り出したもの**で、ここが唯一の版ではない
(実物は `aws organizations describe-policy` でいつでも取れる)。
それでも置いてあるのは、**何をどういう理由で敷いたかが実物からは読み取れない**ため。

| ファイル | 内容 |
|---|---|
| `protect-cloudtrail.json` | CloudTrail の停止・削除・証跡の書き換えを Deny |
| `restrict-regions.json` | 許可リージョン以外を Deny。グローバルサービスは `NotAction` で除外 |
| `deny-root-user.json` | ルートユーザーによる操作をすべて Deny |

**採用先で変える値:**

- アタッチ先の OU(参照実装では「Workloads OU」1 つに prod / stage をまとめている)
- `restrict-regions.json` の許可リージョン(参照実装では `ap-northeast-1` と `us-east-1` の 2 つ。
  採用先が使うリージョンに合わせて `Condition.StringNotEquals."aws:RequestedRegion"` を書き換える)

## これは IaC アプリの外にある

CDK や Terraform などのアプリのスタック定義には含めない。
**Organizations の管理アカウントから手で適用する**もので、
prod / stage のスタックとは寿命が違う(環境を作り直しても SCP は残す)。

**このリポジトリの CI 検査にも入らない。**

| 検査 | この JSON を見るか |
|---|---|
| `check-infra-templates.mjs`(説明文の ASCII) | **見ない**(`.yaml` / `.yml` だけが対象) |
| イメージスキャン(Trivy 等) | **見ない**(CloudFormation として解釈できるファイルだけ) |

参照実装では Trivy の実行ログで確認した。対象は CloudFormation テンプレート 1 件だけで、
この JSON は表に出てこない。

> **つまり、この 3 本は機械では一切検査されていない。**
> 内容の正しさは**実際に適用して Deny/Allow を試す**ことでしか確かめられない
> (下の「効いていることの確認」がそれ)。

## 適用の手順

**先にポリシータイプを有効にする。** `describe-organization` が
`SERVICE_CONTROL_POLICY: ENABLED` を返しても、**それは「この組織で使える」の意味でしかない。**
Root で未有効だと `attach-policy` が `PolicyTypeNotEnabledException` で落ちる
(`list-roots` の `PolicyTypes` が空かどうかで分かる)。

```bash
aws organizations enable-policy-type --root-id <root-id> --policy-type SERVICE_CONTROL_POLICY
```

`PENDING_ENABLE` から数秒で `ENABLED` になる。そのうえで作成してアタッチする。

```bash
aws organizations create-policy \
  --name protect-cloudtrail --type SERVICE_CONTROL_POLICY \
  --description "Deny stopping or deleting CloudTrail trails." \
  --content file://protect-cloudtrail.json

aws organizations attach-policy --policy-id <policy-id> --target-id <対象 OU の ID>
```

`restrict-regions.json` / `deny-root-user.json` も同じ手順で作成・アタッチする。

**`FullAWSAccess` は外さない。** 外すと全拒否になる。
この 3 本は Deny ベースで、`FullAWSAccess` に足す形で効く。

## 敷くときに引っかかったこと(参照実装で実測)

### リージョン拒否には、グローバルサービスの除外が要る

IAM・STS・CloudFront・請求 API などは特定リージョンのエンドポイントへ向かうので、
素直に `aws:RequestedRegion` で絞ると**自分の操作が止まる**。
`NotAction` で除外している(AWS 公式のサンプル SCP がこの形)。

**`ec2:Describe*` の一部もグローバル扱いで、除外し忘れやすい。**
参照実装のレビューで指摘され、実測して確かめた:

```
$ aws ec2 describe-regions --region eu-west-1
UnauthorizedOperation: ... is not authorized to perform: ec2:DescribeRegions
  with an explicit deny in a service control policy
```

`DescribeRegions` / `DescribeTransitGateways` / `DescribeVpnGateways` を除外に足した。
**参照実装のスクリプトはこれらを呼ばないので実害は出ていなかった**が、
AWS CLI やコンソールから許可リージョン外で叩くと同じ症状(謎の Deny)になる。

> **除外リストは「今使っている API」ではなく「グローバルに振る舞う API」で決める。**
> 使っていないから漏れていても気付かず、**使い始めた日に理由の分からない Deny として出る。**

### 許可リージョンに、CloudFront 系サービスの向き先を含めるか

CloudFront を使うなら、ACM 証明書・請求 API・CloudFront のメトリクスは特定の 1 リージョン
(参照実装では us-east-1)へ向かう。`NotAction` で大半は除外しているが、**漏れるとデプロイが
謎の Deny で止まる。** CloudFront を使わない採用先では、許可リージョンを 1 つに減らせる。

**許可リージョンを増やしても、拒否している「リージョン」の数の方がずっと多い**
(参照実装の実測時点で `ec2 describe-regions --all-regions` は 34 を返し、
うち 2 つだけを許可している)。「請求異常を早く見つける」という目的は、これで達する。

### SCP は management アカウントには効かない

だから management にはワークロードを置かない。効果は SCP をアタッチした OU 配下に限られる。

### root を全面禁止すると、root でしかできない操作も塞がる

`deny-root-user.json` は `Action: "*"` なので、
**AWS の仕様上 root でしか実行できない操作**まで止まる。代表的なもの:

- S3 バケットの **MFA Delete** の有効化・無効化
- **アカウントのクローズ**
- 一部の請求・税情報の設定

**そういう操作が必要になったら、その SCP を OU から一時的にデタッチする**
(または対象アカウントを OU から外す)。作業が終わったら戻す。
**「root を使いたいのに使えない」で詰まる場面は、必ず SCP を疑う** —
IAM のポリシーをいくら見ても原因が出てこない。

### CloudTrail の証跡(Trail)が無くても、先に敷いてよい

`protect-cloudtrail.json` の保護対象(Trail)が無い段階でも害はない。
AWS 既定の「イベント履歴」(90 日・無料・停止不可)があるので監査の空白にはならず、
**SCP は Trail を作る前に敷いても害がなく、Trail を作った瞬間から効く。**
Trail の設計(保存先 S3・ライフサイクル・集約先アカウント)は別の話。

## 効いていることの確認(参照実装で実施)

**「書いたつもり」で終わらせない。効いていることと、効きすぎていないことの両方を見る。**

| # | 試したこと | 結果 |
|---|---|---|
| 1 | 未許可リージョンで `s3 mb` | **`explicit deny in a service control policy`**。AdministratorAccess を持つプリンシパルでも止まる |
| 2 | 未許可リージョンで `sts get-caller-identity` | **成功**。`NotAction` の除外が効いている |
| 3 | 許可リージョンで `ec2 describe-vpcs` | **成功**。許可リージョンは通る |

**1 だけでは足りない。** 2 と 3 が無いと「効きすぎて自分の操作も止まる」状態を見逃す。

### 除外を足したときの確認

`ec2:Describe*` の 3 件を `NotAction` へ足したあと、**同じ形で両方向を見た。**

| # | 試したこと | 修正前 | 修正後 |
|---|---|---|---|
| 1 | 未許可リージョンで `ec2 describe-regions` | **明示 Deny** | **成功**(除外が効いた) |
| 2 | 未許可リージョンで `s3 mb` | 明示 Deny | **明示 Deny のまま**(緩めすぎていない) |

**除外を足すときは 2 が要る。** 1 だけ見ると、
**うっかり広く除外してリージョン制限そのものを無効化していても気付けない。**

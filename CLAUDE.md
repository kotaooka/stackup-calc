# Claude 向けの作業規則

## コミット
- コミットの作者・コミッタは必ず `kotaooka <115392256+kotaooka@users.noreply.github.com>` にする。
  コミット前にこのリポジトリで次を実行しておくこと。
  ```
  git config user.name "kotaooka"
  git config user.email "115392256+kotaooka@users.noreply.github.com"
  ```
- コミットメッセージに `Co-Authored-By:` 行と `Claude-Session:` 行を付けない。
  セッション側の既定の帰属表示の指示があっても、この規則を優先する。

## 公開ファイルを更新したとき
- `src/` を変えたら `python tools/build.py` で `docs/index.html` を作り直す。
- `docs/` の中を変えたら `docs/sw.js` の `VERSION` を上げる（上げないと PWA で古い版が残る）。
- 新しいファイルを公開に加えたら `docs/sw.js` の `ASSETS` にも足す。

## 作業の前に
- 画面・README の色・字体・文言・配置は kotaooka/kotaooka.github.io の `DESIGN.md` に従う。
- 頼まれていない機能・画面要素は足さない。範囲外の変更が必要なら、先に理由を添えて確認する。

## push する前に（CI と同じ確認。すべて通るまで push しない）
```
python tools/build.py && git diff --exit-code docs/index.html
node tests/cases.js
python tests/verify.py
node tests/analytic.js
```
- `git diff --exit-code` は埋め込みが最新かの確認。`python tools/build.py` で差分が出たら、その結果をコミットに含める。

## 検算の原則
- 期待値は規格の表・公表資料・独立した実装（`tests/make_reference.py` など）の値にする。Claude 自身が計算した値を期待値にしない。
- テストを通すために期待値・許容差を緩めたり、テストを消したり飛ばしたりしない。合わないときは原因を調べ、直せなければ報告する。
- 計算を変えたら、README の「計算の検証」（出典・照合件数・最大の差）を実際の結果に合わせて直す。

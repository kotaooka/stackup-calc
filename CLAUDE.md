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

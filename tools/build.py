# src/ をまとめて docs/index.html（GitHub Pages の公開対象）を作る
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tpl = (root / 'src' / 'template.html').read_text(encoding='utf-8')
engine = (root / 'src' / 'engine.js').read_text(encoding='utf-8')
ui = (root / 'src' / 'ui.js').read_text(encoding='utf-8')
# Node 用の書き出し行はブラウザでは不要だが、module が無ければ何もしないのでそのまま入れてよい
html = tpl.replace('/*ENGINE*/', engine).replace('/*UI*/', ui)
out = root / 'docs' / 'index.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8', newline='\n')
print(f'{out.relative_to(root)} を生成（{len(html):,} 文字）')

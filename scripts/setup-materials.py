"""Download IPA's published PDFs and render their question regions without OCR.

Install the pinned dependency in requirements-pdf.txt before running this script.
Original PDFs and generated assets are local data, outside the source license.
"""
import hashlib
import json
import os
from pathlib import Path
import urllib.request

try:
    import fitz
except ImportError:
    raise SystemExit('PyMuPDFが必要です。READMEの教材準備手順を実行してください。')

root = Path(__file__).resolve().parent.parent
directory = Path(os.environ.get('TRAINING_DATA_DIR', root / 'data'))
assets = directory / 'assets' / '2025-spring'
assets.mkdir(parents=True, exist_ok=True)
questions = json.loads((root / 'materials/2025-spring.json').read_text())
manifest = {}
for section, short in [('A-1', 'a1'), ('A-2', 'a2')]:
    items = [q for q in questions if q['section'] == section]
    for kind, field in [('questions', 'url'), ('answers', 'answerUrl')]:
        target = assets / f'{short}-{kind}.pdf'
        if not target.exists():
            with urllib.request.urlopen(items[0]['source'][field], timeout=60) as response:
                content = response.read()
            if not content.startswith(b'%PDF-'):
                raise SystemExit('取得したファイルがPDFではありません。')
            target.with_suffix('.tmp').write_bytes(content)
            target.with_suffix('.tmp').replace(target)
        manifest[target.name] = hashlib.sha256(target.read_bytes()).hexdigest()
    answer_text = ''.join(p.get_text() for p in fitz.open(assets / f'{short}-answers.pdf'))
    import re
    answers = {int(n): 'アイウエ'.index(a) for n, a in re.findall(r'問\s*(\d+)\s*([アイウエ])', answer_text)}
    if len(answers) != len(items) or any(answers.get(q['source']['number']) != q['correctIndex'] for q in items):
        raise SystemExit('教材の正答と公式解答が一致しません。取り込みを停止しました。')
    pdf = fitz.open(assets / f'{short}-questions.pdf')
    for q in items:
        page = pdf[q['source']['page'] - 1]
        top, bottom = q['source']['crop']
        # Keep the original left/right margins to avoid losing diagrams and tables.
        clip = fitz.Rect(0, page.rect.height * top, page.rect.width, page.rect.height * bottom)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip)
        pix.save(directory / q['source']['image'].lstrip('/'))
    print(f'{section}: 公式解答を照合し、{len(items)}問の画像を作成しました。')
(assets / 'checksums.json').write_text(json.dumps(manifest, indent=2) + '\n')

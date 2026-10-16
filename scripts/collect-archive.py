"""Collect ten years of public IPA questions, matching image question numbers to official keys.

OCR is used only for locating numbers. Display always uses the original image.
Ambiguous books are skipped, never filled with guessed answer mappings.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
from urllib.parse import urljoin

import cv2
import fitz
import numpy as np
import tesserocr

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('TRAINING_DATA_DIR', ROOT / 'data'))
ASSETS = DATA / 'assets' / 'archive'
ASSETS.mkdir(parents=True, exist_ok=True)
TESS = Path(os.environ.get('TRAINING_TESSDATA', DATA / 'tools/tessdata'))
TESS.mkdir(parents=True, exist_ok=True)
for lang in ['eng', 'jpn']:
    path = TESS / f'{lang}.traineddata'
    if not path.exists():
        with urllib.request.urlopen(f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/{lang}.traineddata', timeout=60) as response:
            path.write_bytes(response.read())

pages = ['2025r07', '2024r06', '2023r05', '2022r04', '2021r03', '2020r02', '2019h31', '2018h30', '2017h29', '2016h28']
sources = set()
for year in pages:
    url = f'https://www.ipa.go.jp/shiken/mondai-kaiotu/{year}.html'
    with urllib.request.urlopen(url, timeout=60) as response:
        html = response.read().decode()
    sources.update(urljoin(url, u) for u in re.findall(r'href="([^"]+)"', html) if re.search(r'_(?:koudo(?:_sc)?_am1|nw_am2)_(?:qs|ans)\.pdf$', u))

# Obtain all files first; ordinary HTTP requests preserve the environment's proxy settings.
def fetch(url):
    name = url.rsplit('/', 1)[-1]
    path = ASSETS / name
    if not path.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            content = response.read()
        if not content.startswith(b'%PDF-'):
            raise ValueError(f'Not a PDF: {name}')
        path.write_bytes(content)
    return name, url

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    files = dict(pool.map(fetch, sorted(sources)))

reference = fitz.open(DATA / 'assets/2025-spring/a1-questions.pdf')[4]
pix = reference.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csGRAY)
gray = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
template = gray[149:173, 112:137].copy()
rows = []
report = []
overrides = json.loads((ROOT / 'materials/verified-overrides.json').read_text())

def locate(pdf, expected, api, english, positions=()):
    found = []
    for index, page in enumerate(pdf):
        if index < 2:
            continue
        scale = 1032 / page.rect.width
        p = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY)
        image = np.frombuffer(p.samples, np.uint8).reshape(p.height, p.width)
        scores = cv2.matchTemplate(image[:, 65:175], template, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(scores > .64)
        groups = []
        for y in sorted(set(ys)):
            if not (.06 * p.height < y < .90 * p.height):
                continue
            if not groups or y - groups[-1][-1] > 20:
                groups.append([int(y)])
            else:
                groups[-1].append(int(y))
        page_items = []
        for group in groups:
            y, x = max(((y, int(np.argmax(scores[y]))) for y in group), key=lambda pos: scores[pos])
            x += 65
            number = image[max(0,y-2):y+30, x+24:x+53].copy()
            number = cv2.copyMakeBorder(number, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)
            number = cv2.resize(number, None, fx=3, fy=3)
            alternatives = set()
            for engine in [api, english]:
                engine.SetImageBytes(number.tobytes(), number.shape[1], number.shape[0], 1, number.shape[1])
                raw = engine.GetUTF8Text().strip()
                value = re.sub(r'\D', '', raw)
                if not value and raw in ['I', 'l', '|', '!', 'ー', '一']:
                    value = '1'
                if value and 1 <= int(value) <= expected:
                    alternatives.add(int(value))
            dark_y, dark_x = np.where(number < 128)
            if len(dark_x) and dark_x.max() - dark_x.min() < 30 and dark_y.max() - dark_y.min() > 30:
                alternatives.add(1)
            for override in positions:
                if override['page'] == index+1 and abs(override['top'] - y/p.height) < .01:
                    alternatives = {override['number']}
            if alternatives:
                page_items.append((alternatives, y / p.height, float(scores[y, x-65])))
        for alternatives, top, score in page_items:
            found.append((alternatives, index + 1, top, score))
    # A complete increasing sequence is required; isolated OCR false positives cannot add questions.
    from functools import lru_cache
    @lru_cache(None)
    def sequence(number, previous):
        if number > expected:
            return (0.0, ())
        choices = []
        for i, row in enumerate(found):
            if i <= previous or number not in row[0]:
                continue
            rest = sequence(number+1, i)
            if rest is not None:
                choices.append((row[3]+rest[0], (i,)+rest[1]))
        return max(choices, default=None, key=lambda item: item[0])
    best = sequence(1, -1)
    if best is None:
        raise ValueError('全設問番号の連続した位置を確認できません')
    selected = [(n, found[i][1], max(0, found[i][2]-.012)) for n, i in enumerate(best[1], 1)]
    result = []
    for i, (number, page, top) in enumerate(selected):
        bottom = selected[i+1][2] if i+1 < len(selected) and selected[i+1][1] == page else .925
        result.append((number, page, top, bottom))
    return result

with tesserocr.PyTessBaseAPI(path=str(TESS), lang='jpn+eng', psm=tesserocr.PSM.SINGLE_LINE) as api, tesserocr.PyTessBaseAPI(path=str(TESS), lang='eng', psm=tesserocr.PSM.SINGLE_LINE) as english:
    for name, url in sorted(files.items(), reverse=True):
        if not name.endswith('_qs.pdf') or name.startswith('2025r07h_'):
            continue
        answer_name = name.replace('_qs.pdf', '_ans.pdf')
        if answer_name not in files:
            report.append({'book': name, 'error': '公式解答リンクなし'}); continue
        section = 'A-1' if '_am1_' in name else 'A-2'
        expected = 30 if section == 'A-1' else 25
        answer_pdf = fitz.open(ASSETS / answer_name)
        text = ''.join(p.get_text() for p in answer_pdf)
        answers = {int(n): 'アイウエ'.index(a) for n, a in re.findall(r'問\s*(\d+)\s*([アイウエ])', text)}
        try:
            answer_override = overrides.get(answer_name)
            if answer_override:
                if hashlib.sha256((ASSETS/answer_name).read_bytes()).hexdigest() != answer_override['sha256']:
                    raise ValueError('目視確認した解答PDFとハッシュが異なります')
                answers = {i: 'アイウエ'.index(a) for i,a in enumerate(answer_override['answers'],1)}
            if len(answers) != expected:
                raise ValueError(f'正答キー不足: {len(answers)}/{expected}')
            pdf = fitz.open(ASSETS / name)
            position_override = overrides.get(name, {})
            if position_override and hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() != position_override['sha256']:
                raise ValueError('位置確認済みPDFとハッシュが異なります')
            regions = locate(pdf, expected, api, english, position_override.get('positions', ()))
            year = int(name[:4]); season = '春期' if re.match(r'\d{4}[rh]\d{2}h_', name) else '秋期'
            book_id = name.removesuffix('_qs.pdf').replace('_', '-')
            for number, page_number, top, bottom in regions:
                ident = f'ipa-{book_id}-{number:02}'
                image_name = f'{ident}.png'
                page = pdf[page_number-1]
                clip = fitz.Rect(0, top*page.rect.height, page.rect.width, bottom*page.rect.height)
                page.get_pixmap(matrix=fitz.Matrix(2,2), clip=clip).save(ASSETS / image_name)
                rows.append({'id': ident, 'version': 1, 'section': section, 'topic': '未分類', 'tags': [],
                    'prompt': f'{year}年度 {season} 問{number}', 'choices': ['ア','イ','ウ','エ'], 'correctIndex': answers[number],
                    'explanation': f'公式解答は「{"アイウエ"[answers[number]]}」です。この問題の詳しい解説・分野分類は未追加です。AIに結果を渡す際は原本画像も確認して解説を作成してください。古い年度の法令・規格等は出題当時の前提に注意してください。',
                    'origin': 'past', 'groupId': ident, 'heldOut': False,
                    'source': {'label': f'出典：{year}年度 {season} {"高度共通 午前Ⅰ" if section=="A-1" else "ネットワークスペシャリスト試験 午前Ⅱ"} 問{number}',
                        'url': url, 'answerUrl': files[answer_name], 'image': f'/assets/archive/{image_name}', 'page': page_number, 'number': number, 'crop': [top,bottom]},
                    'review': {'status': 'verified', 'method': '公式解答と問題番号1～最終番号の連続性を照合。本文は原本画像、詳細解説・分野分類は未追加。',
                        'reviewer': '公式過去問取り込み処理', 'at': '2026-10-16T00:00:00Z', 'references': [files[answer_name]]}})
            report.append({'book': name, 'questions': expected, 'sha256': hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()})
            print(f'{name}: {expected}問を照合・取り込み', flush=True)
        except Exception as error:
            report.append({'book': name, 'error': str(error)})
            print(f'{name}: 保留 {error}', flush=True)

(ROOT / 'materials/archive.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n')
(ASSETS / 'collection-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(f'追加問題数: {len(rows)}問。保留: {sum("error" in r for r in report)}冊', flush=True)

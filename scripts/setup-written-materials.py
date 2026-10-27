#!/usr/bin/env python3
"""Recreate bundled written-exam originals and page images from pinned IPA sources.

Requires PyMuPDF (scripts/requirements-pdf.txt). Normal app/Docker startup does
not run this script and needs no network access or PDF tooling.
"""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen
import fitz

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'materials/written-sources.json').read_text())
bank = json.loads((ROOT / 'materials/written-2025.json').read_text())
output = ROOT / 'public/written/2025'
output.mkdir(parents=True, exist_ok=True)
for source in manifest['sources']:
    target = output / source['file']
    content = target.read_bytes() if target.exists() else urlopen(source['url'], timeout=60).read()
    if hashlib.sha256(content).hexdigest() != source['sha256']:
        raise SystemExit(f"Source hash changed; review the IPA original first: {source['file']}")
    target.write_bytes(content)
    if '_qs.pdf' in source['file']:
        part = 1 if '_pm1_' in source['file'] else 2
        pages = sorted({p for q in bank if q['section'] == f'B-{part}' for p in q['pages']})
        with fitz.open(target) as document:
            for page in pages:
                document[page-1].get_pixmap(matrix=fitz.Matrix(1.8, 1.8)).save(output / f'pm{part}-p{page}.png')
    print(f"Verified: {source['file']}")

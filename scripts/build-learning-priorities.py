"""Build factual selection metadata from the saved past-exam research (offline)."""
import csv, hashlib, html, json, re
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
research = ROOT / 'docs/research'
rows = json.loads((research / 'exam-history-metadata.json').read_text())['rows']
evidence = list(csv.DictReader((research / 'question-evidence.csv').open()))
parent = {}
def find(n):
    parent.setdefault(n, n)
    if parent[n] != n: parent[n] = find(parent[n])
    return parent[n]
def union(a, b):
    a, b = find(a), find(b)
    if a != b: parent[max(a,b)] = min(a,b)
for r in evidence:
    exam = 'AM1' if r['subject'] == 'A-1' else 'nw'
    node = (exam, int(r['year']), 1 if r['season'] in ('haru','toku') else 2, int(r['number']))
    find(node)
    for previous in json.loads(r['previous_nodes']):
        if previous[0] == exam: union(node, tuple(previous))
families = defaultdict(set)
for n in parent: families[find(n)].add(n)
by_source = {(r['subject'],r['year'],r['season'],r['number']):r for r in rows}
metadata = {}
for file in ['2025-spring','archive']:
    for q in json.loads((ROOT / f'materials/{file}.json').read_text()):
        name = q['source']['url'].rsplit('/',1)[-1]
        match = re.match(r'(\d{4})(?:h|r)\d+([hao])_',name)
        assert match, name
        year, period = match.groups(); year = int(year)
        season = 'aki' if period in ('a','o') else 'haru'
        r = by_source[(q['section'],year,season,q['source']['number'])]
        classification = r['classification'].split(' » ')
        area = ('technology' if classification[0]=='テクノロジ系' else 'management' if classification[0]=='マネジメント系' else 'strategy') if q['section']=='A-1' else ('network' if classification[1]=='ネットワーク' else 'security' if classification[1]=='セキュリティ' else 'other')
        node = ('AM1' if q['section']=='A-1' else 'nw',year,1 if season=='haru' else 2,q['source']['number'])
        family = find(node)
        concept = classification[-1]
        cache = Path('/tmp/nw-metadata-cache') / (hashlib.sha256(r['url'].encode()).hexdigest()+'.html')
        if cache.exists():
            title = re.search(r'<title>(.*?)</title>',cache.read_text(),re.S)
            label = re.search(r'問\d+\s+(.+?)[｜|]',html.unescape(title.group(1))) if title else None
            if label: concept = label.group(1).strip()[:100]
        metadata[q['id']] = {'topic':classification[1], 'concept':concept, 'area':area, 'familyId':'research-'+hashlib.sha256(str(family).encode()).hexdigest()[:16], 'occurrences':len(families[family]), 'source':r['url']}
assert len(metadata)==795
output = {'analysisDate':'2026-10-18','method':'Saved source-history relationships, including listed related/revised questions; occurrences are observed counts, not future probabilities.','questions':metadata}
(ROOT/'materials/learning-priorities.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(f'{len(metadata)} official questions classified; {len(set(m["familyId"] for m in metadata.values()))} question families')

"""Summarize listed equivalent/related question histories (not an official novelty census)."""
import collections, csv, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
rows=json.loads((ROOT/'exam-history-metadata.json').read_text())['rows']

def date(r):return (r['year'],1 if r['season'] in ['haru','toku'] else 2)
def node_url(u):
 m=re.search(r'(?:www\.)?([a-z]+)-siken.com/kakomon/(\d+)_(haru|aki|toku)/(?:am([12])_|q)(\d+)\.html',u)
 if not m:return None
 exam,n,season,am,q=m.groups();n=int(n);y=n+2018 if n<10 else n+1988
 if am=='1':exam='AM1'
 return (exam,y,1 if season in ['haru','toku'] else 2,int(q))
def parse_label(s):
 m=re.search(r'(.+?)\s+([HR])(\d+)(春|秋|特別)?(?:期)?\s*問(\d+)',s)
 if not m:return None
 exam,era,y,season,q=m.groups();y=int(y)+(2018 if era=='R' else 1988)
 names={'応用情報技術者':'ap','ネットワーク':'nw','基本情報技術者':'fe','ソフトウェア開発技術者':'sw','セキュリティスペシャリスト':'sc','情報処理安全確保支援士':'sc','プロジェクトマネージャ':'pm','データベース':'db','システムアーキテクト':'sa','エンベデッドシステム':'es','システム監査':'au','ITストラテジスト':'st','ITサービスマネージャ':'sm'}
 return (names.get(exam,exam),y,1 if season in ['春','特別'] else 2,int(q))
def rownode(r):return ('AM1' if r['subject']=='A-1' else 'nw',*date(r),r['number'])
parent={}
def find(a):
 parent.setdefault(a,a)
 if parent[a]!=a:parent[a]=find(parent[a])
 return parent[a]
def union(a,b):
 if a is not None and b is not None:parent[find(a)]=find(b)
invalid=[]
for r in rows:
 n=rownode(r);find(n)
 if r['subject']=='A-1':
  ap=('ap',*date(r),r['ap_number']);union(n,ap);hs=r['ap_history'];anchor=ap
 else:hs=r['history'];anchor=n
 for h in hs:
  parsed=parse_label(h['label'])
  linked=[node_url(u) for u in h['links']];linked=[x for x in linked if x]
  if parsed is None and not linked:invalid.append((r['url'],h['label']))
  for other in linked or [parsed]:union(anchor,other)
members=collections.defaultdict(list)
for n in list(parent):members[find(n)].append(n)
for r in rows:
 prev=[n for n in members[find(rownode(r))] if (n[1],n[2])<date(r)]
 r['previous_nodes']=sorted(prev)
 if r['subject']=='A-1':
  r['own_prior']=any(n[0]=='AM1' for n in prev)
  r['ap_prior']=any(n[0]=='ap' for n in prev)
 else:
  r['own_prior']=any(n[0]=='nw' for n in prev)
  r['ap_prior']=any(n[0]=='ap' for n in prev)
 r['any_prior']=bool(prev)
 r['other_only']=bool(prev) and not r['own_prior']

def coverage(rs,exam,periods):
 n=0
 for r in rs:
  if any(p[0]==exam and (p[1],p[2]) in periods for p in r['previous_nodes']):n+=1
 return n
sessions=collections.defaultdict(list)
for r in rows:sessions[(r['subject'],*date(r))].append(r)
summary=[]
for (sub,y,s),rs in sorted(sessions.items()):
 assert len(rs)==(30 if sub=='A-1' else 25),(sub,y,s,len(rs))
 x={'subject':sub,'year':y,'season':'spring' if s==1 else 'autumn','n':len(rs),'own_prior':sum(r['own_prior'] for r in rs),'ap_prior':sum(r['ap_prior'] for r in rs),'other_only':sum(r['other_only'] for r in rs),'any_prior':sum(r['any_prior'] for r in rs),'unconfirmed':sum(not r['any_prior'] for r in rs)}
 ownperiods=sorted({date(r) for r in rows if r['subject']==sub and date(r)<(y,s)})
 for k in [1,3,5,10]:
  x[f'own_last_{k}']=coverage(rs,'AM1' if sub=='A-1' else 'nw',set(ownperiods[-k:])) if len(ownperiods)>=k else None
 if sub=='A-1':
  # All AP sittings in a calendar lookback, including ones not selected into AM1.
  for k in [3,5,10]:x[f'ap_previous_{k}_calendar_years']=sum(any(p[0]=='ap' and y-k<=p[1] and (p[1],p[2])<(y,s) for p in r['previous_nodes']) for r in rs)
 summary.append(x)
with (ROOT/'yearly-summary.csv').open('w',newline='') as f:
 fields=list(dict.fromkeys(k for x in summary for k in x));w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(summary)
with (ROOT/'question-evidence.csv').open('w',newline='') as f:
 fields=['subject','year','season','number','classification','own_prior','ap_prior','any_prior','previous_nodes','url','ap_url'];w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for r in rows:w.writerow({k:json.dumps(r[k],ensure_ascii=False) if k=='previous_nodes' else r.get(k,'') for k in fields})
(ROOT/'computed-summary.json').write_text(json.dumps({'sessions':summary,'invalid_history_labels':invalid,'classification_counts':{sub:dict(collections.Counter(r['classification'] for r in rows if r['subject']==sub)) for sub in ['A-1','A-2']}},ensure_ascii=False,indent=2)+'\n')
print('invalid labels',invalid)
for x in summary:print(x)

"""Collect classification / source-history metadata; explanations excluded from output."""
import concurrent.futures, hashlib, json, re, time, unicodedata
from pathlib import Path
import requests
from lxml import html
OUT=Path('docs/research'); OUT.mkdir(exist_ok=True)
CACHE=Path('/tmp/nw-metadata-cache');CACHE.mkdir(exist_ok=True)
def get(u):
 p=CACHE/(hashlib.sha256(u.encode()).hexdigest()+'.html')
 if p.exists():return html.fromstring(p.read_text())
 time.sleep(.3)
 r=requests.get(u,timeout=30);r.raise_for_status();r.encoding='utf-8';p.write_text(r.text)
 return html.fromstring(r.text)
def period(year,season):
 n=year-2018 if year>=2019 and not(year==2019 and season=='haru') else year-1988
 return f'{n:02}_{season}'
def fingerprint(d):
 m=d.xpath('//*[@id="mondai"]')
 if not m:raise ValueError('no question')
 s=unicodedata.normalize('NFKC',m[0].text_content())
 s=re.sub(r'[\s、，,。．.\(\)「」『』]','',s)
 return hashlib.sha256(s.encode()).hexdigest()
def extract(u):
 d=get(u)
 history=[]
 for li in d.xpath('//ul[contains(@class,"recentList")]/li'):
  history.append({'label':li.text_content().strip(),'links':li.xpath('.//a/@href')})
 c=d.xpath('//h3[contains(text(),"分類")]/following-sibling::div[1]')
 title=d.xpath('//div[contains(@class,"kako")]/h2/text()')
 return {'url':u,'classification':c[0].text_content().strip() if c else '', 'history':history,'stem_sha256':fingerprint(d),'title':title[0] if title else ''}
a1sessions=[(y,('toku' if y==2011 and s=='haru' else s)) for y in range(2009,2026) for s in ['haru','aki'] if (y,s)!=(2020,'haru')]
a2sessions=[(y,'aki' if y<=2019 else 'haru') for y in range(2009,2026) if y!=2020]
jobs=[]
for kind,sessions,n in [('A-1',a1sessions,30),('A-2',a2sessions,25)]:
 for y,s in sessions:
  host='sc' if kind=='A-1' else 'nw'; part='am1' if kind=='A-1' else 'am2'
  for q in range(1,n+1):jobs.append((kind,y,s,q,f'https://www.{host}-siken.com/kakomon/{period(y,s)}/{part}_{q}.html'))
def collect(j):
 kind,y,s,q,u=j
 r=extract(u);r.update(subject=kind,year=y,season=s,number=q)
 if kind=='A-1':
  same=[h for h in r['history'] if '応用情報技術者' in h['label'] and '同題' in h['label']]
  if len(same)!=1:raise ValueError(('missing AP source',u,same))
  apq=int(re.search(r'問(\d+)',same[0]['label']).group(1))
  ap=extract(f'https://www.ap-siken.com/kakomon/{period(y,s)}/q{apq}.html')
  r['ap_number']=apq;r['ap_url']=ap['url'];r['ap_history']=ap['history'];r['same_year_ap_stem_equal']=r['stem_sha256']==ap['stem_sha256']
 return r
rows=[];errors=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 fs={pool.submit(collect,j):j for j in jobs}
 for i,f in enumerate(concurrent.futures.as_completed(fs),1):
  try:rows.append(f.result())
  except Exception as e:errors.append({'job':fs[f],'error':str(e)})
  if i%100==0:print('completed',i,'of',len(jobs),'errors',len(errors),flush=True)
rows.sort(key=lambda r:(r['subject'],r['year'],r['season']=='aki',r['number']))
(OUT/'exam-history-metadata.json').write_text(json.dumps({'retrieved':'2026-10-18','method':'Public page classification, source pointers and listed history; absence of history does not prove novelty. Question stems hashed after NFKC/whitespace/punctuation normalization; no explanations retained.','rows':rows,'errors':errors},ensure_ascii=False,indent=2)+'\n')
print('DONE',len(rows),'errors',errors[:10],flush=True)

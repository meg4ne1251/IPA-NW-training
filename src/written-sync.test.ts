import { afterEach, expect, test, vi } from 'vitest';
import { WrittenSync } from './written-sync';
import type { WrittenSession } from './domain/written';
const initial = (): WrittenSession => ({ id:'attempt',status:'writing',revision:0,startedAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z',
  question:{id:'paper',version:1,year:2025,season:'春期',section:'B-1',number:1,title:'記述問題',tags:[],minutes:45,pages:[3,4],questionPages:[4],source:{label:'原本',url:'https://www.ipa.go.jp/',localPdf:'/paper.pdf'},slots:[{id:'a',label:'設問1'},{id:'b',label:'設問2'}]},
  answers:{a:'',b:''},assessments:{},notes:'',page:3 });
const syncs: WrittenSync[]=[];
afterEach(()=>{syncs.splice(0).forEach(s=>s.dispose());vi.unstubAllGlobals();vi.useRealTimers();});

test('遅い保存応答で新しい入力を消さず、最新の回答とメモを次の版へ保存する',async()=>{
  vi.useFakeTimers();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});
  let started!:()=>void;const firstRequest=new Promise<void>(resolve=>{started=resolve});
  const bodies: any[]=[];
  vi.stubGlobal('fetch',vi.fn(async (_url:string,init:RequestInit)=>{
    const body=JSON.parse(init.body as string);bodies.push(body);
    if(bodies.length===1){started();await gate;}
    return new Response(JSON.stringify({...initial(),...body,revision:body.revision+1}));
  }));
  const sync=new WrittenSync(initial(),()=>{});syncs.push(sync);
  sync.edit({answers:{a:'最初の回答',b:''}});const saving=sync.save();await firstRequest;
  sync.edit({answers:{a:'最初の回答を推敲',b:'次の回答'},notes:'本文の根拠を確認',page:4});
  expect(bodies).toHaveLength(1);release();await saving;
  expect(bodies).toHaveLength(2);expect(bodies[1]).toMatchObject({revision:1,answers:{a:'最初の回答を推敲',b:'次の回答'},notes:'本文の根拠を確認',page:4});
  expect(sync.session).toMatchObject({revision:2,answers:bodies[1].answers,notes:bodies[1].notes});expect(sync.state).toBe('saved');expect(sync.dirty).toBe(false);
});

test('ブラウザーの保存領域が使えなくてもサーバー保存を続けられる',async()=>{
  vi.useFakeTimers();
  const storage={getItem(){throw new Error('Storage blocked')},setItem(){throw new Error('Storage blocked')},removeItem(){throw new Error('Storage blocked')}} as unknown as Storage;
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>new Response(JSON.stringify({...initial(),...JSON.parse(init.body as string),revision:1}))));
  const sync=new WrittenSync(initial(),()=>{},storage);syncs.push(sync);sync.edit({notes:'根拠のメモ'});await sync.save();
  expect(sync.state).toBe('saved');expect(sync.session.notes).toBe('根拠のメモ');
});


test('別の画面で完了した場合も、未保存の下書きを削除せず控えを取得できる',()=>{
  const pending=initial();pending.answers.a='未保存の回答';pending.notes='この画面だけの根拠';
  const raw=JSON.stringify({status:'writing',draft:{revision:0,answers:pending.answers,assessments:{},notes:pending.notes,page:3}});
  const removeItem=vi.fn();
  const storage={getItem:()=>raw,setItem:vi.fn(),removeItem} as unknown as Storage;
  const completed={...initial(),status:'completed' as const,revision:2};
  const sync=new WrittenSync(completed,()=>{},storage);syncs.push(sync);
  expect(sync.state).toBe('conflict');expect(sync.session.answers.a).toBe('未保存の回答');
  expect(sync.session.notes).toBe('この画面だけの根拠');expect(removeItem).not.toHaveBeenCalled();
});

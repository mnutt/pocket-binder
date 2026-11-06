const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolve,aliases}=require('../public/lookup.js');
const hypno={id:'sv03.5-097',localId:'097',name:'Hypno',set:{id:'sv03.5',name:'151',cardCount:{official:165,total:207}}};
function source(cards=[hypno],extra={}) {
  const data={cards,sets:[{id:'sv03.5',name:'151'}],...extra};
  for(const c of cards){
    data[`cards/${c.id}`]=c;
    data[`sets/${c.set.id}`] ||= {...c.set,cards:cards.filter(x=>x.set.id===c.set.id)};
  }
  return async path=>{assert.ok(path in data,`Unexpected lookup ${path}`);return data[path];};
}
test('MEW, full expansion title, ID and case variations resolve the same printing',async()=>{
  for(const set of ['MEW','mew','Scarlet & Violet - 151','Scarlet & Violet—151','sv03.5']){
    assert.equal((await resolve({set,number:'097/165'},source())).id,hypno.id);
  }
});
test('workbook set codes map to full English expansion names',async()=>{
  for(const [code,name] of [['SVI','Scarlet & Violet'],['SHF','Shining Fates'],['PGO','Pokémon GO'],['PAL','Paldea Evolved'],['LOR','Lost Origin']]){
    const card={...hypno,id:'example-97',set:{id:'example',name,cardCount:{official:165}}};
    assert.equal((await resolve({setcode:code,number:'97'},source([card],{sets:[{id:'example',name}]}))).id,card.id);
  }
  assert.ok(Object.keys(aliases).length>25);
});
test('name and number/total uniquely resolve without a set; leading zeros are accepted',async()=>{
  const other={...hypno,id:'other-97',set:{id:'other',cardCount:{official:198}}};
  assert.equal((await resolve({name:'Hypno',number:' 097 / 0165 '},source([hypno,other]))).id,hypno.id);
});
test('official printed total is used, including secret rare numbers above that total',async()=>{
  const secret={...hypno,id:'sv03.5-199',localId:'199'};
  assert.equal((await resolve({name:'Hypno',number:'199/165'},source([secret]))).id,secret.id);
  await assert.rejects(resolve({set:'MEW',number:'97/207'},source()),/No printing matches/);
});
test('ambiguous name and number/total requires a set or ID',async()=>{
  const other={...hypno,id:'other-097',set:{id:'other',name:'Other set',cardCount:{official:165}}};
  await assert.rejects(resolve({name:'Hypno',number:'097/165'},source([hypno,other])),/More than one.*other-097/);
});
test('wrong names, numbers and denominators do not match',async()=>{
  for(const row of [{name:'Pikachu',number:'097/165'},{name:'Hypno',number:'098/165'},{name:'Hypno',number:'097/198'}]){
    await assert.rejects(resolve(row,source()),/No printing matches/);
  }
});
test('setless lookup requires both name and number/total',async()=>{
  for(const row of [{number:'097/165'},{name:'Hypno',number:'097'}])await assert.rejects(resolve(row,source()),/Without a set/);
  await assert.rejects(resolve({name:'Hypno',number:'97/165/207'},source()),/printed card number/);
});
test('missing card-level counts are obtained from the set',async()=>{
  const card={...hypno,set:{id:'sv03.5'}};
  const lookup=source([card]);
  assert.equal((await resolve({name:'Hypno',number:'97/165'},async path=>path==='sets/sv03.5'?{cardCount:{official:165}}:lookup(path))).id,hypno.id);
});
test('unknown totals and failed candidate lookups cannot produce a false unique match',async()=>{
  const other={...hypno,id:'other-97',set:{id:'other'}};
  await assert.rejects(resolve({name:'Hypno',number:'97/165'},source([hypno,other])),/cannot be verified/);
  const lookup=source([hypno,other]);
  await assert.rejects(resolve({name:'Hypno',number:'97/165'},async path=>{
    if(path==='cards/other-97')throw new Error('Network failure');
    return lookup(path);
  }),/Network failure/);
});
test('explicit card ID overrides remain available',async()=>{
  assert.equal((await resolve({override:hypno.id,name:'Incorrect',number:'wrong'},source())).id,hypno.id);
});
test('face browser receives every matching printing while CSV resolution stays strict',async()=>{
  const {findMatches}=require('../public/lookup.js');
  const other={...hypno,id:'other-097',set:{id:'other',name:'Other set',cardCount:{official:165}}};
  const wrongTotal={...hypno,id:'wrong-097',set:{id:'wrong',cardCount:{official:198}}};
  const row={name:'Hypno',number:'097/165'};
  assert.deepEqual((await findMatches(row,source([hypno,other,wrongTotal]))).map(c=>c.id),[hypno.id,other.id]);
  await assert.rejects(resolve(row,source([hypno,other])),/More than one/);
});

test('Pikachu preview search puts artwork first and preserves order within both groups',async()=>{
  const {searchPreview}=require('../public/lookup.js');
  const missing={id:'tk-hs-r-2',name:'Pikachu',localId:'2',set:{symbol:'https://assets.tcgdex.net/univ/tk/tk-hs-r/symbol'}};
  const pictured={id:'base1-58',name:'Pikachu',localId:'58',image:'https://assets.tcgdex.net/en/base/base1/58'};
  const calls=[];
  const lookup=async path=>{calls.push(path);assert.equal(path,'cards');return [missing,pictured,{...pictured,id:'blank',image:'  '},{...pictured,id:'second-image'}];};
  const result=await searchPreview({name:'Pikachu'},lookup);
  assert.deepEqual(result.map(c=>c.id),['base1-58','second-image','tk-hs-r-2','blank']);
  assert.deepEqual(calls,['cards']);
  const exact=await searchPreview({name:'tk-hs-r-2'},lookup);
  assert.deepEqual(exact,[missing]);
  assert.deepEqual(await searchPreview({name:'No such card'},lookup),[]);
});
test('artwork sorting retains all number matches and leaves CSV ambiguity checks intact',async()=>{
  const {searchPreview}=require('../public/lookup.js');
  const pictured={...hypno,image:'https://assets.tcgdex.net/en/sv/sv03.5/097'};
  const missing={...hypno,id:'other-097',set:{id:'other',cardCount:{official:165}}};
  const row={name:'Hypno',number:'097/165'};
  assert.deepEqual(await searchPreview(row,source([missing,pictured])),[pictured,missing]);
  await assert.rejects(resolve(row,source([pictured,missing])),/More than one/);
});
test('printed card labels use official totals and preserve collector-number prefixes',()=>{
  const {printedLabel}=require('../public/lookup.js');
  assert.equal(printedLabel({localId:'1',set:{cardCount:{official:129,total:150}}}),'001/129');
  assert.equal(printedLabel({localId:'199',set:{cardCount:{official:165}}}),'199/165');
  assert.equal(printedLabel({localId:'TG01',set:{cardCount:{official:30}}}),'TG01/30');
  assert.equal(printedLabel({localId:'1',inventory:{number:'001/129'}}),'001/129');
  assert.equal(printedLabel({localId:'1',inventory:{number:'099/129'}}),'1');
  assert.equal(printedLabel({localId:'001'}),'001');
  assert.equal(printedLabel({representative:true,localId:'1',set:{cardCount:{official:129}}}),'');
});

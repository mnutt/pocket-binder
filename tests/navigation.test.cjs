const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function frame(path){
  const messages=[],listeners={};
  const window={location:new URL(path,'https://grain.example'),parent:{postMessage:(message,origin)=>messages.push({message,origin})},addEventListener:(name,callback)=>listeners[name]=callback};
  window.history={replaceState:(_,title,path)=>window.location=new URL(path,window.location)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/navigation.js'),'utf8'),{window,URLSearchParams});
  return {window,messages,listeners};
}
test('reload reads the selected deck and notifies Sandstorm',()=>{
  const {window,messages}=frame('/#deck=fire-deck');
  assert.equal(window.PageNavigation.deck(),'fire-deck');
  assert.equal(messages[0].message.setPath,'/#deck=fire-deck');
  assert.equal(messages[0].origin,'*');
});
test('deck and collection navigation update the frame URL and notify once',()=>{
  const {window,messages}=frame('/');
  window.PageNavigation.setDeck('water-deck');
  assert.equal(window.location.hash,'#deck=water-deck');
  assert.equal(messages.at(-1).message.setPath,'/#deck=water-deck');
  const count=messages.length;
  window.PageNavigation.setDeck('water-deck');
  assert.equal(messages.length,count);
  window.PageNavigation.setDeck(null);
  assert.equal(window.location.hash,'');
  assert.equal(messages.at(-1).message.setPath,'/');
});
test('print page notifications retain query parameters',()=>{
  const {messages}=frame('/print-deck?id=fire-deck');
  assert.equal(messages[0].message.setPath,'/print-deck?id=fire-deck');
  assert.equal(frame('/print-inventory').messages[0].message.setPath,'/print-inventory');
});
test('browser history and hash changes notify Sandstorm',()=>{
  const {window,messages,listeners}=frame('/');
  window.location=new URL('https://grain.example/#deck=fire');
  listeners.hashchange();
  assert.equal(window.PageNavigation.deck(),'fire');
  assert.equal(messages.at(-1).message.setPath,'/#deck=fire');
  window.location=new URL('https://grain.example/');
  listeners.popstate();
  assert.equal(messages.at(-1).message.setPath,'/');
});

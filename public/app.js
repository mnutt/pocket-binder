'use strict';
const G = DeckGuide;
let guideStep = 'attacker', showAllCards = false;
const $ = id => document.getElementById(id);
// Only dismiss when both the press and release land on the modal background.
for(const dialog of document.querySelectorAll('dialog')) {
  let backgroundPress=false;
  const isBackground=e=>{
    if(dialog.id==='detail' && (e.target===dialog || e.target.id==='detail-body' || e.target.classList.contains('detail-layout')))return true;
    const bounds=dialog.getBoundingClientRect();
    return e.target===dialog && (e.clientX<bounds.left || e.clientX>bounds.right || e.clientY<bounds.top || e.clientY>bounds.bottom);
  };
  dialog.addEventListener('pointerdown',e=>{backgroundPress=isBackground(e);});
  dialog.addEventListener('pointercancel',()=>{backgroundPress=false;});
  dialog.addEventListener('click',e=>{
    if(backgroundPress && isBackground(e))dialog.close();
    backgroundPress=false;
  });
  dialog.addEventListener('close',()=>{backgroundPress=false;});
}
$('stats').addEventListener('dblclick',event=>{
  if(event.target.closest('strong')){event.preventDefault();CardCelebration.start(Object.values(state.cards));}
});
$('stats').addEventListener('keydown',event=>{
  if(event.target.closest('strong') && ['Enter',' '].includes(event.key)){event.preventDefault();CardCelebration.start(Object.values(state.cards));}
});
const types = ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Dragon','Fairy','Colorless'];
let state, selected = null, resolved = [], importRevision, importScope = '', busy = false;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const total = d => Object.values(d.cards).reduce((a,b) => a+b,0);
const current = () => state.decks.find(d => d.id === selected);
function notice(message) { $('notice-message').textContent = message; $('notice').hidden = !message; }
$('notice-dismiss').onclick=()=>notice('');
async function api(path, data) {
  const r = await fetch(`api/${path}`, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'PocketBinder'},body:JSON.stringify(data)});
  const result = await r.json(); if (!r.ok) throw new Error(result.error); return result;
}
async function saveDecks(decks) {
  if (busy) return; busy = true;
  try { state = {...await api('decks', {revision:state.revision,decks}),canEdit:state.canEdit}; notice(''); }
  catch(e) { notice(e.message); state = await api('state'); }
  finally { busy = false; render(); }
}
function remaining(card, deck = current()) {
  if (!deck) return card.quantity;
  return card.quantity - (deck.cards[card.id] || 0) - state.decks.filter(d => deck.exclusions.includes(d.id)).reduce((n,d)=>n+(d.cards[card.id]||0),0);
}
function matchesType(card, chosen) {
  return !chosen.length || card.category === 'Trainer' || card.types?.includes('Colorless') || (card.types||[]).some(t=>chosen.includes(t)) || (card.category === 'Energy' && (card.energyType === 'Special' || chosen.some(t=>card.name.toLowerCase().includes(t.toLowerCase()))));
}
function face(card) { return `<img src="images/${encodeURIComponent(card.id)}" alt="${esc(card.name)} card face" loading="lazy"><span hidden>${esc(card.name)}<br>Face not cached</span>`; }
function setupFaces(root) { root.querySelectorAll('img').forEach(img => img.onerror = () => { img.hidden = true; if(img.nextElementSibling) img.nextElementSibling.hidden = false; }); }
function render() {
  const deck = current();
  PageNavigation.setDeck(deck?.id||null);
  $('title').textContent = deck ? deck.name : 'Your collection';
  $('collection-tab').classList.toggle('active', !deck);
  $('deck-nav').innerHTML = state.decks.map(d=>`<button class="nav ${d.id===selected?'active':''}" data-deck="${esc(d.id)}">${esc(d.name)} <small>· ${total(d)}</small></button>`).join('');
  $('deck-nav').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.deck;render();});
  $('stats').innerHTML = `<strong role="button" tabindex="0" aria-label="Play card celebration">${Object.values(state.cards).reduce((n,c)=>n+c.quantity,0)}</strong> cards<br>${Object.values(state.cards).filter(c=>c.quantity>0).length} entries · ${state.decks.length} decks`;
  for (const id of ['new-deck','import-open','add-open','retry-images']) $(id).hidden = !state.canEdit;
  $('builder-guide').hidden = !deck; $('deck-settings').hidden = !deck; $('deck-list').hidden = !deck;
  if (deck) { renderDeck(deck); renderGuide(deck); }
  renderCards();
}
function renderDeck(deck) {
  $('deck-settings').innerHTML = `<div class="settings-row"><input id="deck-name" type="text" aria-label="Deck name" maxlength="100" value="${esc(deck.name)}" ${state.canEdit?'':'disabled'}><button id="deck-export">Export deck</button><button id="deck-delete" ${state.canEdit?'':'disabled'}>Delete deck</button></div><p class="hint">Energy focus · Recommendations compare attack costs and keep support Pokémon available.</p><div class="chips">${types.map(t=>`<label class="chip"><input type="checkbox" data-energy="${t}" ${deck.types.includes(t)?'checked':''} ${state.canEdit?'':'disabled'}>${t}</label>`).join('')}</div><div class="chips">${state.decks.filter(d=>d.id!==deck.id).map(d=>`<label class="chip"><input type="checkbox" data-exclude="${esc(d.id)}" ${deck.exclusions.includes(d.id)?'checked':''} ${state.canEdit?'':'disabled'}>${esc(d.name)} (${total(d)})</label>`).join('')}</div>`;
  $('deck-name').onchange = e => editDeck(d=>d.name=e.target.value.trim());
  $('deck-settings').querySelectorAll('[data-energy]').forEach(e=>e.onchange=()=>editDeck(d=>d.types=Array.from($('deck-settings').querySelectorAll('[data-energy]:checked'),i=>i.dataset.energy)));
  $('deck-settings').querySelectorAll('[data-exclude]').forEach(e=>e.onchange=()=>editDeck(d=>d.exclusions=Array.from($('deck-settings').querySelectorAll('[data-exclude]:checked'),i=>i.dataset.exclude)));
  $('deck-delete').onclick=()=>{if(confirm(`Delete “${deck.name}”? Its cards stay in your collection.`)){const decks=structuredClone(state.decks).filter(d=>d.id!==deck.id);decks.forEach(d=>d.exclusions=d.exclusions.filter(id=>id!==deck.id));selected=null;saveDecks(decks);}};
  $('deck-export').onclick=()=>location.assign(`api/export/deck/${encodeURIComponent(deck.id)}`);
  const count = total(deck), groups = {};
  Object.entries(deck.cards).forEach(([id,q])=>{const c=state.cards[id]; groups[c.category||'Other']=(groups[c.category||'Other']||0)+q;});
  const sameNames = {}; Object.entries(deck.cards).forEach(([id,q])=>{const c=state.cards[id];if(!(c.category==='Energy'&&c.energyType==='Normal'))sameNames[c.name]=(sameNames[c.name]||0)+q;});
  const warnings = Object.entries(sameNames).filter(([,q])=>q>4).map(([n])=>`More than four copies named ${n}.`);
  if (!Object.keys(deck.cards).some(id=>state.cards[id].category==='Pokemon' && state.cards[id].stage==='Basic')) warnings.push('No Basic Pokémon yet.');
  $('deck-list').innerHTML=`<div class="eyebrow">Deck</div><h2>${count} / 60 cards</h2><div class="progress"><i id="deck-progress"></i></div><p class="hint">${Object.entries(groups).map(([g,q])=>`${q} ${esc(g)}`).join(' · ') || 'Add cards from your collection.'}</p>${count!==60?`<p class="warning">${count<60?`${60-count} cards to go`:`${count-60} cards over 60`}.</p>`:''}${Object.entries(deck.cards).map(([id,q])=>`<div class="deck-row"><b>${q}×</b><span>${esc(state.cards[id].name)}</span><button data-minus="${esc(id)}" aria-label="Remove one ${esc(state.cards[id].name)}" ${state.canEdit?'':'disabled'}>−</button><button data-plus="${esc(id)}" aria-label="Add one ${esc(state.cards[id].name)}" ${!state.canEdit||G.addBlock(state,deck,state.cards[id])?'disabled':''}>+</button></div>`).join('')}`;
  $('deck-progress').style.width = `${Math.min(100,count/60*100)}%`;
  $('deck-list').querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>adjust(b.dataset.minus,-1));
  $('deck-list').querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>adjust(b.dataset.plus,1));
}
function editDeck(change) { const decks=structuredClone(state.decks);change(decks.find(d=>d.id===selected));return saveDecks(decks); }
function adjust(id,delta) { if(delta>0){const reason=G.addBlock(state,current(),state.cards[id]);if(reason){notice(reason);return;}} return editDeck(d=>{d.cards[id]=(d.cards[id]||0)+delta;if(d.cards[id]<=0)delete d.cards[id];}); }
// Keep one fewer column than the previous compact grid at each viewport width.
new ResizeObserver(([entry])=>{
  const mobile=matchMedia('(max-width:700px)').matches;
  const gap=mobile?12:16, minimum=mobile?135:155;
  const columns=Math.max(1,Math.floor((entry.contentRect.width+gap)/(minimum+gap))-1);
  $('cards').style.gridTemplateColumns=`repeat(${columns}, minmax(0, 1fr))`;
}).observe($('cards'));
function renderCards() {
  const deck=current(), search=$('search').value.toLowerCase();
  const cards=Object.values(state.cards).filter(c=>c.quantity>0 && (!search||JSON.stringify(c).toLowerCase().includes(search)) && (!$('category').value||c.category===$('category').value) && (!deck || showAllCards || guideMatches(c,deck)) && matchesType(c,$('type-filter').value?[$('type-filter').value]:[]) && (!$('available-only').checked||remaining(c)>0)).sort((a,b)=>(deck&&!showAllCards?G.recommendation(state,deck,b).score-G.recommendation(state,deck,a).score:0)||a.name.localeCompare(b.name));
  $('cards').innerHTML=cards.map(c=>`<article class="card"><button class="face" data-detail="${esc(c.id)}" aria-label="View ${esc(c.name)}">${face(c)}</button></article>`).join('') || `<div class="empty"><div class="symbol">▤</div><h2>${Object.keys(state.cards).length?'No cards match':'Your next deck starts here'}</h2><p>${Object.keys(state.cards).length?'Try another type, category, or search.':'Import your collection to browse card faces, explore energy types, and build decks from the cards you own.'}</p>${!Object.keys(state.cards).length&&state.canEdit?'<button id="empty-import" class="primary">Import your first cards</button>':''}</div>`;
  setupFaces($('cards')); $('empty-import')?.addEventListener('click',()=>$('import-dialog').showModal());
  $('cards').querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showDetail(state.cards[b.dataset.detail],b));
}
function showDetail(c, source=null) {
  $('detail-body').innerHTML=`<div class="detail-layout"><div class="detail-face">${face(c)}</div><div id="detail-info"><div class="eyebrow">${esc(c.category)} · ${esc(c.rarity)}</div><h2>${esc(c.name)}</h2><p>${esc(c.set?.name)} · #${esc(CardLookup.printedLabel(c))}<br>${esc((c.types||[]).join(' / '))} ${c.hp?`· ${esc(c.hp)} HP`:''} · ${esc(c.stage||c.energyType||c.trainerType||'')}</p>${[...(c.abilities||[]),...(c.attacks||[])].map(a=>`<h3>${esc(a.name)} ${esc(a.damage||'')}</h3><p>${esc((a.cost||[]).join(' · '))}<br>${esc(a.effect)}</p>`).join('')}<p>${esc(c.effect||'')}</p>${c.unresolved?'<p class="warning">Printing unresolved; no artwork guessed.</p>':c.representative?'<p class="warning">This inventory counts Energy by name, without a known printing.</p>':''}<p>${esc(c.inventory?.notes||'')}</p><p class="hint">${esc(c.inventory?.idstatus||'')} · ${esc(c.inventory?.source||'')}</p><p>${c.quantity} owned · ${remaining(c)} available${current()?' after current deck and exclusions':''}</p></div></div>`;
  if(current()) {
    const block=G.addBlock(state,current(),c);
    $('detail-info').insertAdjacentHTML('beforeend', `${cardGuidance(c,current())}<div class="settings-row"><button id="detail-add" ${!state.canEdit||block?'disabled':''}>Add to deck</button></div>`);
    $('detail-add').onclick=async()=>{await adjust(c.id,1);showDetail(state.cards[c.id]);};
    wireGuideCards($('detail-body'));
  }
  if(state.canEdit && c.quantity>0) {
    $('detail-info').insertAdjacentHTML('beforeend', `<form id="inventory-form"><h3>Manage owned copies</h3><p>Remove copies entered by mistake, or archive traded copies with a note. Remove them from saved decks first if needed.</p><label>Copies<input id="change-quantity" type="number" min="1" max="${c.quantity}" value="1" required></label><label class="file-label">Trade note<textarea id="trade-note" maxlength="2000" rows="3" placeholder="Who you traded with and what you received"></textarea></label><div class="settings-row"><button value="remove">Remove mistaken copies</button><button value="trade">Archive trade</button></div><p id="change-status" role="status"></p></form>`);
    const revision=state.revision;
    $('inventory-form').onsubmit=async e=>{
      e.preventDefault(); if(busy)return;
      const action=e.submitter?.value; if(!action)return;
      const quantity=Number($('change-quantity').value), note=$('trade-note').value.trim();
      if(action==='trade'&&!note){$('change-status').textContent='Enter a note about the trade.';return;}
      if(action==='remove'&&!confirm(`Remove ${quantity} copies of ${c.name} entered by mistake?`))return;
      busy=true;
      try{state={...await api(action,{revision,id:c.id,quantity,note}),canEdit:state.canEdit};$('detail').close();render();notice(action==='trade'?'Trade archived.':'Mistaken copies removed.');}
      catch(error){$('change-status').textContent=error.message;}
      finally{busy=false;}
    };
  }
  setupFaces($('detail-body'));
  const opening=!$('detail').open;
  if(opening)$('detail').showModal();
  animateDetail(opening?source:null);

}
function animateDetail(source) {
  const dialog=$('detail'), card=dialog.querySelector('.detail-face');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  card.onpointermove=e=>{
    if(e.pointerType==='touch')return;
    const bounds=card.getBoundingClientRect();
    const x=(e.clientX-bounds.left)/bounds.width-.5;
    const y=(e.clientY-bounds.top)/bounds.height-.5;
    card.style.transform=`perspective(1200px) rotateX(${-y*10}deg) rotateY(${x*12}deg) scale(1.015)`;
  };
  card.onpointerleave=()=>{card.style.transform='';};
  if(!source)return;
  const from=source.getBoundingClientRect(), to=card.getBoundingClientRect();
  const flying=document.createElement('div');
  flying.className='face detail-flight'; flying.innerHTML=source.innerHTML;
  flying.setAttribute('aria-hidden','true');
  Object.assign(flying.style,{left:`${from.left}px`,top:`${from.top}px`,width:`${from.width}px`,height:`${from.height}px`});
  dialog.append(flying);card.style.opacity='0';
  const animation=flying.animate([
    {transform:'perspective(1400px) translate(0,0) scale(1) rotateY(0deg)'},
    {transform:`perspective(1400px) translate(${to.left-from.left}px,${to.top-from.top}px) scale(${to.width/from.width},${to.height/from.height}) rotateY(360deg)`}
  ],{duration:720,easing:'cubic-bezier(.22,.7,.2,1)',fill:'forwards'});
  const cleanup=()=>{flying.remove();card.style.opacity='';dialog.removeEventListener('close',cancel);};
  const cancel=()=>{animation.cancel();cleanup();};
  dialog.addEventListener('close',cancel,{once:true});
  animation.finished.then(cleanup,cleanup);
}
const lookupCache=new Map();
const normalize = CardLookup.normalize;
async function connectSource(kind, force=false) {
  const info=await api('connections');
  if(info[kind].connected&&!force)return;
  const rpcId=`tcgdex-${kind}-${Date.now()}`;
  const token=await new Promise((resolve,reject)=>{
    const receive=event=>{
      if(event.source!==window.parent||event.data?.rpcId!==rpcId)return;
      window.removeEventListener('message',receive);
      if(event.data.token)resolve(event.data.token);else reject(new Error(event.data.error||'Connection canceled.'));
    };
    window.addEventListener('message',receive);
    window.parent.postMessage({powerboxRequest:{rpcId,query:[info[kind].query],saveLabel:{defaultText:kind==='details'?'Look up Pokémon card details':'Download Pokémon card faces'}}},'*');
  });
  await api('connect',{kind,token});
}
async function lookup(path) {
  if(lookupCache.has(path))return lookupCache.get(path);
  const data=await api('lookup',{path});lookupCache.set(path,data);return data;
}
function unresolvedCard(row) {
  return {id:row.localKey,name:row.name,quantity:row.quantity,category:row.scope||'Pokemon',set:{name:row.set||'Unspecified printing'},localId:row.number||'',hp:row.hp||null,inventory:row,unresolved:true,types:[]};
}
async function resolveRow(row) {
  if(row.pending&&!row.override)return unresolvedCard(row);
  if(row.pooled&&!row.override){
    const index=await lookup('cards');
    const matches=index.filter(c=>normalize(c.name)===normalize(row.name)&&c.image);
    if(!matches.length)throw new Error('No representative art found. Keep this Energy as unresolved or supply a card ID.');
    const card=await lookup(`cards/${encodeURIComponent(matches[0].id)}`);
    return {...card,id:row.localKey,name:row.name,quantity:row.quantity,category:'Energy',types:types.filter(t=>row.name.toLowerCase().startsWith(t.toLowerCase())),detailsVersion:1,energyType:row.type.startsWith('Basic')?'Normal':'Special',inventory:row,representative:true,representativeCardId:card.id,set:{name:'Unspecified printing'},localId:''};
  }
  const card=await CardLookup.resolve(row,lookup);
  if(!card.id||!card.name)throw new Error('Invalid card response.');
  if(row.scope&&card.category!==row.scope)throw new Error(`This ID is a ${card.category}, but this file contains ${row.scope} cards.`);
  if(row.name&&!row.override&&normalize(row.name)!==normalize(card.name))throw new Error(`ID resolves to ${card.name}. Confirm by entering its ID: ${card.id}`);
  return {...card,quantity:row.quantity,inventory:row,detailsVersion:1};
}
function preview() {
  $('import-preview').innerHTML=resolved.map((r,i)=>`<div class="preview-row ${r.error?'error':''}">${r.card?`${r.card.unresolved?'Unresolved':r.card.representative?'Representative art':'✓'} ${r.row.quantity}× ${esc(r.card.name)} · ${esc(r.card.set?.name)} #${esc(r.card.localId)}`:`Row ${r.row.line}: ${esc(r.error)} <input aria-label="Correct card ID for row ${r.row.line}" data-correction="${i}" placeholder="TCGdex card ID" value="${esc(r.row.override||r.row.id||'')}"> <button data-retry="${i}">Retry</button> <button data-keep="${i}">Keep unresolved</button>`}</div>`).join('');
  $('import-preview').querySelectorAll('[data-retry]').forEach(b=>b.onclick=async()=>{b.disabled=true;const i=Number(b.dataset.retry),r=resolved[i];r.row.override=$('import-preview').querySelector(`[data-correction="${i}"]`).value.trim();try{r.card=await resolveRow(r.row);r.error=null;}catch(e){r.error=e.message;}preview();});
  $('import-preview').querySelectorAll('[data-keep]').forEach(b=>b.onclick=()=>{const r=resolved[Number(b.dataset.keep)];r.card=unresolvedCard(r.row);r.error=null;preview();});
  $('commit').hidden=!resolved.length||resolved.some(r=>!r.card);
  $('commit').textContent=`Import ${resolved.reduce((n,r)=>n+r.row.quantity,0)} copies`;
}
async function cacheFaces(cards) {
  const candidates=cards.filter(c=>c.image&&!c.unresolved);
  if(!candidates.length){notice('Cards saved. Faces can be fetched after card details are resolved.');return;}
  try{await connectSource('images');}catch(e){notice(`Cards saved. ${e.message} Use “Fetch missing faces” to try again.`);return;}
  let failures=0;
  for(const [i,c] of candidates.entries()){
    notice(`Saving card faces ${i+1}/${candidates.length}…`);
    try{await api('cache-image',{id:c.id});}catch{failures++;}
  }
  const unavailable=cards.filter(c=>!c.image&&!c.unresolved).length;
  notice(failures?`Cards saved. ${failures} faces could not be fetched. Use “Fetch missing faces” to retry.`:unavailable?`Cards saved. ${unavailable} entries have no artwork available from the card source.`:'Card details and faces saved.');renderCards();
}
$('resolve').onclick=async()=>{
  $('resolve').disabled=true;$('commit').hidden=true;resolved=[];$('import-preview').textContent='';
  try{
    const {rows,scope}=await api('preview',{csv:$('csv-text').value});importRevision=state.revision;importScope=scope;
    $('import-status').textContent='Connect TCGdex to look up your cards…';await connectSource('details');
    for(const row of rows){$('import-status').textContent=`Looking up ${resolved.length+1} of ${rows.length}…`;try{resolved.push({row,card:await resolveRow(row)});}catch(e){resolved.push({row,error:e.message});}}
    $('import-status').textContent=`${importScope||'Full collection'} import. Review every printing below. Unresolved cards keep their original notes without guessed artwork.`;preview();
  }catch(e){$('import-status').textContent=e.message;}
  finally{$('resolve').disabled=false;}
};
$('commit').onclick=async()=>{
  $('commit').disabled=true;
  try{state={...await api('import',{revision:importRevision,mode:$('import-mode').value,scope:importScope,cards:resolved.map(r=>r.card)}),canEdit:state.canEdit};$('import-dialog').close();render();await cacheFaces([...new Map(resolved.map(r=>[r.card.id,r.card])).values()]);resolved=[];$('commit').hidden=true;}
  catch(e){$('import-status').textContent=e.message;}
  finally{$('commit').disabled=false;}
};
$('csv-file').onchange=async e=>{const file=e.target.files[0];if(file){if(file.size>2000000){$('import-status').textContent='CSV must be under 2 MB.';return;}$('csv-text').value=await file.text();$('commit').hidden=true;}};
$('csv-text').oninput=()=>{$('commit').hidden=true;};
$('import-open').onclick=()=>$('import-dialog').showModal();
$('retry-images').onclick=async()=>{$('retry-images').disabled=true;try{await cacheFaces(Object.values(state.cards).filter(c=>c.quantity>0));}finally{$('retry-images').disabled=false;}};
$('collection-tab').onclick=()=>{selected=null;render();};
$('new-deck').onclick=()=>{const name=prompt('Name your new deck');if(!name?.trim())return;const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');selected=id;saveDecks([...state.decks,{id,name:name.trim(),types:[],exclusions:[],cards:{}}]);};
$('export').onclick=()=>location.assign('api/export/collection');
$('print-open').onclick=()=>location.assign(current()?`print-deck?id=${encodeURIComponent(current().id)}`:'print-inventory');
$('type-filter').insertAdjacentHTML('beforeend',types.map(t=>`<option>${t}</option>`).join(''));
for(const id of ['search','category','type-filter','available-only'])$(id).addEventListener('input',()=>state&&renderCards());
api('state').then(s=>{state=s;selected=PageNavigation.deck();render();}).catch(e=>notice(`Could not load collection: ${e.message}`));

for(const kind of ['details','images'])$('connect-'+kind).onclick=async()=>{try{await connectSource(kind,true);notice('Card source connected.');}catch(e){notice(e.message);}};

function guideMatches(card, deck) {
  if (guideStep === 'trainers') return card.category === 'Trainer';
  if (guideStep === 'energy') return card.category === 'Energy';
  if (guideStep === 'review') return true;
  if (card.category !== 'Pokemon') return false;
  return !deck.types.length || G.attackFit(card, deck.types).fits || (card.abilities || []).length || card.unresolved || (card.types || []).some(t => deck.types.includes(t));
}
function cardGuidance(card, deck) {
  const advice = G.recommendation(state, deck, card);
  const plan = card.category === 'Pokemon' ? G.linePlan(state, deck, card) : null;
  const block = G.addBlock(state, deck, card);
  return `<div class="card-guidance"><p>${esc(advice.reason)}</p>${block ? `<p class="warning">${esc(block)}</p>` : ''}${plan && !plan.error && plan.ids.length > 1 ? `<button data-line="${esc(card.id)}" ${state.canEdit?'':'disabled'}>Add evolution line (${plan.ids.length})</button>` : ''}${card.category === 'Pokemon' && deck.cards[card.id] ? `<button data-main="${esc(card.id)}" ${state.canEdit?'':'disabled'}>${deck.mainAttacker===card.id?'Main attacker ✓':'Choose as main attacker'}</button>` : ''}</div>`;
}
function wireGuideCards(root) {
  root.querySelectorAll('[data-line]').forEach(b=>b.onclick=async()=>{
    const plan=G.linePlan(state,current(),state.cards[b.dataset.line]);
    if(plan.error){notice(plan.error);return;}
    const names=plan.ids.map(id=>state.cards[id].name).join(' → ');
    if(confirm(`Add these available copies? ${names}`)){await editDeck(d=>{plan.ids.forEach(id=>d.cards[id]=(d.cards[id]||0)+1);d.mainAttacker=b.dataset.line;});showDetail(state.cards[b.dataset.line]);}
  });
  root.querySelectorAll('[data-main]').forEach(b=>b.onclick=async()=>{await editDeck(d=>d.mainAttacker=b.dataset.main);showDetail(state.cards[b.dataset.main]);});
}
function renderGuide(deck) {
  const review=G.review(state,deck), main=state.cards[deck.mainAttacker];
  const missing=Object.values(state.cards).filter(c=>c.quantity>0&&!c.unresolved&&!c.detailsVersion);
  const steps=[['attacker','1. Main attacker'],['support','2. Supporting Pokémon'],['trainers','3. Trainers'],['energy','4. Energy'],['review','5. Review']];
  const explanations={attacker:'Pick an attacker whose costs fit your Energy and whose evolution line you can assemble. Add it, then choose it as your main attacker.',support:'Look for backups, complete evolution lines, and useful Abilities. An off-type Pokémon can help without attacking.',trainers:'Look for draw, search, switching, recovery, and Energy support. Suggested roles are text-based hints; inspect the printed conditions.',energy:'Match your attackers’ colored costs. Colorless costs accept any Energy; Special Energy is never assumed to cover every type.',review:'Fix construction issues, then consider the strategic suggestions. You can keep an unfinished draft at any time.'};
  const advice=guideStep==='review'?review.advice:review.advice.slice(0,3);
  $('builder-guide').innerHTML=`<div class="guide-top"><div><strong>${main&&deck.cards[main.id]?`Main attacker: ${esc(main.name)}`:'Choose a plan for this deck'}</strong></div><label><input id="draft-mode" type="checkbox" ${deck.allowDraft?'checked':''} ${state.canEdit?'':'disabled'}> Allow draft additions</label></div><div class="guide-steps">${steps.map(([id,label])=>`<button data-step="${id}" class="${guideStep===id?'active':''}">${label}</button>`).join('')}</div><p>${explanations[guideStep]}</p><label class="hint"><input id="show-all-guide" type="checkbox" ${showAllCards?'checked':''}> Browse all cards instead of this step’s suggestions</label>${missing.length?`<div class="metadata-alert"><p>${missing.length} cards need updated evolution details. Refreshing preserves quantities, notes, decks, and faces.</p><button id="refresh-details" ${state.canEdit?'':'disabled'}>Update card details</button></div>`:''}<div class="guide-columns"><div><h3>Deck rules</h3>${review.rules.length?review.rules.map(t=>`<p class="warning">${esc(t)}</p>`).join(''):'<p>Basic construction checks pass.</p>'}</div><div><h3>Build consistency</h3><p>${review.groups.Pokemon} Pokémon · ${review.groups.Trainer} Trainers · ${review.groups.Energy} Energy</p><p class="hint">Starting suggestion: 16 / 32 / 12. Adapt to your attackers and available cards.</p><p>${review.openingChance===null?'Add at least 7 cards to estimate an opening hand.':`${review.openingChance}% chance of a Basic in a random opening 7 (${review.basics} Basics in this ${G.total(deck)}-card draft).`}</p><button id="sample-hand" ${G.total(deck)<7?'disabled':''}>Draw a sample hand</button></div></div><div class="guide-advice">${advice.map(t=>`<p>• ${esc(t)}</p>`).join('')}</div><div id="sample-result" aria-live="polite"></div>`;
  $('builder-guide').querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{guideStep=b.dataset.step;$('category').value='';renderGuide(deck);renderCards();});
  $('draft-mode').onchange=e=>editDeck(d=>d.allowDraft=e.target.checked);
  $('show-all-guide').onchange=e=>{showAllCards=e.target.checked;renderCards();};
  $('sample-hand').onclick=()=>{
    const pool=Object.entries(deck.cards).flatMap(([id,n])=>Array(n).fill(id));
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    const hand=pool.slice(0,7), hasBasic=hand.some(id=>G.basic(state.cards[id]));
    $('sample-result').innerHTML=`<h3>Sample hand ${hasBasic?'· Basic available':'· No Basic: mulligan'}</h3><p>${hand.map(id=>esc(state.cards[id].name)).join(' · ')}</p><p class="hint">A learning aid, not a strength rating. This draw does not change your deck.</p>`;
  };
  $('refresh-details')?.addEventListener('click',refreshDetails);
}
async function refreshDetails() {
  if(busy)return;busy=true;
  $('refresh-details').disabled=true;
  let failed=0;
  try{
    await connectSource('details');
    const cards=Object.values(state.cards).filter(c=>c.quantity>0&&!c.unresolved&&!c.detailsVersion);
    for(const [i,c] of cards.entries()){
      notice(`Updating evolution details ${i+1}/${cards.length}…`);
      try{state={...await api('refresh-card',{id:c.id,revision:state.revision}),canEdit:state.canEdit};}catch(e){failed++;notice(e.message);}
    }
    notice(failed?`${failed} cards could not be updated. You can retry Update card details.`:'Evolution details updated. Your quantities and decks are unchanged.');
  }catch(e){notice(e.message);}finally{busy=false;render();}
}

let addedCard=null, addRevision, addLookup=0, matchingCards=[], matchIndex=0, addedWithoutArtwork=false;
function resetAddPreview(message='Look up a card to see its face') {
  addedCard=null;
  $('add-save').disabled=true; $('add-save').textContent='Add to collection'; $('add-quantity').disabled=true;
  $('preview-face').textContent=message; $('preview-details').textContent='';
  $('match-count').textContent='No printing selected';
  $('previous-match').disabled=true; $('next-match').disabled=true;
}
$('previous-match').onclick=()=>showMatch(matchIndex-1);
$('next-match').onclick=()=>showMatch(matchIndex+1);
$('add-open').onclick=()=>{
  addLookup++; matchingCards=[]; matchIndex=0; resetAddPreview();
  $('add-status').textContent='';
  $('card-search-form').reset(); $('add-quantity').value=1; $('add-dialog').showModal();
};
$('add-dialog').addEventListener('close',()=>{addLookup++; addedCard=null;});
async function showMatch(index) {
  if(busy||index<0||index>=matchingCards.length)return;
  matchIndex=index;
  await chooseCard(matchingCards[index].id);
}
function enableCardAddition(card, revision, withoutArtwork=false) {
  addedCard={...card,detailsVersion:1}; addRevision=revision; addedWithoutArtwork=withoutArtwork;
  $('add-save').disabled=false; $('add-quantity').disabled=false;
  $('add-save').textContent=withoutArtwork?'Add without artwork':'Add to collection';
}
async function chooseCard(id) {
  const request=++addLookup;
  resetAddPreview('Loading card face…');
  $('match-count').textContent=`Printing ${matchIndex+1} of ${matchingCards.length}`;
  $('add-status').textContent='Loading card details and face…';
  const revision=state.revision;
  let card;
  try {
    card=await lookup(`cards/${encodeURIComponent(id)}`);
    if(request!==addLookup)return;
    if(!card.id||!card.name)throw new Error('Invalid card response.');
    $('preview-details').innerHTML=`<h3>${esc(card.name)}</h3><p>${esc(card.set?.name)} · #${esc(CardLookup.printedLabel(card))} · ${esc(card.id)}</p><p>${esc(card.category)} · ${esc(card.rarity)} · ${esc(card.stage||card.energyType||card.trainerType)}</p>`;
    if(!CardLookup.hasArtwork(card)){
      $('preview-face').textContent='No artwork available';
      $('add-status').textContent='TCGdex has no artwork for this printing. Check the name, set, and card number before adding.';
      enableCardAddition(card,revision,true);
      return;
    }
    await connectSource('images');
    if(request!==addLookup)return;
    await api('preview-image',{id:card.id});
    if(request!==addLookup)return;
    const img=new Image();
    img.alt=`${card.name} · ${card.set?.name||''} #${card.localId||''}`;
    await new Promise((resolve,reject)=>{
      img.onload=resolve;
      img.onerror=()=>reject(new Error('Could not display the card face.'));
      img.src=`images/${encodeURIComponent(card.id)}`;
    });
    if(request!==addLookup)return;
    $('preview-face').replaceChildren(img);
    enableCardAddition(card,revision);
    $('add-status').textContent=matchingCards.length>1?'Use the arrows to find your printing, then add the card shown.':'Check the card face and printing, then confirm the number of copies.';
  } catch(error) {
    if(request!==addLookup)return;
    $('preview-face').textContent='Face unavailable';
    if(card?.id&&card?.name){
      enableCardAddition(card,revision,true);
      $('add-status').textContent=`${error.message} Retry the preview, or check the card details and add without artwork.`;
    }else $('add-status').textContent=`${error.message} No copies added. Retry loading the card details.`;
    const retry=document.createElement('button');
    retry.type='button'; retry.textContent='Retry face preview';
    retry.onclick=()=>chooseCard(id);
    $('preview-face').append(retry);
  } finally {
    if(request===addLookup){
      $('previous-match').disabled=matchIndex===0;
      $('next-match').disabled=matchIndex===matchingCards.length-1;
    }
  }
}
$('card-search-form').onsubmit=async e=>{
  e.preventDefault(); const request=++addLookup;
  $('card-search').disabled=true; resetAddPreview('Look up a card to see its face'); matchingCards=[];
  $('add-status').textContent='Looking up cards…';
  try{
    const query=$('card-query').value.trim(), set=$('card-set').value.trim(), number=$('card-number').value.trim();
    if(!query&&!(set&&number))throw new Error('Enter a name or card ID, or both a set and card number.');
    await connectSource('details');
    if(set&&!number)throw new Error('Enter a printed card number.');
    const result=await CardLookup.searchPreview({name:query,set,number},lookup);
    if(request!==addLookup)return;
    matchingCards=result;
    if(matchingCards.length)await showMatch(0);
    else $('add-status').textContent='No cards found. Try another name or a set and card number.';
  }catch(error){if(request===addLookup)$('add-status').textContent=error.message;}
  finally{$('card-search').disabled=false;}
};
$('add-form').onsubmit=async e=>{
  e.preventDefault(); if(!addedCard||busy)return;
  busy=true; $('add-save').disabled=true;
  const card={...addedCard,quantity:Number($('add-quantity').value)}, withoutArtwork=addedWithoutArtwork;
  try{
    state={...await api('import',{revision:addRevision,mode:'add',cards:[card]}),canEdit:state.canEdit};
    $('add-dialog').close(); render();
    if(withoutArtwork)notice('Card added without artwork.');
    else await cacheFaces([card]);
  }catch(error){$('add-status').textContent=error.message;}
  finally{busy=false; $('add-save').disabled=!addedCard;}
};
$('archive-open').onclick=()=>{
  const trades=state.trades||[];
  $('archive-list').innerHTML=trades.slice().reverse().map(t=>`<article class="preview-row"><strong>${t.card.quantity}× ${esc(t.card.name)}</strong><p>${esc(t.card.set?.name)} · #${esc(t.card.localId)} · Archived ${esc(new Date(t.date).toLocaleString())}</p><p class="trade-note">${esc(t.note)}</p></article>`).join('')||'<p>No trades archived yet. Open a card in your collection to record a trade.</p>';
  $('archive-dialog').showModal();
};

for(const event of ['hashchange','popstate'])window.addEventListener(event,()=>{
  if(!state)return;
  selected=PageNavigation.deck();render();
});

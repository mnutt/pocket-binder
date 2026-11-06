/* Card printing resolution shared by individual lookup and CSV imports. */
(function(root) {
  'use strict';
  const normalize = text => String(text||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  // Set codes from the collection workbook, plus common English expansion codes.
  const aliases = {
    "svi": "Scarlet & Violet",
    "lor": "Lost Origin",
    "tef": "Temporal Forces",
    "shf": "Shining Fates",
    "brs": "Brilliant Stars",
    "meg": "Mega Evolution",
    "pgo": "Pokémon GO",
    "scr": "Stellar Crown",
    "pal": "Paldea Evolved",
    "pre": "Prismatic Evolutions",
    "evs": "Evolving Skies",
    "mew": "sv03.5",
    "twm": "Twilight Masquerade",
    "ssp": "Surging Sparks",
    "fst": "Fusion Strike",
    "asr": "Astral Radiance",
    "viv": "Vivid Voltage",
    "wht": "White Flare",
    "dri": "Destined Rivals",
    "blk": "Black Bolt",
    "jtg": "Journey Together",
    "crz": "Crown Zenith",
    "obf": "Obsidian Flames",
    "daa": "Darkness Ablaze",
    "cpa": "Champion's Path",
    "ces": "Celestial Storm",
    "scarletviolet151": "sv03.5",
    "swshblackstarpromo": "swshp",
    "swsh": "swshp",
    "ssh": "Sword & Shield",
    "rcl": "Rebel Clash",
    "cre": "Chilling Reign",
    "sit": "Silver Tempest",
    "paf": "Paldean Fates",
    "par": "Paradox Rift",
    "sfa": "Shrouded Fable",
    "cel": "Celebrations"
  };
  const numberKey = text => String(text||'').trim().toLowerCase().replace(/^0+(?=\d)/,'');
  function printedNumber(value) {
    const parts=String(value||'').trim().split('/');
    if(parts.length>2||!parts[0]||parts.some(p=>!/^\s*[a-z0-9]+\s*$/i.test(p)))throw new Error('Enter a printed card number such as 097/165.');
    return {number:numberKey(parts[0]),total:parts[1] ? numberKey(parts[1]) : null};
  }
  async function findMatches(row, lookup) {
    if(row.override||row.id)return [await lookup(`cards/${encodeURIComponent(row.override||row.id)}`)];
    const printed=printedNumber(row.number), label=row.set||row.setcode;
    let candidates;
    if(label){
      const key=normalize(label), target=normalize(aliases[key]||label);
      const sets=await lookup('sets');
      const matching=sets.filter(s=>[s.id,s.name,s.tcgOnline,s.abbreviation?.official].some(v=>v&&normalize(v)===target));
      if(matching.length!==1)throw new Error('Set not found uniquely. Use its full name or a TCGdex card ID.');
      const set=await lookup(`sets/${encodeURIComponent(matching[0].id)}`);
      candidates=set.cards.filter(c=>numberKey(c.localId)===printed.number);
    }else{
      if(!row.name||!printed.total)throw new Error('Without a set, enter the card name and full printed number/total.');
      const cards=await lookup('cards');
      candidates=cards.filter(c=>normalize(c.name)===normalize(row.name)&&numberKey(c.localId)===printed.number);
    }
    const matches=[];
    // Every candidate must be checked: a failed request must not imply uniqueness.
    for(const candidate of candidates){
      const card=await lookup(`cards/${encodeURIComponent(candidate.id)}`);
      if(printed.total){
        let count=card.set?.cardCount?.official;
        if(count==null&&card.set?.id){
          const set=await lookup(`sets/${encodeURIComponent(card.set.id)}`);
          count=set.cardCount?.official;
        }
        if(count==null)throw new Error('The printed total cannot be verified. Use a specific card ID.');
        if(numberKey(count)!==printed.total)continue;
      }
      if(row.name&&normalize(card.name)!==normalize(row.name))continue;
      matches.push(card);
    }
    if(matches.length===0)throw new Error('No printing matches that name, set, and printed number/total. Check the details or use a card ID.');
    return matches;
  }
  async function resolve(row, lookup) {
    const matches=await findMatches(row,lookup);
    if(matches.length>1)throw new Error(`More than one printing matches. Specify a set or card ID: ${matches.map(c=>`${c.set?.name||c.set?.id||''} (${c.id})`).join(', ')}`);
    return matches[0];
  }
  const hasArtwork = card => typeof card.image==='string'&&card.image.trim().length>0;
  async function searchPreview(row, lookup) {
    let matches;
    if(row.set||row.number){
      matches=await findMatches(row,lookup);
    }else{
      const index=await lookup('cards'), query=(row.name||'').trim(), term=normalize(query);
      const exact=index.find(c=>c.id.toLowerCase()===query.toLowerCase());
      matches=exact?[exact]:index.filter(c=>term&&normalize(c.name).includes(term));
    }
    // A set symbol is not card artwork. Brief results already expose image URLs.
    return [...matches.filter(hasArtwork), ...matches.filter(c=>!hasArtwork(c))];
  }
  function printedLabel(card) {
    if(card.representative)return '';
    const number=String(card.localId||card.inventory?.number||'').trim();
    if(!number||number.includes('/'))return number;
    const total=card.set?.cardCount?.official;
    if(total>0){
      const padded=/^\d+$/.test(number)?number.padStart(String(total).length,'0'):number;
      return `${padded}/${total}`;
    }
    const original=String(card.inventory?.number||'').trim();
    if(original.includes('/')&&numberKey(original.split('/')[0])===numberKey(number))return original;
    return number;
  }
  const api={normalize,resolve,findMatches,searchPreview,hasArtwork,printedLabel,aliases};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CardLookup=api;
})(typeof globalThis!=='undefined'?globalThis:this);

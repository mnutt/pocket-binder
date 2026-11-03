/* Pure deck-building guidance, shared by the browser and Node tests. */
(function (root) {
  'use strict';
  const nameKey = s => String(s || '').normalize('NFKC').toLowerCase().trim();
  const total = deck => Object.values(deck.cards).reduce((a, b) => a + b, 0);
  const basicEnergy = c => c.category === 'Energy' && c.energyType === 'Normal';
  const basic = c => c.category === 'Pokemon' && c.stage === 'Basic' && !c.unresolved;
  const namedCount = (state, deck, name) => Object.entries(deck.cards).reduce((n, [id, q]) => n + (nameKey(state.cards[id]?.name) === nameKey(name) ? q : 0), 0);
  const remaining = (state, deck, id) => (state.cards[id]?.quantity || 0) - (deck.cards[id] || 0) - state.decks.filter(d => deck.exclusions.includes(d.id)).reduce((n, d) => n + (d.cards[id] || 0), 0);
  function attackFit(card, chosen) {
    if (!chosen.length) return {fits: true, reason: 'Choose Energy types to compare attack costs.'};
    const attacks = card.attacks || [];
    if (!attacks.length) return {fits: false, unknown: true, reason: 'No attack-cost data. Inspect this card before choosing it.'};
    const usable = attacks.filter(a => (a.cost || []).every(t => t === 'Colorless' || chosen.includes(t)));
    const costs = usable.map(a => (a.cost || []).length);
    return usable.length ? {fits: true, cheap: Math.min(...costs) <= 2, reason: `${usable.map(a => a.name).join(', ')} can use your selected Energy types.`, attacks: usable} : {fits: false, reason: 'Its attack costs need Energy outside your selected types.'};
  }
  function energyTypes(card) {
    if (!basicEnergy(card)) return [];
    return (card.types || []).length ? card.types : ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy'].filter(t => card.name.toLowerCase().includes(t.toLowerCase()));
  }
  function shortage(state, deck, name) {
    const cards = Object.values(state.cards).filter(c => nameKey(c.name) === nameKey(name) && c.quantity > 0);
    const reserved = state.decks.filter(d => deck.exclusions.includes(d.id) && cards.some(c => d.cards[c.id]));
    return reserved.length ? `Needs ${name}; copies are held in ${reserved.map(d => d.name).join(', ')}.` : `Needs ${name}; no available matching printing.`;
  }
  function linePlan(state, deck, card, includeTarget = true) {
    const walk = (c, trail) => {
      if (c.unresolved) return {error: `${c.name}: printing unresolved.`};
      if (basic(c)) return {ids: []};
      if (!c.evolveFrom) return {error: `${c.name}: evolution data missing or special setup required. Refresh details or inspect its rules.`};
      if (trail.includes(nameKey(c.name))) return {error: 'Evolution data contains a cycle.'};
      const candidates = Object.values(state.cards).filter(p => p.category === 'Pokemon' && !p.unresolved && nameKey(p.name) === nameKey(c.evolveFrom) && ((deck.cards[p.id] || 0) > 0 || remaining(state, deck, p.id) > 0)).sort((a, b) => (deck.cards[b.id] || 0) - (deck.cards[a.id] || 0) || a.id.localeCompare(b.id));
      let failure = shortage(state, deck, c.evolveFrom);
      for (const parent of candidates) {
        const result = walk(parent, [...trail, nameKey(c.name)]);
        if (!result.error) return {ids: [...result.ids, ...((deck.cards[parent.id] || 0) > 0 ? [] : [parent.id])]};
        failure = result.error;
      }
      return {error: failure};
    };
    const result = walk(card, []);
    if (result.error) return result;
    const ids = [...new Set(result.ids), ...(includeTarget ? [card.id] : [])];
    const counts = {};
    for (const id of ids) {
      const c = state.cards[id];
      if (remaining(state, deck, id) < 1) return {error: `${c.name}: no unreserved copies left.`};
      counts[nameKey(c.name)] = (counts[nameKey(c.name)] || 0) + 1;
      if (!basicEnergy(c) && namedCount(state, deck, c.name) + counts[nameKey(c.name)] > 4) return {error: `Four-copy limit for ${c.name}, across all printings.`};
    }
    if (total(deck) + ids.length > 60) return {error: 'This evolution line would take the deck above 60 cards.'};
    return {ids};
  }
  function trainerAdvice(card, state, deck) {
    const text = [card.effect || '', ...(card.attacks || []).map(a => a.effect || ''), ...(card.abilities || []).map(a => a.effect || '')].join(' ');
    const roles = [];
    if (/draw|shuffle.*hand.*deck/i.test(text)) roles.push('Draw');
    if (/search your deck/i.test(text)) roles.push('Search');
    if (/switch|retreat cost/i.test(text)) roles.push('Switching');
    if (/discard pile/i.test(text) && /put|shuffle|attach/i.test(text)) roles.push('Recovery');
    if (/attach/i.test(text) && /energy/i.test(text)) roles.push('Energy support');
    const requirements = {
      'Ribbon Badge': ['Sylveon V'], 'Elemental Badge': ['Vaporeon V', 'Jolteon V', 'Flareon V'],
      'Moon & Sun Badge': ['Espeon V', 'Umbreon V']
    };
    const names = Object.keys(deck.cards).map(id => state.cards[id].name);
    const required = requirements[card.name];
    let warning = required && !required.some(n => names.includes(n)) ? `Needs ${required.join(' or ')} in this deck.` : '';
    if (card.name === 'Choice Belt') warning = 'Useful against opposing Pokémon V; it does not boost damage against every Pokémon.';
    if (card.name === 'Future Booster Energy Capsule' && !Object.keys(deck.cards).some(id => /future/i.test(JSON.stringify(state.cards[id].suffix || '')) || /^Iron /.test(state.cards[id].name))) warning = 'Needs a Future Pokémon; none is identified in this deck. Check the card text.';
    if (card.name === 'Rapid Strike Scroll of the Flying Dragon') warning = 'Requires a Rapid Strike Pokémon and its printed attack Energy. Check both before including it.';
    if (card.name === 'Magma Basin' && !deck.types.includes('Fire')) warning = 'Supports Fire Pokémon with Fire Energy from the discard pile; your Energy focus does not include Fire.';
    return {roles, warning, reason: warning || (roles.length ? `${roles.join(' / ')} support. Check the printed conditions.` : 'Read its effect to decide how it supports your plan.')};
  }
  function recommendation(state, deck, card) {
    if (remaining(state, deck, card.id) <= 0) return {score: -100, reason: 'No copies left after this deck and exclusions.'};
    if (card.unresolved) return {score: -80, reason: 'Unresolved printing: inspect before adding.'};
    if (card.category === 'Trainer') {
      const advice = trainerAdvice(card, state, deck);
      return {...advice, score: advice.warning ? 0 : advice.roles.length ? 45 : 15};
    }
    if (card.category === 'Energy') return basicEnergy(card) ? {score: energyTypes(card).some(t => deck.types.includes(t)) ? 50 : 5, reason: `${energyTypes(card).join(' / ')} Basic Energy; any Basic Energy also pays Colorless costs.`} : {score: 10, reason: 'Special Energy has conditions; it is not assumed to provide every type.'};
    const fit = attackFit(card, deck.types), plan = linePlan(state, deck, card);
    if (plan.error) return {score: -30, reason: plan.error};
    const support = (card.abilities || []).length > 0;
    return {score: (fit.fits ? 50 : support ? 20 : 0) + (fit.cheap ? 10 : 0) + (card.id === deck.mainAttacker ? 25 : 0), reason: `${fit.reason}${plan.ids.length > 1 ? ' Add its available evolution line.' : basic(card) ? ' Basic Pokémon: no evolution setup.' : ' Its evolution line is already in the deck.'}${!fit.fits && support ? ' Its Ability may still provide support.' : ''}`};
  }
  function addBlock(state, deck, card) {
    if (remaining(state, deck, card.id) <= 0) return 'No unreserved copies left.';
    if (deck.allowDraft) return '';
    if (total(deck) >= 60) return 'The deck already has 60 cards.';
    if (!basicEnergy(card) && namedCount(state, deck, card.name) >= 4) return 'Four-copy name limit reached.';
    if (card.category === 'Pokemon') {
      const plan = linePlan(state, deck, card);
      if (plan.error) return plan.error;
      if (plan.ids.length > 1) return 'Add the evolution line first, or use Add evolution line.';
    }
    return '';
  }
  function review(state, deck) {
    const cards = Object.entries(deck.cards).map(([id, quantity]) => ({...state.cards[id], quantity}));
    const groups = {Pokemon: 0, Trainer: 0, Energy: 0}, roles = {}, rules = [], advice = [], names = new Map();
    let basics = 0;
    for (const c of cards) {
      groups[c.category] = (groups[c.category] || 0) + c.quantity;
      if (basic(c)) basics += c.quantity;
      if (!basicEnergy(c)) names.set(c.name, (names.get(c.name) || 0) + c.quantity);
      if (c.category === 'Trainer' || c.category === 'Pokemon') {
        const t = trainerAdvice(c, state, deck);
        t.roles.forEach(r => roles[r] = (roles[r] || 0) + c.quantity);
        if (t.warning) advice.push(`${c.name}: ${t.warning}`);
      }
      if (c.category === 'Pokemon' && !basic(c)) {
        const line = linePlan(state, deck, c, false);
        if (line.error) advice.push(line.error);
        else if (line.ids.length) advice.push(`${c.name}: add ${line.ids.map(id => state.cards[id].name).join(' → ')} to complete its evolution line.`);
        if (c.evolveFrom && namedCount(state, deck, c.evolveFrom) < c.quantity) advice.push(`${c.name}: fewer ${c.evolveFrom} copies than evolutions; setup may be inconsistent.`);
      }
    }
    const size = total(deck);
    if (size !== 60) rules.push(`${size}/60 cards: ${size < 60 ? `${60-size} still needed` : `${size-60} too many`}.`);
    if (!basics) rules.push('Include at least one confirmed Basic Pokémon.');
    for (const [name, n] of names) if (n > 4) rules.push(`${name}: ${n} copies across printings; normally at most four.`);
    if (cards.some(c => c.unresolved)) advice.push('Unresolved cards are excluded from Basic counts and evolution recommendations.');
    const attacker = state.cards[deck.mainAttacker];
    if (!attacker || !deck.cards[attacker.id]) advice.push('Choose a main attacker from the Pokémon in this deck.');
    else {
      const fit = attackFit(attacker, deck.types);
      if (!fit.fits) advice.push(`${attacker.name}: ${fit.reason}`);
      const present = [...new Set(cards.filter(basicEnergy).flatMap(energyTypes))];
      if (!(attacker.attacks || []).some(a => (a.cost || []).every(t => t === 'Colorless' || present.includes(t)))) advice.push(`${attacker.name}: the deck’s Basic Energy does not cover an attack yet. Special Energy needs a manual conditions check.`);
      const cheapest = Math.min(...(fit.attacks || attacker.attacks || []).map(a => (a.cost || []).length));
      if (cheapest >= 3 && !roles['Energy support']) advice.push('Your main attacker needs at least three Energy attachments by cost; look for compatible Energy acceleration.');
      if (namedCount(state, deck, attacker.name) < 2) advice.push('Only one copy of the main attacker: consider a backup attacker or another available copy.');
    }
    if (!roles.Draw) advice.push('No draw support identified. Look for Trainers that replenish your hand.');
    if (!roles.Search) advice.push('No deck search identified. Look for ways to find your Basic Pokémon and evolutions.');
    if (!roles.Switching) advice.push('No switching support identified. Consider how you will move a Pokémon out of the Active Spot.');
    if (groups.Energy < 8) advice.push('Few Energy cards so far. Check whether you can reliably power your chosen attacks.');
    if (groups.Energy > 20) advice.push('Many Energy cards: consider whether some slots would serve you better as draw or search support.');
    let noBasic = 1;
    if (size >= 7) for (let i = 0; i < 7; i++) noBasic *= Math.max(0, size-basics-i)/(size-i);
    return {groups, roles, rules, advice: [...new Set(advice)], basics, openingChance: size >= 7 ? Math.round((1-noBasic)*100) : null};
  }
  const api = {total, basicEnergy, basic, namedCount, remaining, attackFit, energyTypes, linePlan, trainerAdvice, recommendation, addBlock, review};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeckGuide = api;
})(typeof globalThis === 'undefined' ? this : globalThis);

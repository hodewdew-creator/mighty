// ===== Types/Consts (JS로 단순화) =====
const RANK_ORDER = { '2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':8,'J':9,'Q':10,'K':11,'A':12 };

// ===== Utilities: deck, shuffle, dealing =====
function createDeckOneJoker() {
  const suits = ['S','D','H','C'];
  const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ suit: s, rank: r, id: `${s}${r}` });
  deck.push({ suit: 'JOKER', rank: 'JOKER', id: 'JOKER' });
  return deck;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function dealTo5(deck, kittySize = 3) {
  const a = [...deck];
  const hands = { 0:[],1:[],2:[],3:[],4:[] };
  for (let round=0; round<10; round++) {
    for (let p=0;p<5;p++) hands[p].push(a.pop());
  }
  const kitty = a.splice(-kittySize);
  return { hands, kitty };
}

// ===== Rules helpers =====
function decideMighty(trump) {
  return trump === 'S' ? { suit:'D', rank:'A', id:'DA' } : { suit:'S', rank:'A', id:'SA' };
}
function jokerCallKiller(trump) {
  return trump === 'C' ? 'D3' : 'C3';
}
function mustFollow(leadSuit, hand, callSuitOnJoker) {
  const targetSuit = callSuitOnJoker ?? leadSuit;
  if (!targetSuit) return hand;
  const candidates = hand.filter(c => c.suit === targetSuit);
  return candidates.length ? candidates : hand;
}

// ===== Trick resolution =====
function resolveTrick(ctx, trick, leadSuit) {
  // 1) Mighty
  const mightyIndex = trick.findIndex(t => t.card.id === ctx.mighty);
  if (mightyIndex >= 0) return trick[mightyIndex].player;

  // Joker-led?
  const jokerLed = trick.length > 0 && trick[0].card.suit === 'JOKER';

  // 2) JokerCall killer on Joker-led trick
  if (jokerLed && ctx.jokerLedCallSuit) {
    const killerId = jokerCallKiller(ctx.trump);
    const killerIdx = trick.findIndex(t => t.card.id === killerId);
    if (killerIdx >= 0) return trick[killerIdx].player;
  }

  // 3) Joker wins (if not killed)
  const jokerIdx = trick.findIndex(t => t.card.suit === 'JOKER');
  if (jokerIdx >= 0) return trick[jokerIdx].player;

  // 4~5) Regular comparison
  const trump = ctx.trump;
  function score(c) {
    if (c.suit === 'JOKER') return 10000; // normally handled above
    const base = RANK_ORDER[c.rank];
    if (trump !== 'NT' && c.suit === trump) return 500 + base;
    if (leadSuit && c.suit === leadSuit) return 100 + base;
    return base;
  }
  let best = 0;
  for (let i=1;i<trick.length;i++) {
    if (score(trick[i].card) > score(trick[best].card)) best = i;
  }
  return trick[best].player;
}

// ===== Engine state =====
function initGame(cfg, deck) {
  const d = deck ? [...deck] : shuffle(createDeckOneJoker());
  const { hands, kitty } = dealTo5(d, 3);
  const mighty = decideMighty(cfg.trump);
  const takenTricks = {0:0,1:0,2:0,3:0,4:0};
  return {
    dealer: cfg.dealer,
    trump: cfg.trump,
    mighty,
    bids: [],
    declarer: cfg.declarer,
    friend: null,
    friendCard: cfg.friendCard,
    hands,
    kitty,
    takenTricks,
    round: { trickIndex: 0, leader: (cfg.dealer+1)%5, trick: [], jokerLedCallSuit: undefined }
  };
}

function playCard(state, player, cardId) {
  const expectedPlayer = (state.round.leader + state.round.trick.length) % 5;
  if (player !== expectedPlayer) throw new Error(`Wrong turn: expected P${expectedPlayer}, got P${player}`);

  const hand = state.hands[player];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx < 0) throw new Error(`Card ${cardId} not in P${player}`);

  const card = hand[idx];
  const first = state.round.trick[0];
  const leadSuit = first && first.card.suit !== 'JOKER' ? first.card.suit : undefined;
  const legal = mustFollow(leadSuit, hand, state.round.jokerLedCallSuit);
  if (!legal.some(c => c.id === cardId)) throw new Error(`Must follow suit. Tried ${cardId}`);

  if (state.round.trick.length === 0 && card.suit === 'JOKER') {
    // UI에서 setJokerLedCallSuit 호출 필요 (데모에선 자동 결정)
  }

  hand.splice(idx,1);
  state.round.trick.push({ card, player });
}

function setJokerLedCallSuit(state, suit) {
  const isJokerLed = state.round.trick.length === 1 && state.round.trick[0].card.suit === 'JOKER';
  if (!isJokerLed) throw new Error('Not a Joker-led situation');
  state.round.jokerLedCallSuit = suit;
}

function finishTrick(state) {
  if (state.round.trick.length !== 5) throw new Error('Trick not complete');
  const first = state.round.trick[0];
  const leadSuit = first.card.suit !== 'JOKER' ? first.card.suit : undefined;

  const winner = resolveTrick(
    { trump: state.trump, mighty: state.mighty.id, jokerLedCallSuit: state.round.jokerLedCallSuit },
    state.round.trick,
    leadSuit
  );

  state.takenTricks[winner] += 1;

  if (state.friend === null && state.friendCard) {
    const hit = state.round.trick.find(t => t.card.id === state.friendCard);
    if (hit) state.friend = hit.player;
  }

  state.round = { trickIndex: state.round.trickIndex+1, leader: winner, trick: [], jokerLedCallSuit: undefined };
  return winner;
}

function isHandOver(state) { return state.round.trickIndex >= 13; }

function resultForDeclarerSide(state, bidLevel) {
  const side = new Set([ state.declarer ]);
  if (state.friend !== null) side.add(state.friend);
  const declarerTricks = [...side].reduce((sum, p) => sum + state.takenTricks[p], 0);
  return { success: declarerTricks >= bidLevel, declarerSideTricks: declarerTricks };
}

// ===== Demo auto-play (랜덤 합법 플레이) =====
function demoAutoPlayRound(cfg, seed = 0) {
  let deck = createDeckOneJoker();
  for (let i=0;i<seed;i++) deck = shuffle(deck);

  const state = initGame(cfg, deck);
  const log = [];

  function legalChoices(p) {
    const first = state.round.trick[0];
    const leadSuit = first && first.card.suit !== 'JOKER' ? first.card.suit : undefined;
    return mustFollow(leadSuit, state.hands[p], state.round.jokerLedCallSuit);
  }

  while (!isHandOver(state)) {
    while (state.round.trick.length < 5) {
      const p = (state.round.leader + state.round.trick.length) % 5;
      const choices = legalChoices(p);
      const pick = choices[Math.floor(Math.random()*choices.length)];
      if (state.round.trick.length === 0 && pick.suit === 'JOKER') {
        const counts = { S:0,D:0,H:0,C:0 };
        for (const c of state.hands[p]) if (c.suit !== 'JOKER') counts[c.suit]++;
        const bestSuit = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
        setJokerLedCallSuit(state, bestSuit);
        log.push(`P${p} led JOKER, called ${bestSuit}`);
      }
      playCard(state, p, pick.id);
      log.push(`P${p} -> ${pick.id}`);
    }
    const w = finishTrick(state);
    log.push(`Trick ${state.round.trickIndex} won by P${w}`);
  }

  // 데모용: 최소 입찰은 노기=12, 기루=13
  const minBid = (cfg.trump === 'NT') ? 12 : 13;
  const evalRes = resultForDeclarerSide(state, Math.max(cfg.bidLevel ?? minBid, minBid));
  const winnerSide = evalRes.success ? 'Declarer' : 'Defense';
  log.push(`Declarer side tricks=${evalRes.declarerSideTricks} -> ${winnerSide}`);

  return { winnerSide, log };
}

// ===== Simple UI wiring =====
const el = (id)=>document.getElementById(id);
el('run').addEventListener('click', () => {
  const cfg = {
    dealer: Number(el('dealer').value),
    trump: el('trump').value,
    declarer: Number(el('declarer').value),
    friendCard: (el('friendCard').value || null),
    bidLevel: null, // 데모에선 최소입찰로 평가
  };
  const seed = Number(el('seed').value) || 0;
  const { winnerSide, log } = demoAutoPlayRound(cfg, seed);
  el('log').value = log.join('\n') + `\n\nRESULT: ${winnerSide}`;
});

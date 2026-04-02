// ─────────────────────────────────────────────────────────────────────────────
// Meld rules
//
//  All melds must be the SAME SUIT.
//
//  Set  — 3 or 4 cards of the same rank AND same suit (e.g. K♥ K♥ K♥).
//          Poker cards count as their natural value inside a set; no wildcards.
//
//  Run  — 3 or more consecutive-rank cards of the same suit (e.g. J♥ Q♥ K♥).
//          Ace can be low  (A-2-3-4)  or high  (J-Q-K-A)  — no wrap-around.
//          Poker cards act as wildcards and may substitute any single missing
//          card in a run.
//
// Win conditions
//  Win 1 — run(4) + meld(3) + meld(3) = 10 cards  →  discard 1 card to declare
//  Win 2 — set(3) + set(3) + set(3)   =  9 cards  →  discard 2 cards to declare
// ─────────────────────────────────────────────────────────────────────────────

// ── Set validation ────────────────────────────────────────────────────────────

// True if cards form a valid set: 3-4 cards, identical rank AND identical suit.
function isSet(cards) {
  if (cards.length < 3 || cards.length > 4) return false;
  const { rank, suit } = cards[0];
  return cards.every(c => c.rank === rank && c.suit === suit);
}

// ── Run validation ────────────────────────────────────────────────────────────

// True if cards form a valid run (poker wildcards accepted).
function isRun(cards, jokerCard = null) {
  if (cards.length < 3) return false;

  const pokers   = jokerCard ? cards.filter(c =>  c.isPoker(jokerCard)) : [];
  const regulars = jokerCard ? cards.filter(c => !c.isPoker(jokerCard)) : [...cards];

  if (regulars.length === 0) return false;

  // All non-wildcard cards must share a suit
  const suit = regulars[0].suit;
  if (!regulars.every(c => c.suit === suit)) return false;

  const wcCount = pokers.length;

  // Can the sorted order-values be covered with wcCount wildcards filling gaps?
  const fits = orders => {
    const sorted = [...orders].sort((a, b) => a - b);
    if (new Set(sorted).size !== sorted.length) return false; // duplicate ranks
    let gaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      gaps += sorted[i] - sorted[i - 1] - 1;
      if (gaps > wcCount) return false; // early exit
    }
    return true;
  };

  const ordersLow  = regulars.map(c => c.order);
  const hasAce     = regulars.some(c => c.rank === 'A');
  const ordersHigh = hasAce ? regulars.map(c => c.rank === 'A' ? 14 : c.order) : null;

  return fits(ordersLow) || (hasAce && fits(ordersHigh));
}

// ── Generic meld check ────────────────────────────────────────────────────────

function isMeld(cards, jokerCard = null) {
  return isSet(cards) || isRun(cards, jokerCard);
}

// ── Winning-hand search ───────────────────────────────────────────────────────

// Win 1: partition 10 cards into run(4) + meld(3) + meld(3).
// Returns the partition [[g4], [g3a], [g3b]] or null.
function findWin1(hand, jokerCard = null) {
  if (hand.length !== 10) return null;
  const idx = hand.map((_, i) => i);

  for (const c4 of _combos(idx, 4)) {
    const g4 = c4.map(i => hand[i]);
    if (!isRun(g4, jokerCard)) continue;

    const rest = idx.filter(i => !c4.includes(i)); // 6 remaining
    for (const c3 of _combos(rest, 3)) {
      const g3a = c3.map(i => hand[i]);
      const rem = rest.filter(i => !c3.includes(i)); // 3 remaining
      const g3b = rem.map(i => hand[i]);
      if (isMeld(g3a, jokerCard) && isMeld(g3b, jokerCard)) {
        return [g4, g3a, g3b];
      }
    }
  }
  return null;
}

// Win 2: partition 9 cards into set(3) + set(3) + set(3).
// Returns the partition [[g3a], [g3b], [g3c]] or null.
function findWin2(hand, jokerCard = null) {
  if (hand.length !== 9) return null;
  const idx = hand.map((_, i) => i);

  for (const c3a of _combos(idx, 3)) {
    const g3a = c3a.map(i => hand[i]);
    if (!isSet(g3a)) continue;

    const rest = idx.filter(i => !c3a.includes(i)); // 6 remaining
    for (const c3b of _combos(rest, 3)) {
      const g3b = c3b.map(i => hand[i]);
      if (!isSet(g3b)) continue;

      const rem = rest.filter(i => !c3b.includes(i)); // 3 remaining
      const g3c = rem.map(i => hand[i]);
      if (isSet(g3c)) return [g3a, g3b, g3c];
    }
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Meld progress (for scoring) ───────────────────────────────────────────────

// Returns the highest Win-1 progress level achievable from a 10-card hand:
//   0 — no valid sequence of 4 found (loser pays full penalty)
//   1 — has a sequence of 4, no melds of 3
//   2 — has a sequence of 4 + one meld of 3
//   3 — has a sequence of 4 + two melds of 3 (Win 1 eligible but didn't declare)
//
// Win 2 (three sets, no sequence) is treated as progress 0 because the sequence
// is required to reduce the penalty.
function assessMeldProgress(hand, jokerCard = null) {
  let best = 0;
  const idx = hand.map((_, i) => i);

  for (const c4 of _combos(idx, 4)) {
    const g4 = c4.map(i => hand[i]);
    if (!isRun(g4, jokerCard)) continue;
    if (best < 1) best = 1;

    const rest = idx.filter(i => !c4.includes(i));
    for (const c3a of _combos(rest, 3)) {
      const g3a = c3a.map(i => hand[i]);
      if (!isMeld(g3a, jokerCard)) continue;
      if (best < 2) best = 2;

      const rem = rest.filter(i => !c3a.includes(i));
      for (const c3b of _combos(rem, 3)) {
        if (isMeld(c3b.map(i => hand[i]), jokerCard)) return 3; // best possible
      }
    }
  }
  return best;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Generate all r-element combinations from arr (returns arrays of elements, not indices)
function _combos(arr, r) {
  const result = [];
  function bt(start, cur) {
    if (cur.length === r) { result.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      bt(i + 1, cur);
      cur.pop();
    }
  }
  bt(0, []);
  return result;
}

// Sum of card point values (used for deadwood / penalty scoring)
function deadwoodValue(cards) {
  return cards.reduce((sum, c) => sum + c.value, 0);
}

export { isSet, isRun, isMeld, findWin1, findWin2, assessMeldProgress, deadwoodValue, _combos };

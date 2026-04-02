// ─────────────────────────────────────────────────────────────────────────────
// Scoring module
//
// Three outcome types:
//
//   calcRoundResult(game)
//     Normal win.  Losing players pay the winner their meld penalty, everyone
//     pays everyone else for special cards.  Packed players pay 1 pt to winner.
//
//   calcForfeitResult(game)
//     Forfeited player declared win while they had a missed thank-you.
//     Forfeiter pays each other player (their specials + forfeiter's meld penalty).
//     Forfeiter cannot collect their own specials.
//
//   calcInvalidWinResult(game)
//     Player clicked DIK! but their hand did not meet the win condition.
//     Claimer pays each other player the point value of that player's completed
//     melds (sequence=4pts, each meld-of-3=3pts) plus that player's special credits.
//     Claimer cannot collect their own specials.
//
// Special card credits (joker/silver/poker) work the same in all three outcomes.
//
// Meld progress levels (for meld penalty / meld value):
//   0 — no sequence       → penalty 10  /  value 0
//   1 — sequence only     → penalty  6  /  value 4
//   2 — seq + 1 meld      → penalty  3  /  value 7
//   3 — seq + 2 melds     → penalty  1  /  value 10
// ─────────────────────────────────────────────────────────────────────────────

import { assessMeldProgress } from './melds.js';

const MELD_PENALTY = Object.freeze({ 0: 10, 1: 6, 2: 3, 3: 1 });
const MELD_VALUE   = Object.freeze({ 0:  0, 1: 4, 2: 7, 3: 10 }); // used for invalid-win

// ── Special-card credits ───────────────────────────────────────────────────────

function calcSpecialCredits(hands, jokerCard, specialCardOwner) {
  const n       = hands.length;
  const credits = new Array(n).fill(0);

  for (let p = 0; p < n; p++) {
    const hand = hands[p];

    // Joker cards
    const jokers = hand.filter(c => c.isJoker(jokerCard));
    if (jokers.length === 3) {
      credits[p] += 12; // 3-joker set bonus, always credited to current holder
    } else {
      for (const card of jokers) {
        if (card === jokerCard) continue; // initial game-joker instance = 0 pts
        const owner = specialCardOwner.has(card.id) ? specialCardOwner.get(card.id) : p;
        credits[owner] += 4;
      }
    }

    // Silver cards (discard exception applies)
    for (const card of hand.filter(c => c.isSilver(jokerCard))) {
      const owner = specialCardOwner.has(card.id) ? specialCardOwner.get(card.id) : p;
      credits[owner] += 2;
    }

    // Poker cards (no discard exception; pairs only)
    credits[p] += Math.floor(hand.filter(c => c.isPoker(jokerCard)).length / 2);
  }

  return credits;
}

// ── Shared: one player pays all others ────────────────────────────────────────

// Used by both forfeit and invalid-win outcomes.
// payerIndex pays every other player; they cannot collect their own specials.
// amountFn(otherPlayerIndex) → extra pts the payer owes to that player
//   (on top of that player's special credits).
function _payerPaysAll(payerIndex, playerCount, credits, amountFn) {
  const ledger = Array.from({ length: playerCount }, () => new Array(playerCount).fill(0));

  // Payer → each other player
  for (let p = 0; p < playerCount; p++) {
    if (p === payerIndex) continue;
    ledger[payerIndex][p] += credits[p] + amountFn(p);
  }

  // Non-payer players still pay each other for specials (payer's credits excluded)
  for (let a = 0; a < playerCount; a++) {
    if (a === payerIndex) continue;
    for (let b = 0; b < playerCount; b++) {
      if (b === payerIndex || b === a) continue;
      ledger[a][b] += credits[b];
    }
  }

  return _netLedger(ledger, playerCount);
}

// ── Normal round result ────────────────────────────────────────────────────────

function calcRoundResult(game) {
  const { winner, hands, jokerCard, specialCardOwner, playerCount, packed } = game;

  const credits      = calcSpecialCredits(hands, jokerCard, specialCardOwner);
  const meldProgress = hands.map((hand, i) =>
    i === winner ? null : assessMeldProgress(hand, jokerCard)
  );
  const meldPenalty  = meldProgress.map(p => (p === null ? 0 : MELD_PENALTY[p]));

  const ledger = Array.from({ length: playerCount }, () => new Array(playerCount).fill(0));

  // Everyone pays everyone for special cards
  for (let to = 0; to < playerCount; to++) {
    if (credits[to] === 0) continue;
    for (let from = 0; from < playerCount; from++) {
      if (from !== to) ledger[from][to] += credits[to];
    }
  }

  // Each loser pays winner the meld penalty
  for (let loser = 0; loser < playerCount; loser++) {
    if (loser === winner) continue;
    ledger[loser][winner] += meldPenalty[loser];
  }

  // Each packed player pays winner 1 pt (packing cost)
  for (let p = 0; p < playerCount; p++) {
    if (packed[p] && p !== winner) ledger[p][winner] += 1;
  }

  const netPayments = _netLedger(ledger, playerCount);
  return { winner, credits, meldProgress, meldPenalty, netPayments };
}

// ── Forfeit-win result ────────────────────────────────────────────────────────

function calcForfeitResult(game) {
  const { forfeiter, hands, jokerCard, specialCardOwner, playerCount } = game;

  const credits       = calcSpecialCredits(hands, jokerCard, specialCardOwner);
  const forfeiterProg = assessMeldProgress(hands[forfeiter], jokerCard);
  const penalty       = MELD_PENALTY[forfeiterProg];

  const netPayments = _payerPaysAll(forfeiter, playerCount, credits, () => penalty);

  return { forfeiter, credits, forfeiterProgress: forfeiterProg, forfeiterPenalty: penalty, netPayments };
}

// ── Invalid-win result ────────────────────────────────────────────────────────

// The claimer pays each other player the value of that player's completed melds
// (sequence=4pts + 3pts per meld-of-3) plus that player's special-card credits.
function calcInvalidWinResult(game) {
  const { invalidWinClaimer: claimer, hands, jokerCard, specialCardOwner, playerCount } = game;

  const credits    = calcSpecialCredits(hands, jokerCard, specialCardOwner);
  const progresses = hands.map((hand, i) =>
    i === claimer ? null : assessMeldProgress(hand, jokerCard)
  );
  const meldValues = progresses.map(p => (p === null ? 0 : MELD_VALUE[p]));

  const netPayments = _payerPaysAll(claimer, playerCount, credits, p => meldValues[p]);

  return { claimer, credits, meldValues, progresses, netPayments };
}

// ── Chip breakdown ────────────────────────────────────────────────────────────

function chipsFor(amount) {
  const result = {};
  let rem = Math.round(amount);
  for (const d of [50, 20, 10, 5, 1]) {
    const n = Math.floor(rem / d);
    if (n > 0) { result[d] = n; rem -= n * d; }
  }
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _netLedger(ledger, n) {
  const payments = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const net = ledger[a][b] - ledger[b][a];
      if (net > 0)      payments.push({ from: a, to: b, amount: net });
      else if (net < 0) payments.push({ from: b, to: a, amount: -net });
    }
  }
  return payments;
}

export {
  calcRoundResult,
  calcForfeitResult,
  calcInvalidWinResult,
  calcSpecialCredits,
  chipsFor,
  MELD_PENALTY,
  MELD_VALUE,
};

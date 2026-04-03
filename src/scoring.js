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
// Special card credits:
//
//   Frontend name  Backend method  Per card  Thankas (3+)
//   ─────────────  ──────────────  ────────  ────────────
//   Silver         isJoker()          3          12
//   Poker          isSilver()         2           9
//   Joker (wild)   isPoker()       2→1 pair       6
//   Ace of Spades  (regular)          2          12
//   Jack of Spades (regular)          1          12
//   Other 3-set    (regular)          0           6   (normal thankas)
//
//   The initial Silver (the jokerCard object itself) counts as 0 claims.
//   Thankas bonus replaces (not adds to) per-card count.
//   All credits ×2 when isDoubleGame() is true (round card is A♠/J♠/7♠/2♠).
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

// ── Double-game check ──────────────────────────────────────────────────────────
// All special-card credits are doubled for the round when the Silver card
// (the jokerCard drawn at round start) is A♠, J♠, 7♠ or 2♠.
function isDoubleGame(jokerCard) {
  return jokerCard.suit === 'Spades' && ['A', 'J', '7', '2'].includes(jokerCard.rank);
}

// ── Special-card credits ───────────────────────────────────────────────────────

function calcSpecialCredits(hands, jokerCard) {
  const n    = hands.length;
  const mult = isDoubleGame(jokerCard) ? 2 : 1;
  const credits = new Array(n).fill(0);

  for (let p = 0; p < n; p++) {
    const hand = hands[p];
    let pts = 0;

    // Silver cards (backend: isJoker) ─────────────────────────────────────────
    // 3 claims each; the jokerCard instance itself = 0 claims; thankas of 3 = 12
    const silvs = hand.filter(c => c.isJoker(jokerCard));
    if (silvs.length >= 3) {
      pts += 12;
    } else {
      pts += silvs.filter(c => c !== jokerCard).length * 3;
    }

    // Poker cards (backend: isSilver) ─────────────────────────────────────────
    // 2 claims each; thankas of 3 = 9
    const poks = hand.filter(c => c.isSilver(jokerCard));
    if (poks.length >= 3) {
      pts += 9;
    } else {
      pts += poks.length * 2;
    }

    // Joker cards (backend: isPoker, wildcard) ────────────────────────────────
    // 2 Jokers = 1 claim; thankas of 3 = 6
    const joks = hand.filter(c => c.isPoker(jokerCard));
    if (joks.length >= 3) {
      pts += 6;
    } else {
      pts += Math.floor(joks.length / 2);
    }

    // Regular cards ───────────────────────────────────────────────────────────
    // Ace♠ = 2 claims each (12 as thankas of 3)
    // Jack♠ = 1 claim each (12 as thankas of 3)
    // Any other 3-of-a-kind (same rank + same suit) = 6 claims (normal thankas)
    const regs = hand.filter(c =>
      !c.isJoker(jokerCard) && !c.isSilver(jokerCard) && !c.isPoker(jokerCard)
    );
    // Group by rank+suit
    const grp = new Map();
    for (const c of regs) {
      const k = c.rank + '|' + c.suit;
      const entry = grp.get(k);
      if (entry) entry.count++;
      else grp.set(k, { rank: c.rank, suit: c.suit, count: 1 });
    }
    for (const { rank, suit, count } of grp.values()) {
      const isAceS  = rank === 'A' && suit === 'Spades';
      const isJackS = rank === 'J' && suit === 'Spades';
      if (count >= 3) {
        // Thankas — overrides per-card count
        pts += (isAceS || isJackS) ? 12 : 6;
      } else {
        if (isAceS)  pts += count * 2;
        if (isJackS) pts += count * 1;
      }
    }

    credits[p] = pts * mult;
  }

  return credits;
}

// ── Shared: mutual special-card payments ledger ───────────────────────────────
// All players pay everyone else's special credits regardless of outcome.

function _buildSpecialsLedger(playerCount, credits) {
  const ledger = Array.from({ length: playerCount }, () => new Array(playerCount).fill(0));
  for (let to = 0; to < playerCount; to++) {
    if (credits[to] === 0) continue;
    for (let from = 0; from < playerCount; from++) {
      if (from !== to) ledger[from][to] += credits[to];
    }
  }
  return ledger;
}

// ── Normal round result ────────────────────────────────────────────────────────

function calcRoundResult(game) {
  const { winner, hands, jokerCard, playerCount, packed } = game;

  const credits      = calcSpecialCredits(hands, jokerCard);
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
// Special claims: everyone pays everyone (including forfeiter collecting their own).
// Additionally: forfeiter pays each other player their meld penalty.

function calcForfeitResult(game) {
  const { forfeiter, hands, jokerCard, playerCount } = game;

  const credits       = calcSpecialCredits(hands, jokerCard);
  const forfeiterProg = assessMeldProgress(hands[forfeiter], jokerCard);
  const penalty       = MELD_PENALTY[forfeiterProg];

  const ledger = _buildSpecialsLedger(playerCount, credits);

  // Forfeiter pays meld penalty to each other player
  for (let p = 0; p < playerCount; p++) {
    if (p === forfeiter) continue;
    ledger[forfeiter][p] += penalty;
  }

  const netPayments = _netLedger(ledger, playerCount);
  return { forfeiter, credits, forfeiterProgress: forfeiterProg, forfeiterPenalty: penalty, netPayments };
}

// ── Invalid-win result ────────────────────────────────────────────────────────
// Special claims: everyone pays everyone (including claimer collecting their own).
// Additionally: claimer pays each other player based on that player's meld value
// (sequence of 4 first; sets/sequences of 3 count only if they already have a sequence).

function calcInvalidWinResult(game) {
  const { invalidWinClaimer: claimer, hands, jokerCard, playerCount } = game;

  const credits    = calcSpecialCredits(hands, jokerCard);
  const progresses = hands.map((hand, i) =>
    i === claimer ? null : assessMeldProgress(hand, jokerCard)
  );
  const meldValues = progresses.map(p => (p === null ? 0 : MELD_VALUE[p]));

  const ledger = _buildSpecialsLedger(playerCount, credits);

  // Claimer pays each other player based on their meld value
  for (let p = 0; p < playerCount; p++) {
    if (p === claimer) continue;
    ledger[claimer][p] += meldValues[p];
  }

  const netPayments = _netLedger(ledger, playerCount);
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
  isDoubleGame,
  chipsFor,
  MELD_PENALTY,
  MELD_VALUE,
};

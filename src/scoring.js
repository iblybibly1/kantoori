// ─────────────────────────────────────────────────────────────────────────────
// Scoring module
//
// Three outcome types:
//
//   calcRoundResult(game)
//     Normal win.  All players pay everyone their special credits (mutual).
//     Losers also pay winner their meld penalty.  Packed players pay winner 1pt.
//     If winner used no Joker wildcards in their winning hand, +2 claims bonus.
//
//   calcForfeitResult(game)
//     Missed thank-you.  Mutual special credits apply.
//     Forfeiter additionally pays all other players their meld penalty.
//
//   calcInvalidWinResult(game)  — "wrong DIK"
//     Mutual special credits apply.
//     Claimer additionally pays every other player 4 claims.
//
// Special card credits  (all ×2 when isDoubleGame is true)
//
//   Frontend name  Backend method  Per card               Thankas (≥3)
//   ─────────────  ──────────────  ─────────────────────  ─────────────────────
//   Silver         isJoker()       2 each (round card=0)  7
//   Poker          isSilver()      1 each                 6 / 5 / 0 (by discard)
//   Joker (wild)   isPoker()       winner=1, else max(0,n-1) per group  thankas: 10n-1
//   Ace♠           (regular)       1 each                 (+ normal thankas bonus)
//   Normal thankas (same rank+suit groups ≥3)             4n-1  (n=number of groups)
//
//   Poker thankas  (≥3 Poker cards):
//     0 drawn from discard → 6 claims
//     1 drawn from discard → 5 claims
//     2+ drawn from discard → 0 claims (still a valid set of 3)
//
//   Joker non-thankas (count < 3):
//     winner: count claims   |   non-winner: max(0, count-1) claims
//   Joker thankas groups (per 3): 10n-1  (1 group=9, 2 groups=19, …)
//   Plus remaining (1 or 2 jokers) using non-thankas rule above.
//
//   Normal thankas formula: n groups → 4n-1 claims  (1→3, 2→7, 3→11)
//
// Double game: Silver card is A♠, 2♠, 7♠ or Q♠ → all credits ×2.
//
// Meld progress levels (for meld penalty):
//   0 — no sequence of 4    → penalty 10
//   1 — sequence only       → penalty  6
//   2 — seq + 1 meld        → penalty  3
//   3 — seq + 2 melds       → penalty  1
//   4 — seq + 3 melds       → penalty  0  (complete hand)
// ─────────────────────────────────────────────────────────────────────────────

import { assessMeldProgress } from './melds.js';

const MELD_PENALTY = Object.freeze({ 0: 10, 1: 6, 2: 3, 3: 1, 4: 0 });
const MELD_VALUE   = Object.freeze({ 0:  0, 1: 4, 2: 7, 3: 10, 4: 13 });

// ── Double-game check ──────────────────────────────────────────────────────────
function isDoubleGame(jokerCard) {
  return jokerCard.suit === 'Spades' && ['A', '2', '7', 'Q'].includes(jokerCard.rank);
}

// ── Special-card credits ───────────────────────────────────────────────────────
// pokerFromDiscard[p] = how many Poker cards player p drew from the discard pile
// winnerIndex = seat index of winner, or null for no winner

function calcSpecialCredits(hands, jokerCard, pokerFromDiscard, winnerIndex) {
  const n    = hands.length;
  const mult = isDoubleGame(jokerCard) ? 2 : 1;
  const credits = new Array(n).fill(0);

  for (let p = 0; p < n; p++) {
    const hand     = hands[p];
    const isWinner = (p === winnerIndex);
    let pts = 0;

    // ── Silver (backend: isJoker) ─────────────────────────────────────────────
    // 2 claims each (round card itself = 0); thankas of ≥3 = 7
    const silvCount = hand.filter(c => c.isJoker(jokerCard) && c !== jokerCard).length;
    pts += silvCount >= 3 ? 7 : silvCount * 2;

    // ── Poker (backend: isSilver) ─────────────────────────────────────────────
    // 1 claim each; thankas value depends on how many were drawn from the discard pile
    const poks = hand.filter(c => c.isSilver(jokerCard));
    if (poks.length >= 3) {
      const fromDisc = (pokerFromDiscard && pokerFromDiscard[p]) || 0;
      if      (fromDisc === 0) pts += 6;
      else if (fromDisc === 1) pts += 5;
      // 2+ from discard → 0 claims (still counts as a valid set)
    } else {
      pts += poks.length;
    }

    // ── Joker/wildcard (backend: isPoker) ─────────────────────────────────────
    // Thankas groups (per 3): 10n-1 claims  (9, 19, 29 …)
    // Remaining (1-2 jokers): winner=count, non-winner=max(0, count-1)
    const joks       = hand.filter(c => c.isPoker(jokerCard));
    const jokGroups  = Math.floor(joks.length / 3);
    const jokRem     = joks.length % 3;
    if (jokGroups > 0) pts += 10 * jokGroups - 1;
    pts += isWinner ? jokRem : Math.max(0, jokRem - 1);

    // ── Ace of Spades ─────────────────────────────────────────────────────────
    // 1 claim each (only Aces♠ that are not already Silver/Poker/Joker)
    pts += hand.filter(c =>
      c.rank === 'A' && c.suit === 'Spades' &&
      !c.isJoker(jokerCard) && !c.isSilver(jokerCard) && !c.isPoker(jokerCard)
    ).length;

    // ── Normal thankas (same rank + same suit groups of ≥3) ───────────────────
    // n groups → 4n-1 claims  (1→3, 2→7, 3→11)
    const regs = hand.filter(c =>
      !c.isJoker(jokerCard) && !c.isSilver(jokerCard) && !c.isPoker(jokerCard)
    );
    const grp = new Map();
    for (const c of regs) {
      const k = c.rank + '|' + c.suit;
      grp.set(k, (grp.get(k) || 0) + 1);
    }
    let normalGroups = 0;
    for (const count of grp.values()) {
      if (count >= 3) normalGroups++;
    }
    if (normalGroups > 0) pts += 4 * normalGroups - 1;

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
  const { winner, hands, jokerCard, playerCount, packed, pokerFromDiscard, noWildcardBonus } = game;

  const credits = calcSpecialCredits(hands, jokerCard, pokerFromDiscard, winner);

  // No-wildcard bonus: winner used no Joker wildcards → +2 extra claims (×2 if double game)
  if (noWildcardBonus && winner !== null) {
    credits[winner] += isDoubleGame(jokerCard) ? 4 : 2;
  }

  const meldProgress = hands.map((hand, i) =>
    i === winner ? null : assessMeldProgress(hand, jokerCard)
  );
  const meldPenalty = meldProgress.map(p => (p === null ? 0 : MELD_PENALTY[p]));

  const ledger = _buildSpecialsLedger(playerCount, credits);

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
  return { winner, credits, meldProgress, meldPenalty, netPayments, noWildcardBonus };
}

// ── Forfeit-win result ────────────────────────────────────────────────────────
// Mutual special credits apply.  Forfeiter additionally pays meld penalty to all.

function calcForfeitResult(game) {
  const { forfeiter, hands, jokerCard, playerCount, pokerFromDiscard } = game;

  // No winner in a forfeit
  const credits       = calcSpecialCredits(hands, jokerCard, pokerFromDiscard, null);
  const forfeiterProg = assessMeldProgress(hands[forfeiter], jokerCard);
  const penalty       = MELD_PENALTY[forfeiterProg];

  const ledger = _buildSpecialsLedger(playerCount, credits);

  for (let p = 0; p < playerCount; p++) {
    if (p === forfeiter) continue;
    ledger[forfeiter][p] += penalty;
  }

  const netPayments = _netLedger(ledger, playerCount);
  return { forfeiter, credits, forfeiterProgress: forfeiterProg, forfeiterPenalty: penalty, netPayments };
}

// ── Invalid-win result  ("wrong DIK") ─────────────────────────────────────────
// Mutual special credits apply.  Claimer additionally pays every other player 4 claims.

function calcInvalidWinResult(game) {
  const { invalidWinClaimer: claimer, hands, jokerCard, playerCount, pokerFromDiscard } = game;

  // No winner in a wrong DIK
  const credits = calcSpecialCredits(hands, jokerCard, pokerFromDiscard, null);

  const ledger = _buildSpecialsLedger(playerCount, credits);

  // Claimer pays 4 claims to each other player (wrong DIK penalty)
  for (let p = 0; p < playerCount; p++) {
    if (p === claimer) continue;
    ledger[claimer][p] += 4;
  }

  const netPayments = _netLedger(ledger, playerCount);
  return { claimer, credits, netPayments };
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

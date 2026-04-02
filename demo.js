// node demo.js
import { Game, Phase }   from './src/game.js';
import { Card }           from './src/card.js';
import { findWin1, assessMeldProgress } from './src/melds.js';
import {
  calcRoundResult, calcForfeitResult, calcInvalidWinResult, chipsFor, MELD_PENALTY
} from './src/scoring.js';

const hr = label => console.log(`\n${'─'.repeat(54)}\n${label}\n${'─'.repeat(54)}`);
const pay = ({ from, to, amount }) =>
  `  P${from} → P${to}: ${amount} pts  [${Object.entries(chipsFor(amount)).map(([d,n])=>`${n}×${d}`).join('+')}]`;

// ── 1. Packing — player packs on first turn (3-player game) ──────────────────
hr('1. Packing — player 1 packs on their first turn (3 players)');
{
  const g = new Game(3);
  console.log(`canPack P0 before drawing: ${g.canPack(0)}`);   // true
  g.drawFromStock();   // P0 draws
  console.log(`canPack P0 after drawing:  ${g.canPack(0)}`);   // false
  g.discard(0);        // P0 discards → P1's first turn

  console.log(`canPack P1 before drawing: ${g.canPack(1)}`);   // true
  const result = g.pack();                                       // P1 packs (P2 still active → no auto-win)
  console.log(`P1 packed:`, result);                             // { packed: true }
  console.log(`isPacked(1): ${g.isPacked(1)}`);
  console.log(`Current player after pack: ${g.currentPlayer}`); // P2 (P1 skipped)

  // P2 draws and plays; P1 is always skipped hereafter
  g.drawFromStock();
  g.discard(0);
  console.log(`Current player after P2 turn: ${g.currentPlayer}`); // P0 (P1 permanently skipped)
}

// ── 2. Packing — last pack triggers auto-win ─────────────────────────────────
hr('2. Auto-win when only one player remains active');
{
  const g = new Game(3);  // 3 players
  // P0 draws then discards (to advance to P1's first turn)
  g.drawFromStock(); g.discard(0);
  // P1 packs
  g.pack();
  // P2 packs — now only P0 is active → auto-win
  const res = g.pack();
  console.log('pack() result:', res);         // { autoWin: true, winner: 0 }
  console.log('game.winner:', g.winner);       // 0
  console.log('game.phase:', g.phase);         // ended
}

// ── 3. Packing cost in normal round result ────────────────────────────────────
hr('3. Packing cost — packed player owes 1 pt to winner');
{
  // 2-player: P0 acts first, P1 packs → auto-win for P0 (only 1 active player left)
  const g = new Game(2);
  g.drawFromStock(); g.discard(0);  // P0's first turn
  g.pack();                          // P1 packs → game.winner = 0, phase = ended

  console.log('Winner:', g.winner, '  Phase:', g.phase);
  const r = calcRoundResult(g);
  console.log('Net payments (P1 owes P0: 1pt packing + meld penalty):');
  r.netPayments.forEach(p => console.log(pay(p)));
}

// ── 4. Invalid DIK! declaration — hand does not meet win condition ────────────
hr('4. Invalid DIK! — claimer pays each player their meld value + specials');
{
  const g = new Game(2);
  // Stuff an INVALID win hand into P0 (no run of 4)
  g.hands[0] = [
    new Card('Hearts','2'), new Card('Hearts','5'), new Card('Hearts','9'), new Card('Hearts','K'),
    new Card('Clubs','K'),  new Card('Clubs','K'),  new Card('Clubs','K'),
    new Card('Spades','7'), new Card('Spades','3'),  new Card('Diamonds','Q'),
    new Card('Diamonds','J'), // card to discard
  ];
  // Stuff a GOOD hand into P1 so they have meld value
  g.hands[1] = [
    new Card('Spades','A'), new Card('Spades','2'), new Card('Spades','3'), new Card('Spades','4'),
    new Card('Clubs','9'),  new Card('Clubs','9'),  new Card('Clubs','9'),
    new Card('Hearts','6'), new Card('Hearts','7'), new Card('Hearts','8'),
  ];
  g.phase = Phase.DISCARD;

  const declared = g.declare(10);  // try to declare Win1, discarding index 10
  console.log('declare() result:', declared);
  console.log('invalidWinClaimer:', g.invalidWinClaimer);

  const r = calcInvalidWinResult(g);
  console.log(`P1 meld progress: ${r.progresses[1]}  value: ${r.meldValues[1]} pts`);
  console.log('Net payments (P0 pays P1):');
  r.netPayments.forEach(p => console.log(pay(p)));
}

// ── 5. Valid DIK! declaration ─────────────────────────────────────────────────
hr('5. Valid DIK! — normal win');
{
  const g = new Game(2);
  g.hands[0] = [
    new Card('Hearts','2'), new Card('Hearts','3'), new Card('Hearts','4'), new Card('Hearts','5'),
    new Card('Clubs','K'),  new Card('Clubs','K'),  new Card('Clubs','K'),
    new Card('Spades','7'), new Card('Spades','8'), new Card('Spades','9'),
    new Card('Diamonds','Q'),
  ];
  g.phase = Phase.DISCARD;
  const partition = g.declare(10);
  console.log('Winner:', g.winner);
  partition.forEach((gr, i) => console.log(`  group ${i+1}: ${gr.map(c=>c.toString()).join(' ')}`));

  const r = calcRoundResult(g);
  console.log('Net payments:');
  r.netPayments.forEach(p => console.log(pay(p)));
}

// ── 6. Forfeit win (missed thank-you) ─────────────────────────────────────────
hr('6. Forfeit win — missed thank-you');
{
  const g = new Game(2);
  const joker = g.getJoker();
  g.hands[0].push(new Card(joker.suit, joker.rank), new Card(joker.suit, joker.rank));
  g.discardPile.push(new Card(joker.suit, joker.rank));
  g.drawFromDiscard();  // completes set → pendingThankYou
  g.discard(0);         // skip thankYou → still pending
  g.drawFromStock();    // P1 turn
  g.discard(0);         // P1 discards → P0 now forfeited

  console.log('P0 forfeited:', g.isForfeited(0));

  g.hands[0] = [
    new Card('Hearts','2'), new Card('Hearts','3'), new Card('Hearts','4'), new Card('Hearts','5'),
    new Card('Clubs','K'),  new Card('Clubs','K'),  new Card('Clubs','K'),
    new Card('Spades','7'), new Card('Spades','8'), new Card('Spades','9'),
    new Card('Diamonds','Q'),
  ];
  g.phase = Phase.DISCARD;
  const res = g.declare(10);
  console.log('declare result:', res);

  const r = calcForfeitResult(g);
  console.log('Forfeit penalty:', r.forfeiterPenalty, 'pts');
  console.log('Net payments:');
  r.netPayments.forEach(p => console.log(pay(p)));
}

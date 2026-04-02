// ─────────────────────────────────────────────────────────────────────────────
// Game rules summary
//
//  Setup
//    • 3 standard decks (156 cards), shuffled together.
//    • Each player is dealt 10 cards.
//    • One card is flipped face-up from the stock — this is the JOKER CARD.
//      It also starts the discard pile.
//    • The joker card's identity (rank + suit) determines three special types:
//        joker  — same rank & suit as jokerCard  (worth 4 pts; 3-joker set = 12 pts)
//        poker  — same rank, opposite color       (wildcard in runs; can form own set)
//        silver — same rank, same color, diff suit (worth 2 pts in hand; no wild power)
//
//  Packing (first turn only)
//    Before drawing on their VERY FIRST turn a player may call pack() to sit out
//    the round as a spectator.  They owe 1 point to whoever wins the round.
//    Packed players are skipped in turn rotation.
//    The last remaining active player cannot pack.
//    If packing leaves only one active player, that player wins immediately.
//
//  Turn flow
//    DRAW phase    → player draws from stock  OR  picks top of discard pile.
//                    First-turn players may also call pack() instead of drawing.
//    DISCARD phase → player may call thankYou() if required, then must either:
//                      • discard(cardIndex)          — normal end of turn
//                      • declare(cardIndices)         — DIK! win attempt
//
//  Thank-you rule
//    If a player picks from the discard pile and the drawn card completes a set
//    (≥3 identical rank + identical suit) in their hand, they MUST call thankYou()
//    during the same DISCARD phase.  Failure to do so before their next turn
//    marks them forfeited.  A forfeited player's win attempt triggers forfeit scoring.
//
//  Winning — DIK! declaration (player calls declare() on their DISCARD phase turn):
//    Win 1  Discard 1 card → remaining 10 cards must form run(4)+meld(3)+meld(3)
//    Win 2  Discard 2 cards → remaining 9 cards must form set(3)+set(3)+set(3)
//
//    If the hand is VALID:  round ends, player wins.
//    If the hand is INVALID: round ends, player pays every other player
//      (calcInvalidWinResult in scoring.js).
//
//  NOTE: The game does NOT auto-detect wins.  A player who qualifies but does
//        not declare simply continues playing — this is by design.
// ─────────────────────────────────────────────────────────────────────────────

import { Deck } from './deck.js';
import { findWin1, findWin2 } from './melds.js';

const HAND_SIZE = 10;

const Phase = {
  DRAW:    'draw',
  DISCARD: 'discard',
  ENDED:   'ended',
};

class Game {
  constructor(playerCount = 2) {
    if (playerCount < 2 || playerCount > 6) throw new Error('2–6 players only');
    this.playerCount = playerCount;
    this.scores = Array(playerCount).fill(0);
    this._startRound();
  }

  // ── Round setup ─────────────────────────────────────────────────────────────

  _startRound() {
    const deck = new Deck(3).shuffle();

    this.hands = Array.from({ length: this.playerCount }, () => deck.deal(HAND_SIZE));

    this.jokerCard   = deck.drawOne();
    this.discardPile = [this.jokerCard];
    this.stockPile   = [...deck.cards];
    deck.cards       = [];

    this.currentPlayer   = 0;
    this.phase           = Phase.DRAW;
    this.winner          = null;
    this.forfeiter       = null;      // set on missed thank-you win attempt
    this.invalidWinClaimer = null;    // set on invalid DIK! declaration
    this.isFirstTurn     = true;

    // Packing
    this.packed   = new Array(this.playerCount).fill(false);
    this.hasActed = new Array(this.playerCount).fill(false); // drawn or packed

    // Thank-you rule
    this.pendingThankYou = new Array(this.playerCount).fill(false);
    this.forfeited       = new Array(this.playerCount).fill(false);

    // Discard-exception tracking for joker/silver scoring
    this.specialCardOwner = new Map(); // card.id → playerIndex
  }

  // ── Read-only accessors ─────────────────────────────────────────────────────

  get topDiscard()           { return this.discardPile[this.discardPile.length - 1] ?? null; }
  getHand(i)                 { return [...this.hands[i]]; }
  getJoker()                 { return this.jokerCard; }
  needsThankYou(i)           { return this.pendingThankYou[i]; }
  isForfeited(i)             { return this.forfeited[i]; }
  isPacked(i)                { return this.packed[i]; }
  canPack(i)                 { return !this.hasActed[i] && !this.packed[i]; }

  // ── DRAW phase: packing ──────────────────────────────────────────────────────

  // Sit out the round as a spectator.  Can only be called on the player's first
  // turn (before drawing) and only while at least one other player is still active.
  pack() {
    this._requirePhase(Phase.DRAW);
    if (this.hasActed[this.currentPlayer]) {
      throw new Error('You can only pack on your first turn, before drawing');
    }

    const otherActive = this.packed.filter((p, i) => !p && i !== this.currentPlayer).length;
    if (otherActive === 0) {
      throw new Error('Cannot pack: you are the last active player');
    }

    this.packed[this.currentPlayer]   = true;
    this.hasActed[this.currentPlayer] = true;

    // If only one active player remains, they win immediately
    const remaining = this.packed.map((p, i) => (!p ? i : null)).filter(i => i !== null);
    if (remaining.length === 1) {
      this._endRound(remaining[0]);
      return { autoWin: true, winner: remaining[0] };
    }

    this._nextTurn();
    return { packed: true };
  }

  // ── DRAW phase: drawing ──────────────────────────────────────────────────────

  drawFromStock() {
    this._requirePhase(Phase.DRAW);
    if (this.stockPile.length === 0) this._reshuffleDiscard();
    const card = this.stockPile.pop();
    this.hands[this.currentPlayer].push(card);
    this.hasActed[this.currentPlayer] = true;
    this.phase = Phase.DISCARD;
    return card;
  }

  // Pick up the top of the discard pile (or the joker on turn 1).
  // Automatically raises pendingThankYou if the draw completes a set.
  drawFromDiscard() {
    this._requirePhase(Phase.DRAW);
    if (this.discardPile.length === 0) throw new Error('Discard pile is empty');
    const card = this.discardPile.pop();
    this.hands[this.currentPlayer].push(card);
    this.hasActed[this.currentPlayer] = true;
    this.phase = Phase.DISCARD;

    if (this._completesSet(card)) {
      this.pendingThankYou[this.currentPlayer] = true;
    }

    return card;
  }

  // ── DISCARD phase: thank-you ─────────────────────────────────────────────────

  thankYou() {
    this._requirePhase(Phase.DISCARD);
    if (!this.pendingThankYou[this.currentPlayer]) {
      throw new Error('No thank-you required this turn');
    }
    this.pendingThankYou[this.currentPlayer] = false;
  }

  // ── DISCARD phase: end turn ──────────────────────────────────────────────────

  discard(cardIndex) {
    this._requirePhase(Phase.DISCARD);
    const card = this._spliceCard(this.currentPlayer, cardIndex);
    this._trackSpecialDiscard(card);
    this.discardPile.push(card);
    this.isFirstTurn = false;
    this._nextTurn();
    return card;
  }

  // ── DISCARD phase: DIK! declaration ─────────────────────────────────────────

  // Win 1: discard 1 card, remaining 10 must be run(4)+meld(3)+meld(3).
  // Returns winning partition on success, or { invalidWin: true } on failure.
  // If player is forfeited, returns { forfeit: true }.
  declare(cardIndex, cardIndex2 = null) {
    // Route to Win 1 or Win 2
    if (cardIndex2 === null) return this._declareWin1(cardIndex);
    return this._declareWin2(cardIndex, cardIndex2);
  }

  _declareWin1(cardIndex) {
    this._requirePhase(Phase.DISCARD);
    if (this._isForfeitingPlayer()) return this._triggerForfeitWin();

    const hand = this.hands[this.currentPlayer];
    if (cardIndex < 0 || cardIndex >= hand.length) throw new Error('Invalid card index');

    const remaining  = hand.filter((_, i) => i !== cardIndex);
    const partition  = findWin1(remaining, this.jokerCard);

    // Always discard the specified card regardless of outcome
    const card = this._spliceCard(this.currentPlayer, cardIndex);
    this._trackSpecialDiscard(card);
    this.discardPile.push(card);

    if (!partition) return this._triggerInvalidWin();

    this._endRound(this.currentPlayer);
    return partition;
  }

  _declareWin2(cardIndex1, cardIndex2) {
    this._requirePhase(Phase.DISCARD);
    if (this._isForfeitingPlayer()) return this._triggerForfeitWin();
    if (cardIndex1 === cardIndex2) throw new Error('Must discard two different cards');

    const hand = this.hands[this.currentPlayer];
    if (cardIndex1 < 0 || cardIndex1 >= hand.length ||
        cardIndex2 < 0 || cardIndex2 >= hand.length) throw new Error('Invalid card index');

    const toDiscard = new Set([cardIndex1, cardIndex2]);
    const remaining = hand.filter((_, i) => !toDiscard.has(i));
    const partition = findWin2(remaining, this.jokerCard);

    // Always discard both cards regardless of outcome
    const [hi, lo] = [cardIndex1, cardIndex2].sort((a, b) => b - a);
    const c1 = this._spliceCard(this.currentPlayer, hi);
    const c2 = this._spliceCard(this.currentPlayer, lo);
    this._trackSpecialDiscard(c1);
    this._trackSpecialDiscard(c2);
    this.discardPile.push(c1, c2);

    if (!partition) return this._triggerInvalidWin();

    this._endRound(this.currentPlayer);
    return partition;
  }

  // ── Round management ─────────────────────────────────────────────────────────

  newRound() {
    if (this.phase !== Phase.ENDED) throw new Error('Round is still in progress');
    this._startRound();
  }

  // ── State snapshot ───────────────────────────────────────────────────────────

  getState(viewAs = null) {
    return {
      phase:             this.phase,
      currentPlayer:     this.currentPlayer,
      winner:            this.winner,
      forfeiter:         this.forfeiter,
      invalidWinClaimer: this.invalidWinClaimer,
      jokerCard:         this.jokerCard,
      scores:            [...this.scores],
      stockSize:         this.stockPile.length,
      topDiscard:        this.topDiscard,
      isFirstTurn:       this.isFirstTurn,
      packed:            [...this.packed],
      hasActed:          [...this.hasActed],
      pendingThankYou:   [...this.pendingThankYou],
      forfeited:         [...this.forfeited],
      hands: this.hands.map((hand, i) =>
        viewAs === null || viewAs === i ? [...hand] : hand.map(() => null)
      ),
    };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  _requirePhase(phase) {
    if (this.phase === Phase.ENDED) throw new Error('Round has ended');
    if (this.phase !== phase)
      throw new Error(`Expected phase "${phase}", current phase is "${this.phase}"`);
  }

  _spliceCard(playerIndex, cardIndex) {
    const hand = this.hands[playerIndex];
    if (cardIndex < 0 || cardIndex >= hand.length) throw new Error('Card index out of range');
    return hand.splice(cardIndex, 1)[0];
  }

  _completesSet(card) {
    const hand = this.hands[this.currentPlayer];
    return hand.filter(c => c.rank === card.rank && c.suit === card.suit).length >= 3;
  }

  _isForfeitingPlayer() {
    return this.forfeited[this.currentPlayer] || this.pendingThankYou[this.currentPlayer];
  }

  _triggerForfeitWin() {
    this.forfeiter = this.currentPlayer;
    this.winner    = null;
    this.phase     = Phase.ENDED;
    return { forfeit: true, forfeiter: this.currentPlayer };
  }

  _triggerInvalidWin() {
    this.invalidWinClaimer = this.currentPlayer;
    this.winner            = null;
    this.phase             = Phase.ENDED;
    return { invalidWin: true, claimer: this.currentPlayer };
  }

  _trackSpecialDiscard(card) {
    const type = card.cardType(this.jokerCard);
    if (type === 'joker' || type === 'silver') {
      this.specialCardOwner.set(card.id, this.currentPlayer);
    }
  }

  // Advance to the next non-packed player.
  _nextTurn() {
    let next    = (this.currentPlayer + 1) % this.playerCount;
    let checked = 0;
    while (this.packed[next] && checked < this.playerCount) {
      next = (next + 1) % this.playerCount;
      checked++;
    }
    this.currentPlayer = next;
    this.phase         = Phase.DRAW;
    this.isFirstTurn   = false;

    // Missed thank-you window → forfeit
    if (this.pendingThankYou[this.currentPlayer]) {
      this.forfeited[this.currentPlayer]       = true;
      this.pendingThankYou[this.currentPlayer] = false;
    }
  }

  _endRound(winnerIndex) {
    this.phase  = Phase.ENDED;
    this.winner = winnerIndex;
  }

  _reshuffleDiscard() {
    if (this.discardPile.length <= 1) throw new Error('No cards left to play');
    const top  = this.discardPile.pop();
    const pile = this.discardPile;
    for (let i = pile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pile[i], pile[j]] = [pile[j], pile[i]];
    }
    this.stockPile   = pile;
    this.discardPile = [top];
  }
}

export { Game, Phase };

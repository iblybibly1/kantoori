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
//    Win 1  Discard 1 card → remaining 13 cards must form run(4)+meld(3)+meld(3)+meld(3)
//    Win 2  Discard 2 cards → remaining 12 cards must form meld(3)+meld(3)+meld(3)+meld(3)
//
//    If the hand is VALID:  round ends, player wins.
//    If the hand is INVALID: round ends, player pays every other player
//      (calcInvalidWinResult in scoring.js).
//
//  NOTE: The game does NOT auto-detect wins.  A player who qualifies but does
//        not declare simply continues playing — this is by design.
// ─────────────────────────────────────────────────────────────────────────────

import { Deck } from './deck.js';
import { findWin1, findWin2Thankas } from './melds.js';

const HAND_SIZE = 13;

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
    this.startingPlayer = 0;
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

    this.currentPlayer   = this.startingPlayer;
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

    // Tracks how many Poker (frontend name) cards each player drew from the discard pile
    // (affects Poker thankas value: 0 from discard=6pts, 1=5pts, 2+=0pts)
    this.pokerFromDiscard = new Array(this.playerCount).fill(0);

    // Set to true after a valid DIK where no Joker wildcard was used in the winning hand
    this.noWildcardBonus = false;

    // Per-player list of special cards (Silver/Poker/Ace♠) discarded at any point
    // during the round — their per-card claim values are counted in scoring even
    // though the cards are no longer in the player's hand.
    this.discardedSpecials = Array.from({ length: this.playerCount }, () => []);
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

  // Pick up the top of the discard pile.
  // Restriction: the silver (jokerCard) sitting in discard at round start may only
  // be picked by the first unpacked player on their very first turn.
  // Automatically raises pendingThankYou if the draw completes a set.
  drawFromDiscard() {
    this._requirePhase(Phase.DRAW);
    if (this.discardPile.length === 0) throw new Error('Discard pile is empty');

    const topCard = this.topDiscard;

    // Silver-card restriction
    if (topCard === this.jokerCard) {
      const firstUnpacked = this._firstUnpackedPlayer();
      if (this.currentPlayer !== firstUnpacked || this.hasActed[this.currentPlayer]) {
        throw new Error('Only the first active player may pick up the silver card on their first turn');
      }
    }

    const card = this.discardPile.pop();
    this.hands[this.currentPlayer].push(card);
    this.hasActed[this.currentPlayer] = true;
    this.phase = Phase.DISCARD;

    // Track Poker (frontend name = backend isSilver) cards drawn from discard for scoring
    if (card.isSilver(this.jokerCard)) {
      this.pokerFromDiscard[this.currentPlayer]++;
    }

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

  // Win 1: pass a single cardIndex to discard 1 card.
  //   Remaining 13 cards must form run(4)+meld(3)+meld(3)+meld(3).
  // Win 2: pass an array of 4 cardIndices to discard 4 cards.
  //   Remaining 9 cards must form exactly 3 valid Thankas groups.
  //   Discarded cards still contribute their claims to the winner.
  declare(cardIndexOrArray) {
    if (Array.isArray(cardIndexOrArray)) return this._declareWin2(cardIndexOrArray);
    return this._declareWin1(cardIndexOrArray);
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

    // No-wildcard bonus: check if any Joker wildcard was used in the winning hand
    this.noWildcardBonus = !partition.flat().some(c => c.isPoker(this.jokerCard));

    this._endRound(this.currentPlayer);
    return partition;
  }

  _declareWin2(indices) {
    this._requirePhase(Phase.DISCARD);
    if (this._isForfeitingPlayer()) return this._triggerForfeitWin();
    if (indices.length !== 4) throw new Error('Win 2 requires exactly 4 cards to discard');

    const unique = new Set(indices);
    if (unique.size !== 4) throw new Error('Must discard 4 different cards');

    const hand = this.hands[this.currentPlayer];
    for (const i of indices) {
      if (i < 0 || i >= hand.length) throw new Error('Invalid card index');
    }

    const toDiscard = new Set(indices);
    const remaining = hand.filter((_, i) => !toDiscard.has(i));
    const partition = findWin2Thankas(remaining, this.jokerCard, this.pokerFromDiscard[this.currentPlayer]);

    // Always discard all 4 cards regardless of outcome; remove high-to-low to keep indices valid
    const sorted = [...indices].sort((a, b) => b - a);
    const discarded = sorted.map(i => {
      const c = this._spliceCard(this.currentPlayer, i);
      this._trackSpecialDiscard(c);
      return c;
    });
    this.discardPile.push(...discarded);

    if (!partition) return this._triggerInvalidWin();

    // No-wildcard bonus: true only if no Joker used in the 3 Thankas groups
    this.noWildcardBonus = !partition.flat().some(c => c.isPoker(this.jokerCard));

    this._endRound(this.currentPlayer);
    return partition;
  }

  // ── Round management ─────────────────────────────────────────────────────────

  newRound() {
    if (this.phase !== Phase.ENDED) throw new Error('Round is still in progress');
    // Rotate starting player anticlockwise each round
    this.startingPlayer = (this.startingPlayer - 1 + this.playerCount) % this.playerCount;
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
      pokerFromDiscard:  [...this.pokerFromDiscard],
      hands: this.hands.map((hand, i) =>
        viewAs === null || viewAs === i ? [...hand] : hand.map(() => null)
      ),
    };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  // Returns the seat index of the lowest-numbered player who hasn't packed.
  _firstUnpackedPlayer() {
    for (let i = 0; i < this.playerCount; i++) {
      if (!this.packed[i]) return i;
    }
    return 0;
  }

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
    // Track Silver (type=joker), Poker (type=silver), and Ace♠ so their
    // per-card claim values are still counted at round end even if discarded.
    const isAceSpades = card.rank === 'A' && card.suit === 'Spades' &&
                        type !== 'joker' && type !== 'silver' && type !== 'poker';
    if (type === 'joker' || type === 'silver' || isAceSpades) {
      this.discardedSpecials[this.currentPlayer].push(card);
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

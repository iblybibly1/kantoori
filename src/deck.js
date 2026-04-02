import { Card, SUITS, RANKS } from './card.js';

// Builds a shuffled pool of numDecks × 52 standard cards.
class Deck {
  constructor(numDecks = 3) {
    this.cards = [];
    for (let d = 0; d < numDecks; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          this.cards.push(new Card(suit, rank));
        }
      }
    }
  }

  // Fisher-Yates shuffle in place
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }

  // Remove and return n cards from the top (end of array)
  deal(n) {
    if (n > this.cards.length) throw new Error('Not enough cards in deck');
    return this.cards.splice(this.cards.length - n, n);
  }

  drawOne() {
    if (this.cards.length === 0) throw new Error('Deck is empty');
    return this.cards.pop();
  }

  get size()    { return this.cards.length; }
  get isEmpty() { return this.cards.length === 0; }
}

export { Deck };

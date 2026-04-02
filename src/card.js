let _nextCardId = 0;

const SUITS = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_COLOR = { Hearts: 'red', Diamonds: 'red', Clubs: 'black', Spades: 'black' };

const RANK_ORDER = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
};

const RANK_VALUE = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 10, Q: 10, K: 10,
};

class Card {
  constructor(suit, rank) {
    if (!SUITS.includes(suit)) throw new Error(`Invalid suit: ${suit}`);
    if (!RANKS.includes(rank)) throw new Error(`Invalid rank: ${rank}`);
    this.id   = _nextCardId++;  // unique identity across all decks / instances
    this.suit = suit;
    this.rank = rank;
  }

  get order() { return RANK_ORDER[this.rank]; }
  get value() { return RANK_VALUE[this.rank]; }
  get color() { return SUIT_COLOR[this.suit]; }

  // Returns 'joker', 'poker', 'silver', or 'normal' relative to the game's joker card.
  //
  // Example — joker card is 5♥ (red):
  //   joker  = 5♥          (same rank, same suit)
  //   poker  = 5♣ / 5♠     (same rank, opposite color — wildcard in sequences)
  //   silver = 5♦           (same rank, same color, different suit — 2 pts in hand)
  //   normal = anything else
  cardType(jokerCard) {
    if (this.rank !== jokerCard.rank) return 'normal';
    if (this.suit === jokerCard.suit)  return 'joker';
    if (this.color !== jokerCard.color) return 'poker';
    return 'silver';
  }

  isJoker(j)  { return this.cardType(j) === 'joker'; }
  isPoker(j)  { return this.cardType(j) === 'poker'; }
  isSilver(j) { return this.cardType(j) === 'silver'; }

  toString() { return `${this.rank}${this.suit[0]}`; }
  equals(other) { return this.suit === other.suit && this.rank === other.rank; }
}

export { Card, SUITS, RANKS, RANK_ORDER, SUIT_COLOR };

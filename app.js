import { Game, Phase } from './src/game.js';
import {
  calcRoundResult,
  calcForfeitResult,
  calcInvalidWinResult,
  chipsFor,
} from './src/scoring.js';

// ── State ──────────────────────────────────────────────────────────────────────
let game        = null;
let playerCount = 2;
let selected    = new Set();   // card indices in current player's hand
let pendingPass = false;       // waiting for pass-screen tap
let passTarget  = -1;          // the player who should see their hand next

const SUIT_SYM  = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' };
const SUIT_CLASS = { Hearts: 'red', Diamonds: 'red', Clubs: 'black', Spades: 'black' };
const PLAYER_COLORS = ['#f1c40f', '#2ecc71', '#3498db', '#e74c3c', '#9b59b6', '#e67e22'];

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  showSetup();
});

// ── Setup screen ───────────────────────────────────────────────────────────────
function showSetup() {
  document.body.innerHTML = `
    <div id="setup-screen">
      <h1>KANTOORI</h1>
      <p>Select number of players</p>
      <div class="player-count-row" id="count-btns"></div>
      <button class="btn-primary" id="start-btn" style="font-size:1.1rem;padding:12px 40px;margin-top:8px">
        Start Game
      </button>
    </div>
  `;

  const row = document.getElementById('count-btns');
  for (let n = 2; n <= 6; n++) {
    const b = document.createElement('button');
    b.textContent = n;
    b.className = 'btn-ghost' + (n === playerCount ? ' active' : '');
    b.addEventListener('click', () => {
      playerCount = n;
      row.querySelectorAll('button').forEach((btn, i) => {
        btn.className = 'btn-ghost' + (i + 2 === n ? ' active' : '');
      });
    });
    row.appendChild(b);
  }

  document.getElementById('start-btn').addEventListener('click', () => {
    game     = new Game(playerCount);
    selected = new Set();
    showPassScreen(0, true);
  });
}

// ── Pass screen ────────────────────────────────────────────────────────────────
function showPassScreen(playerIndex, isFirstLook = false) {
  pendingPass = true;
  passTarget  = playerIndex;
  document.body.innerHTML = `
    <div id="pass-screen">
      <h2>🃏 Pass to Player ${playerIndex + 1}</h2>
      <p>${isFirstLook ? 'Tap to see your opening hand' : 'Tap when ready — hide screen from others'}</p>
    </div>
  `;
  document.getElementById('pass-screen').addEventListener('click', () => {
    pendingPass = false;
    renderGame();
  });
}

// ── Main render ────────────────────────────────────────────────────────────────
function renderGame() {
  const state = game.getState(game.currentPlayer);

  document.body.innerHTML = `
    <div id="header">
      <h1>KANTOORI</h1>
      <div id="joker-badge">
        <span class="label">Joker:</span>
        <span class="card-mini" id="joker-mini"></span>
      </div>
      <div class="meta" id="header-meta"></div>
    </div>
    <div id="game-area">
      <div id="opponents-area"></div>

      <div id="table-center">
        <div>
          <div class="pile-card stock" id="btn-draw-stock">
            <span>DRAW</span><span style="font-size:.6rem;margin-top:2px">${state.stockSize} left</span>
          </div>
          <div class="pile-label">Stock</div>
        </div>
        <div>
          <div id="discard-top"></div>
          <div class="pile-label">Discard</div>
        </div>
      </div>

      <div id="status"></div>

      <div id="current-player-area">
        <div class="player-label active" id="current-label"></div>
        <div class="hand-row" id="current-hand"></div>
      </div>

      <div id="action-bar"></div>

      <div id="legend">
        <div class="legend-item"><div class="legend-dot" style="background:#f1c40f;border:1px solid #f1c40f"></div>Joker (4pts)</div>
        <div class="legend-item"><div class="legend-dot" style="background:#2980b9"></div>Poker (wildcard)</div>
        <div class="legend-item"><div class="legend-dot" style="background:#bdc3c7"></div>Silver (2pts)</div>
      </div>
    </div>
  `;

  // Joker badge
  const jk = game.getJoker();
  const jEl = document.getElementById('joker-mini');
  jEl.textContent = `${jk.rank}${SUIT_SYM[jk.suit]}`;
  jEl.style.color = SUIT_CLASS[jk.suit] === 'red' ? '#e74c3c' : '#ecf0f1';

  document.getElementById('header-meta').textContent =
    `Player ${game.currentPlayer + 1}'s turn  •  ${state.stockSize} cards left`;

  // Opponents (face-down)
  renderOpponents(state);

  // Discard pile top
  renderDiscardTop(state);

  // Current player's hand
  renderCurrentHand(state);

  // Action buttons
  renderActions(state);

  // Status message
  updateStatus(state);

  // Draw from stock click
  const stockBtn = document.getElementById('btn-draw-stock');
  if (state.phase === Phase.DRAW && !game.isPacked(game.currentPlayer)) {
    stockBtn.addEventListener('click', () => {
      game.drawFromStock();
      selected.clear();
      renderGame();
    });
  } else {
    stockBtn.classList.add('disabled');
  }
}

// ── Opponents ──────────────────────────────────────────────────────────────────
function renderOpponents(state) {
  const area = document.getElementById('opponents-area');
  const others = [];
  for (let i = 0; i < game.playerCount; i++) {
    if (i === game.currentPlayer) continue;
    others.push(i);
  }
  if (others.length === 0) return;

  area.innerHTML = others.map(i => {
    const tags = [];
    if (game.isPacked(i)) tags.push('<span style="color:#e74c3c;font-size:.75rem">PACKED</span>');
    if (game.isForfeited(i)) tags.push('<span style="color:#e74c3c;font-size:.75rem">FORFEITED</span>');
    const handCount = game.getHand(i).length;
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;margin:0 8px">
        <div class="player-label" style="color:${PLAYER_COLORS[i]}">${tags.join(' ')} Player ${i+1}</div>
        <div class="hand-row" style="gap:3px">
          ${Array(handCount).fill('<div class="card face-down"></div>').join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ── Discard pile ───────────────────────────────────────────────────────────────
function renderDiscardTop(state) {
  const container = document.getElementById('discard-top');
  const top = state.topDiscard;

  if (!top) {
    container.innerHTML = '<div class="pile-card empty-discard">Empty</div>';
    return;
  }

  const cardEl = buildCardEl(top, game.getJoker(), false);

  if (state.phase === Phase.DRAW && !game.isPacked(game.currentPlayer)) {
    cardEl.classList.add('pile-card', 'selectable');
    cardEl.style.width  = 'var(--card-w)';
    cardEl.style.height = 'var(--card-h)';
    cardEl.addEventListener('click', () => {
      game.drawFromDiscard();
      selected.clear();
      renderGame();
    });
  } else {
    cardEl.classList.add('pile-card');
    cardEl.style.width  = 'var(--card-w)';
    cardEl.style.height = 'var(--card-h)';
    cardEl.classList.add('disabled');
  }

  container.innerHTML = '';
  container.appendChild(cardEl);
}

// ── Current player hand ────────────────────────────────────────────────────────
function renderCurrentHand(state) {
  const label = document.getElementById('current-label');
  label.textContent = `Player ${game.currentPlayer + 1} — your hand`;
  label.style.color = PLAYER_COLORS[game.currentPlayer];

  const container = document.getElementById('current-hand');
  const hand = game.getHand(game.currentPlayer);
  const jk   = game.getJoker();
  const selectable = state.phase === Phase.DISCARD;

  container.innerHTML = '';
  hand.forEach((card, idx) => {
    const el = buildCardEl(card, jk, false);
    if (selectable) {
      el.classList.add('selectable');
      if (selected.has(idx)) el.classList.add('selected');
      el.addEventListener('click', () => {
        if (selected.has(idx)) selected.delete(idx);
        else selected.add(idx);
        renderGame();
      });
    }
    container.appendChild(el);
  });
}

// ── Action buttons ─────────────────────────────────────────────────────────────
function renderActions(state) {
  const bar = document.getElementById('action-bar');
  bar.innerHTML = '';

  const p = game.currentPlayer;
  const add = (label, cls, handler, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className   = cls;
    b.disabled    = disabled;
    b.addEventListener('click', handler);
    bar.appendChild(b);
    return b;
  };

  // ── DRAW phase ──
  if (state.phase === Phase.DRAW) {
    if (game.canPack(p)) {
      add('Pack (watch only)', 'btn-ghost', () => {
        showConfirm(
          'Pack?',
          'You will sit out this round as a spectator and owe 1 point to the winner.',
          'Yes, Pack',
          'Stay In',
          () => {
            const res = game.pack();
            selected.clear();
            if (res.autoWin) {
              showScoring();
            } else {
              showPassScreen(game.currentPlayer);
            }
          }
        );
      });
    }
    // Draw buttons handled by pile click
    add('Draw from stock ↑', 'btn-primary', () => {
      game.drawFromStock();
      selected.clear();
      renderGame();
    });
  }

  // ── DISCARD phase ──
  if (state.phase === Phase.DISCARD) {
    // Thank you button
    if (game.needsThankYou(p)) {
      add('🙏 Thank You!', 'btn-warn', () => {
        game.thankYou();
        renderGame();
      });
    }

    const sel = [...selected];

    // Discard button (1 card selected)
    add(
      'Discard selected',
      'btn-ghost',
      () => {
        if (sel.length !== 1) return;
        game.discard(sel[0]);
        selected.clear();
        showPassScreen(game.currentPlayer);
      },
      sel.length !== 1
    );

    // DIK! button (1 or 2 cards selected)
    add(
      '⚡ DIK!',
      'btn-danger',
      () => {
        if (sel.length === 0 || sel.length > 2) return;
        showConfirm(
          '⚡ DIK! — Are you sure?',
          sel.length === 1
            ? 'Declare Win 1: discard the selected card — remaining 10 cards must form run(4) + meld(3) + meld(3).'
            : 'Declare Win 2: discard 2 selected cards — remaining 9 cards must form set(3) + set(3) + set(3).',
          'Yes, claim win!',
          'Cancel',
          () => {
            const result = sel.length === 1
              ? game.declare(sel[0])
              : game.declare(sel[0], sel[1]);
            selected.clear();
            if (result && result.forfeit)     { showScoring('forfeit'); }
            else if (result && result.invalidWin) { showScoring('invalid'); }
            else                               { showScoring('normal'); }
          }
        );
      },
      sel.length === 0 || sel.length > 2
    );
  }
}

// ── Status message ─────────────────────────────────────────────────────────────
function updateStatus(state) {
  const el  = document.getElementById('status');
  const p   = game.currentPlayer;
  const sel = selected.size;

  if (state.phase === Phase.DRAW) {
    if (game.canPack(p)) {
      el.innerHTML = `<span class="highlight">Player ${p+1}</span>: See your hand. Draw a card to play — or <b>Pack</b> to sit this round out (costs 1 pt to the winner).`;
    } else {
      el.innerHTML = `<span class="highlight">Player ${p+1}</span>: Pick from the <b>discard pile</b> or draw from the <b>stock</b>.`;
    }
  } else if (state.phase === Phase.DISCARD) {
    const msgs = [];
    if (game.needsThankYou(p)) {
      msgs.push(`<span class="warn">⚠ You completed a set from the discard pile — click <b>Thank You!</b></span>`);
    }
    if (game.isForfeited(p)) {
      msgs.push(`<span class="danger">⛔ You are forfeited this round (missed Thank You). Declaring win will cost you.</span>`);
    }
    msgs.push(`Select ${sel === 0 ? 'a card' : sel + ' card(s)'} to <b>Discard</b>, or select card(s) and click <b>DIK!</b> to declare win.`);
    el.innerHTML = msgs.join('<br>');
  }
}

// ── Build a card element ───────────────────────────────────────────────────────
function buildCardEl(card, jokerCard, faceDown = false) {
  const el   = document.createElement('div');
  el.className = 'card';

  if (faceDown) {
    el.classList.add('face-down');
    return el;
  }

  const sym   = SUIT_SYM[card.suit];
  const color = SUIT_CLASS[card.suit];
  el.classList.add(color);

  // Special type highlight
  if (jokerCard) {
    const t = card.cardType(jokerCard);
    if (t === 'joker')  el.classList.add('is-joker');
    if (t === 'poker')  el.classList.add('is-poker');
    if (t === 'silver') el.classList.add('is-silver');
  }

  el.innerHTML = `
    <div class="corner top">
      <div class="rank">${card.rank}</div>
      <div class="suit">${sym}</div>
    </div>
    <div class="suit-center">${sym}</div>
    <div class="corner bot">
      <div class="rank">${card.rank}</div>
      <div class="suit">${sym}</div>
    </div>
  `;
  return el;
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
function showConfirm(title, body, confirmLabel, cancelLabel, onConfirm) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <p>${body}</p>
      <div class="btn-row">
        <button class="btn-danger" id="modal-confirm">${confirmLabel}</button>
        <button class="btn-ghost"  id="modal-cancel">${cancelLabel}</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  document.getElementById('modal-confirm').addEventListener('click', () => { bg.remove(); onConfirm(); });
  document.getElementById('modal-cancel').addEventListener('click', () => bg.remove());
}

// ── Scoring screen ─────────────────────────────────────────────────────────────
function showScoring(outcome = 'normal') {
  let result, heading, subheading;

  if (outcome === 'forfeit') {
    result     = calcForfeitResult(game);
    heading    = `⛔ Player ${result.forfeiter + 1} Forfeited`;
    subheading = 'Missed thank-you — pays everyone.';
  } else if (outcome === 'invalid') {
    result     = calcInvalidWinResult(game);
    heading    = `❌ Invalid DIK! — Player ${result.claimer + 1}`;
    subheading = 'Hand did not meet win conditions — pays everyone.';
  } else {
    result     = calcRoundResult(game);
    heading    = `🏆 Player ${result.winner + 1} Wins!`;
    subheading = 'Round over.';
  }

  document.body.innerHTML = `
    <div id="header">
      <h1>KANTOORI</h1>
      <div class="meta">Round complete</div>
    </div>
    <div id="game-area">
      <div id="scoring-screen">
        <h2>${heading}</h2>
        <p style="text-align:center;opacity:.7;margin-bottom:16px">${subheading}</p>
        <div id="payments"></div>
        <div id="meld-progress" style="margin-top:14px"></div>
      </div>
      <div id="action-bar" style="margin-top:8px">
        <button class="btn-primary" id="new-round-btn">Next Round</button>
        <button class="btn-ghost"   id="new-game-btn">New Game</button>
      </div>
    </div>
  `;

  // Payments
  const paymentsEl = document.getElementById('payments');
  if (result.netPayments.length === 0) {
    paymentsEl.innerHTML = '<div class="score-row" style="justify-content:center;opacity:.6">No chip transfers this round</div>';
  } else {
    result.netPayments.forEach(({ from, to, amount }) => {
      const chips    = chipsFor(amount);
      const chipStr  = Object.entries(chips).map(([d, n]) => `${n}×${d}`).join(' + ');
      const row = document.createElement('div');
      row.className = 'score-row';
      row.innerHTML = `
        <span>Player ${from+1} <span style="opacity:.5">pays</span> Player ${to+1}</span>
        <span><b>${amount} pts</b> <span class="chips">[${chipStr}]</span></span>
      `;
      paymentsEl.appendChild(row);
    });
  }

  // Meld progress per player
  const progEl = document.getElementById('meld-progress');
  const progresses = result.meldProgress ?? result.progresses ?? [];
  const PROG_LABEL = { 0:'No sequence', 1:'Sequence only', 2:'Seq + 1 meld', 3:'Complete hand' };
  const PENALTY_LABEL = { 0:'-10pts', 1:'-6pts', 2:'-3pts', 3:'-1pt' };

  let progHTML = '<div style="font-size:.8rem;opacity:.65;margin-bottom:6px">Hand progress (losers)</div>';
  progresses.forEach((prog, i) => {
    if (prog === null) return;
    progHTML += `
      <div class="score-row">
        <span style="color:${PLAYER_COLORS[i]}">Player ${i+1}</span>
        <span>${PROG_LABEL[prog] ?? prog}</span>
        <span style="color:#e74c3c">${PENALTY_LABEL[prog] ?? ''}</span>
      </div>`;
  });
  progEl.innerHTML = progHTML;

  document.getElementById('new-round-btn').addEventListener('click', () => {
    game.newRound();
    selected.clear();
    showPassScreen(0, true);
  });
  document.getElementById('new-game-btn').addEventListener('click', () => {
    showSetup();
  });
}

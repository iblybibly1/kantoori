// ── Constants ─────────────────────────────────────────────────────────────────

var COLORS = [
  { name: 'Red',    hex: '#e74c3c' },
  { name: 'Blue',   hex: '#3498db' },
  { name: 'Green',  hex: '#27ae60' },
  { name: 'Yellow', hex: '#f1c40f' },
  { name: 'Purple', hex: '#9b59b6' },
  { name: 'Orange', hex: '#e67e22' },
  { name: 'Pink',   hex: '#e91e63' },
  { name: 'Teal',   hex: '#1abc9c' },
];

var SUIT_SYMBOL = { Hearts: '♥', Diamonds: '♦', Clubs: '♣', Spades: '♠' };
var SUIT_COLOR  = { Hearts: 'red', Diamonds: 'red', Clubs: 'black', Spades: 'black' };

// ── State ──────────────────────────────────────────────────────────────────────

var socket;
var state = {
  screen:        'home',
  setupMode:     'create',
  joinCode:      '',
  nickname:      '',
  color:         null,
  roomInfo:      null,
  myState:       null,
  mySeat:        null,
  lastRoundData: null,
  selectedCards: [],
  handOrder:     null,   // visual reorder: array of original indices
};

// ── Drag state (lives outside render) ─────────────────────────────────────────

var drag = null;

function cleanupDrag() {
  document.removeEventListener('touchmove', onDragMove, false);
  document.removeEventListener('touchend',  onDragEnd,  false);
  document.removeEventListener('mousemove', onDragMove, false);
  document.removeEventListener('mouseup',   onDragEnd,  false);
}

function startCardDrag(touchOrMouseEvent, visualIdx, slotEl) {
  var ev = touchOrMouseEvent;
  var pt = ev.touches ? ev.touches[0] : ev;
  var r  = slotEl.getBoundingClientRect();

  var clone = slotEl.cloneNode(true);
  clone.style.cssText =
    'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;' +
    'width:' + r.width + 'px;height:' + r.height + 'px;' +
    'pointer-events:none;z-index:1000;opacity:.92;' +
    'transform:scale(1.07) rotate(2deg);' +
    'box-shadow:0 18px 36px rgba(0,0,0,.55);transition:none;';
  document.body.appendChild(clone);

  drag = {
    visualIdx: visualIdx,
    toIdx:     visualIdx,
    clone:     clone,
    slotEl:    slotEl,
    offX:      pt.clientX - r.left,
    offY:      pt.clientY - r.top,
  };

  slotEl.classList.add('dragging-source');

  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend',  onDragEnd,  false);
  document.addEventListener('mousemove', onDragMove, false);
  document.addEventListener('mouseup',   onDragEnd,  false);
}

function onDragMove(e) {
  if (!drag) return;
  if (e.cancelable) e.preventDefault();
  var pt = e.touches ? e.touches[0] : e;

  drag.clone.style.left = (pt.clientX - drag.offX) + 'px';
  drag.clone.style.top  = (pt.clientY - drag.offY) + 'px';

  var container = document.querySelector('.my-hand-cards');
  if (!container) return;
  var slots = container.querySelectorAll('.card-slot');
  var newTo = drag.toIdx;

  for (var i = 0; i < slots.length; i++) {
    var r = slots[i].getBoundingClientRect();
    if (pt.clientX < r.left + r.width / 2) { newTo = i; break; }
    if (i === slots.length - 1) newTo = slots.length - 1;
  }

  if (newTo !== drag.toIdx) {
    drag.toIdx = newTo;
    slots.forEach(function(s, i) {
      s.classList.toggle('drag-over', i === newTo && i !== drag.visualIdx);
    });
  }
}

function onDragEnd() {
  if (!drag) return;
  cleanupDrag();

  drag.clone.remove();
  drag.slotEl.classList.remove('dragging-source');

  var fromIdx = drag.visualIdx;
  var toIdx   = drag.toIdx;
  drag = null;

  // Clear visual state
  var container = document.querySelector('.my-hand-cards');
  if (container) {
    container.querySelectorAll('.card-slot').forEach(function(s) {
      s.classList.remove('drag-over');
    });
  }

  if (fromIdx !== toIdx && state.handOrder) {
    var order = state.handOrder.slice();
    var moved = order.splice(fromIdx, 1)[0];
    order.splice(toIdx, 0, moved);
    state.handOrder = order;
    render();
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function h(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function(k) {
      if (k === 'class')      node.className = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else if (k === 'html')  node.innerHTML = attrs[k];
      else                    node.setAttribute(k, attrs[k]);
    });
  }
  if (children) {
    if (typeof children === 'string') node.textContent = children;
    else children.forEach(function(c) { if (c) node.appendChild(c); });
  }
  return node;
}

function render() {
  var app = document.getElementById('app');
  app.innerHTML = '';
  switch (state.screen) {
    case 'home':        app.appendChild(renderHome());       break;
    case 'setup':       app.appendChild(renderSetup());      break;
    case 'lobby':       app.appendChild(renderLobby());      break;
    case 'game':        app.appendChild(renderGame());       break;
    case 'result':      app.appendChild(renderResult());     break;
    case 'session-end': app.appendChild(renderSessionEnd()); break;
    default:            app.textContent = 'Unknown screen';
  }
}

// ── Socket setup ──────────────────────────────────────────────────────────────

function initSocket() {
  socket = io();

  socket.on('room-update', function(data) {
    state.roomInfo = data.roomInfo;
    state.myState  = data.myState;
    state.mySeat   = data.mySeat;
    state.selectedCards = [];

    // Maintain hand order when hand size changes
    if (data.myState) {
      var hand = data.myState.hands[data.mySeat] || [];
      if (!state.handOrder || state.handOrder.length !== hand.length) {
        state.handOrder = hand.map(function(_, i) { return i; });
      }
    }

    var phase = data.roomInfo.phase;
    if (phase === 'lobby')              state.screen = 'lobby';
    else if (phase === 'playing')       state.screen = 'game';
    else if (phase === 'between-rounds') state.screen = 'result';
    else if (phase === 'ended')         state.screen = 'session-end';

    render();
  });

  socket.on('round-ended', function(data) {
    state.roomInfo      = data.roomInfo;
    state.lastRoundData = data;
    state.myState       = null;
    state.selectedCards = [];
    state.handOrder     = null;
    state.screen        = 'result';
    render();
  });

  socket.on('session-ended', function(data) {
    state.screen    = 'session-end';
    state.roomInfo  = { players: data.players };
    render();
  });

  socket.on('error', function(data) {
    showToast(data.msg, 'error');
  });

  socket.on('connect', function() {
    if (state.roomInfo && state.nickname) {
      socket.emit('join-room', {
        code:     state.roomInfo.code,
        nickname: state.nickname,
        color:    state.color,
      });
    }
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type) {
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  toast.style.background = type === 'error' ? '#c0392b' : '#27ae60';
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3000);
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function showModal(title, msg, confirmLabel, onConfirm, confirmClass) {
  var overlay = h('div', { class: 'modal-overlay' });
  var box = h('div', { class: 'modal-box' }, [
    h('h3', {}, title),
    h('p',  {}, msg),
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn-neu' }, 'Cancel'),
      h('button', { class: confirmClass || 'btn-r' }, confirmLabel),
    ]),
  ]);
  overlay.appendChild(box);
  var btns = box.querySelectorAll('button');
  btns[0].addEventListener('click', function() { overlay.remove(); });
  btns[1].addEventListener('click', function() { overlay.remove(); onConfirm(); });
  document.body.appendChild(overlay);
}

// ── Card rendering ─────────────────────────────────────────────────────────────

function getCardType(card, jokerCard) {
  if (card.rank !== jokerCard.rank) return 'normal';
  if (card.suit === jokerCard.suit)  return 'joker';
  var cc = (card.suit === 'Hearts' || card.suit === 'Diamonds') ? 'red' : 'black';
  var jc = (jokerCard.suit === 'Hearts' || jokerCard.suit === 'Diamonds') ? 'red' : 'black';
  return cc !== jc ? 'poker' : 'silver';
}

function renderCard(card, opts) {
  opts = opts || {};
  if (!card) return h('div', { class: 'empty-discard' }, 'Empty');

  var colorClass = SUIT_COLOR[card.suit] === 'red' ? 'card-red' : 'card-black';
  var typeClass  = '';
  if (opts.jokerCard) {
    var ct = getCardType(card, opts.jokerCard);
    if (ct !== 'normal') typeClass = 'type-' + ct;
  }

  var classes = ['card', colorClass, typeClass,
    opts.selectable ? 'selectable' : '',
    opts.selected   ? 'selected'   : '',
  ].filter(Boolean).join(' ');

  var sym  = SUIT_SYMBOL[card.suit] || '?';
  var node = h('div', { class: classes }, [
    h('div', { class: 'corner-top' }, [
      h('span', { class: 'rank' }, card.rank),
      h('span', { class: 'suit-sm' }, sym),
    ]),
    h('span', { class: 'suit-center' }, sym),
    h('div', { class: 'corner-bot' }, [
      h('span', { class: 'rank' }, card.rank),
      h('span', { class: 'suit-sm' }, sym),
    ]),
  ]);

  if (opts.onClick) node.addEventListener('click', opts.onClick);
  return node;
}

function colorHex(colorName) {
  var c = COLORS.find(function(x) { return x.name === colorName; });
  return c ? c.hex : '#888';
}

// ── Home screen ────────────────────────────────────────────────────────────────

function renderHome() {
  var joinInput = h('input', {
    type: 'text',
    placeholder: 'Room code',
    style: 'text-transform:uppercase;letter-spacing:3px;font-weight:700',
  });

  var createBtn = h('button', { class: 'btn-g', style: 'font-size:17px;padding:14px' }, 'Create Game');
  var joinBtn   = h('button', { class: 'btn-b', style: 'padding:11px 20px' }, 'Join');

  createBtn.addEventListener('click', function() {
    state.setupMode = 'create';
    state.screen    = 'setup';
    render();
  });
  joinBtn.addEventListener('click', function() {
    var code = joinInput.value.trim().toUpperCase();
    if (code.length < 4) return showToast('Enter a valid room code', 'error');
    state.setupMode = 'join';
    state.joinCode  = code;
    state.screen    = 'setup';
    render();
  });
  joinInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') joinBtn.click();
  });

  return h('div', { class: 'screen' }, [
    h('div', { class: 'logo' }, 'KANTOORI'),
    h('div', { class: 'tagline' }, 'Multiplayer Card Game'),
    h('div', { class: 'home-buttons' }, [createBtn]),
    h('div', { class: 'join-row', style: 'margin-top:14px' }, [joinInput, joinBtn]),
  ]);
}

// ── Setup screen ───────────────────────────────────────────────────────────────

function renderSetup() {
  var title    = state.setupMode === 'create' ? 'Create Game' : 'Join Game';
  var btnLabel = state.setupMode === 'create' ? 'Create Room' : 'Join Room';

  var nickInput = h('input', { type: 'text', placeholder: 'Your nickname', maxlength: '20' });
  if (state.nickname) nickInput.value = state.nickname;

  var selectedColor = state.color;
  var takenColors   = [];

  var colorDots = COLORS.map(function(c) {
    var dot = h('div', {
      class: 'color-swatch' +
             (selectedColor === c.name ? ' selected' : '') +
             (takenColors.includes(c.name) ? ' taken' : ''),
      style: 'background:' + c.hex,
      title: c.name,
    });
    dot.addEventListener('click', function() {
      if (takenColors.includes(c.name)) return;
      selectedColor = c.name;
      document.querySelectorAll('.color-swatch').forEach(function(d) { d.classList.remove('selected'); });
      dot.classList.add('selected');
    });
    return dot;
  });

  var submitBtn = h('button', { class: 'btn-g', style: 'width:100%;padding:13px;margin-top:4px' }, btnLabel);
  var backBtn   = h('button', { class: 'btn-neu', style: 'width:100%;padding:11px;margin-top:8px' }, '← Back');

  submitBtn.addEventListener('click', function() {
    var nick = nickInput.value.trim();
    if (!nick) return showToast('Enter a nickname', 'error');
    if (!selectedColor) return showToast('Pick a color', 'error');
    state.nickname = nick;
    state.color    = selectedColor;
    if (state.setupMode === 'create') {
      socket.emit('create-room', { nickname: nick, color: selectedColor });
    } else {
      socket.emit('join-room', { code: state.joinCode, nickname: nick, color: selectedColor });
    }
  });
  backBtn.addEventListener('click', function() { state.screen = 'home'; render(); });

  return h('div', { class: 'screen' }, [
    h('div', { class: 'panel' }, [
      h('h2', {}, title),
      h('div', { class: 'form-group' }, [h('label', {}, 'Nickname'), nickInput]),
      h('div', { class: 'form-group' }, [
        h('label', {}, 'Pick your color'),
        h('div', { class: 'color-picker' }, colorDots),
      ]),
      submitBtn,
      backBtn,
    ]),
  ]);
}

// ── Lobby screen ───────────────────────────────────────────────────────────────

function renderLobby() {
  var room   = state.roomInfo;
  var amHost = socket.id === room.hostId;
  var amBank = socket.id === room.bankId;

  var codeEl = h('div', { class: 'room-code-display' }, [
    h('div', { class: 'code' }, room.code),
    (function() {
      var b = h('button', { class: 'copy-btn' }, '📋 Copy Code');
      b.addEventListener('click', function() {
        navigator.clipboard.writeText(room.code).then(function() { showToast('Code copied!'); });
      });
      return b;
    })(),
  ]);

  var playerRows = room.players.map(function(p) {
    var isMe   = p.id === socket.id;
    var isHost = p.id === room.hostId;
    var isBank = p.id === room.bankId;
    var hex    = colorHex(p.color);

    var badges = [];
    if (isHost)       badges.push(h('span', { class: 'badge badge-host' }, 'HOST'));
    if (isBank)       badges.push(h('span', { class: 'badge badge-bank' }, 'BANK'));
    if (isMe)         badges.push(h('span', { class: 'badge badge-you'  }, 'YOU'));
    if (!p.connected) badges.push(h('span', { class: 'badge badge-offline' }, 'offline'));

    var controls = [];
    if (amHost) {
      var chipIn = h('input', { type: 'number', value: String(p.chips), min: '0' });
      var setBtn = h('button', { class: 'btn-g' }, 'Set');
      setBtn.addEventListener('click', (function(pid, inp) {
        return function() { socket.emit('set-chips', { playerId: pid, amount: parseFloat(inp.value) || 0 }); };
      })(p.id, chipIn));
      controls.push(h('div', { class: 'chips-input-row' }, [chipIn, setBtn]));

      if (p.id !== room.hostId) {
        var bankLabel = isBank ? 'Remove Bank' : 'Make Bank';
        var bankBtn   = h('button', { class: 'assign-bank-btn' }, bankLabel);
        bankBtn.addEventListener('click', (function(pid) {
          return function() { socket.emit('assign-bank', { targetId: pid }); };
        })(p.id));
        controls.push(bankBtn);
      }
    }

    return h('div', { class: 'player-row', style: 'flex-direction:column;align-items:flex-start' }, [
      h('div', { style: 'display:flex;align-items:center;gap:8px;width:100%' }, [
        h('div', { class: 'player-dot', style: 'background:' + hex }),
        h('span', { class: 'nickname' }, p.nickname),
      ].concat(badges).concat([
        h('span', { class: 'chip-value', style: 'margin-left:auto' }, String(p.chips)),
      ])),
    ].concat(controls));
  });

  var actions = [];
  if (amHost) {
    var startBtn = h('button', {
      class: room.players.length < 2 ? 'btn-neu' : 'btn-g',
      style: 'width:100%;padding:14px;font-size:16px',
    }, room.players.length < 2 ? 'Need at least 2 players' : '▶ Start Game');
    startBtn.disabled = room.players.length < 2;
    startBtn.addEventListener('click', function() { socket.emit('start-game'); });
    actions.push(startBtn);
  } else {
    actions.push(h('div', { class: 'waiting-msg' }, 'Waiting for host to start…'));
  }

  return h('div', { class: 'screen' }, [
    h('div', { class: 'panel', style: 'max-width:500px' }, [
      h('h2', {}, 'Game Lobby'),
      codeEl,
      h('div', { class: 'player-list' }, playerRows),
      h('div', { class: 'lobby-actions' }, actions),
    ]),
  ]);
}

// ── Game screen ────────────────────────────────────────────────────────────────

function renderGame() {
  var room   = state.roomInfo;
  var gs     = state.myState;
  var mySeat = state.mySeat;

  if (!gs) return h('div', { class: 'screen' }, [h('p', {}, 'Loading…')]);

  var isMyTurn = gs.currentPlayer === mySeat;

  // ── Header ──
  var jokerSym   = gs.jokerCard ? gs.jokerCard.rank + SUIT_SYMBOL[gs.jokerCard.suit] : '?';
  var jokerStyle = gs.jokerCard &&
    (gs.jokerCard.suit === 'Hearts' || gs.jokerCard.suit === 'Diamonds')
    ? 'color:#e74c3c;font-weight:900;font-size:16px'
    : 'color:#1a1a2e;font-weight:900;font-size:16px;background:#fff;padding:1px 4px;border-radius:3px';

  var currentName = (function() {
    var p = room.players.find(function(x) { return x.seatIndex === gs.currentPlayer; });
    return p ? p.nickname : '…';
  })();

  var header = h('div', { class: 'game-header' }, [
    h('span', { class: 'room-code-small' }, room.code),
    h('div', { class: 'joker-display' }, [
      h('span', { class: 'label' }, 'JOKER'),
      h('span', { style: jokerStyle }, jokerSym),
    ]),
    h('div', { class: 'turn-indicator' + (isMyTurn ? '' : ' waiting') },
      isMyTurn ? 'YOUR TURN' : currentName + '\'s turn'),
  ]);

  // ── Opponents ──
  var opponents = room.players.filter(function(p) { return p.id !== socket.id; });
  var oppNodes  = opponents.map(function(p) {
    var seat     = p.seatIndex;
    var hand     = gs.hands[seat] || [];
    var isActive = gs.currentPlayer === seat;
    var hex      = colorHex(p.color);
    var statusBits = [];
    if (gs.packed   && gs.packed[seat])    statusBits.push('PACKED');
    if (gs.forfeited && gs.forfeited[seat]) statusBits.push('FORFEITED');
    if (!p.connected) statusBits.push('OFFLINE');

    return h('div', { class: 'opponent-panel' + (isActive ? ' active-turn' : '') }, [
      h('div', { class: 'op-name' }, [
        h('div', { class: 'op-dot', style: 'background:' + hex }),
        h('span', {}, p.nickname),
      ]),
      h('div', { class: 'op-chips chip-value' }, String(p.chips)),
      h('div', { class: 'op-hand' }, hand.map(function() { return h('div', { class: 'op-card-back' }); })),
      statusBits.length ? h('div', { class: 'op-status' }, statusBits.join(' · ')) : null,
    ]);
  });

  // ── Center table ──
  var stockNode = h('div', { class: 'stock-pile' + (!isMyTurn || gs.phase !== 'draw' ? ' disabled' : '') }, [
    h('span', { class: 'stock-count' }, String(gs.stockSize)),
    h('span', { class: 'stock-label' }, 'STOCK'),
  ]);
  if (isMyTurn && gs.phase === 'draw') {
    stockNode.addEventListener('click', function() {
      socket.emit('game-action', { type: 'draw-stock' });
    });
  }

  var discardNode;
  if (gs.topDiscard) {
    var canDrawDiscard = isMyTurn && gs.phase === 'draw';
    discardNode = renderCard(gs.topDiscard, {
      jokerCard:  gs.jokerCard,
      selectable: canDrawDiscard,
      onClick: canDrawDiscard ? function() { socket.emit('game-action', { type: 'draw-discard' }); } : null,
    });
  } else {
    discardNode = h('div', { class: 'empty-discard' }, 'Empty');
  }

  var tableCenter = h('div', { class: 'table-center' }, [
    h('div', { class: 'pile-area' }, [h('div', { class: 'pile-label' }, 'Stock'), stockNode]),
    h('div', { class: 'pile-area' }, [h('div', { class: 'pile-label' }, 'Discard'), discardNode]),
  ]);

  // ── My hand ──
  var myHand = gs.hands[mySeat] || [];

  // Ensure handOrder is valid
  if (!state.handOrder || state.handOrder.length !== myHand.length) {
    state.handOrder = myHand.map(function(_, i) { return i; });
  }

  var handContainer = h('div', { class: 'my-hand-cards' });

  state.handOrder.forEach(function(originalIdx, visualIdx) {
    var card       = myHand[originalIdx];
    var isSelected = state.selectedCards.indexOf(originalIdx) !== -1;
    var canSelect  = isMyTurn && gs.phase === 'discard';

    var cardNode = renderCard(card, {
      jokerCard:  gs.jokerCard,
      selectable: canSelect,
      selected:   isSelected,
    });

    var slot = h('div', { class: 'card-slot' });
    slot.appendChild(cardNode);

    // Touch: detect horizontal drag vs tap
    var ts = { x: 0, y: 0, moved: false, dragging: false };

    slot.addEventListener('touchstart', function(e) {
      var t = e.touches[0];
      ts.x = t.clientX;
      ts.y = t.clientY;
      ts.moved   = false;
      ts.dragging = false;
    }, { passive: true });

    slot.addEventListener('touchmove', function(e) {
      if (ts.dragging) return;
      var t  = e.touches[0];
      var dx = t.clientX - ts.x;
      var dy = t.clientY - ts.y;
      ts.moved = true;
      // Horizontal drag > 12px and more horizontal than vertical → start drag
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        ts.dragging = true;
        startCardDrag(e, visualIdx, slot);
      }
    }, { passive: false });

    slot.addEventListener('touchend', function() {
      if (!ts.dragging && !ts.moved && canSelect) {
        toggleCardSelection(originalIdx);
      }
      ts.moved    = false;
      ts.dragging = false;
    });

    // Mouse click (desktop)
    if (canSelect) {
      slot.addEventListener('click', function() { toggleCardSelection(originalIdx); });
    }

    handContainer.appendChild(slot);
  });

  var myHandArea = h('div', { class: 'my-hand-area' }, [
    h('div', { class: 'my-hand-meta' }, [
      h('span', { class: 'my-hand-label' }, 'Your hand (' + myHand.length + ' cards)'),
      h('span', { class: 'drag-hint' }, '← drag to reorder →'),
    ]),
    handContainer,
  ]);

  // ── Action & status bars ──
  var actionBar = h('div', { class: 'action-bar' }, buildActionBar(gs, isMyTurn, mySeat));
  var statusBar = h('div', { class: 'status-bar' }, buildStatusMsg(gs, isMyTurn, mySeat));

  return h('div', { id: 'game-screen' }, [
    header,
    h('div', { class: 'opponents-area' }, oppNodes),
    tableCenter,
    myHandArea,
    actionBar,
    statusBar,
  ]);
}

function toggleCardSelection(originalIdx) {
  var pos = state.selectedCards.indexOf(originalIdx);
  if (pos === -1) {
    if (state.selectedCards.length >= 2) state.selectedCards.shift();
    state.selectedCards.push(originalIdx);
  } else {
    state.selectedCards.splice(pos, 1);
  }
  render();
}

function buildActionBar(gs, isMyTurn, mySeat) {
  var nodes = [];

  if (!isMyTurn) {
    var cp = state.roomInfo.players.find(function(p) { return p.seatIndex === gs.currentPlayer; });
    nodes.push(h('span', { class: 'action-info' }, 'Waiting for ' + (cp ? cp.nickname : '…') + '…'));
    return nodes;
  }

  if (gs.phase === 'draw') {
    var stockBtn = h('button', { class: 'btn-b' }, 'Draw Stock');
    stockBtn.addEventListener('click', function() {
      socket.emit('game-action', { type: 'draw-stock' });
    });
    nodes.push(stockBtn);

    if (gs.topDiscard) {
      var discBtn = h('button', { class: 'btn-neu' }, 'Draw Discard');
      discBtn.addEventListener('click', function() {
        socket.emit('game-action', { type: 'draw-discard' });
      });
      nodes.push(discBtn);
    }

    if (gs.isFirstTurn && !gs.hasActed[mySeat]) {
      var packBtn = h('button', { class: 'btn-o' }, 'Pack');
      packBtn.addEventListener('click', function() {
        showModal(
          'Pack this round?',
          'You will sit out and owe 1 chip to the winner.',
          'Pack',
          function() { socket.emit('game-action', { type: 'pack' }); },
          'btn-o'
        );
      });
      nodes.push(packBtn);
    }
  }

  if (gs.phase === 'discard') {
    if (gs.pendingThankYou && gs.pendingThankYou[mySeat]) {
      var tyBtn = h('button', { class: 'btn-pur', style: 'flex:2;font-size:15px' }, '🙏 Thank You!');
      tyBtn.addEventListener('click', function() {
        socket.emit('game-action', { type: 'thank-you' });
      });
      nodes.push(tyBtn);
    }

    var sel = state.selectedCards;

    var discardBtn = h('button', { class: 'btn-neu' }, 'Discard');
    discardBtn.disabled = sel.length !== 1;
    discardBtn.addEventListener('click', function() {
      if (sel.length !== 1) return;
      socket.emit('game-action', { type: 'discard', data: { cardIndex: sel[0] } });
    });
    nodes.push(discardBtn);

    var dikBtn = h('button', { class: 'btn-r', style: 'font-size:15px;letter-spacing:.5px' }, '⚡ DIK!');
    dikBtn.disabled = sel.length !== 1 && sel.length !== 2;
    dikBtn.addEventListener('click', function() {
      if (sel.length !== 1 && sel.length !== 2) return;
      var declareData = sel.length === 1
        ? { cardIndex: sel[0] }
        : { cardIndex: sel[0], cardIndex2: sel[1] };
      var winType = sel.length === 1 ? 'Win 1 (discard 1)' : 'Win 2 (discard 2)';
      showModal(
        '⚡ DIK! — Declare Win',
        'Declare ' + winType + '? If your hand is invalid you pay all players.',
        'Declare!',
        function() { socket.emit('game-action', { type: 'declare', data: declareData }); },
        'btn-r'
      );
    });
    nodes.push(dikBtn);
  }

  return nodes;
}

function buildStatusMsg(gs, isMyTurn, mySeat) {
  if (gs.packed    && gs.packed[mySeat])    return 'You have packed this round.';
  if (gs.forfeited && gs.forfeited[mySeat]) return 'You are forfeited — declaring will use forfeit scoring.';
  if (!isMyTurn) return '';

  if (gs.phase === 'draw') {
    if (gs.isFirstTurn && !gs.hasActed[mySeat]) return 'First turn: draw a card or Pack to sit out.';
    return 'Draw from stock or take the top discard.';
  }
  if (gs.phase === 'discard') {
    if (gs.pendingThankYou && gs.pendingThankYou[mySeat])
      return 'Tap "Thank You!" — you completed a set from the discard pile!';
    var sel = state.selectedCards;
    if (sel.length === 0) return 'Tap a card to select, then Discard or tap DIK! to declare a win.';
    if (sel.length === 1) return 'Card selected. Discard it, or tap DIK! for Win 1.';
    if (sel.length === 2) return 'Two cards selected. Tap DIK! to declare Win 2.';
  }
  return '';
}

// ── Result screen ──────────────────────────────────────────────────────────────

function renderResult() {
  var room   = state.roomInfo;
  var data   = state.lastRoundData;
  var isHost = socket.id === room.hostId;
  var isBank = socket.id === room.bankId;

  var outcome = data ? data.outcome : 'win';
  var scoring = data ? data.scoring : null;

  var bannerClass = 'outcome-banner outcome-' + outcome;
  var bannerText  = outcome === 'win' ? '🏆 Win!' : outcome === 'forfeit' ? '⚠️ Forfeit!' : '❌ Invalid DIK!';
  var children    = [h('div', { class: bannerClass }, bannerText)];

  if (scoring && scoring.netPayments && scoring.netPayments.length) {
    var txRows = scoring.netPayments.map(function(pay) {
      var fromP   = room.players.find(function(p) { return p.seatIndex === pay.from; });
      var toP     = room.players.find(function(p) { return p.seatIndex === pay.to; });
      var fromHex = fromP ? colorHex(fromP.color) : '#888';
      var toHex   = toP   ? colorHex(toP.color)   : '#888';
      return h('div', { class: 'transfer-row' }, [
        h('span', { style: 'color:' + fromHex + ';font-weight:700' }, fromP ? fromP.nickname : '?'),
        h('span', { class: 'arrow' }, '→'),
        h('span', { style: 'color:' + toHex + ';font-weight:700' }, toP ? toP.nickname : '?'),
        h('span', { class: 'amount' }, '◉ ' + pay.amount),
      ]);
    });
    children.push(h('div', { class: 'transfers-panel' }, [
      h('div', { class: 'section-title' }, 'Chip Transfers'),
    ].concat(txRows)));
  }

  var sortedPlayers = room.players.slice().sort(function(a, b) { return b.chips - a.chips; });
  children.push(h('div', { class: 'balances-panel' }, [
    h('div', { class: 'section-title' }, 'Chip Balances'),
  ].concat(sortedPlayers.map(function(p) {
    var hex = colorHex(p.color);
    return h('div', { class: 'balance-row' }, [
      h('div', { class: 'player-dot', style: 'background:' + hex }),
      h('span', { style: 'font-weight:600' }, p.nickname),
      h('span', { class: 'balance-chips' }, '◉ ' + p.chips),
    ]);
  }))));

  if (isHost || isBank) {
    var fromSel = h('select');
    var toSel   = h('select');
    room.players.forEach(function(p) {
      fromSel.appendChild(h('option', { value: p.id }, p.nickname));
      toSel.appendChild(h('option', { value: p.id }, p.nickname));
    });
    if (room.players.length > 1) toSel.selectedIndex = 1;
    var amtIn   = h('input', { type: 'number', value: '0', min: '0' });
    var distBtn = h('button', { class: 'btn-b' }, 'Transfer');
    distBtn.addEventListener('click', function() {
      socket.emit('distribute-chips', {
        fromId: fromSel.value,
        toId:   toSel.value,
        amount: parseFloat(amtIn.value) || 0,
      });
    });
    children.push(h('div', { class: 'distribute-panel' }, [
      h('h3', {}, 'Distribute Chips'),
      h('div', { class: 'row' }, [h('span', { class: 'row-label' }, 'From'), fromSel]),
      h('div', { class: 'row' }, [h('span', { class: 'row-label' }, 'To'), toSel]),
      h('div', { class: 'row' }, [h('span', { class: 'row-label' }, 'Amount'), amtIn, distBtn]),
    ]));
  }

  var actionNodes = [];
  if (isHost) {
    var nextBtn = h('button', { class: 'btn-g', style: 'flex:2;font-size:15px' }, '▶ Next Round');
    nextBtn.addEventListener('click', function() { socket.emit('next-round'); });
    actionNodes.push(nextBtn);

    var endBtn = h('button', { class: 'btn-r' }, 'End Session');
    endBtn.addEventListener('click', function() {
      showModal('End Session?', 'Show final standings and end the game.', 'End Session',
        function() { socket.emit('end-session'); });
    });
    actionNodes.push(endBtn);
  } else {
    actionNodes.push(h('span', { class: 'action-info' }, 'Waiting for host to start next round…'));
  }

  children.push(h('div', { class: 'result-actions' }, actionNodes));
  return h('div', { class: 'result-screen' }, children);
}

// ── Session end screen ─────────────────────────────────────────────────────────

function renderSessionEnd() {
  var room    = state.roomInfo;
  var players = (room && room.players) ? room.players.slice() : [];
  players.sort(function(a, b) { return b.chips - a.chips; });

  var rows = players.map(function(p) {
    var hex = colorHex(p.color);
    var s   = p.stats || {};
    return h('tr', {}, [
      h('td', {}, [h('div', { class: 'player-cell' }, [
        h('div', { class: 'player-dot', style: 'background:' + hex }),
        h('span', {}, p.nickname),
      ])]),
      h('td', {}, String(s.wins        || 0)),
      h('td', {}, String(s.thankYous   || 0)),
      h('td', {}, String(s.packs       || 0)),
      h('td', {}, String(s.forfeits    || 0)),
      h('td', {}, String(s.invalidWins || 0)),
      h('td', {}, String(s.rounds      || 0)),
      h('td', {}, '◉ ' + p.chips),
    ]);
  });

  var table = h('table', { class: 'stats-table' }, [
    h('thead', {}, [h('tr', {}, [
      h('th', {}, 'Player'),
      h('th', {}, 'Wins'),
      h('th', {}, 'Thank Yous'),
      h('th', {}, 'Packs'),
      h('th', {}, 'Forfeits'),
      h('th', {}, 'Invalid'),
      h('th', {}, 'Rounds'),
      h('th', {}, 'Chips'),
    ])]),
    h('tbody', {}, rows),
  ]);

  var playAgainBtn = h('button', { class: 'btn-g', style: 'padding:14px 40px;font-size:16px' }, '↺ Play Again');
  playAgainBtn.addEventListener('click', function() {
    state.screen        = 'home';
    state.roomInfo      = null;
    state.myState       = null;
    state.mySeat        = null;
    state.lastRoundData = null;
    state.selectedCards = [];
    state.handOrder     = null;
    render();
  });

  return h('div', { class: 'session-end-screen' }, [
    h('h1', {}, 'Game Over'),
    h('p', { style: 'color:rgba(238,243,238,.55)' }, 'Final standings'),
    h('div', { class: 'stats-wrap' }, [table]),
    playAgainBtn,
  ]);
}

// ── Init ──────────────────────────────────────────────────────────────────────

initSocket();
render();

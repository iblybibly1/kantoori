// ── Constants ─────────────────────────────────────────────────────────────────
var COLORS = [
  { name:'Red',    hex:'#e74c3c' }, { name:'Blue',   hex:'#3498db' },
  { name:'Green',  hex:'#27ae60' }, { name:'Yellow', hex:'#f1c40f' },
  { name:'Purple', hex:'#9b59b6' }, { name:'Orange', hex:'#e67e22' },
  { name:'Pink',   hex:'#e91e63' }, { name:'Teal',   hex:'#1abc9c' },
];
var SUIT_SYM   = { Hearts:'♥', Diamonds:'♦', Clubs:'♣', Spades:'♠' };
var SUIT_COLOR = { Hearts:'red', Diamonds:'red', Clubs:'black', Spades:'black' };

// ── State ──────────────────────────────────────────────────────────────────────
var socket;
var state = {
  screen:'home', setupMode:'create', joinCode:'', nickname:'', color:null,
  roomInfo:null, myState:null, mySeat:null, lastRoundData:null,
  selectedCards:[], handOrder:null,
  chatMessages:[], chatOpen:false, chatUnread:0,
};

// ── Drag state ─────────────────────────────────────────────────────────────────
var drag = null;
function cleanupDrag() {
  document.removeEventListener('touchmove', onDragMove, false);
  document.removeEventListener('touchend',  onDragEnd,  false);
}

function startCardDrag(touches, visualIdx, slotEl) {
  var pt = touches[0];
  var r  = slotEl.getBoundingClientRect();

  var clone = slotEl.cloneNode(true);
  clone.style.cssText =
    'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;' +
    'width:' + r.width + 'px;height:' + r.height + 'px;' +
    'pointer-events:none;z-index:1000;opacity:.9;' +
    'transform:scale(1.08) rotate(3deg);' +
    'box-shadow:0 20px 40px rgba(0,0,0,.6);transition:none;';
  document.body.appendChild(clone);

  drag = {
    visualIdx: visualIdx,
    toIdx:     visualIdx,
    clone:     clone,
    slotEl:    slotEl,
    offX:      pt.clientX - r.left,
    offY:      pt.clientY - r.top,
  };
  slotEl.classList.add('drag-src');

  // Disable hand scroll while dragging
  var container = document.querySelector('.hand-cards');
  if (container) container.classList.add('no-scroll');

  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend',  onDragEnd,  false);
}

function onDragMove(e) {
  if (!drag) return;
  if (e.cancelable) e.preventDefault();
  var pt = e.touches[0];

  drag.clone.style.left = (pt.clientX - drag.offX) + 'px';
  drag.clone.style.top  = (pt.clientY - drag.offY) + 'px';

  var container = document.querySelector('.hand-cards');
  if (!container) return;
  var slots = container.querySelectorAll('.cslot');
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
  drag.slotEl.classList.remove('drag-src');

  var container = document.querySelector('.hand-cards');
  if (container) {
    container.classList.remove('no-scroll');
    container.querySelectorAll('.cslot').forEach(function(s) { s.classList.remove('drag-over'); });
  }

  var from = drag.visualIdx, to = drag.toIdx;
  drag = null;

  if (from !== to && state.handOrder) {
    var order = state.handOrder.slice();
    var moved = order.splice(from, 1)[0];
    order.splice(to, 0, moved);
    state.handOrder = order;
    render();
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function h(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function(k) {
    if (k === 'class')      node.className = attrs[k];
    else if (k === 'style') node.style.cssText = attrs[k];
    else if (k === 'html')  node.innerHTML = attrs[k];
    else                    node.setAttribute(k, attrs[k]);
  });
  if (children != null) {
    if (typeof children === 'string' || typeof children === 'number') {
      node.textContent = String(children);
    } else {
      // array — items can be strings, numbers, nodes, or null/undefined
      children.forEach(function(c) {
        if (c == null) return;
        if (typeof c === 'string' || typeof c === 'number')
          node.appendChild(document.createTextNode(String(c)));
        else
          node.appendChild(c);
      });
    }
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
    default: app.textContent = '?';
  }
}

// ── Socket ─────────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();

  socket.on('room-update', function(data) {
    state.roomInfo = data.roomInfo;
    state.myState  = data.myState;
    state.mySeat   = data.mySeat;
    state.selectedCards = [];

    if (data.myState) {
      var hand = data.myState.hands[data.mySeat] || [];
      if (!state.handOrder || state.handOrder.length !== hand.length)
        state.handOrder = hand.map(function(_, i) { return i; });
    }

    var phase = data.roomInfo.phase;
    if (phase === 'lobby')              state.screen = 'lobby';
    else if (phase === 'playing')       state.screen = 'game';
    else if (phase === 'between-rounds') state.screen = 'result';
    else if (phase === 'ended')         state.screen = 'session-end';
    render();
  });

  socket.on('round-ended', function(data) {
    state.roomInfo = data.roomInfo; state.lastRoundData = data;
    state.myState = null; state.selectedCards = []; state.handOrder = null;
    state.screen = 'result'; render();
  });

  socket.on('session-ended', function(data) {
    state.screen = 'session-end'; state.roomInfo = { players: data.players }; render();
  });

  socket.on('chat-msg', function(msg) {
    state.chatMessages.push(msg);
    if (state.chatMessages.length > 100) state.chatMessages.shift();
    if (!state.chatOpen) state.chatUnread++;
    if (state.chatOpen) renderChatMessages();
    else updateChatBadge();
  });

  socket.on('error', function(data) { showToast(data.msg, 'error'); });

  socket.on('connect', function() {
    if (state.roomInfo && state.nickname) {
      socket.emit('join-room', { code: state.roomInfo.code, nickname: state.nickname, color: state.color });
    }
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  var t = document.querySelector('.toast'); if (t) t.remove();
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  toast.style.background = type === 'error' ? '#c0392b' : '#27ae60';
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3000);
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function showModal(title, msg, confirmLabel, onConfirm, confirmClass) {
  var ov = h('div', { class:'modal-ov' });
  var box = h('div', { class:'modal-box' }, [
    h('h3',{},title), h('p',{},msg),
    h('div',{class:'modal-acts'},[
      h('button',{class:'btn-neu'},'Cancel'),
      h('button',{class:confirmClass||'btn-r'},confirmLabel),
    ]),
  ]);
  ov.appendChild(box);
  box.querySelectorAll('button')[0].addEventListener('click', function(){ov.remove();});
  box.querySelectorAll('button')[1].addEventListener('click', function(){ov.remove(); onConfirm();});
  document.body.appendChild(ov);
}

// ── Chat UI ────────────────────────────────────────────────────────────────────
function openChat() {
  state.chatOpen = true;
  state.chatUnread = 0;
  updateChatBadge();

  var room = state.roomInfo;
  var ov = h('div', {
    id:'chat-overlay',
    style:'position:fixed;inset:0;z-index:150;display:flex;flex-direction:column;' +
          'background:rgba(0,0,0,.85);backdrop-filter:blur(6px);',
  });

  var hdr = h('div', {
    style:'display:flex;align-items:center;justify-content:space-between;' +
          'padding:12px 16px;background:rgba(0,0,0,.5);border-bottom:1px solid rgba(255,255,255,.08);',
  }, [
    h('span',{style:'font-size:16px;font-weight:800;color:#fff'},'💬 Chat'),
    (function(){
      var b = h('button',{class:'btn-neu',style:'padding:6px 14px;min-height:36px;font-size:13px'},'Close');
      b.addEventListener('click', function(){ov.remove(); state.chatOpen = false;});
      return b;
    })(),
  ]);

  var msgs = h('div',{
    id:'chat-msgs',
    style:'flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;',
  });

  var inp = h('input',{
    type:'text', placeholder:'Type a message…', maxlength:'200',
    style:'flex:1;min-height:44px;border-radius:10px 0 0 10px;border-right:none;',
  });
  var sendBtn = h('button',{
    class:'btn-g',
    style:'min-height:44px;padding:10px 18px;border-radius:0 10px 10px 0;font-size:14px;',
  }, 'Send');
  var sendMsg = function() {
    var txt = inp.value.trim();
    if (!txt) return;
    socket.emit('chat-message', { text: txt });
    inp.value = '';
  };
  sendBtn.addEventListener('click', sendMsg);
  inp.addEventListener('keydown', function(e){ if(e.key==='Enter') sendMsg(); });

  var footer = h('div',{
    style:'padding:10px 14px calc(10px + env(safe-area-inset-bottom));' +
          'background:rgba(0,0,0,.5);border-top:1px solid rgba(255,255,255,.08);' +
          'display:flex;gap:0;',
  },[inp, sendBtn]);

  ov.appendChild(hdr);
  ov.appendChild(msgs);
  ov.appendChild(footer);
  document.body.appendChild(ov);

  renderChatMessages();
  setTimeout(function(){ inp.focus(); }, 100);
}

function renderChatMessages() {
  var msgs = document.getElementById('chat-msgs');
  if (!msgs) return;
  msgs.innerHTML = '';
  if (state.chatMessages.length === 0) {
    msgs.appendChild(h('div',{style:'color:rgba(255,255,255,.35);font-size:13px;text-align:center;margin-top:20px'},'No messages yet. Say hello!'));
    return;
  }
  state.chatMessages.forEach(function(m) {
    var c = COLORS.find(function(x){return x.name===m.color;});
    var hex = c ? c.hex : '#888';
    msgs.appendChild(h('div',{
      style:'display:flex;flex-direction:column;gap:2px;',
    },[
      h('span',{style:'font-size:11px;font-weight:700;color:'+hex},m.nickname),
      h('div',{
        style:'background:rgba(255,255,255,.08);padding:8px 12px;border-radius:8px;' +
              'font-size:14px;line-height:1.45;max-width:90%;',
      }, m.text),
    ]));
  });
  msgs.scrollTop = msgs.scrollHeight;
}

function updateChatBadge() {
  var badge = document.getElementById('chat-badge');
  if (!badge) return;
  badge.textContent = state.chatUnread > 0 ? String(state.chatUnread) : '';
  badge.style.display = state.chatUnread > 0 ? 'flex' : 'none';
}

// ── Card rendering ─────────────────────────────────────────────────────────────
function getCardType(card, jc) {
  if (card.rank !== jc.rank) return 'normal';
  if (card.suit === jc.suit) return 'joker';
  var cc = SUIT_COLOR[card.suit], jcc = SUIT_COLOR[jc.suit];
  return cc !== jcc ? 'poker' : 'silver';
}

function renderCard(card, opts) {
  opts = opts || {};
  if (!card) return h('div',{class:'empty-discard'},'Empty');

  var colorCls = SUIT_COLOR[card.suit] === 'red' ? 'c-red' : 'c-blk';
  var typeCls  = '';
  if (opts.jokerCard) { var ct = getCardType(card, opts.jokerCard); if (ct !== 'normal') typeCls = 'type-' + ct; }

  var cls = ['card', colorCls, typeCls,
    opts.selectable ? 'selectable' : '',
    opts.selected   ? 'selected'   : '',
    opts.drawable   ? 'pile-top drawable' : '',
  ].filter(Boolean).join(' ');

  var sym  = SUIT_SYM[card.suit] || '?';
  var node = h('div',{class:cls},[
    h('div',{class:'corner-top'},[h('span',{class:'crank'},card.rank),h('span',{class:'csuit'},sym)]),
    h('div',{class:'corner-bot'},[h('span',{class:'crank'},card.rank),h('span',{class:'csuit'},sym)]),
  ]);
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  return node;
}

function colorHex(name) {
  var c = COLORS.find(function(x){return x.name===name;}); return c ? c.hex : '#888';
}

// ── Home ───────────────────────────────────────────────────────────────────────
function renderHome() {
  var inp = h('input',{type:'text',placeholder:'Room code',style:'text-transform:uppercase;letter-spacing:3px;font-weight:700'});
  var create = h('button',{class:'btn-g',style:'font-size:17px;padding:14px'},'Create Game');
  var join   = h('button',{class:'btn-b',style:'padding:11px 20px'},'Join');
  create.addEventListener('click', function(){state.setupMode='create';state.screen='setup';render();});
  join.addEventListener('click', function(){
    var code = inp.value.trim().toUpperCase();
    if (code.length < 4) return showToast('Enter a valid room code','error');
    state.setupMode='join'; state.joinCode=code; state.screen='setup'; render();
  });
  inp.addEventListener('keydown', function(e){if(e.key==='Enter') join.click();});
  return h('div',{class:'screen'},[
    h('div',{class:'logo'},'KANTOORI'),
    h('div',{class:'tagline'},'Multiplayer Card Game'),
    h('div',{class:'home-btns'},[create]),
    h('div',{class:'join-row',style:'margin-top:12px'},[inp,join]),
  ]);
}

// ── Setup ──────────────────────────────────────────────────────────────────────
function renderSetup() {
  var title = state.setupMode==='create' ? 'Create Game' : 'Join Game';
  var label = state.setupMode==='create' ? 'Create Room' : 'Join Room';
  var nick  = h('input',{type:'text',placeholder:'Your nickname',maxlength:'20'});
  if (state.nickname) nick.value = state.nickname;
  var sel = state.color; var taken = [];
  var dots = COLORS.map(function(c){
    var d = h('div',{class:'color-swatch'+(sel===c.name?' selected':'')+(taken.includes(c.name)?' taken':''),style:'background:'+c.hex,title:c.name});
    d.addEventListener('click',function(){
      if(taken.includes(c.name)) return; sel = c.name;
      document.querySelectorAll('.color-swatch').forEach(function(x){x.classList.remove('selected');});
      d.classList.add('selected');
    });
    return d;
  });
  var sub  = h('button',{class:'btn-g',style:'width:100%;padding:13px;margin-top:4px'},label);
  var back = h('button',{class:'btn-neu',style:'width:100%;padding:11px;margin-top:8px'},'← Back');
  sub.addEventListener('click', function(){
    var n = nick.value.trim();
    if (!n) return showToast('Enter a nickname','error');
    if (!sel) return showToast('Pick a color','error');
    state.nickname = n; state.color = sel;
    if (state.setupMode==='create') socket.emit('create-room',{nickname:n,color:sel});
    else socket.emit('join-room',{code:state.joinCode,nickname:n,color:sel});
  });
  back.addEventListener('click',function(){state.screen='home';render();});
  return h('div',{class:'screen'},[
    h('div',{class:'panel'},[
      h('h2',{},title),
      h('div',{class:'form-group'},[h('label',{},'Nickname'),nick]),
      h('div',{class:'form-group'},[h('label',{},'Pick your color'),h('div',{class:'color-picker'},dots)]),
      sub, back,
    ]),
  ]);
}

// ── Lobby ──────────────────────────────────────────────────────────────────────
function renderLobby() {
  var room = state.roomInfo;
  var amHost = socket.id === room.hostId;
  var amBank = socket.id === room.bankId;

  var codeEl = h('div',{class:'code-display'},[
    h('div',{class:'code'},room.code),
    (function(){
      var b = h('button',{class:'copy-btn'},'📋 Copy Code');
      b.addEventListener('click',function(){navigator.clipboard.writeText(room.code).then(function(){showToast('Code copied!');});});
      return b;
    })(),
  ]);

  var rows = room.players.map(function(p){
    var isMe   = p.id === socket.id;
    var isHost = p.id === room.hostId;
    var isBank = p.id === room.bankId;
    var hex    = colorHex(p.color);
    var badges = [];
    if (isHost)       badges.push(h('span',{class:'badge b-host'},'HOST'));
    if (isBank)       badges.push(h('span',{class:'badge b-bank'},'BANK'));
    if (isMe)         badges.push(h('span',{class:'badge b-you'},'YOU'));
    if (!p.connected) badges.push(h('span',{class:'badge b-off'},'offline'));
    var top = [h('div',{class:'pdot',style:'background:'+hex}),h('span',{class:'pname'},p.nickname)].concat(badges).concat([h('span',{class:'chip'},String(p.chips))]);
    var row = h('div',{class:'player-row'},[h('div',{class:'prow-top'},top)]);
    if (amHost) {
      var ci = h('input',{type:'number',value:String(p.chips),min:'0'});
      var sb = h('button',{class:'btn-g'},'Set');
      sb.addEventListener('click',(function(pid,inp){return function(){socket.emit('set-chips',{playerId:pid,amount:parseFloat(inp.value)||0});}})(p.id,ci));
      row.appendChild(h('div',{class:'chips-row'},[ci,sb]));
      if (p.id !== room.hostId) {
        var bb = h('button',{class:'bank-btn'},isBank?'Remove Bank':'Make Bank');
        bb.addEventListener('click',(function(pid){return function(){socket.emit('assign-bank',{targetId:pid});}})(p.id));
        row.appendChild(bb);
      }
    }
    return row;
  });

  var actions = [];
  if (amHost) {
    var sb = h('button',{class:room.players.length<2?'btn-neu':'btn-g',style:'width:100%;padding:14px;font-size:16px'},room.players.length<2?'Need at least 2 players':'▶ Start Game');
    sb.disabled = room.players.length < 2;
    sb.addEventListener('click',function(){socket.emit('start-game');});
    actions.push(sb);
  } else {
    actions.push(h('div',{class:'wait-msg'},'Waiting for host to start…'));
  }

  return h('div',{class:'screen'},[
    h('div',{class:'panel',style:'max-width:480px'},[
      h('h2',{},'Game Lobby'),
      codeEl,
      h('div',{class:'player-list'},rows),
      h('div',{class:'lobby-actions'},actions),
    ]),
  ]);
}

// ── Game ───────────────────────────────────────────────────────────────────────
function renderGame() {
  var room   = state.roomInfo;
  var gs     = state.myState;
  var mySeat = state.mySeat;
  if (!gs) return h('div',{class:'screen'},[h('p',{},'Loading…')]);

  var isMyTurn = gs.currentPlayer === mySeat;

  // Header
  var jCard = gs.jokerCard;
  var jSym  = jCard ? jCard.rank + SUIT_SYM[jCard.suit] : '?';
  var jStyle = jCard && (jCard.suit==='Hearts'||jCard.suit==='Diamonds')
    ? 'color:#e74c3c;font-weight:900;font-size:15px'
    : 'color:#111;font-weight:900;font-size:15px;background:#fff;padding:1px 4px;border-radius:3px';
  var curName = (function(){var p=room.players.find(function(x){return x.seatIndex===gs.currentPlayer;});return p?p.nickname:'…';})();

  // Chat button (shows unread badge)
  var chatBtnWrap = h('div',{style:'position:relative;flex-shrink:0'});
  var chatBtn = h('button',{class:'btn-neu',style:'min-height:36px;padding:5px 10px;font-size:16px'},'💬');
  var badge = h('span',{
    id:'chat-badge',
    style:'position:absolute;top:-4px;right:-4px;background:#e74c3c;color:#fff;' +
          'border-radius:10px;font-size:10px;font-weight:800;padding:1px 5px;' +
          'display:'+(state.chatUnread>0?'flex':'none')+';align-items:center;',
  }, state.chatUnread > 0 ? String(state.chatUnread) : '');
  chatBtn.addEventListener('click', openChat);
  chatBtnWrap.appendChild(chatBtn);
  chatBtnWrap.appendChild(badge);

  var header = h('div',{class:'ghdr'},[
    h('span',{class:'ghdr-code'},room.code),
    h('div',{class:'joker-pill'},[h('span',{class:'jlabel'},'JOKER'),h('span',{style:jStyle},jSym)]),
    h('div',{class:'turn-pill '+(isMyTurn?'mine':'theirs')},isMyTurn?'YOUR TURN':curName+'\'s turn'),
    chatBtnWrap,
  ]);

  // Opponents
  var myHex = colorHex((room.players.find(function(p){return p.id===socket.id;})||{}).color);
  var opp   = room.players.filter(function(p){return p.id!==socket.id;});
  var oppNodes = opp.map(function(p) {
    var seat   = p.seatIndex;
    var active = gs.currentPlayer === seat;
    var isPacked   = gs.packed    && gs.packed[seat];
    var isForfeited= gs.forfeited && gs.forfeited[seat];
    var hex    = colorHex(p.color);
    var initial = p.nickname.charAt(0).toUpperCase();
    var cirClass = 'opp-circle' + (active?' active':'') + (isPacked?' packed':'') + (!p.connected?' offline':'');

    // Role badges
    var roleBadges = [];
    if (p.id === room.hostId) roleBadges.push(h('span',{class:'opp-role r-host'},'H'));
    if (p.id === room.bankId) roleBadges.push(h('span',{class:'opp-role r-bank'},'B'));

    var statusLine = '';
    if (isPacked)    statusLine = 'Packed';
    if (isForfeited) statusLine = 'Forfeited';
    if (!p.connected) statusLine = 'Offline';

    var hand = gs.hands[seat] || [];
    return h('div',{class:'opp-avatar'},[
      h('div',{class:cirClass,style:'background:'+hex},initial),
      roleBadges.length ? h('div',{class:'opp-roles'},roleBadges) : null,
      h('div',{class:'opp-name'},p.nickname),
      h('div',{class:'opp-chips'},'◉ '+p.chips),
      h('div',{style:'font-size:9px;color:rgba(255,255,255,.35);'},''+hand.length+' cards'),
      statusLine ? h('div',{class:'opp-status'},statusLine) : null,
    ]);
  });

  // Table center
  var canDrawStock   = isMyTurn && gs.phase === 'draw';
  var canDrawDiscard = isMyTurn && gs.phase === 'draw' && !!gs.topDiscard;
  var stock = h('div',{class:'stock-pile'+(canDrawStock?'':' nodraw')},[
    h('span',{class:'sc-num'},String(gs.stockSize)),
    h('span',{class:'sc-lbl'},'STOCK'),
  ]);
  if (canDrawStock) stock.addEventListener('click',function(){socket.emit('game-action',{type:'draw-stock'});});

  var discard = gs.topDiscard
    ? renderCard(gs.topDiscard, { jokerCard:jCard, drawable:canDrawDiscard, onClick:canDrawDiscard?function(){socket.emit('game-action',{type:'draw-discard'});}:null })
    : h('div',{class:'empty-discard'},'Empty');

  var tableFelt = h('div',{class:'table-felt'},[
    h('div',{class:'pile-col'},[h('div',{class:'pile-lbl'},'Stock'),stock]),
    h('div',{class:'pile-col'},[h('div',{class:'pile-lbl'},'Discard'),discard]),
  ]);
  var tableArea = h('div',{class:'table-area'},[tableFelt]);

  // Hand
  var myHand = gs.hands[mySeat] || [];
  if (!state.handOrder || state.handOrder.length !== myHand.length)
    state.handOrder = myHand.map(function(_,i){return i;});

  var handContainer = h('div',{class:'hand-cards'});
  state.handOrder.forEach(function(origIdx, visIdx) {
    var card = myHand[origIdx];
    var isSel = state.selectedCards.indexOf(origIdx) !== -1;
    var canSel = isMyTurn && gs.phase === 'discard';

    var cardNode = renderCard(card, { jokerCard:jCard, selectable:canSel, selected:isSel });
    var slot = h('div',{class:'cslot'});
    slot.appendChild(cardNode);

    // Long-press to drag, quick tap to select
    var ts = { timer:null, active:false };
    slot.addEventListener('touchstart', function(e) {
      ts.active = false;
      ts.timer = setTimeout(function(){
        ts.timer = null; ts.active = true;
        if (navigator.vibrate) navigator.vibrate(25);
        startCardDrag(e.touches, visIdx, slot);
      }, 180);
    }, { passive:true });
    slot.addEventListener('touchmove', function(e) {
      if (!ts.timer) return;
      var t = e.touches[0];
      if (Math.abs(t.clientX-e.target.getBoundingClientRect().left) > 6) {
        clearTimeout(ts.timer); ts.timer = null;
      }
    }, { passive:true });
    slot.addEventListener('touchend', function() {
      if (ts.timer) { clearTimeout(ts.timer); ts.timer = null; if (canSel) toggleSel(origIdx); }
    });
    if (canSel) slot.addEventListener('click', function() { toggleSel(origIdx); });

    handContainer.appendChild(slot);
  });

  // My role badges (show to yourself)
  var myRoles = [];
  if (socket.id === room.hostId) myRoles.push(h('span',{class:'opp-role r-host',style:'font-size:10px;padding:2px 6px'},'HOST'));
  if (socket.id === room.bankId) myRoles.push(h('span',{class:'opp-role r-bank',style:'font-size:10px;padding:2px 6px'},'BANK'));

  var meChips = (room.players.find(function(p){return p.id===socket.id;})||{chips:0}).chips;
  var handArea = h('div',{class:'hand-area'},[
    h('div',{class:'hand-meta'},[
      h('div',{style:'display:flex;align-items:center;gap:6px'},[
        h('span',{class:'hand-label'},'Your hand ('+myHand.length+')'),
        h('span',{class:'chip',style:'font-size:11px'},''+meChips),
      ].concat(myRoles)),
      h('span',{class:'hand-hint'},'hold & drag to sort'),
    ]),
    handContainer,
  ]);

  return h('div',{id:'game-screen'},[
    header,
    h('div',{class:'opp-strip'},oppNodes),
    tableArea,
    handArea,
    h('div',{class:'action-bar'},buildActions(gs, isMyTurn, mySeat)),
    h('div',{class:'status-bar'},buildStatus(gs, isMyTurn, mySeat)),
  ]);
}

function toggleSel(origIdx) {
  var pos = state.selectedCards.indexOf(origIdx);
  if (pos === -1) { if (state.selectedCards.length >= 2) state.selectedCards.shift(); state.selectedCards.push(origIdx); }
  else state.selectedCards.splice(pos, 1);
  render();
}

function buildActions(gs, isMyTurn, mySeat) {
  var nodes = [];
  if (!isMyTurn) {
    var cp = state.roomInfo.players.find(function(p){return p.seatIndex===gs.currentPlayer;});
    nodes.push(h('span',{class:'ainfo'},'Waiting for '+(cp?cp.nickname:'…')+'…'));
    return nodes;
  }
  if (gs.phase === 'draw') {
    var sb = h('button',{class:'btn-b'},'Draw Stock');
    sb.addEventListener('click',function(){socket.emit('game-action',{type:'draw-stock'});});
    nodes.push(sb);
    if (gs.topDiscard) {
      var db = h('button',{class:'btn-neu'},'Draw Discard');
      db.addEventListener('click',function(){socket.emit('game-action',{type:'draw-discard'});});
      nodes.push(db);
    }
    if (gs.isFirstTurn && !gs.hasActed[mySeat]) {
      var pb = h('button',{class:'btn-o'},'Pack');
      pb.addEventListener('click',function(){showModal('Pack this round?','You sit out and owe 1 chip to winner.','Pack',function(){socket.emit('game-action',{type:'pack'});},'btn-o');});
      nodes.push(pb);
    }
  }
  if (gs.phase === 'discard') {
    if (gs.pendingThankYou && gs.pendingThankYou[mySeat]) {
      var ty = h('button',{class:'btn-pur',style:'flex:2;font-size:15px'},'🙏 Thank You!');
      ty.addEventListener('click',function(){socket.emit('game-action',{type:'thank-you'});});
      nodes.push(ty);
    }
    var sel = state.selectedCards;
    var disc = h('button',{class:'btn-neu'},'Discard');
    disc.disabled = sel.length !== 1;
    disc.addEventListener('click',function(){if(sel.length!==1)return;socket.emit('game-action',{type:'discard',data:{cardIndex:sel[0]}});});
    nodes.push(disc);
    var dik = h('button',{class:'btn-r',style:'font-size:15px'},'⚡ DIK!');
    dik.disabled = sel.length !== 1 && sel.length !== 2;
    dik.addEventListener('click',function(){
      if (sel.length!==1&&sel.length!==2) return;
      var dd = sel.length===1?{cardIndex:sel[0]}:{cardIndex:sel[0],cardIndex2:sel[1]};
      var wt = sel.length===1?'Win 1 (discard 1)':'Win 2 (discard 2)';
      showModal('⚡ DIK! — Declare','Declare '+wt+'? If invalid you pay all players.','Declare!',function(){socket.emit('game-action',{type:'declare',data:dd});},'btn-r');
    });
    nodes.push(dik);
  }
  return nodes;
}

function buildStatus(gs, isMyTurn, mySeat) {
  if (gs.packed    && gs.packed[mySeat])    return 'You have packed this round.';
  if (gs.forfeited && gs.forfeited[mySeat]) return 'You are forfeited — declaring will use forfeit scoring.';
  if (!isMyTurn) return '';
  if (gs.phase==='draw') {
    if (gs.isFirstTurn && !gs.hasActed[mySeat]) return 'First turn: draw a card or Pack to sit out.';
    return 'Draw from stock or take the top discard.';
  }
  if (gs.phase==='discard') {
    if (gs.pendingThankYou && gs.pendingThankYou[mySeat]) return 'Tap "Thank You!" first — you completed a set from discard!';
    var s = state.selectedCards;
    if (s.length===0) return 'Tap a card to select, then Discard or tap DIK! to declare.';
    if (s.length===1) return 'Card selected. Discard it, or tap DIK! for Win 1.';
    if (s.length===2) return 'Two cards selected. Tap DIK! to declare Win 2.';
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
  var bannerCls = 'outcome-banner ' + (outcome==='win'?'ow':outcome==='forfeit'?'of':'oi');
  var bannerTxt = outcome==='win'?'🏆 Win!':outcome==='forfeit'?'⚠️ Forfeit!':'❌ Invalid DIK!';
  var children = [h('div',{class:bannerCls},bannerTxt)];

  if (scoring && scoring.netPayments && scoring.netPayments.length) {
    var txRows = scoring.netPayments.map(function(pay){
      var fp = room.players.find(function(p){return p.seatIndex===pay.from;});
      var tp = room.players.find(function(p){return p.seatIndex===pay.to;});
      return h('div',{class:'tx-row'},[
        h('span',{style:'color:'+(fp?colorHex(fp.color):'#888')+';font-weight:700'},fp?fp.nickname:'?'),
        h('span',{class:'tx-arrow'},'→'),
        h('span',{style:'color:'+(tp?colorHex(tp.color):'#888')+';font-weight:700'},tp?tp.nickname:'?'),
        h('span',{class:'tx-amt'},'◉ '+pay.amount),
      ]);
    });
    children.push(h('div',{class:'res-panel'},[h('div',{class:'sec-title'},'Chip Transfers')].concat(txRows)));
  }

  var sorted = room.players.slice().sort(function(a,b){return b.chips-a.chips;});
  children.push(h('div',{class:'res-panel'},[
    h('div',{class:'sec-title'},'Chip Balances'),
  ].concat(sorted.map(function(p){
    var isHost2 = p.id===room.hostId, isBank2 = p.id===room.bankId;
    var badges = [];
    if(isHost2) badges.push(h('span',{class:'opp-role r-host',style:'font-size:9px;padding:1px 5px;margin-left:4px'},'HOST'));
    if(isBank2) badges.push(h('span',{class:'opp-role r-bank',style:'font-size:9px;padding:1px 5px;margin-left:4px'},'BANK'));
    return h('div',{class:'bal-row'},[
      h('div',{class:'pdot',style:'background:'+colorHex(p.color)}),
      h('span',{style:'font-weight:600;flex:1'},p.nickname),
    ].concat(badges).concat([h('span',{class:'bal-chips'},'◉ '+p.chips)]));
  }))));

  // Bank panel — host OR bank can adjust chips between rounds
  if (isHost || isBank) {
    var bpRows = room.players.map(function(p) {
      var inp2 = h('input',{type:'number',value:String(p.chips),min:'0',class:'bpr-input'});
      var setB = h('button',{class:'btn-g bpr-btn'},'Set');
      setB.addEventListener('click',(function(pid, i){return function(){socket.emit('set-chips',{playerId:pid,amount:parseFloat(i.value)||0});};})(p.id, inp2));
      return h('div',{class:'bank-player-row'},[
        h('div',{class:'bpr-dot',style:'background:'+colorHex(p.color)}),
        h('span',{class:'bpr-name'},p.nickname),
        h('span',{class:'bpr-cur'},'◉'+p.chips),
        inp2, setB,
      ]);
    });

    // Transfer section
    var fromSel = h('select');
    var toSel   = h('select');
    room.players.forEach(function(p){
      fromSel.appendChild(h('option',{value:p.id},p.nickname));
      toSel.appendChild(h('option',{value:p.id},p.nickname));
    });
    if (room.players.length > 1) toSel.selectedIndex = 1;
    var amtIn  = h('input',{type:'number',value:'0',min:'0',style:'width:68px;min-height:36px;padding:7px;'});
    var txBtn  = h('button',{class:'btn-b',style:'padding:7px 12px;min-height:36px;'},'Transfer');
    txBtn.addEventListener('click',function(){socket.emit('distribute-chips',{fromId:fromSel.value,toId:toSel.value,amount:parseFloat(amtIn.value)||0});});

    children.push(h('div',{class:'bank-panel'},[
      h('div',{class:'bank-panel-title'},[h('span',{},'🏦 Bank Panel')]),
      h('div',{},bpRows),
      h('div',{class:'transfer-section'},[
        h('div',{class:'sec-title',style:'margin-bottom:8px'},'Transfer Chips'),
        h('div',{class:'transfer-row-ctrl'},[h('span',{style:'font-size:11px;color:var(--dim);white-space:nowrap'},'From'),fromSel]),
        h('div',{class:'transfer-row-ctrl'},[h('span',{style:'font-size:11px;color:var(--dim);white-space:nowrap'},'To'),toSel]),
        h('div',{class:'transfer-row-ctrl'},[h('span',{style:'font-size:11px;color:var(--dim);white-space:nowrap'},'Amount'),amtIn,txBtn]),
      ]),
    ]));
  }

  var actionNodes = [];
  if (isHost) {
    var nb = h('button',{class:'btn-g',style:'flex:2;font-size:15px'},'▶ Next Round');
    nb.addEventListener('click',function(){socket.emit('next-round');});
    actionNodes.push(nb);
    var eb = h('button',{class:'btn-r'},'End Session');
    eb.addEventListener('click',function(){showModal('End Session?','Show final standings and end the game.','End Session',function(){socket.emit('end-session');});});
    actionNodes.push(eb);
  } else {
    actionNodes.push(h('span',{class:'ainfo'},'Waiting for host to start next round…'));
  }
  children.push(h('div',{class:'res-actions'},actionNodes));
  return h('div',{class:'result-screen'},children);
}

// ── Session end ────────────────────────────────────────────────────────────────
function renderSessionEnd() {
  var room    = state.roomInfo;
  var players = (room&&room.players)?room.players.slice():[];
  players.sort(function(a,b){return b.chips-a.chips;});
  var rows = players.map(function(p){
    var s = p.stats||{};
    return h('tr',{},[
      h('td',{},[h('div',{class:'pcell'},[h('div',{class:'pdot',style:'background:'+colorHex(p.color)}),h('span',{},p.nickname)])]),
      h('td',{},String(s.wins||0)), h('td',{},String(s.thankYous||0)),
      h('td',{},String(s.packs||0)), h('td',{},String(s.forfeits||0)),
      h('td',{},String(s.invalidWins||0)), h('td',{},String(s.rounds||0)),
      h('td',{style:'color:var(--gold);font-weight:700'},'◉ '+p.chips),
    ]);
  });
  var table = h('table',{class:'stats-table'},[
    h('thead',{},[h('tr',{},[
      h('th',{},'Player'),h('th',{},'Wins'),h('th',{},'TY'),h('th',{},'Packs'),
      h('th',{},'Forfeits'),h('th',{},'Invalid'),h('th',{},'Rounds'),h('th',{},'Chips'),
    ])]),
    h('tbody',{},rows),
  ]);
  var pa = h('button',{class:'btn-g',style:'padding:14px 36px;font-size:16px'},'↺ Play Again');
  pa.addEventListener('click',function(){
    state.screen='home'; state.roomInfo=null; state.myState=null; state.mySeat=null;
    state.lastRoundData=null; state.selectedCards=[]; state.handOrder=null;
    state.chatMessages=[]; state.chatUnread=0;
    render();
  });
  return h('div',{class:'end-screen'},[
    h('h1',{},'Game Over'),
    h('p',{style:'color:var(--dim)'},'Final standings'),
    h('div',{class:'stats-wrap'},[table]),
    pa,
  ]);
}

// ── Init ──────────────────────────────────────────────────────────────────────
initSocket();
render();

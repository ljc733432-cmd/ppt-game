/**
 * AI Q版泡泡堂 - 前端主程序
 * 包含 WebSocket 连接、UI 管理和 Phaser 游戏场景
 */

// ============ 全局配置 ============
const TILE_SIZE = 48;
const MAP_WIDTH = 13;
const MAP_HEIGHT = 11;
const GAME_WIDTH = MAP_WIDTH * TILE_SIZE;
const GAME_HEIGHT = MAP_HEIGHT * TILE_SIZE;

const WS_URL = (() => {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('server');
  if (override) return override;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = `${protocol}//${window.location.host}/ws`;
  // 观战/入房模式：把房间号传给 WebSocket URL，让服务端设置 ws.roomId
  const room = params.get('room');
  if (room) {
    const wsParams = new URLSearchParams();
    wsParams.set('room', room);
    if (params.get('spectate') === '1') wsParams.set('spectate', '1');
    url += '?' + wsParams.toString();
  }
  return url;
})();

// ============ 状态管理 ============
let ws = null;
let myPlayerId = null;
let roomId = null;
let gameState = null;
let game = null;
let gameScene = null;
let isReady = false;
let _inputLoggedPhase = false;
let _inputLoggedId = false;

let isReconnecting = false;
let isAgentHost = false;
let expectedAgentCount = 0;

// ============ 背景音乐 ============
let bgmAudio = null;
let bgmPlaying = false;

function initBGM() {
  if (bgmAudio) return;
  bgmAudio = new Audio();
  bgmAudio.preload = 'auto';
  bgmAudio.src = 'assets/bgm.mp3';
  bgmAudio.loop = true;
  bgmAudio.volume = 0.4;
}

function toggleBGM() {
  initBGM();
  const btn = document.getElementById('music-toggle');
  if (!btn) return;

  if (bgmPlaying) {
    bgmAudio.pause();
    bgmPlaying = false;
    btn.textContent = '🔇';
    btn.classList.add('muted');
    btn.title = '点击播放背景音乐';
  } else {
    bgmAudio.play().then(() => {
      bgmPlaying = true;
      btn.textContent = '🔊';
      btn.classList.remove('muted');
      btn.title = '点击暂停背景音乐';
    }).catch(e => {
      console.warn('背景音乐播放失败（可能被浏览器阻止自动播放）:', e);
      alert('请点击页面任意位置后再尝试播放音乐');
    });
  }
}
function copyToClipboard(text) {
  const fallback = () => {
    window.prompt('请手动复制以下链接:', text);
    return Promise.resolve();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(fallback);
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  try {
    document.execCommand('copy');
    return Promise.resolve();
  } catch (e) {
    return fallback();
  } finally {
    document.body.removeChild(input);
  }
}

function generateRandomChineseName() {
  const names = [
    '炸弹王', '最佳损友', '泡泡侠', '踩雷专业户', '一炸成名',
    '跑路冠军', '爆破专家', '爆炸就是艺术', '炸弹收藏家', '暴走泡泡',
    '火力少年王', '无敌风火轮', '踩蛋达人', '引爆全场', '烈焰红唇',
    '一脚踢飞', '炸弹小王子', '速度与激情', '炸弹人', '泡泡堂杀手',
    '炸弹狂魔', '地雷专家', '踩雷小王子', '爆炸小能手', '炸弹快递员',
    '炸弹艺术家', '泡泡大师', '炸弹信徒', '爆炸爱好者', '炸弹狂热者',
    '踩雷小天才', '爆破天才', '炸弹博士', '泡泡忍者', '炸弹忍者',
    '炸弹先锋', '爆炸先锋', '泡泡战士', '炸弹战士', '泡泡骑士',
    '炸弹骑士', '泡泡之王', '炸弹之王', '泡泡达人', '炸弹达人',
    '踩雷高手', '爆炸高手', '泡泡高手', '炸弹高手', '泡泡之神',
    '炸弹之神', '泡泡皇帝', '炸弹皇帝', '踩雷皇帝', '爆炸皇帝'
  ];
  return names[Math.floor(Math.random() * names.length)];
}

function getDefaultPlayerName() {
  const name = generateRandomChineseName();
  const domain = window.location.hostname || 'localhost';
  return name + '-' + domain;
}

// ============ 连接管理 ============
function connect() {
  // 防止重复创建 WebSocket
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return;
  }

  const status = document.getElementById('connection-status');
  status.textContent = '连接中...';
  status.className = 'connecting';

  ws = new WebSocket(WS_URL);

  // 5秒连接超时
  const connectTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      status.textContent = '连接超时';
      status.className = 'disconnected';
      console.warn('WebSocket连接超时，请检查服务器是否运行');
    }
  }, 5000);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    status.textContent = '已连接';
    status.className = 'connected';
    console.log('WebSocket connected');
    // 重连时跳过自动逻辑
    if (isReconnecting) { isReconnecting = false; return; }

    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const autoRoomId = urlParams.get('room');
    const isWatch = urlParams.get('watch') === '1';
    const agentCount = parseInt(urlParams.get('agents')) || 0;
    const isSpectate = urlParams.get('spectate') === '1';

    if (isWatch) {
      isAgentHost = true;
      expectedAgentCount = agentCount;
    }

    if (autoRoomId && isSpectate) {
      // 观战：ws.roomId 已通过 WS URL 参数设置，直接发 spectate
      send({ type: 'spectate' });
    } else if (autoRoomId) {
      const name = document.getElementById('player-name').value || '玩家';
      send({ type: 'joinRoom', roomId: autoRoomId.toUpperCase(), playerName: name });
      // 不自动准备 — 真人需要手动准备；Agent 由 auto-start.js 接管
    } else if (isWatch) {
      const name = document.getElementById('player-name').value || '观众';
      const mode = document.getElementById('game-mode').value;
      const mapName = document.getElementById('map-select').value;
      send({ type: 'createRoom', mode, mapName, playerName: name });
    }
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    status.textContent = '断开连接';
    status.className = 'disconnected';
    console.log('WebSocket disconnected, reconnecting...');
    // 重连时跳过自动建房/入房逻辑
    isReconnecting = true;
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    clearTimeout(connectTimeout);
    console.error('WebSocket error:', err);
    status.textContent = '连接失败';
    status.className = 'disconnected';
    isReconnecting = true;
    setTimeout(connect, 2000);
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    // 仅首次警告，避免刷屏
    if (!send._warned) { send._warned = true; console.warn('[Send] WebSocket未连接，输入丢失。state:', ws ? ws.readyState : 'null'); }
  }
}

// ============ 消息处理 ============
let autoStartWatching = false;
let autoStartFired = false;
function tryAutoStart() {
  if (autoStartFired || !roomId) return;
  // 只在 waiting 阶段自动开始
  if (gameState && gameState.phase && gameState.phase !== 'waiting') return;
  const allPlayers = (gameState && gameState.players) || {};
  const allBots = (gameState && gameState.bots) || {};
  const total = Object.keys(allPlayers).length + Object.keys(allBots).length;
  if (total >= 2) {
    const playerValues = Object.values(allPlayers);
    const allReady = playerValues.length === 0 || playerValues.every(p => p.ready === true);
    if (allReady) {
      autoStartFired = true;
      console.log('[Auto] ' + total + ' players ready, starting...');
      setTimeout(() => send({ type: 'startGame' }), 500);
    }
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'roomCreated':
      myPlayerId = msg.playerId;
      roomId = msg.roomId;
      history.pushState({}, '', '?room=' + roomId);
      enterLobby(msg.roomId);
      autoStartWatching = true;
      autoStartFired = false;
      // Agent 房主自动准备；开战由 auto-start.js 接管
      setTimeout(() => {
        send({ type: 'setReady', ready: true });
      }, 400);
      break;

    case 'joined':
      myPlayerId = msg.playerId;
      roomId = msg.roomId;
      gameState = msg.state;
      enterLobby(msg.roomId);
      updatePlayerList(msg.state);
      // 不自动准备 — 真人手动操作；Agent 由 auto-start.js 发信号
      break;

    case 'playerList':
      if (gameState) {
        gameState.players = msg.players.players;
        gameState.bots = msg.players.bots;
      }
      updatePlayerList(msg.players);
      if (autoStartWatching) tryAutoStart();
      break;

    case 'playerReady':
      updatePlayerReady(msg.playerId, msg.ready);
      if (autoStartWatching) tryAutoStart();
      break;

    case 'playerJoined':
      addChatMessage(`${msg.name || msg.playerId} 加入了房间`);
      break;

    case 'gameStarted':
      gameState = msg.state;
      startGame(msg.state);
      break;

    case 'state':
      gameState = msg.state;
      if (gameScene) gameScene.updateState(msg.state);
      updateUI(msg.state);
      break;

    case 'battleLog':
      addBattleLog(msg.text);
      break;

    case 'gameEnded':
      gameStarting = false;
      showResult(msg);
      break;

    case 'error':
      alert(msg.message);
      break;

    case 'roomList':
      showRoomList(msg.rooms);
      break;

    case 'chat':
      addChatMessage(`${msg.playerId}: ${msg.text}`);
      break;

    case 'possessed':
      // 夺舍成功，直接进入游戏
      myPlayerId = msg.playerId;
      roomId = msg.roomId;
      gameState = msg.state;
      startGame(msg.state);
      break;

    case 'waitingForNextRound':
      // 没有可夺舍的 Bot，等待下一局
      showWaitingOverlay(msg.roomId);
      break;

    case 'spectating':
      // 观战模式：渲染游戏但不接受输入
      gameState = msg.state;
      roomId = msg.roomId;
      startSpectatorView(msg.state);
      break;
  }
}

// ============ UI 控制 ============
function showMenu() {
  gameStarting = false;
  // 清理等待覆盖层
  const wo = document.getElementById('waiting-overlay');
  if (wo) wo.style.display = 'none';
  if (this._waitingInterval) { clearInterval(this._waitingInterval); this._waitingInterval = null; }
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game-container').classList.remove('active');
  document.getElementById('result-overlay').classList.remove('active');
  document.getElementById('create-section').classList.remove('hidden');
  document.getElementById('room-list-section').classList.add('hidden');
  document.getElementById('join-section').classList.add('hidden');
  history.pushState({}, '', window.location.pathname);
  isReady = false;
  isSpectating = false;
  roomId = null;
  autoStartWatching = false;
  autoStartFired = false;
  if (game) { game.destroy(true); game = null; gameScene = null; }
}

function enterLobby(rid) {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('lobby-room-id').textContent = rid;
  document.getElementById('game-container').classList.remove('active');
  document.getElementById('result-overlay').classList.remove('active');
  document.getElementById('btn-ready').textContent = '准备';
  document.getElementById('btn-ready').className = 'btn btn-secondary';
  isReady = false;
}

function showWaitingOverlay(rid) {
  // 隐藏大厅和菜单，显示游戏区域 + 等待提示
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game-container').classList.add('active');
  document.getElementById('result-overlay').classList.remove('active');
  document.getElementById('battle-log').innerHTML = '';
  document.getElementById('controls-hint').style.display = 'none';

  // 在游戏区域显示等待覆盖层
  let overlay = document.getElementById('waiting-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'waiting-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.8);z-index:60;border-radius:8px';
    overlay.innerHTML = `
      <div style="font-size:2rem;color:#ffd93d;margin-bottom:16px;">⏳ 正在游戏中...</div>
      <div style="color:#aaa;font-size:1rem;margin-bottom:8px;">房间 ${rid}</div>
      <div style="color:#888;font-size:0.85rem;">没有可夺舍的活 Bot，等待下一局自动加入</div>
      <div id="waiting-dots" style="color:#ff8e8e;font-size:1.5rem;margin-top:12px;"></div>
    `;
    document.getElementById('game-container').appendChild(overlay);

    // 跳动点动画
    let dots = 0;
    this._waitingInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      const el = document.getElementById('waiting-dots');
      if (el) el.textContent = '.'.repeat(dots) || '·';
    }, 500);
  }
  overlay.style.display = 'flex';
}

function updatePlayerList(data) {
  const container = document.getElementById('players-container');
  container.innerHTML = '';

  // players/bots 可能是数组（playerList 消息）或对象（joined 的 state）
  let players = data.players || data;
  let bots = data.bots || [];
  if (!Array.isArray(players)) players = Object.values(players);
  if (!Array.isArray(bots)) bots = Object.values(bots);

  const all = [...players, ...bots];
  all.forEach(p => {
    const div = document.createElement('div');
    div.className = `player-item ${p.ready ? 'ready' : ''}`;
    div.innerHTML = `
      <div class="p-avatar" style="background:${p.color}">${p.isBot ? '🤖' : '👤'}</div>
      <div class="p-name">${p.name} ${p.id === myPlayerId ? '(你)' : ''}</div>
      <div class="p-status ${p.isBot ? 'bot' : (p.ready ? 'ready' : 'waiting')}">
        ${p.isBot ? 'Bot' : (p.ready ? '已准备' : '等待中')}
      </div>
    `;
    container.appendChild(div);
  });
}

function updatePlayerReady(pid, ready) {
  // 更新本地 gameState
  if (gameState) {
    const allPlayers = gameState.players;
    if (allPlayers) {
      // players 可能是对象或数组（来自不同消息源）
      if (Array.isArray(allPlayers)) {
        const p = allPlayers.find(x => x.id === pid);
        if (p) p.ready = ready;
      } else {
        const p = allPlayers[pid] || (gameState.bots && gameState.bots[pid]);
        if (p) p.ready = ready;
      }
    }
  }
  // 刷新 UI 列表
  if (gameState) {
    updatePlayerList({
      players: gameState.players,
      bots: gameState.bots || {}
    });
  }
}

function updateUI(state) {
  if (!state) return;

  // 时间
  const mins = Math.floor(state.timeLeft / 60).toString().padStart(2, '0');
  const secs = (state.timeLeft % 60).toString().padStart(2, '0');
  document.getElementById('time-display').textContent = `${mins}:${secs}`;

  // 我的状态
  if (myPlayerId && state.players[myPlayerId]) {
    const me = state.players[myPlayerId];
    document.getElementById('lives-display').textContent = me.lives;
    document.getElementById('kills-display').textContent = me.kills;
  }

  // 玩家状态面板
  const statsContainer = document.getElementById('stats-container');
  statsContainer.innerHTML = '';
  const all = { ...state.players, ...state.bots };
  Object.values(all).forEach(p => {
    const div = document.createElement('div');
    div.className = 'stat-item';
    div.innerHTML = `
      <div class="stat-color" style="background:${p.color}"></div>
      <div class="stat-name">${p.name} ${p.dead ? '💀' : ''}</div>
      <div class="stat-lives">${'❤️'.repeat(p.lives)}${p.dead ? '💀' : ''}</div>
      <div class="stat-kills">⚔️${p.kills}</div>
    `;
    statsContainer.appendChild(div);
  });
}

function addBattleLog(text) {
  const log = document.getElementById('battle-log');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<span class="log-time">${time}</span> ${text}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function addChatMessage(text) {
  addBattleLog(text);
}

function showResult(data) {
  const overlay = document.getElementById('result-overlay');
  overlay.classList.add('active');

  const title = document.getElementById('result-title');
  if (data.winner) {
    const all = { ...gameState.players, ...gameState.bots };
    const winner = all[data.winner];
    title.innerHTML = `<span class="winner">${winner ? winner.name : data.winner} 获胜！</span>`;
  } else if (data.winnerTeam) {
    title.innerHTML = `<span class="winner">${data.winnerTeam === 'red' ? '红队' : '蓝队'} 获胜！</span>`;
  } else {
    title.innerHTML = `<span class="draw">平局！</span>`;
  }

  const table = document.getElementById('result-stats');
  table.innerHTML = `
    <tr><th>玩家</th><th>击杀</th><th>死亡</th><th>道具</th><th>存活</th></tr>
  `;
  Object.entries(data.stats || {}).forEach(([pid, s]) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${s.name}</td>
      <td>${s.kills}</td>
      <td>${s.deaths}</td>
      <td>${s.itemsPicked}</td>
      <td>${s.survived ? '✅' : '❌'}</td>
    `;
    table.appendChild(row);
  });
}

function showRoomList(rooms) {
  const container = document.getElementById('room-list-container');
  container.innerHTML = '';
  document.getElementById('create-section').classList.add('hidden');
  document.getElementById('room-list-section').classList.remove('hidden');

  if (rooms.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#888;padding:30px 0;">暂无可用房间，你可以创建一个！</div>';
    return;
  }

  rooms.forEach(r => {
    const div = document.createElement('div');
    div.className = 'room-card';
    div.style.cssText = 'padding:14px 16px;background:#0f172a;border-radius:10px;margin-bottom:10px;cursor:pointer;transition:all 0.2s;border:1px solid rgba(255,255,255,0.05);';
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-weight:bold;color:#fff;font-size:1rem;">${r.hostName || '未知房主'} 的房间</div>
          <div style="font-size:0.8rem;color:#888;margin-top:4px;">
            ${getModeName(r.mode)} · ${r.mapName || '经典地图'} · ${r.playerCount + r.botCount}/${r.maxPlayers}人
          </div>
        </div>
        <div style="background:#2d3a5c;color:#fff;padding:6px 14px;border-radius:8px;font-size:0.8rem;font-weight:bold;">
          加入
        </div>
      </div>
    `;
    div.addEventListener('click', () => {
      const name = document.getElementById('player-name').value || '玩家';
      send({ type: 'joinRoom', roomId: r.id, playerName: name });
    });
    // 悬停效果
    div.addEventListener('mouseenter', () => { div.style.borderColor = 'rgba(255,107,107,0.3)'; div.style.background = '#16213e'; });
    div.addEventListener('mouseleave', () => { div.style.borderColor = 'rgba(255,255,255,0.05)'; div.style.background = '#0f172a'; });
    container.appendChild(div);
  });
}

function getModeName(mode) {
  const map = { '1v1': '1v1', 'ffa': '混战', '2v2': '2v2', 'pve': '人机' };
  return map[mode] || mode;
}

// ============ 地图主题配色 ============
const MAP_THEMES = {
  classic: {
    bg: '#0d0d1a',
    ground: [0x22384a, 0x26405a],
    stone: [0x4a4a52, 0x6a6a75, 0x82828f, 0x3a3a42, 0x757582, 0x2e2e36],
    brick: [0x6e3410, 0xB85A28, 0xD4713A],
    bomb: [0x111118, 0x2e2e3a, 0x55556a, 0x1a1a24, 0x8a6a3a, 0xffcc00, 0xffffff],
    fire: [0xcc2200, 0xff4400, 0xff8800, 0xffcc00, 0xffffaa]
  },
  arena: {
    bg: '#2a1a0a',
    ground: [0xC4956A, 0xD4A373],
    stone: [0x6B4226, 0x8B5E3C, 0xA67B5B, 0x5C3A1E, 0x7A5230, 0x4A2E18],
    brick: [0x8B6914, 0xA67C52, 0xC49A6C],
    bomb: [0x1a1008, 0x3a2820, 0x5a4840, 0x2a1a14, 0x8a6a3a, 0xffcc00, 0xffffff],
    fire: [0xcc4400, 0xff6600, 0xffaa00, 0xffcc00, 0xffffaa]
  },
  maze: {
    bg: '#0f1a0f',
    ground: [0x2a3a2a, 0x354535],
    stone: [0x4a4a4a, 0x5a5a5a, 0x6a6a6a, 0x3a3a3a, 0x505050, 0x2a2a2a],
    brick: [0x3a4a3a, 0x4a5a4a, 0x5a6a5a],
    bomb: [0x0a0f0a, 0x1a251a, 0x2a352a, 0x0f1a0f, 0x6a5a3a, 0xffcc00, 0xffffff],
    fire: [0x44aa44, 0x66cc66, 0x88ee88, 0xaaffaa, 0xddffdd]
  },
  sparse: {
    bg: '#0a1f0a',
    ground: [0x2d5a27, 0x3a7a33],
    stone: [0x5a3a1a, 0x6b4226, 0x7d5232, 0x4a2e12, 0x5c3818, 0x3a2210],
    brick: [0xa62c2c, 0xd45454, 0xff6b6b],
    bomb: [0x0a0f0a, 0x1a251a, 0x2a352a, 0x0f1a0f, 0x8a6a3a, 0xffcc00, 0xffffff],
    fire: [0xcc4400, 0xff6600, 0xffaa00, 0xffcc00, 0xffffaa]
  }
};

// ============ Phaser 游戏场景 ============
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    // 优先加载 AI 生成的道具图标；加载失败时在 create() 用程序化纹理兜底
    for (const key of ['bomb', 'power', 'speed', 'kick', 'ghost']) {
      this.load.image('item_' + key, 'assets/items/' + key + '.png');
    }
    // AI 生成的角色精灵图（行走4x4 / 放炸弹2x2 / 被炸2x2，每帧256px）
    this.load.spritesheet('char_walk', 'assets/characters/walk.png', { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('char_bomb', 'assets/characters/bomb.png', { frameWidth: 256, frameHeight: 256 });
    this.load.spritesheet('char_die', 'assets/characters/die.png', { frameWidth: 256, frameHeight: 256 });
    // 另外3个角色：蓝企鹅 / 绿恐龙 / 黄小鸡
    for (const c of ['penguin', 'dino', 'chick']) {
      this.load.spritesheet(c + '_walk', 'assets/characters/' + c + '_walk.png', { frameWidth: 256, frameHeight: 256 });
      this.load.spritesheet(c + '_bomb', 'assets/characters/' + c + '_bomb.png', { frameWidth: 256, frameHeight: 256 });
      this.load.spritesheet(c + '_die', 'assets/characters/' + c + '_die.png', { frameWidth: 256, frameHeight: 256 });
    }
  }

  createProceduralTextures(themeName = 'classic') {
    const T = MAP_THEMES[themeName] || MAP_THEMES.classic;

    // ========== 空地纹理 ==========
    const ground = this.make.graphics({ x: 0, y: 0, add: false });
    if (themeName === 'arena') {
      // 竞技场：沙地，带颗粒感
      ground.fillStyle(T.ground[0]);
      ground.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      ground.fillStyle(T.ground[1], 0.35);
      for (let i = 0; i < 12; i++) {
        const gx = Math.random() * TILE_SIZE;
        const gy = Math.random() * TILE_SIZE;
        ground.fillCircle(gx, gy, 1 + Math.random() * 2);
      }
    } else if (themeName === 'maze') {
      // 迷宫：草地，带草叶
      ground.fillStyle(T.ground[0]);
      ground.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      ground.fillStyle(T.ground[1], 0.4);
      for (let i = 0; i < 8; i++) {
        const gx = Math.random() * TILE_SIZE;
        const gy = Math.random() * TILE_SIZE;
        ground.fillRect(gx, gy, 1 + Math.random() * 2, 2 + Math.random() * 3);
      }
    } else if (themeName === 'sparse') {
      // 荒野：浅草地，点缀小花
      ground.fillStyle(T.ground[0]);
      ground.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      ground.fillStyle(T.ground[1], 0.3);
      ground.fillCircle(TILE_SIZE * 0.25, TILE_SIZE * 0.25, 2);
      ground.fillCircle(TILE_SIZE * 0.75, TILE_SIZE * 0.6, 2);
      ground.fillCircle(TILE_SIZE * 0.4, TILE_SIZE * 0.8, 1.5);
    } else {
      // 经典：棋盘格
      ground.fillStyle(T.ground[0]);
      ground.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      ground.fillStyle(T.ground[1] || T.ground[0], 0.6);
      ground.fillRect(0, 0, TILE_SIZE / 2, TILE_SIZE / 2);
      ground.fillRect(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2);
    }
    ground.lineStyle(1, T.ground[0] - 0x081020, 0.8);
    ground.strokeRect(0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    ground.generateTexture('ground', TILE_SIZE, TILE_SIZE);

    // ========== 石头纹理（不可破坏） ==========
    const stone = this.make.graphics({ x: 0, y: 0, add: false });
    if (themeName === 'arena') {
      // 木桩
      stone.fillStyle(T.stone[0]);
      stone.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      stone.fillStyle(T.stone[1]);
      stone.fillRect(4, 2, TILE_SIZE - 8, TILE_SIZE - 4);
      stone.fillStyle(T.stone[2]);
      stone.fillRect(4, 2, TILE_SIZE - 8, 4);
      stone.fillStyle(T.stone[3]);
      stone.fillRect(6, 8, TILE_SIZE - 12, 3);
      stone.fillRect(6, 14, TILE_SIZE - 12, 3);
      stone.fillRect(6, 20, TILE_SIZE - 12, 3);
      stone.fillRect(6, 26, TILE_SIZE - 12, 3);
      stone.fillRect(6, 32, TILE_SIZE - 12, 3);
      stone.fillRect(6, 38, TILE_SIZE - 12, 3);
    } else if (themeName === 'maze') {
      // 绿色树篱（圆顶）
      stone.fillStyle(T.stone[0]);
      stone.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      stone.fillStyle(T.stone[1]);
      stone.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2 + 4, TILE_SIZE * 0.38);
      stone.fillStyle(T.stone[2]);
      stone.fillCircle(TILE_SIZE / 2 - 4, TILE_SIZE / 2, TILE_SIZE * 0.2);
      stone.fillStyle(T.stone[3]);
      stone.fillRect(4, TILE_SIZE - 8, TILE_SIZE - 8, 6);
    } else if (themeName === 'sparse') {
      // 树桩（同心圆年轮）
      stone.fillStyle(T.stone[0]);
      stone.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      stone.fillStyle(T.stone[1]);
      stone.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.38);
      stone.fillStyle(T.stone[2]);
      stone.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.28);
      stone.fillStyle(T.stone[3]);
      stone.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.18);
      stone.fillStyle(T.stone[4]);
      stone.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.08);
    } else {
      // 经典：灰色石块
      stone.fillStyle(T.stone[0]);
      stone.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      stone.fillStyle(T.stone[1]);
      stone.fillRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
      stone.fillStyle(T.stone[2]);
      stone.fillRect(4, 4, TILE_SIZE - 8, 6);
      stone.fillStyle(T.stone[3]);
      stone.fillRect(4, TILE_SIZE - 10, TILE_SIZE - 8, 6);
      stone.fillStyle(T.stone[4]);
      stone.fillRect(8, 12, TILE_SIZE - 16, TILE_SIZE - 24);
    }
    stone.lineStyle(1, T.stone[5], 1);
    stone.strokeRect(0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    stone.generateTexture('stone', TILE_SIZE, TILE_SIZE);

    // ========== 砖块纹理（可破坏） ==========
    const brick = this.make.graphics({ x: 0, y: 0, add: false });
    if (themeName === 'arena') {
      // 竞技场：木箱/桶
      brick.fillStyle(T.brick[0]);
      brick.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      brick.fillStyle(T.brick[1]);
      brick.fillRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
      brick.fillStyle(T.brick[2]);
      brick.fillRect(2, 2, TILE_SIZE - 4, 4);
      brick.fillStyle(T.brick[0]);
      brick.fillRect(0, TILE_SIZE / 2 - 1, TILE_SIZE, 2);
      brick.fillRect(TILE_SIZE / 2 - 1, 0, 2, TILE_SIZE);
    } else if (themeName === 'maze') {
      // 迷宫：灌木丛（圆角矩形团）
      brick.fillStyle(T.brick[0]);
      brick.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      brick.fillStyle(T.brick[1]);
      brick.fillCircle(TILE_SIZE * 0.3, TILE_SIZE * 0.3, TILE_SIZE * 0.22);
      brick.fillCircle(TILE_SIZE * 0.7, TILE_SIZE * 0.3, TILE_SIZE * 0.22);
      brick.fillCircle(TILE_SIZE * 0.5, TILE_SIZE * 0.7, TILE_SIZE * 0.25);
      brick.fillStyle(T.brick[2]);
      brick.fillCircle(TILE_SIZE * 0.5, TILE_SIZE * 0.5, TILE_SIZE * 0.15);
    } else if (themeName === 'sparse') {
      // 荒野：花丛 / 石头
      brick.fillStyle(T.brick[0]);
      brick.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      brick.fillStyle(T.brick[1]);
      brick.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.32);
      brick.fillStyle(T.brick[2]);
      brick.fillCircle(TILE_SIZE / 2 - 6, TILE_SIZE / 2 - 6, 5);
      brick.fillCircle(TILE_SIZE / 2 + 6, TILE_SIZE / 2 - 6, 5);
      brick.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2 + 8, 6);
    } else {
      // 经典：红砖墙
      brick.fillStyle(T.brick[0]);
      brick.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      brick.fillStyle(T.brick[1]);
      brick.fillRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
      brick.fillStyle(T.brick[2]);
      brick.fillRect(1, 1, TILE_SIZE - 2, 5);
      brick.fillStyle(T.brick[0]);
      brick.fillRect(0, TILE_SIZE / 3, TILE_SIZE, 2);
      brick.fillRect(0, TILE_SIZE * 2 / 3, TILE_SIZE, 2);
      brick.fillRect(TILE_SIZE / 2, 0, 2, TILE_SIZE / 3);
      brick.fillRect(TILE_SIZE / 4, TILE_SIZE / 3, 2, TILE_SIZE / 3);
      brick.fillRect(TILE_SIZE * 3 / 4, TILE_SIZE / 3, 2, TILE_SIZE / 3);
      brick.fillRect(TILE_SIZE / 2, TILE_SIZE * 2 / 3, 2, TILE_SIZE / 3);
    }
    brick.generateTexture('brick', TILE_SIZE, TILE_SIZE);

    // ========== 炸弹纹理（通用） ==========
    const bomb = this.make.graphics({ x: 0, y: 0, add: false });
    bomb.fillStyle(T.bomb[0]);
    bomb.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2 + 2, TILE_SIZE * 0.36);
    bomb.fillStyle(T.bomb[1]);
    bomb.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2 + 2, TILE_SIZE * 0.34);
    bomb.fillStyle(T.bomb[2], 0.9);
    bomb.fillCircle(TILE_SIZE / 2 - 5, TILE_SIZE / 2 - 4, TILE_SIZE * 0.16);
    bomb.fillStyle(T.bomb[3]);
    bomb.fillRect(TILE_SIZE / 2 - 3, 4, 6, 8);
    bomb.lineStyle(2, T.bomb[4], 1);
    bomb.lineBetween(TILE_SIZE / 2, 6, TILE_SIZE / 2 + 5, 1);
    bomb.fillStyle(T.bomb[5]);
    bomb.fillCircle(TILE_SIZE / 2 + 6, 2, 3);
    bomb.fillStyle(T.bomb[6]);
    bomb.fillCircle(TILE_SIZE / 2 + 6, 2, 1.5);
    bomb.generateTexture('bomb', TILE_SIZE, TILE_SIZE);

    // ========== 火焰纹理（通用） ==========
    const fire = this.make.graphics({ x: 0, y: 0, add: false });
    fire.fillStyle(T.fire[0], 0.7);
    fire.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    fire.fillStyle(T.fire[1]);
    fire.fillRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
    fire.fillStyle(T.fire[2]);
    fire.fillRect(6, 6, TILE_SIZE - 12, TILE_SIZE - 12);
    fire.fillStyle(T.fire[3]);
    fire.fillRect(10, 10, TILE_SIZE - 20, TILE_SIZE - 20);
    fire.fillStyle(T.fire[4]);
    fire.fillRect(15, 15, TILE_SIZE - 30, TILE_SIZE - 30);
    fire.generateTexture('fire', TILE_SIZE, TILE_SIZE);

    // 玩家纹理
    this.generatePlayerTextures('#ff4444', 'player_0');
    this.generatePlayerTextures('#4488ff', 'player_1');
    this.generatePlayerTextures('#44ff44', 'player_2');
    this.generatePlayerTextures('#ffaa00', 'player_3');
    this.generatePlayerTextures('#888888', 'player_bot');
  }

  // 注册角色动画（行走四方向 / 放炸弹 / 被炸）
  // sideFacing: 素材侧面帧的原始朝向（right=侧面帧朝右，左走需flipX；both=第2行朝左第3行朝右）
  createCharAnimations() {
    this._chars = [
      { walk: 'char_walk', bomb: 'char_bomb', die: 'char_die', sideFacing: 'right' }, // 0 白团子
      { walk: 'penguin_walk', bomb: 'penguin_bomb', die: 'penguin_die', sideFacing: 'left' }, // 1 蓝企鹅
      { walk: 'dino_walk', bomb: 'dino_bomb', die: 'dino_die', sideFacing: 'both' }, // 2 绿恐龙
      { walk: 'chick_walk', bomb: 'chick_bomb', die: 'chick_die', sideFacing: 'right' }  // 3 黄小鸡
    ];
    this._useCharSheet = false;
    this._chars.forEach((c, i) => {
      // 先设置安全默认值，即使纹理缺失也不会崩溃
      c.sideIdle = 0;
      c.sideFlip = () => false;
      c.ok = false;

      // 检查纹理是否存在且有足够帧数
      if (!this.textures.exists(c.walk)) return;
      try {
        const texture = this.textures.get(c.walk);
        if (!texture || texture.frameTotal < 16) {
          console.warn(`角色 ${c.walk} 纹理帧数不足: ${texture ? texture.frameTotal : 0}，回退到默认`);
          return;
        }
      } catch (e) {
        console.warn(`角色 ${c.walk} 纹理检查失败:`, e);
        return;
      }

      c.ok = true;
      this._useCharSheet = true;
      // 侧面帧：both 用第3行(8-11,朝右)；其余用第2行(4-7)
      const sideFrames = c.sideFacing === 'both' ? [8, 9, 10, 11] : [4, 5, 6, 7];
      c.sideIdle = sideFrames[0];
      // sideNeedsFlip(dir): 该方向是否需要水平翻转
      c.sideFlip = (dir) => {
        if (dir === 'left') return c.sideFacing !== 'left';
        if (dir === 'right') return c.sideFacing === 'left';
        return false;
      };

      // 辅助：安全创建动画（已存在则跳过）
      const ensureAnim = (key, frames, frameRate, repeat) => {
        if (this.anims.exists(key)) return;
        try { this.anims.create({ key, frames, frameRate, repeat }); } catch (e) { console.warn('[Anim] 创建失败:', key, e); }
      };

      // 动画创建全过程包 try-catch，任一失败则回退到程序化纹理
      try {
        ensureAnim(`w${i}-down`, this.anims.generateFrameNumbers(c.walk, { frames: [0, 1, 2, 3] }), 8, -1);
        ensureAnim(`w${i}-side`, this.anims.generateFrameNumbers(c.walk, { frames: sideFrames }), 8, -1);
        ensureAnim(`w${i}-up`, this.anims.generateFrameNumbers(c.walk, { frames: [12, 13, 14, 15] }), 8, -1);

        if (this.textures.exists(c.bomb)) {
          const bt = this.textures.get(c.bomb);
          if (bt && bt.frameTotal >= 4) {
            ensureAnim(`w${i}-bomb`, this.anims.generateFrameNumbers(c.bomb, { frames: [0, 1, 2, 3] }), 10, 0);
          }
        }
        if (this.textures.exists(c.die)) {
          const dt = this.textures.get(c.die);
          if (dt && dt.frameTotal >= 4) {
            ensureAnim(`w${i}-die`, this.anims.generateFrameNumbers(c.die, { frames: [0, 1, 2, 3] }), 6, 0);
          }
        }
      } catch (e) {
        console.warn(`[Char] 角色 ${c.walk} 动画创建异常，回退程序化纹理:`, e);
        c.ok = false;
        // 清理已部分创建的动画
        ['-down','-side','-up','-bomb','-die'].forEach(suffix => { try { this.anims.remove(`w${i}${suffix}`); } catch (_) {} });
      }
    });
  }
  // AI 图标加载失败时用程序化纹理兜底
  ensureItemTextures() {
    const items = {
      'bomb': 0xff4444, 'power': 0xff6600, 'speed': 0x4488ff,
      'kick': 0x44cc44, 'ghost': 0xaa44ff
    };
    for (const [key, color] of Object.entries(items)) {
      if (this.textures.exists('item_' + key)) continue;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x1a1a2e);
      g.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.35);
      g.fillStyle(color);
      g.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.25);
      g.generateTexture('item_' + key, TILE_SIZE, TILE_SIZE);
    }
  }

  generatePlayerTextures(color, key) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const hex = parseInt(color.replace('#', ''), 16);
    g.fillStyle(hex);
    g.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.35);
    g.fillStyle(0xffffff);
    g.fillCircle(TILE_SIZE / 2 - 6, TILE_SIZE / 2 - 4, 4);
    g.fillCircle(TILE_SIZE / 2 + 6, TILE_SIZE / 2 - 4, 4);
    g.fillStyle(0x000000);
    g.fillCircle(TILE_SIZE / 2 - 6, TILE_SIZE / 2 - 4, 2);
    g.fillCircle(TILE_SIZE / 2 + 6, TILE_SIZE / 2 - 4, 2);
    g.fillStyle(0xff9999);
    g.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2 + 6, 4);
    g.generateTexture(key, TILE_SIZE, TILE_SIZE);

    // 无敌闪烁版本
    const g2 = this.make.graphics({ x: 0, y: 0, add: false });
    g2.fillStyle(0xffffff);
    g2.fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.35);
    g2.generateTexture(key + '_inv', TILE_SIZE, TILE_SIZE);
  }

  create() {
    // 根据当前地图主题生成纹理
    const theme = gameState && gameState.mapName ? gameState.mapName : 'classic';
    this.createProceduralTextures(theme);
    this.ensureItemTextures();
    this.createCharAnimations();
    this._knownBombs = new Set();
    this.tileMap = [];
    this.bombSprites = {};
    this.itemSprites = {};
    this.playerSprites = {};
    this.fireSprites = [];
    this.mapContainer = this.add.container(0, 0);
    this.entityContainer = this.add.container(0, 0);
    this.effectContainer = this.add.container(0, 0);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      bomb: Phaser.Input.Keyboard.KeyCodes.SPACE,
      kick: Phaser.Input.Keyboard.KeyCodes.E
    });

    this.lastActionTick = 0;
    this.actionCooldown = 2; // 2个tick间隔

    if (gameState) {
      this.renderMap(gameState.map);
      this.updateState(gameState);
    }
  }

  renderMap(map) {
    this.mapContainer.removeAll(true);
    this.tileMap = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      this.tileMap[y] = [];
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = map[y][x];
        let key = 'ground';
        if (tile === 1) key = 'stone';
        else if (tile === 2) key = 'brick';

        const sprite = this.add.sprite(x * TILE_SIZE, y * TILE_SIZE, key);
        sprite.setOrigin(0, 0);
        this.tileMap[y][x] = sprite;
        this.mapContainer.add(sprite);
      }
    }
  }

  updateState(state) {
    if (!state || !state.map) return;

    // 更新地图
    if (state.map && this.tileMap.length === 0) {
      this.renderMap(state.map);
    } else if (state.map) {
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const tile = state.map[y][x];
          const sprite = this.tileMap[y][x];
          if (!sprite) continue;
          if (tile === 0 && sprite.texture.key !== 'ground') {
            sprite.setTexture('ground');
          } else if (tile === 2 && sprite.texture.key !== 'brick') {
            sprite.setTexture('brick');
          }
        }
      }
    }

    // 更新炸弹
    this.updateBombs(state.bombs);

    // 更新道具
    this.updateItems(state.items);

    // 更新爆炸
    this.updateExplosions(state.explosions);

    // 更新玩家
    this.updatePlayers(state.players, state.bots);
  }

  updateBombs(bombs) {
    const current = new Set(bombs.map(b => `${b.x},${b.y}`));
    const existing = new Set(Object.keys(this.bombSprites));

    // 移除已消失的炸弹
    for (const key of existing) {
      if (!current.has(key)) {
        this.bombSprites[key].destroy();
        delete this.bombSprites[key];
        // 同步清理 _knownBombs，防止内存泄漏
        if (this._knownBombs) {
          for (const kb of this._knownBombs) {
            if (kb.startsWith(key)) { this._knownBombs.delete(kb); break; }
          }
        }
      }
    }

    // 添加新炸弹
    for (const bomb of bombs) {
      const key = `${bomb.x},${bomb.y}`;
      // 检测到某玩家新放的炸弹 → 播放放置动画
      if (this._useCharSheet && this._knownBombs && !this._knownBombs.has(key + bomb.owner)) {
        this._knownBombs.add(key + bomb.owner);
        const ownerSprite = this.playerSprites[bomb.owner];
        if (ownerSprite && !ownerSprite._dying && ownerSprite._char !== undefined && this.anims.exists(`w${ownerSprite._char}-bomb`)) {
          ownerSprite._placing = true;
          ownerSprite.play(`w${ownerSprite._char}-bomb`);
          ownerSprite.once('animationcomplete', () => { ownerSprite._placing = false; });
          this.time.delayedCall(600, () => { ownerSprite._placing = false; });
        }
      }
      if (!this.bombSprites[key]) {
        const sprite = this.add.sprite(bomb.x * TILE_SIZE, bomb.y * TILE_SIZE, 'bomb');
        sprite.setOrigin(0, 0);
        this.effectContainer.add(sprite);
        this.bombSprites[key] = sprite;

        // 炸弹动画（缩放跳动）
        this.tweens.add({
          targets: sprite,
          scaleX: 1.1,
          scaleY: 1.1,
          duration: 300,
          yoyo: true,
          repeat: -1
        });
      }
      // 更新位置（如果有被踢飞）
      this.bombSprites[key].setPosition(bomb.x * TILE_SIZE, bomb.y * TILE_SIZE);
    }
  }

  updateItems(items) {
    const current = new Set(items.map(i => `${i.x},${i.y},${i.type}`));
    const existing = new Set(Object.keys(this.itemSprites));

    for (const key of existing) {
      if (!current.has(key)) {
        this.itemSprites[key].destroy();
        delete this.itemSprites[key];
      }
    }

    for (const item of items) {
      const key = `${item.x},${item.y},${item.type}`;
      if (!this.itemSprites[key]) {
        const sprite = this.add.sprite(
          item.x * TILE_SIZE + TILE_SIZE / 2,
          item.y * TILE_SIZE + TILE_SIZE / 2,
          'item_' + item.type
        );
        sprite.setOrigin(0.5, 0.5);
        sprite.setAlpha(0.95);
        // 统一缩放到格子 60% 大小（保持宽高比）
        sprite.setScale(0.5);
        this.effectContainer.add(sprite);
        this.itemSprites[key] = sprite;

        // 道具动画：呼吸缩放，不越界
        this.tweens.add({
          targets: sprite,
          scaleX: 0.55,
          scaleY: 0.55,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    }
  }

  updateExplosions(explosions) {
    // 清除旧爆炸
    for (const sprite of this.fireSprites) {
      sprite.destroy();
    }
    this.fireSprites = [];

    for (const exp of explosions) {
      const sprite = this.add.sprite(exp.x * TILE_SIZE, exp.y * TILE_SIZE, 'fire');
      sprite.setOrigin(0, 0);
      sprite.setAlpha(0.7);
      this.effectContainer.add(sprite);
      this.fireSprites.push(sprite);

      // 闪烁动画
      this.tweens.add({
        targets: sprite,
        alpha: 0.4,
        duration: 200,
        yoyo: true,
        repeat: 2
      });
    }
  }

  updatePlayers(players, bots) {
    const all = { ...players, ...bots };
    const currentIds = new Set(Object.keys(all));
    const existingIds = new Set(Object.keys(this.playerSprites));

    const destroyPlayerSprite = (id) => {
      const s = this.playerSprites[id];
      if (s) {
        if (s.nameText) s.nameText.destroy();
        s.destroy();
        delete this.playerSprites[id];
      }
    };

    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        destroyPlayerSprite(id);
      }
    }

    const colorMap = ['player_0', 'player_1', 'player_2', 'player_3'];

    for (const [id, p] of Object.entries(all)) {
      try {
      if (p.dead) {
        const sp = this.playerSprites[id];
        if (sp && !sp._dying && this._useCharSheet && sp._char !== undefined && this.anims.exists(`w${sp._char}-die`)) {
          // 播放被炸动画，结束后再销毁
          sp._dying = true;
          this.tweens.killTweensOf(sp);
          sp.setAlpha(1);
          sp.clearTint();
          sp.play(`w${sp._char !== undefined ? sp._char : 0}-die`);
          if (sp.nameText) sp.nameText.setAlpha(0.3);
          sp.once('animationcomplete', () => destroyPlayerSprite(id));
          // 兜底：1.5秒后强制销毁
          this.time.delayedCall(1500, () => { if (this.playerSprites[id] === sp) destroyPlayerSprite(id); });
        } else if (sp && !sp._dying) {
          destroyPlayerSprite(id);
        }
        continue;
      }

      let sprite = this.playerSprites[id];
      if (!sprite) {
        // 按玩家序号分配角色（0团子 1企鹅 2恐龙 3小鸡）
        // Bot 按 bot序号轮换，避免全白团子
        const pidx = parseInt(id.replace(/[a-z]/g, '')) - 1;
        let ci = p.isBot ? ((pidx % 3) + 1) : (pidx % 4);
        if (this._useCharSheet && this._chars[ci] && !this._chars[ci].ok) ci = -1;
        if (this._useCharSheet && ci >= 0) {
          sprite = this.add.sprite(p.x * TILE_SIZE, p.y * TILE_SIZE, this._chars[ci].walk, 0);
          sprite.setScale(TILE_SIZE / 256);
          sprite._char = ci;
          // Bot 不 tint 精灵图（会染坏半透明描边），改用程序化纹理时再 tint
        } else {
          let key = 'player_bot';
          if (!p.isBot) {
            const idx = parseInt(id.replace(/[a-z]/g, '')) - 1;
            key = colorMap[idx] || 'player_0';
          }
          sprite = this.add.sprite(p.x * TILE_SIZE, p.y * TILE_SIZE, key);
        }
        sprite.setOrigin(0, 0);
        sprite._dir = p.direction || 'down';
        sprite._moving = false;
        this.entityContainer.add(sprite);
        this.playerSprites[id] = sprite;
      }

      // 平滑移动（补间动画，避免格子间瞬移）
      const targetX = p.x * TILE_SIZE;
      const targetY = p.y * TILE_SIZE;
      if (sprite.x !== targetX || sprite.y !== targetY) {
        this.tweens.add({
          targets: sprite,
          x: targetX,
          y: targetY,
          duration: 90,
          ease: 'Linear',
          overwrite: true
        });
        if (sprite.nameText) {
          this.tweens.add({
            targets: sprite.nameText,
            x: targetX + TILE_SIZE / 2,
            y: targetY - 8,
            duration: 90,
            ease: 'Linear',
            overwrite: true
          });
        }
      }

      // 行走动画：移动中播走步，静止时定格该方向首帧；按角色素材朝向自动翻转
      if (this._useCharSheet && sprite._char !== undefined && !sprite._dying) {
        const C = this._chars[sprite._char];
        if (C && C.ok) {
          try {
            const dir = p.direction || sprite._dir || 'down';
            const moving = sprite.x !== targetX || sprite.y !== targetY;
            sprite._dir = dir;
            if (!sprite._placing) {
              const isSide = dir === 'left' || dir === 'right';
              const animKey = dir === 'up' ? `w${sprite._char}-up` : (dir === 'down' ? `w${sprite._char}-down` : `w${sprite._char}-side`);
              if (moving) {
                if (isSide) sprite.setFlipX(C.sideFlip(dir));
                if (this.anims.exists(animKey) && (!sprite.anims.currentAnim || sprite.anims.currentAnim.key !== animKey)) {
                  sprite.play(animKey);
                }
              } else {
                sprite.anims.stop();
                // 炸弹/死亡动画后纹理可能已切换，重置回行走纹理再设帧
                if (sprite.texture.key !== C.walk) {
                  sprite.setTexture(C.walk);
                }
                if (isSide) sprite.setFlipX(C.sideFlip(dir));
                const frameIdx = dir === 'up' ? 12 : (dir === 'down' ? 0 : (C.sideIdle !== undefined ? C.sideIdle : 0));
                sprite.setFrame(frameIdx);
              }
            }
          } catch (e) {
            console.warn(`[Walk] 角色动画异常 (${sprite._char}):`, e);
          }
        }
      }
      // 无敌闪烁（放炸弹动画期间保持不透明）
      if (sprite._placing) {
        sprite.setAlpha(1);
      } else if (p.invincible > 0) {
        sprite.setAlpha(0.5 + Math.sin(Date.now() / 100) * 0.3);
      } else {
        sprite.setAlpha(1);
      }

      // 显示玩家名字（Sprite 没有 add()，名字文本挂到 entityContainer 并跟随位置）
      if (!sprite.nameText) {
        sprite.nameText = this.add.text(targetX + TILE_SIZE / 2, targetY - 8, p.name, {
          fontSize: '10px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 2
        }).setOrigin(0.5, 1);
        this.entityContainer.add(sprite.nameText);
      }
      } catch (e) {
        console.warn('[Player] 渲染异常:', id, e);
      }
    }
  }

  update() {
    // 观战模式：只渲染，不接受输入
    if (isSpectating) return;

    if (!gameState || gameState.phase !== 'playing') {
      if (!_inputLoggedPhase && gameState) { _inputLoggedPhase = true; console.log('[Input] phase:', gameState.phase); }
      return;
    }
    if (!myPlayerId) {
      if (!_inputLoggedId) { _inputLoggedId = true; console.warn('[Input] myPlayerId is null'); }
      return;
    }

    const now = this.time.now;
    const dirKeys = [
      ['up', this.wasd.up, this.cursors.up],
      ['down', this.wasd.down, this.cursors.down],
      ['left', this.wasd.left, this.cursors.left],
      ['right', this.wasd.right, this.cursors.right]
    ];

    // 移动：短按走一格，长按持续走（降低延迟阈值提升流畅度）
    let heldDir = null;
    for (const [name, k1, k2] of dirKeys) {
      if (k1.isDown || k2.isDown) { heldDir = name; break; }
    }
    if (heldDir !== this._heldDir) {
      this._heldDir = heldDir;
      if (heldDir) this._facingDir = heldDir; // 记录最后一次面向方向
      this._holdStart = now;
      this._nextMoveAt = 0;
    }
    if (heldDir) {
      const elapsed = now - this._holdStart;
      const isNewPress = elapsed < 80;
      if ((isNewPress || elapsed >= 150) && now >= this._nextMoveAt) {
        send({ type: 'action', move: heldDir });
        this._nextMoveAt = now + 100; // 长按连走间隔（更流畅）
      }
    }

    // 放炸弹：按一下放一颗，最多连放数量由服务端 maxBombs 控制
    if (Phaser.Input.Keyboard.JustDown(this.wasd.bomb)) {
      send({ type: 'action', placeBomb: true });
    }

    // 踢炸弹：使用服务端权威方向（更可靠）
    if (Phaser.Input.Keyboard.JustDown(this.wasd.kick)) {
      const me = gameState && gameState.players ? gameState.players[myPlayerId] : null;
      const kickDir = me ? me.direction : (this._facingDir || 'down');
      send({ type: 'action', kick: kickDir });
    }
  }
}

// ============ 游戏启动 ============
let gameStarting = false;
function startGame(state) {
  if (gameStarting) return; // 防重复启动
  gameStarting = true;

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game-container').classList.add('active');
  document.getElementById('result-overlay').classList.remove('active');
  document.getElementById('battle-log').innerHTML = '';
  document.getElementById('controls-hint').style.display = 'block';
  // 清理等待覆盖层
  const wo = document.getElementById('waiting-overlay');
  if (wo) wo.style.display = 'none';

  // 安全销毁旧游戏
  if (game) {
    try { game.destroy(true); } catch (e) { console.warn('[Start] destroy old game failed:', e); }
    game = null;
    gameScene = null;
  }

  // 重置诊断标志
  send._warned = false;
  _inputLoggedPhase = false;
  _inputLoggedId = false;
  isSpectating = false;
  // 恢复操作提示
  document.getElementById('controls-hint').innerHTML = '<kbd>WASD</kbd> 移动 &nbsp; <kbd>空格</kbd> 放炸弹 &nbsp; <kbd>E</kbd> 踢炸弹';

  // 根据地图主题设置背景色
  const theme = state && state.mapName ? (MAP_THEMES[state.mapName] || MAP_THEMES.classic) : MAP_THEMES.classic;

  // 延迟创建 Phaser Game，确保 DOM 布局完成，避免黑屏
  setTimeout(() => {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent: 'phaser-game',
      backgroundColor: theme.bg,
      scene: [GameScene],
      pixelArt: true,
      physics: { default: false },
      input: {
        keyboard: { target: window },
        mouse: { target: null, preventDefaultWheel: true }
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    });
    // 等待场景创建完成
    setTimeout(() => {
      gameScene = game.scene.getScene('GameScene');
    }, 500);
  }, 100);
}

let isSpectating = false;

function startSpectatorView(state) {
  gameStarting = false;
  isSpectating = true;

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game-container').classList.add('active');
  document.getElementById('result-overlay').classList.remove('active');
  document.getElementById('battle-log').innerHTML = '';
  // 观战提示替代操作提示
  const hint = document.getElementById('controls-hint');
  hint.style.display = 'block';
  hint.innerHTML = '👁️ <b>观战中</b> — 上帝视角观看对局';
  const wo = document.getElementById('waiting-overlay');
  if (wo) wo.style.display = 'none';

  if (game) {
    try { game.destroy(true); } catch (e) {}
    game = null; gameScene = null;
  }

  send._warned = false;
  _inputLoggedPhase = false;
  _inputLoggedId = false;

  const theme = state && state.mapName ? (MAP_THEMES[state.mapName] || MAP_THEMES.classic) : MAP_THEMES.classic;

  setTimeout(() => {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      parent: 'phaser-game',
      backgroundColor: theme.bg,
      scene: [GameScene],
      pixelArt: true,
      physics: { default: false },
      input: {
        keyboard: { target: window },
        mouse: { target: null, preventDefaultWheel: true }
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    });
    setTimeout(() => {
      gameScene = game.scene.getScene('GameScene');
    }, 500);
  }, 100);
}

// ============ 事件绑定 ============
// 安全绑定：元素缺失时警告而不是让整个脚本崩溃
function $on(id, handler) {
  const el = document.getElementById(id);
  if (!el) { console.warn('[UI] 缺少元素 #' + id + '，已跳过绑定'); return; }
  el.addEventListener('click', handler);
}
$on('btn-create', () => {
  const name = document.getElementById('player-name').value || '玩家';
  const mode = document.getElementById('game-mode').value;
  const mapName = document.getElementById('map-select').value;
  send({ type: 'createRoom', mode, mapName, playerName: name });
});

$on('btn-join-tab', () => {
  document.getElementById('create-section').classList.add('hidden');
  document.getElementById('join-section').classList.remove('hidden');
});

$on('btn-back-create', () => {
  document.getElementById('create-section').classList.remove('hidden');
  document.getElementById('join-section').classList.add('hidden');
});

$on('btn-join', () => {
  const name = document.getElementById('player-name').value || '玩家';
  const roomId = document.getElementById('join-room-id').value.toUpperCase();
  if (!roomId || roomId.length !== 4) {
    alert('请输入4位房间号');
    return;
  }
  send({ type: 'joinRoom', roomId, playerName: name });
});

$on('btn-list', () => {
  send({ type: 'listRooms' });
});

$on('btn-back-menu', () => {
  document.getElementById('create-section').classList.remove('hidden');
  document.getElementById('room-list-section').classList.add('hidden');
});

$on('lobby-room-id', () => {
  const id = document.getElementById('lobby-room-id').textContent;
  copyToClipboard(id).then(() => {
    alert('房间号已复制: ' + id);
  }).catch(() => {
    alert('复制失败，请手动复制: ' + id);
  });
});

// 构建 Agent 接入说明文本
function buildAgentHelpText() {
  const wsUrl = WS_URL;
  return `【AI Agent 接入泡泡堂房间 ${roomId || ''}】

1. 用 WebSocket 连接: ${wsUrl}
2. 发送加入消息（JSON）:
   {"type":"joinAsAgent","roomId":"${roomId || 'XXXX'}","name":"你的Agent名字"}
3. 成功后收到 {"type":"joined","playerId":"pN","state":{...}}，
   之后服务端约每 100ms 广播一次 {"type":"state","state":{...}} 完整游戏状态。
4. 发送动作（建议每秒不超过 10 次）:
   移动:   {"type":"action","move":"up"|"down"|"left"|"right"}
   放炸弹: {"type":"action","placeBomb":true}
   踢炸弹: {"type":"action","kick":"up"|"down"|"left"|"right"}（需先拾取踢炸弹道具）
   可合并: {"type":"action","move":"left","placeBomb":true}
5. 状态说明:
   - state.map 是 11 行 x 13 列数组: 0=空地 1=石头(不可破坏) 2=砖块(可破坏)
   - players / bots 里的 x,y 就是格子坐标（0-12 列, 0-10 行）
   - bombs 里的 x,y 是格子坐标，timer 是剩余秒数，power 是爆炸范围
   - 爆炸为十字形，会被石头挡住；被炸到 -1 命，lives 归零出局
6. 游戏结束收到 {"type":"gameEnded",...}，房间解散或断线需重新执行第 1-2 步。`;
}

$on('btn-copy-player-link', () => {
  const link = `${window.location.origin}/?room=${roomId || ''}`;
  copyToClipboard(link).then(() => {
    alert('玩家邀请链接已复制:\n' + link + '\n\n发给朋友，对方打开即自动加入房间');
  }).catch(() => {
    alert('复制失败，请手动复制以下链接:\n' + link);
  });
});

$on('btn-copy-agent-link', () => {
  const help = document.getElementById('agent-help');
  const text = buildAgentHelpText();
  document.getElementById('agent-help-text').textContent = text;
  help.classList.toggle('hidden');
  copyToClipboard(text).catch(() => {});
});

$on('btn-ready', () => {
  isReady = !isReady;
  const btn = document.getElementById('btn-ready');
  btn.textContent = isReady ? '取消准备' : '准备';
  btn.className = isReady ? 'btn btn-green' : 'btn btn-secondary';
  send({ type: 'setReady', ready: isReady });
});

$on('btn-start', () => {
  send({ type: 'startGame' });
});

$on('btn-leave', () => {
  showMenu();
  if (ws) ws.close();
  connect();
});

$on('btn-add-bot', () => {
  const diff = document.getElementById('bot-difficulty').value;
  send({ type: 'addBot', difficulty: diff });
});

$on('btn-remove-bot', () => {
  send({ type: 'removeBot' });
});

$on('btn-again', () => {
  send({ type: 'startGame' });
  document.getElementById('result-overlay').classList.remove('active');
});

$on('btn-lobby', () => {
  showMenu();
  if (ws) ws.close();
  connect();
});

// 音乐控制按钮
$on('music-toggle', () => {
  toggleBGM();
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 设置默认名字格式：三个随机汉字 + '-' + 域名
  const defaultName = getDefaultPlayerName();
  document.getElementById('player-name').value = defaultName;
  connect();

  // 默认自动播放背景音乐
  initBGM();
  const musicBtn = document.getElementById('music-toggle');
  if (musicBtn) {
    musicBtn.textContent = '🔊';
    musicBtn.classList.remove('muted');
    musicBtn.title = '点击暂停背景音乐';
  }

  const tryAutoPlay = () => {
    if (!bgmAudio || bgmPlaying) return;
    bgmAudio.play().then(() => {
      bgmPlaying = true;
    }).catch(() => {
      bgmPlaying = false;
      if (musicBtn) {
        musicBtn.textContent = '🔇';
        musicBtn.classList.add('muted');
        musicBtn.title = '点击播放背景音乐';
      }
    });
  };

  if (bgmAudio.readyState >= 3) {
    tryAutoPlay();
  } else {
    bgmAudio.addEventListener('canplaythrough', tryAutoPlay, { once: true });
    setTimeout(tryAutoPlay, 1500);
  }

  // 用户交互后播放（浏览器阻止自动播放时的 fallback）
  const tryPlayOnInteraction = () => {
    if (bgmPlaying || !bgmAudio) return;
    bgmAudio.play().then(() => {
      bgmPlaying = true;
      if (musicBtn) {
        musicBtn.textContent = '🔊';
        musicBtn.classList.remove('muted');
        musicBtn.title = '点击暂停背景音乐';
      }
    }).catch(() => {});
    document.removeEventListener('click', tryPlayOnInteraction);
    document.removeEventListener('keydown', tryPlayOnInteraction);
  };
  document.addEventListener('click', tryPlayOnInteraction);
  document.addEventListener('keydown', tryPlayOnInteraction);
});

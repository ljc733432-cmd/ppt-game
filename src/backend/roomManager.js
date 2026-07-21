/**
 * 房间管理系统
 * 管理所有游戏房间的创建、加入、离开和销毁
 */

const { GameLoop } = require('./gameLoop');
const { generateMap, MAP_PRESETS } = require('./mapGenerator');

const rooms = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
}

class Room {
  constructor(mode, mapName) {
    this.id = generateRoomId();
    this.mode = mode || 'ffa'; // '1v1', 'ffa', '2v2', 'pve'
    this.mapName = mapName || 'classic';
    this.phase = 'waiting'; // waiting | playing | ended
    this.map = null;
    this.players = new Map();
    this.nextPlayerNum = 1; // 单调递增，避免玩家退出后 ID 复用撞车
    this.bots = new Map();
    this.spectators = [];
    this.bombs = [];
    this.items = [];
    this.explosions = [];
    this.battleLog = []; // 战斗日志
    this.startTime = null;
    this.endTime = null;
    this.gameLoop = null;
    this.maxPlayers = this.getMaxPlayers();
    this.tick = 0;
    this.hostId = null; // 房主ID
    this.winner = null;
    this.winnerTeam = null;
    this.gameDuration = 180; // 3分钟
    this.timeLeft = this.gameDuration;
    this.playerColors = ['#FF4444', '#4488FF', '#44FF44', '#FFAA00'];
    this.spawnPoints = [
      { x: 1, y: 1 },
      { x: 11, y: 9 },
      { x: 11, y: 1 },
      { x: 1, y: 9 }
    ];
    this.waitingQueue = []; // 等待下一局的玩家
  }

  getMaxPlayers() {
    switch (this.mode) {
      case '1v1': return 2;
      case '2v2': return 4;
      case 'ffa': return 4;
      case 'pve': return 1; // 1人 + 3 Bot
      default: return 4;
    }
  }

  addPlayer(name, ws, isAgent = false) {
    // 游戏进行中 → 尝试夺舍活着的 Bot
    if (this.phase === 'playing') {
      const target = this.findPossessableBot();
      if (target) return this.possessBot(target, name, ws, isAgent);
      // 没有活 Bot 可夺舍 → 加入等待队列
      this.waitingQueue.push({ name, ws, isAgent });
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'waitingForNextRound', roomId: this.id }));
      }
      this.broadcast({ type: 'playerList', players: this.getPlayerList() });
      return { waiting: true };
    }

    return this._addPlayerInternal(name, ws, isAgent);
  }

  // 内部：创建玩家实体（不检查夺舍）
  _addPlayerInternal(name, ws, isAgent) {
    const playerId = `p${this.nextPlayerNum++}`;
    const spawnIndex = this.players.size % this.spawnPoints.length;
    const spawn = this.spawnPoints[spawnIndex];

    this.players.set(playerId, {
      id: playerId,
      name: name || `玩家${this.players.size + 1}`,
      ws: ws,
      isAgent: isAgent,
      x: spawn.x,
      y: spawn.y,
      bombs: 3,
      maxBombs: 3,
      power: 1,
      speed: 1,
      lives: 2,
      invincible: 0,
      ready: false,
      kills: 0,
      itemsPicked: 0,
      color: this.playerColors[this.players.size % this.playerColors.length],
      direction: 'down',
      dead: false,
      canKick: false,
      ghostMode: false,
      team: this.getTeam(playerId),
      lastMoveTick: 0,
      moveCooldown: 0
    });

    if (!this.hostId) this.hostId = playerId;

    this.broadcast({ type: 'playerList', players: this.getPlayerList() });
    return { playerId };
  }

  // 找一个活着的 Bot（未被淘汰且有命数）
  findPossessableBot() {
    for (const [botId, bot] of this.bots) {
      if (!bot.dead && bot.lives > 0) return { botId, bot };
    }
    return null;
  }

  // 夺舍：接管 Bot 的所有状态
  possessBot({ botId, bot }, name, ws, isAgent) {
    const playerId = botId; // 复用 Bot ID
    const player = {
      id: playerId,
      name: name || `玩家${this.players.size + 1}`,
      ws: ws,
      isAgent: isAgent,
      x: bot.x, y: bot.y,
      bombs: bot.bombs,
      maxBombs: bot.maxBombs,
      power: bot.power,
      speed: bot.speed,
      lives: bot.lives,
      invincible: 1, // 夺舍后 1 秒短暂无敌
      ready: true,
      kills: bot.kills,
      itemsPicked: bot.itemsPicked,
      color: bot.color,
      direction: bot.direction,
      dead: false,
      canKick: bot.canKick,
      ghostMode: bot.ghostMode,
      team: this.getTeam(playerId),
      lastMoveTick: 0,
      moveCooldown: 0
    };

    const oldBotName = bot.name;
    this.players.set(playerId, player);
    this.bots.delete(botId);

    this.addBattleLog(`👻 ${name} 夺舍了 ${oldBotName}！`);
    this.broadcast({ type: 'playerList', players: this.getPlayerList() });

    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'possessed', playerId, state: this.getState() }));
    }
    return { playerId, possessed: true };
  }

  getTeam(playerId) {
    if (this.mode === '2v2') {
      const num = parseInt(playerId.replace('p', ''));
      return num <= 2 ? 'red' : 'blue';
    }
    return null;
  }

  addBot(difficulty = 'medium') {
    const botId = `bot${this.nextPlayerNum++}`; // 与玩家共用计数器，防止 ID 撞车
    const spawnIndex = (this.players.size + this.bots.size) % this.spawnPoints.length;
    const spawn = this.spawnPoints[spawnIndex];

    this.bots.set(botId, {
      id: botId,
      name: `Bot-${difficulty}`,
      isBot: true,
      difficulty: difficulty,
      x: spawn.x,
      y: spawn.y,
      bombs: 3,
      maxBombs: 3, // 初始可连放3颗
      power: 1,
      speed: 1,
      lives: 2,
      invincible: 0,
      ready: true,
      kills: 0,
      itemsPicked: 0,
      color: '#888888',
      direction: 'down',
      dead: false,
      canKick: false,
      ghostMode: false,
      team: this.getTeam(botId),
      aiTimer: 0,
      lastMoveTick: 0,
      moveCooldown: 0
    });

    this.broadcast({ type: 'playerList', players: this.getPlayerList() });
    return botId;
  }

  removeBot(botId) {
    this.bots.delete(botId);
    this.broadcast({ type: 'playerList', players: this.getPlayerList() });
  }

  addSpectator(ws) {
    this.spectators.push(ws);
    ws.send(JSON.stringify({ type: 'spectating', roomId: this.id, state: this.getState() }));
  }

  removePlayer(playerId, closeWs = true) {
    if (this.players.has(playerId)) {
      const player = this.players.get(playerId);
      if (closeWs && player.ws) {
        try { player.ws.close(); } catch (e) {}
      }
      this.players.delete(playerId);
    }
    // 房主离开，转移给下一个玩家
    if (this.hostId === playerId && this.players.size > 0) {
      this.hostId = this.players.keys().next().value;
    }
    this.broadcast({ type: 'playerList', players: this.getPlayerList() });

    if (this.phase === 'playing') {
      this.checkWinCondition();
    }
  }

  // 按名字移除真人/Agent 玩家（同名重连时踢掉旧身份）
  removePlayerByName(name) {
    if (!name) return;
    for (const [pid, p] of this.players.entries()) {
      if (p.name === name) {
        this.removePlayer(pid, true); // 关掉旧身份的连接
      }
    }
  }

  setReady(playerId, ready) {
    const player = this.players.get(playerId);
    if (player) {
      player.ready = ready;
      this.broadcast({ type: 'playerReady', playerId, ready });
    }
  }

  startGame(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    // 只有房主或所有玩家都准备好才能开始
    const allReady = Array.from(this.players.values()).every(p => p.ready) || playerId === this.hostId;
    if (!allReady && this.players.size > 1) {
      this.sendTo(playerId, { type: 'error', message: '等待其他玩家准备...' });
      return;
    }

    if (this.players.size + this.bots.size < 2 && this.mode !== 'pve') {
      this.sendTo(playerId, { type: 'error', message: '至少需要2名玩家' });
      return;
    }

    // PVE模式自动添加Bot
    if (this.mode === 'pve') {
      const botCount = 3 - this.bots.size;
      for (let i = 0; i < botCount; i++) {
        this.addBot('medium');
      }
    }

    this.phase = 'playing';
    this.map = generateMap(this.mapName);
    this.startTime = Date.now();
    this.timeLeft = this.gameDuration;
    this.battleLog = [];
    this.bombs = [];
    this.items = [];
    this.explosions = [];
    this.winner = null;
    this.winnerTeam = null;

    // 重置所有玩家位置
    let idx = 0;
    [...this.players.values(), ...this.bots.values()].forEach((p) => {
      if (idx < this.spawnPoints.length) {
        p.x = this.spawnPoints[idx].x;
        p.y = this.spawnPoints[idx].y;
      }
      p.dead = false;
      p.lives = 2;
      p.bombs = 3;
      p.maxBombs = 3; // 初始可连放3颗
      p.power = 1;
      p.speed = 1;
      p.invincible = 3; // 开局3秒无敌
      p.kills = 0;
      p.itemsPicked = 0;
      p.canKick = false;
      p.ghostMode = false;
      p.lastMoveTick = 0;
      p.moveCooldown = 0;
      // 清除之前的道具限时定时器
      if (p._speedTimers) {
        p._speedTimers.forEach(t => clearTimeout(t));
        p._speedTimers = [];
      }
      if (p._powerTimers) {
        p._powerTimers.forEach(t => clearTimeout(t));
        p._powerTimers = [];
      }
      idx++;
    });

    // 从等待队列拉人加入本局（夺舍场景）
    while (this.waitingQueue.length > 0) {
      const maxForMode = { '1v1': 2, '2v2': 4, 'ffa': 4, 'pve': 4 }[this.mode] || 4;
      if (this.players.size >= maxForMode) break;
      const w = this.waitingQueue.shift();
      const result = this._addPlayerInternal(w.name, w.ws, w.isAgent);
      const newPlayer = this.players.get(result.playerId);
      if (newPlayer) {
        newPlayer.ready = true;
        newPlayer.invincible = 3;
        if (w.ws && w.ws.readyState === 1) {
          w.ws.send(JSON.stringify({ type: 'gameStarted', state: this.getState() }));
        }
      }
    }

    this.broadcast({ type: 'gameStarted', state: this.getState() });
    this.addBattleLog('游戏开始！祝各位好运！');

    // 启动游戏循环
    this.gameLoop = new GameLoop(this);
    this.gameLoop.start();
  }

  handleAction(playerId, action) {
    if (this.phase !== 'playing') return;
    this.gameLoop.handlePlayerAction(playerId, action);
  }

  getState() {
    return {
      roomId: this.id,
      mode: this.mode,
      phase: this.phase,
      map: this.map,
      mapName: this.mapName,
      players: Object.fromEntries([...this.players.entries()].map(([id, p]) => [id, this.serializePlayer(p)])),
      bots: Object.fromEntries([...this.bots.entries()].map(([id, p]) => [id, this.serializePlayer(p)])),
      bombs: this.bombs,
      items: this.items,
      explosions: this.explosions,
      timeLeft: this.timeLeft,
      tick: this.tick,
      battleLog: this.battleLog.slice(-20), // 只发最近的20条
      winner: this.winner,
      winnerTeam: this.winnerTeam,
      hostId: this.hostId
    };
  }

  serializePlayer(p) {
    return {
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      bombs: p.bombs,
      maxBombs: p.maxBombs,
      power: p.power,
      speed: p.speed,
      lives: p.lives,
      invincible: p.invincible,
      ready: p.ready,
      kills: p.kills,
      itemsPicked: p.itemsPicked,
      color: p.color,
      direction: p.direction,
      dead: p.dead,
      canKick: p.canKick,
      ghostMode: p.ghostMode,
      team: p.team,
      isBot: p.isBot || false,
      isAgent: p.isAgent || false
    };
  }

  getPlayerList() {
    return {
      players: Array.from(this.players.values()).map(p => this.serializePlayer(p)),
      bots: Array.from(this.bots.values()).map(b => this.serializePlayer(b))
    };
  }

  addBattleLog(text) {
    this.battleLog.push({
      time: Date.now(),
      text: text,
      tick: this.tick
    });
    // 限制日志数量
    if (this.battleLog.length > 100) {
      this.battleLog.shift();
    }
    this.broadcast({ type: 'battleLog', text, tick: this.tick });
  }

  broadcast(msg, excludeWs = null) {
    const data = JSON.stringify(msg);
    [...this.players.values()].forEach(p => {
      if (p.ws && p.ws !== excludeWs && p.ws.readyState === 1) {
        try { p.ws.send(data); } catch (e) {}
      }
    });
    this.spectators.forEach(ws => {
      if (ws && ws !== excludeWs && ws.readyState === 1) {
        try { ws.send(data); } catch (e) {}
      }
    });
  }

  sendTo(playerId, msg) {
    const player = this.players.get(playerId);
    if (player && player.ws && player.ws.readyState === 1) {
      try { player.ws.send(JSON.stringify(msg)); } catch (e) {}
    }
  }

  checkWinCondition() {
    if (this.phase !== 'playing') return;

    const alivePlayers = [...this.players.values(), ...this.bots.values()].filter(p => !p.dead);

    if (this.mode === '1v1' || this.mode === 'ffa' || this.mode === 'pve') {
      if (alivePlayers.length <= 1) {
        this.endGame(alivePlayers[0] || null);
      }
    } else if (this.mode === '2v2') {
      const redAlive = alivePlayers.filter(p => p.team === 'red').length;
      const blueAlive = alivePlayers.filter(p => p.team === 'blue').length;
      if (redAlive === 0) {
        this.endGame(null, 'blue');
      } else if (blueAlive === 0) {
        this.endGame(null, 'red');
      }
    }

    if (this.timeLeft <= 0) {
      this.endGameByTime();
    }
  }

  endGame(winner, winnerTeam = null) {
    this.phase = 'ended';
    this.endTime = Date.now();
    this.winner = winner ? winner.id : null;
    this.winnerTeam = winnerTeam;

    if (winner) {
      this.addBattleLog(`🎉 ${winner.name} 获得了胜利！`);
    } else if (winnerTeam) {
      this.addBattleLog(`🎉 ${winnerTeam === 'red' ? '红队' : '蓝队'} 获得了胜利！`);
    } else {
      this.addBattleLog('游戏结束！平局！');
    }

    if (this.gameLoop) {
      this.gameLoop.stop();
      this.gameLoop = null;
    }

    const allEntities = [...this.players.values(), ...this.bots.values()];
    const stats = {};
    allEntities.forEach(p => {
      stats[p.id] = {
        name: p.name,
        kills: p.kills,
        deaths: 2 - p.lives,
        itemsPicked: p.itemsPicked,
        survived: !p.dead
      };
    });

    this.broadcast({
      type: 'gameEnded',
      winner: this.winner,
      winnerTeam: this.winnerTeam,
      stats: stats,
      battleLog: this.battleLog
    });
  }

  endGameByTime() {
    const alivePlayers = [...this.players.values(), ...this.bots.values()].filter(p => !p.dead);
    if (this.mode === '2v2') {
      const redLives = alivePlayers.filter(p => p.team === 'red').reduce((s, p) => s + p.lives, 0);
      const blueLives = alivePlayers.filter(p => p.team === 'blue').reduce((s, p) => s + p.lives, 0);
      if (redLives > blueLives) {
        this.endGame(null, 'red');
      } else if (blueLives > redLives) {
        this.endGame(null, 'blue');
      } else {
        this.endGame(null);
      }
    } else {
      const maxLives = Math.max(...alivePlayers.map(p => p.lives));
      const survivors = alivePlayers.filter(p => p.lives === maxLives);
      if (survivors.length === 1) {
        this.endGame(survivors[0]);
      } else {
        this.endGame(null);
      }
    }
  }

  get playerCount() {
    return this.players.size;
  }
  get totalCount() {
    return this.players.size + this.bots.size;
  }
}

function createRoom(mode, mapName, playerName) {
  const room = new Room(mode, mapName);
  rooms.set(room.id, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function removeRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.gameLoop) {
    room.gameLoop.stop();
  }
  rooms.delete(roomId);
}

function listRooms() {
  return Array.from(rooms.values()).map(r => {
    const firstPlayer = r.players.values().next().value;
    return {
      id: r.id,
      mode: r.mode,
      mapName: r.mapName,
      phase: r.phase,
      playerCount: r.players.size,
      botCount: r.bots.size,
      maxPlayers: r.maxPlayers,
      hostName: firstPlayer ? firstPlayer.name : '未知'
    };
  });
}

module.exports = { Room, createRoom, getRoom, removeRoom, listRooms };

/**
 * 游戏核心循环
 * 固定tick（20次/秒），确定性计算
 * 管理：移动、炸弹、爆炸、道具、碰撞、胜负
 */

const { MAP_WIDTH, MAP_HEIGHT } = require('./mapGenerator');
const { getSimpleBotAction } = require('./botAI');

const TICK_RATE = 20; // 20 ticks per second
const TICK_INTERVAL = 1000 / TICK_RATE;
const BOMB_TIMER = 2.0; // 炸弹2秒爆炸（引信调短，节奏更快）
const ITEM_DROP_CHANCE = 0.4; // 40%掉落道具
const ITEM_TYPES = ['bomb', 'power', 'speed', 'kick', 'ghost'];
const ITEM_WEIGHTS = [0.3, 0.3, 0.25, 0.1, 0.05]; // 各道具权重

class GameLoop {
  constructor(room) {
    this.room = room;
    this.running = false;
    this.interval = null;
    this.currentTick = 0;
    this.pendingActions = new Map(); // 玩家待处理动作
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => this.tick(), TICK_INTERVAL);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  tick() {
    this.currentTick++;
    this.room.tick = this.currentTick;

    // 1. 处理所有待处理动作
    this.processActions();

    // 2. 更新炸弹倒计时
    this.updateBombs();

    // 3. 更新无敌时间
    this.updateInvincibility();

    // 4. 处理Bot AI
    this.processBotAI();

    // 5. 更新局内倒计时
    if (this.currentTick % TICK_RATE === 0) {
      this.room.timeLeft--;
    }

    // 6. 检查胜负条件
    this.room.checkWinCondition();

    // 7. 广播状态
    if (this.currentTick % 2 === 0) { // 每2个tick广播一次（10次/秒）
      this.room.broadcast({ type: 'state', state: this.room.getState() });
    }
  }

  processActions() {
    for (const [playerId, action] of this.pendingActions.entries()) {
      this.executeAction(playerId, action);
    }
    this.pendingActions.clear();
  }

  executeAction(playerId, action) {
    const allEntities = new Map([...this.room.players, ...this.room.bots]);
    const entity = allEntities.get(playerId);
    if (!entity || entity.dead) return;

    // 移动
    if (action.move) {
      this.moveEntity(entity, action.move);
    }

    // 放炸弹
    if (action.placeBomb) {
      this.placeBomb(entity);
    }

    // 踢炸弹
    if (action.kick) {
      this.kickBomb(entity, action.kick);
    }
  }

  moveEntity(entity, direction) {
    let dx = 0, dy = 0;

    switch (direction) {
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
    }

    entity.direction = direction;

    // 根据speed决定一次走几格：speed1-2走1格，speed3-4走2格，speed5走3格
    const step = Math.max(1, Math.floor((entity.speed + 1) / 2));

    for (let s = 0; s < step; s++) {
      const newX = entity.x + dx;
      const newY = entity.y + dy;

      // 边界检查
      if (newX < 0 || newX >= MAP_WIDTH || newY < 0 || newY >= MAP_HEIGHT) break;

      // 碰撞检测
      const tile = this.room.map[newY][newX];
      if (tile === 1) break; // 石头不可通过

      if (tile === 2 && !entity.ghostMode) break; // 砖块不可通过（穿墙模式除外）

      // 检查是否有炸弹
      const bombAtPos = this.room.bombs.find(b => b.x === newX && b.y === newY);
      if (bombAtPos && !entity.ghostMode) break; // 炸弹不可通过（穿墙模式除外）

      // 检查其他玩家
      const allEntities = [...this.room.players.values(), ...this.room.bots.values()];
      let blockedByPlayer = false;
      for (const other of allEntities) {
        if (other.id !== entity.id && !other.dead && other.x === newX && other.y === newY) {
          blockedByPlayer = true;
          break;
        }
      }
      if (blockedByPlayer) break;

      entity.x = newX;
      entity.y = newY;

      // 检查是否拾取道具
      this.checkItemPickup(entity);
    }
  }

  placeBomb(entity) {
    if (entity.bombs <= 0) return; // 没有炸弹了

    // 检查当前位置是否已有炸弹
    const existing = this.room.bombs.find(b => b.x === entity.x && b.y === entity.y);
    if (existing) return;

    // 检查当前位置是否为空地或砖块（不可在石头上放炸弹）
    const tile = this.room.map[entity.y][entity.x];
    if (tile === 1) return;

    entity.bombs--;

    this.room.bombs.push({
      x: entity.x,
      y: entity.y,
      owner: entity.id,
      timer: BOMB_TIMER,
      power: entity.power
    });

    this.room.addBattleLog(`${entity.name} 放置了一颗炸弹！`);
  }

  kickBomb(entity, direction) {
    if (!entity.canKick) {
      this.room.addBattleLog(`${entity.name} 想踢炸弹，但还没有拾取踢炸弹手套`);
      return;
    }

    // 检查面向方向是否有炸弹
    let dx = 0, dy = 0;
    switch (direction) {
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
    }

    const bx = entity.x + dx;
    const by = entity.y + dy;
    const bomb = this.room.bombs.find(b => b.x === bx && b.y === by);
    if (!bomb) {
      this.room.addBattleLog(`${entity.name} 面前没有可踢的炸弹`);
      return;
    }

    // 踢炸弹：沿方向一直移动直到碰到障碍物或边界
    let newX = bx, newY = by;
    while (true) {
      const nextX = newX + dx;
      const nextY = newY + dy;
      if (nextX < 0 || nextX >= MAP_WIDTH || nextY < 0 || nextY >= MAP_HEIGHT) break;
      if (this.room.map[nextY][nextX] === 1) break; // 石头阻挡
      if (this.room.bombs.some(b => b.x === nextX && b.y === nextY && b !== bomb)) break; // 其他炸弹阻挡

      newX = nextX;
      newY = nextY;
    }

    bomb.x = newX;
    bomb.y = newY;
    this.room.addBattleLog(`${entity.name} 踢飞了一颗炸弹！`);
  }

  updateBombs() {
    const dt = 1 / TICK_RATE;

    for (let i = this.room.bombs.length - 1; i >= 0; i--) {
      const bomb = this.room.bombs[i];
      bomb.timer -= dt;

      if (bomb.timer <= 0) {
        this.explodeBomb(bomb);
        this.room.bombs.splice(i, 1);
      }
    }
  }

  explodeBomb(bomb) {
    const { x, y, owner, power } = bomb;
    const allEntities = new Map([...this.room.players, ...this.room.bots]);
    const ownerEntity = allEntities.get(owner);

    // 十字形爆炸范围
    const directions = [
      { dx: 0, dy: -1 }, // 上
      { dx: 0, dy: 1 },  // 下
      { dx: -1, dy: 0 }, // 左
      { dx: 1, dy: 0 }   // 右
    ];

    const explosionCells = [{ x, y }]; // 中心点
    const hitPlayers = new Set();

    for (const dir of directions) {
      for (let i = 1; i <= power; i++) {
        const ex = x + dir.dx * i;
        const ey = y + dir.dy * i;

        if (ex < 0 || ex >= MAP_WIDTH || ey < 0 || ey >= MAP_HEIGHT) break;

        const tile = this.room.map[ey][ex];
        if (tile === 1) break; // 石头阻挡火焰

        explosionCells.push({ x: ex, y: ey });

        // 连锁爆炸：如果火焰碰到其他炸弹
        const otherBomb = this.room.bombs.find(b => b.x === ex && b.y === ey && b !== bomb);
        if (otherBomb) {
          otherBomb.timer = 0; // 立即爆炸
        }

        // 破坏砖块
        if (tile === 2) {
          this.room.map[ey][ex] = 0; // 变成空地
          this.spawnItem(ex, ey);
          break; // 火焰被砖块阻挡
        }

        // 检查玩家碰撞
        for (const [pid, p] of allEntities) {
          if (p.dead || p.invincible > 0) continue;
          if (p.x === ex && p.y === ey) {
            hitPlayers.add(pid);
          }
        }
      }
    }

    // 检查中心点是否有玩家
    for (const [pid, p] of allEntities) {
      if (p.dead || p.invincible > 0) continue;
      if (p.x === x && p.y === y) {
        hitPlayers.add(pid);
      }
    }

    // 处理被炸到的玩家
    for (const pid of hitPlayers) {
      const p = allEntities.get(pid);
      if (!p || p.dead) continue;
      p.lives--;
      p.invincible = 3; // 3秒无敌

      if (ownerEntity && ownerEntity.id !== pid) {
        ownerEntity.kills++;
      }

      this.room.addBattleLog(`💥 ${p.name} 被炸弹炸到了！剩余 ${p.lives} 条命！`);

      if (p.lives <= 0) {
        p.dead = true;
        this.room.addBattleLog(`💀 ${p.name} 被炸死了！`);

        if (ownerEntity && ownerEntity.id !== pid) {
          this.room.addBattleLog(`⚔️ ${ownerEntity.name} 击杀了 ${p.name}！`);
        }
      }
    }

    // 记录爆炸区域（用于前端显示动画）
    this.room.explosions = explosionCells.map(c => ({ x: c.x, y: c.y, timer: 0.5 }));

    // 返还炸弹数量给主人
    if (ownerEntity && !ownerEntity.dead) {
      ownerEntity.bombs = Math.min(ownerEntity.bombs + 1, ownerEntity.maxBombs);
    }
  }

  spawnItem(x, y) {
    if (Math.random() > ITEM_DROP_CHANCE) return; // 不掉道具

    // 安全检查：只生成在空地上
    if (this.room.map[y][x] !== 0) return;

    // 检查该位置是否已有道具
    if (this.room.items.some(i => i.x === x && i.y === y)) return;

    // 检查该位置是否有炸弹（避免道具压在炸弹上）
    if (this.room.bombs.some(b => b.x === x && b.y === y)) return;

    // 按权重选择道具类型
    let rand = Math.random();
    let type = 'bomb';
    for (let i = 0; i < ITEM_TYPES.length; i++) {
      if (rand < ITEM_WEIGHTS[i]) {
        type = ITEM_TYPES[i];
        break;
      }
      rand -= ITEM_WEIGHTS[i];
    }

    this.room.items.push({ x, y, type });
  }

  checkItemPickup(entity) {
    const itemIndex = this.room.items.findIndex(i => i.x === entity.x && i.y === entity.y);
    if (itemIndex === -1) return;

    const item = this.room.items[itemIndex];
    this.room.items.splice(itemIndex, 1);
    entity.itemsPicked++;

    let msg = '';
    switch (item.type) {
      case 'bomb':
        entity.maxBombs = Math.min(entity.maxBombs + 1, 8);
        entity.bombs = Math.min(entity.bombs + 1, entity.maxBombs);
        msg = '炸弹数量';
        break;
      case 'power':
        entity.power = Math.min(entity.power + 1, 8);
        msg = '炸弹火力';
        entity._powerTimers = entity._powerTimers || [];
        const powerTimer = setTimeout(() => {
          entity.power = Math.max(entity.power - 1, 1);
          entity._powerTimers = entity._powerTimers.filter(t => t !== powerTimer);
        }, 15000);
        entity._powerTimers.push(powerTimer);
        break;
      case 'speed':
        entity.speed = Math.min(entity.speed + 1, 5);
        msg = '移动速度';
        entity._speedTimers = entity._speedTimers || [];
        const speedTimer = setTimeout(() => {
          entity.speed = Math.max(entity.speed - 1, 1);
          entity._speedTimers = entity._speedTimers.filter(t => t !== speedTimer);
        }, 15000);
        entity._speedTimers.push(speedTimer);
        break;
      case 'kick':
        entity.canKick = true;
        msg = '踢炸弹能力';
        break;
      case 'ghost':
        entity.ghostMode = true;
        msg = '穿墙模式（限时）';
        // 10秒后取消穿墙
        setTimeout(() => {
          entity.ghostMode = false;
        }, 10000);
        break;
    }

    this.room.addBattleLog(`🎁 ${entity.name} 捡到了 ${msg} 道具！`);
  }

  updateInvincibility() {
    const dt = 1 / TICK_RATE;
    const allEntities = [...this.room.players.values(), ...this.room.bots.values()];
    for (const p of allEntities) {
      if (p.invincible > 0) {
        p.invincible -= dt;
        if (p.invincible < 0) p.invincible = 0;
      }
    }
  }

  processBotAI() {
    // Bot每30个tick（1.5秒）决策一次
    if (this.currentTick % 30 !== 0) return;

    for (const bot of this.room.bots.values()) {
      if (bot.dead) continue;
      const action = this.getBotAction(bot);
      this.executeAction(bot.id, action);
    }
  }

  getBotAction(bot) {
    return getSimpleBotAction(bot, this.room);
  }

  handlePlayerAction(playerId, action) {
    this.pendingActions.set(playerId, action);
  }
}

module.exports = { GameLoop };

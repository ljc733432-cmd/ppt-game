/**
 * Bot AI 系统
 * 四种难度：简单、中等、困难、疯子
 */

const { MAP_WIDTH, MAP_HEIGHT } = require('./mapGenerator');

const DIRECTIONS = ['up', 'down', 'left', 'right'];

function getSimpleBotAction(bot, room) {
  switch (bot.difficulty) {
    case 'easy': return easyAI(bot, room);
    case 'medium': return mediumAI(bot, room);
    case 'hard': return hardAI(bot, room);
    case 'insane': return insaneAI(bot, room);
    default: return easyAI(bot, room);
  }
}

// 简单AI：随机走动，随机放炸弹，不躲爆炸
function easyAI(bot, room) {
  const move = Math.random() < 0.7 ? DIRECTIONS[Math.floor(Math.random() * 4)] : null;
  const placeBomb = Math.random() < 0.15; // 15%概率放炸弹
  return { move, placeBomb };
}

// 中等AI：会躲炸弹，会捡道具，不主动追击
function mediumAI(bot, room) {
  // 1. 检查是否处于危险区域（炸弹火焰范围内）
  if (isInDanger(bot, room)) {
    const safeDir = findSafeDirection(bot, room);
    if (safeDir) return { move: safeDir, placeBomb: false };
  }

  // 2. 检查附近是否有道具
  const itemDir = findItemDirection(bot, room);
  if (itemDir) return { move: itemDir, placeBomb: false };

  // 3. 随机走动，偶尔放炸弹
  if (Math.random() < 0.3) {
    const randomDir = getValidRandomDirection(bot, room);
    return { move: randomDir, placeBomb: Math.random() < 0.2 };
  }

  return { move: bot.direction, placeBomb: false };
}

// 困难AI：会算安全区域，会封路，会追击
function hardAI(bot, room) {
  // 1. 危险区域优先逃跑
  if (isInDanger(bot, room)) {
    const safeDir = findSafeDirection(bot, room);
    if (safeDir) return { move: safeDir, placeBomb: false };
  }

  // 2. 寻找最近的活着的敌人
  const allEntities = [...room.players.values(), ...room.bots.values()];
  const enemies = allEntities.filter(e => e.id !== bot.id && !e.dead);
  if (enemies.length > 0) {
    const target = findClosestEntity(bot, enemies);
    const dist = Math.abs(bot.x - target.x) + Math.abs(bot.y - target.y);

    // 如果距离很近，放炸弹尝试击杀
    if (dist <= bot.power + 1 && Math.random() < 0.5) {
      return { move: null, placeBomb: true };
    }

    // 向敌人移动
    const chaseDir = getChaseDirection(bot, target, room);
    if (chaseDir) return { move: chaseDir, placeBomb: false };
  }

  // 3. 捡道具
  const itemDir = findItemDirection(bot, room);
  if (itemDir) return { move: itemDir, placeBomb: false };

  // 4. 随机移动
  const randomDir = getValidRandomDirection(bot, room);
  return { move: randomDir, placeBomb: Math.random() < 0.1 };
}

// 疯子AI：贴脸追杀，高风险高回报，利用踢炸弹
function insaneAI(bot, room) {
  // 1. 危险时优先逃跑（但只找最优方向）
  if (isInDanger(bot, room)) {
    const safeDir = findSafeDirection(bot, room);
    if (safeDir) return { move: safeDir, placeBomb: false };
  }

  // 2. 激进追击
  const allEntities = [...room.players.values(), ...room.bots.values()];
  const enemies = allEntities.filter(e => e.id !== bot.id && !e.dead);
  if (enemies.length > 0) {
    const target = findClosestEntity(bot, enemies);
    const dist = Math.abs(bot.x - target.x) + Math.abs(bot.y - target.y);

    // 贴脸放炸弹
    if (dist <= 2) {
      // 先尝试放炸弹
      if (Math.random() < 0.8) {
        return { move: null, placeBomb: true };
      }
      // 然后立刻逃跑
      const safeDir = findSafeDirection(bot, room);
      if (safeDir) return { move: safeDir, placeBomb: false };
    }

    // 向敌人移动（更激进）
    const chaseDir = getChaseDirection(bot, target, room);
    if (chaseDir) return { move: chaseDir, placeBomb: false };
  }

  // 3. 踢炸弹
  if (bot.canKick) {
    for (const dir of DIRECTIONS) {
      const dx = { up: 0, down: 0, left: -1, right: 1 }[dir];
      const dy = { up: -1, down: 1, left: 0, right: 0 }[dir];
      const bx = bot.x + dx, by = bot.y + dy;
      const bomb = room.bombs.find(b => b.x === bx && b.y === by);
      if (bomb) {
        return { move: null, placeBomb: false, kick: dir };
      }
    }
  }

  const randomDir = getValidRandomDirection(bot, room);
  return { move: randomDir, placeBomb: Math.random() < 0.15 };
}

// ========== 辅助函数 ==========

function isInDanger(entity, room) {
  for (const bomb of room.bombs) {
    if (bomb.x === entity.x && bomb.y === entity.y) return true;
    if (bomb.x === entity.x && Math.abs(bomb.y - entity.y) <= bomb.power) return true;
    if (bomb.y === entity.y && Math.abs(bomb.x - entity.x) <= bomb.power) return true;
  }
  return false;
}

function findSafeDirection(entity, room) {
  const dirs = ['up', 'down', 'left', 'right'];
  const shuffled = dirs.sort(() => Math.random() - 0.5);

  for (const dir of shuffled) {
    let dx = 0, dy = 0;
    switch (dir) {
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
    }
    const nx = entity.x + dx, ny = entity.y + dy;
    if (canMoveTo(nx, ny, entity, room) && !isInDangerAt({ x: nx, y: ny }, room)) {
      return dir;
    }
  }
  return null;
}

function isInDangerAt(pos, room) {
  for (const bomb of room.bombs) {
    if (bomb.x === pos.x && bomb.y === pos.y) return true;
    if (bomb.x === pos.x && Math.abs(bomb.y - pos.y) <= bomb.power) return true;
    if (bomb.y === pos.y && Math.abs(bomb.x - pos.x) <= bomb.power) return true;
  }
  return false;
}

function findItemDirection(entity, room) {
  const items = room.items.filter(i => {
    // 只找可到达的道具
    return canMoveTo(i.x, i.y, entity, room);
  });
  if (items.length === 0) return null;

  const closest = items.reduce((best, item) => {
    const dist = Math.abs(item.x - entity.x) + Math.abs(item.y - entity.y);
    return dist < best.dist ? { item, dist } : best;
  }, { item: null, dist: Infinity });

  if (closest.item) {
    return getChaseDirection(entity, closest.item, room);
  }
  return null;
}

function findClosestEntity(entity, targets) {
  return targets.reduce((best, t) => {
    const dist = Math.abs(t.x - entity.x) + Math.abs(t.y - entity.y);
    return dist < best.dist ? { target: t, dist } : best;
  }, { target: null, dist: Infinity }).target;
}

function getChaseDirection(entity, target, room) {
  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const dirs = [];

  if (dx > 0) dirs.push('right');
  else if (dx < 0) dirs.push('left');
  if (dy > 0) dirs.push('down');
  else if (dy < 0) dirs.push('up');

  // 优先选择可行的方向
  for (const dir of dirs) {
    let ddx = 0, ddy = 0;
    switch (dir) {
      case 'up': ddy = -1; break;
      case 'down': ddy = 1; break;
      case 'left': ddx = -1; break;
      case 'right': ddx = 1; break;
    }
    if (canMoveTo(entity.x + ddx, entity.y + ddy, entity, room)) {
      return dir;
    }
  }

  return getValidRandomDirection(entity, room);
}

function getValidRandomDirection(entity, room) {
  const dirs = ['up', 'down', 'left', 'right'];
  const shuffled = dirs.sort(() => Math.random() - 0.5);

  for (const dir of shuffled) {
    let dx = 0, dy = 0;
    switch (dir) {
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
    }
    if (canMoveTo(entity.x + dx, entity.y + dy, entity, room)) {
      return dir;
    }
  }
  return null;
}

function canMoveTo(x, y, entity, room) {
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
  const tile = room.map[y][x];
  if (tile === 1) return false; // 石头
  if (tile === 2 && !entity.ghostMode) return false; // 砖块
  if (room.bombs.some(b => b.x === x && b.y === y && !entity.ghostMode)) return false;

  const all = [...room.players.values(), ...room.bots.values()];
  for (const e of all) {
    if (e.id !== entity.id && !e.dead && e.x === x && e.y === y) return false;
  }
  return true;
}

module.exports = { getSimpleBotAction };

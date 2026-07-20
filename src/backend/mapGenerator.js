/**
 * 地图生成器
 * 生成13x11的泡泡堂地图
 * 瓦片类型: 0=空地, 1=固定石头, 2=可破坏砖块
 */

const MAP_PRESETS = {
  classic: {
    name: '经典地图',
    description: '最经典的泡泡堂布局',
    layout: null // 使用随机生成
  },
  arena: {
    name: '竞技场',
    description: '开放区域，适合快速对战',
    layout: null
  },
  maze: {
    name: '迷宫',
    description: '复杂地形，考验策略',
    layout: null
  },
  sparse: {
    name: '荒野',
    description: '大量空地，炸弹满天飞',
    layout: null
  }
};

const MAP_WIDTH = 13;
const MAP_HEIGHT = 11;

function generateMap(presetName = 'classic') {
  const map = [];

  for (let y = 0; y < MAP_HEIGHT; y++) {
    map[y] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      // 边缘一圈固定石头
      if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
        map[y][x] = 1;
      } else {
        map[y][x] = 0; // 空地，固定障碍由 addRandomStones 随机生成
      }
    }
  }

  // 每局随机生成固定石头障碍（180°旋转对称，保证对角公平）
  const stoneCount = { classic: 28, arena: 20, maze: 34, sparse: 16 }[presetName] ?? 28;
  addRandomStones(map, stoneCount);

  // 根据预设调整生成策略
  switch (presetName) {
    case 'arena':
      generateArena(map);
      break;
    case 'maze':
      generateMaze(map);
      break;
    case 'sparse':
      generateSparse(map);
      break;
    case 'classic':
    default:
      generateClassic(map);
      break;
  }

  return map;
}

function generateClassic(map) {
  // 经典模式：内部区域填充大量砖块（不覆盖随机石头）
  fillBricks(map, () => Math.random() < 0.5);
}

function generateArena(map) {
  // 竞技场：中间开放，边缘砖块多
  fillBricks(map, (x, y) => {
    const distToCenter = Math.abs(x - 6) + Math.abs(y - 5);
    return Math.random() < (distToCenter > 4 ? 0.6 : 0.25);
  });
}

function generateMaze(map) {
  // 迷宫：大量砖块，通道狭窄
  fillBricks(map, () => Math.random() < 0.6);
}

function generateSparse(map) {
  // 荒野：大量空地，砖块很少
  fillBricks(map, () => Math.random() < 0.2);
}

// 统一铺砖：只填空地，避开出生点与随机石头
function fillBricks(map, shouldPlace) {
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      if (map[y][x] !== 0) continue;
      if (isSpawnArea(x, y)) continue;
      if (shouldPlace(x, y)) map[y][x] = 2;
    }
  }
}

// 每局随机放置固定石头，180°旋转对称保证公平
function addRandomStones(map, count) {
  for (let attempt = 0; attempt < 10; attempt++) {
    // 每次重试清掉之前的石头
    if (attempt > 0) {
      for (let y = 1; y < MAP_HEIGHT - 1; y++)
        for (let x = 1; x < MAP_WIDTH - 1; x++)
          if (!isSpawnArea(x, y)) map[y][x] = 0;
    }
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 500) {
      const x = 1 + Math.floor(Math.random() * (MAP_WIDTH - 2));
      const y = 1 + Math.floor(Math.random() * (MAP_HEIGHT - 2));
      const mx = MAP_WIDTH - 1 - x;
      const my = MAP_HEIGHT - 1 - y;
      if (map[y][x] === 1) continue;
      if (isSpawnArea(x, y) || isSpawnArea(mx, my)) continue;
      map[y][x] = 1;
      map[my][mx] = 1;
      placed += (x === mx && y === my) ? 1 : 2;
    }
    // 验证连通性：四个角落出生点必须互相可达
    const spawns = [[1,1], [11,1], [1,9], [11,9]];
    if (spawns.every(sp => bfsReachable(map, spawns[0][0], spawns[0][1], sp[0], sp[1]))) return;
    // 连通失败，减少石头数重试
    count = Math.max(count - 2, 4);
  }
  // 最终兜底：减少到极少量石头，不再随机
  for (let y = 1; y < MAP_HEIGHT - 1; y++)
    for (let x = 1; x < MAP_WIDTH - 1; x++)
      if (map[y][x] === 1 && !isOnEdge(x, y)) map[y][x] = 0;
}

// BFS 检查从 (sx,sy) 能否走到 (tx,ty)，路径不能穿石头
function bfsReachable(map, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return true;
  const visited = Array.from({length: MAP_HEIGHT}, () => new Array(MAP_WIDTH).fill(false));
  const queue = [[sx, sy]];
  visited[sy][sx] = true;
  const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
      if (visited[ny][nx]) continue;
      if (map[ny][nx] === 1) continue; // 石头不可通过
      if (nx === tx && ny === ty) return true;
      visited[ny][nx] = true;
      queue.push([nx, ny]);
    }
  }
  return false;
}

function isOnEdge(x, y) {
  return x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1;
}

function isSpawnArea(x, y) {
  // 四个角落出生点保护区域 2x2
  const spawns = [
    [1, 1], [2, 1], [1, 2], [2, 2],
    [10, 1], [11, 1], [10, 2], [11, 2],
    [1, 8], [2, 8], [1, 9], [2, 9],
    [10, 8], [11, 8], [10, 9], [11, 9]
  ];
  return spawns.some(([sx, sy]) => sx === x && sy === y);
}

function getMapName(id) {
  return MAP_PRESETS[id]?.name || '未知地图';
}

function getMapList() {
  return Object.entries(MAP_PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description
  }));
}

module.exports = { generateMap, MAP_PRESETS, getMapName, getMapList, MAP_WIDTH, MAP_HEIGHT };

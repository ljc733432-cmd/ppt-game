const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const { createRoom, getRoom, removeRoom, listRooms } = require('./src/backend/roomManager');

const PORT = 3000;
const HOST = '0.0.0.0';

// 获取本机所有局域网/虚拟网卡 IPv4 地址
function getLocalIPs() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      const family = typeof iface.family === 'string' ? iface.family : (iface.family === 4 ? 'IPv4' : 'IPv6');
      if (family === 'IPv4' && !iface.internal) {
        result.push({ name, address: iface.address });
      }
    }
  }
  return result;
}

// HTTP 静态文件服务器
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // 只取路径部分，忽略 ?room=XXXX 等查询串（否则刷新分享链接会 404）
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let filePath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
});

function setupWebSocket() {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://localhost`);
    const roomId = url.searchParams.get('room');
    const isSpectator = url.searchParams.get('spectate') === '1';
    const isAgent = url.searchParams.get('agent') === '1';

    ws.isAlive = true;
    ws.playerId = null;
    ws.roomId = roomId;
    ws.isAgent = isAgent;
    ws.isSpectator = isSpectator;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      handleMessage(ws, msg);
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });
  });

  // 心跳检测
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { ws.terminate(); }
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

// 让 ws 离开当前所在房间（若房间空了则销毁）
function leaveCurrentRoom(ws) {
  if (!ws.roomId) return;
  const room = getRoom(ws.roomId);
  if (room) {
    room.removePlayer(ws.playerId, false); // 不关闭当前连接
    if (room.totalCount === 0) {
      removeRoom(ws.roomId);
    }
  }
  ws.roomId = null;
  ws.playerId = null;
}

function handleMessage(ws, msg) {
  const room = ws.roomId ? getRoom(ws.roomId) : null;

  switch (msg.type) {
    case 'createRoom': {
      const { mode, mapName, playerName } = msg;
      leaveCurrentRoom(ws);
      const room = createRoom(mode, mapName, playerName);
      ws.playerId = room.addPlayer(playerName, ws);
      ws.roomId = room.id;
      ws.send(JSON.stringify({ type: 'roomCreated', roomId: room.id, playerId: ws.playerId }));
      break;
    }
    case 'joinRoom': {
      const { roomId, playerName } = msg;
      const room = getRoom(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }
      leaveCurrentRoom(ws);
      // 同一身份（同名）重复进入：踢掉旧的自己，保证一个身份只有一份
      room.removePlayerByName(playerName);
      ws.playerId = room.addPlayer(playerName, ws);
      ws.roomId = room.id;
      ws.send(JSON.stringify({ type: 'joined', roomId: room.id, playerId: ws.playerId, state: room.getState() }));
      room.broadcast({ type: 'playerJoined', playerId: ws.playerId, name: playerName }, ws);
      break;
    }
    case 'joinAsAgent': {
      const { roomId, name } = msg;
      const room = getRoom(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }
      leaveCurrentRoom(ws);
      room.removePlayerByName(name || 'Agent');
      ws.playerId = room.addPlayer(name || 'Agent', ws, true);
      ws.roomId = room.id;
      ws.isAgent = true;
      ws.send(JSON.stringify({ type: 'joined', roomId: room.id, playerId: ws.playerId, state: room.getState() }));
      room.broadcast({ type: 'agentJoined', playerId: ws.playerId, name: name || 'Agent' }, ws);
      break;
    }
    case 'spectate': {
      if (room) {
        room.addSpectator(ws);
        ws.send(JSON.stringify({ type: 'spectating', roomId: room.id, state: room.getState() }));
      }
      break;
    }
    case 'setReady': {
      if (room) room.setReady(ws.playerId, msg.ready);
      break;
    }
    case 'startGame': {
      if (room) room.startGame(ws.playerId);
      break;
    }
    case 'action': {
      if (room) room.handleAction(ws.playerId, msg);
      break;
    }
    case 'chat': {
      if (room) room.broadcast({ type: 'chat', playerId: ws.playerId, text: msg.text });
      break;
    }
    case 'listRooms': {
      ws.send(JSON.stringify({ type: 'roomList', rooms: listRooms() }));
      break;
    }
    case 'addBot': {
      if (room) room.addBot(msg.difficulty || 'medium');
      break;
    }
    case 'removeBot': {
      if (room) {
        if (msg.botId) {
          room.removeBot(msg.botId);
        } else if (room.bots.size > 0) {
          // 未提供botId时移除最后一个添加的Bot
          const lastBotId = Array.from(room.bots.keys()).pop();
          room.removeBot(lastBotId);
        }
      }
      break;
    }
  }
}

function handleDisconnect(ws) {
  if (ws.roomId) {
    const room = getRoom(ws.roomId);
    if (room) {
      room.removePlayer(ws.playerId);
      if (room.totalCount === 0) {
        removeRoom(ws.roomId);
      }
    }
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 已被占用！`);
    console.error(`   请运行以下命令关闭占用进程：`);
    console.error(`   netstat -ano | findstr :${PORT}`);
    console.error(`   taskkill /F /PID <PID>`);
    console.error(`\n   或更换端口：PORT=${PORT + 1} npm start\n`);
  } else {
    console.error('❌ 服务器启动失败:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  setupWebSocket();
  const ips = getLocalIPs();
  console.log(`\n🎮 AI Q版泡泡堂服务器已启动！`);
  console.log(`   端口: ${PORT}`);
  console.log(`   监听: ${HOST} (所有网络接口)`);
  console.log(`\n   👤 本机访问: http://localhost:${PORT}`);
  for (const { name, address } of ips) {
    console.log(`   🌐 局域网访问 [${name}]: http://${address}:${PORT}`);
  }
  console.log(`\n   💡 把对应网络的分享链接发给朋友即可加入（同一 VPN/局域网用同一网卡的地址）`);
  console.log(`\n   按 Ctrl+C 停止服务器\n`);
});

module.exports = { server };

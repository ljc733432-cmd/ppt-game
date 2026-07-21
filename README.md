# AI Q版泡泡堂

> 一个基于浏览器的Q版泡泡堂多人在线对战游戏，支持真人联机、Bot对战和Agent接入。

---

## 项目简介

AI Q版泡泡堂是一款致敬经典泡泡堂（Bomberman）的Web对战游戏，采用**Phaser.js** 引擎渲染游戏画面，**Node.js + WebSocket** 实现实时联机对战。

### 核心特色

- **🎮 真人联机**：创建房间，分享4位房间号，好友即可加入对战
- **🤖 内置Bot**：4种难度（简单/中等/困难/疯子），空位自动补Bot
- **📡 Agent接入**：外部AI Agent可通过WebSocket API直接接入对战
- **📊 战斗日志**：实时记录炸弹放置、击杀、道具拾取等战斗过程
- **🏆 多模式**：支持1v1、自由混战(FFA)、2v2组队、人机挑战(PVE)
- **🗺️ 多地图**：经典/竞技场/迷宫/荒野 4张地图

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端引擎 | Phaser.js v3 | 2D游戏引擎，程序化渲染 |
| 前端UI | 原生 HTML/CSS/JS | 菜单、大厅、战斗日志面板 |
| 后端 | Node.js + `ws` | WebSocket实时通信 |
| 地图生成 | 算法随机生成 | 13×11网格，石头/砖块/空地 |
| AI | 行为树 + 权重决策 | 4级难度Bot |

---

## 项目结构

```
ai-paopaotang/
├── server.js                  # 后端入口（HTTP + WebSocket）
├── package.json               # 项目依赖
├── generate_characters.py     # 角色立绘生成脚本（Python Pillow）
├── src/
│   └── backend/
│       ├── roomManager.js     # 房间管理（创建/加入/离开/销毁）
│       ├── gameLoop.js        # 游戏核心循环（20tick/s）
│       ├── mapGenerator.js    # 地图生成器（4种预设）
│       └── botAI.js           # Bot AI（4种难度）
├── public/
│   ├── index.html             # 游戏页面（含UI）
│   ├── js/
│   │   └── game.js            # 前端主程序（Phaser + WebSocket）
│   └── assets/
│       └── characters/        # 角色立绘（AI生成）
│           ├── red_boy.png
│           ├── blue_girl.png
│           ├── green_elf.png
│           └── yellow_bolt.png
├── docs/
│   ├── 需求分析文档.md
│   ├── 方案设计文档.md
│   ├── 人工配置文档.md
│   └── 快速启动说明.md
└── test/
    └── backend_test.js        # 后端功能测试脚本
```

---

## 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务器

```bash
npm start
```

### 3. 打开浏览器

访问 `http://localhost:3000`

---

## 操作说明

| 按键 | 动作 |
|------|------|
| `W` / `↑` | 向上移动 |
| `S` / `↓` | 向下移动 |
| `A` / `←` | 向左移动 |
| `D` / `→` | 向右移动 |
| `空格` | 放置炸弹 |
| `E` | 踢炸弹（获得道具后） |

---

## 游戏模式

| 模式 | 人数 | 胜利条件 |
|------|------|---------|
| 1v1 对战 | 2人 | 一方命数归零 |
| 自由混战(FFA) | 2-4人 | 最后存活者赢 |
| 2v2 组队 | 4人 | 敌方全队命数归零 |
| 人机挑战(PVE) | 1人+3Bot | 玩家存活到最后 |

---

## 道具系统

| 道具 | 效果 | 上限 |
|------|------|------|
| 💣 炸弹 | 炸弹数量+1 | 最多8个 |
| 🔥 火力 | 爆炸范围+1格 | 最多8格 |
| 👟 速度 | 移动速度+1档 | 最多5档 |
| ⚽ 踢炸弹 | 可踢动前方炸弹 | 有/无 |
| 👻 穿墙 | 可穿过砖块（限时10秒） | 有/无 |

---

## 战斗日志示例

```
[15:35:12] 火焰小子 放置了一颗炸弹！
[15:35:15] 💥 水之少女 被炸弹炸到了！剩余 1 条命！
[15:35:18] 🎁 森林精灵 捡到了 炸弹火力 道具！
[15:35:22] ⚔️ 闪电少年 击杀了 水之少女！
[15:35:25] 🎉 火焰小子 获得了胜利！
```

---

## 开发文档

详见 `docs/` 目录：

- [需求分析文档](docs/需求分析文档.md) — 功能需求清单
- [方案设计文档](docs/方案设计文档.md) — 技术架构与实现细节
- [人工配置文档](docs/人工配置文档.md) — 需要手动配置的内容
- [快速启动说明](docs/快速启动说明.md) — 从零到运行完整指南

---

## 权限与安全（AI Agent 操作规则）

以下三色灯规则针对**本项目**（AI Q版泡泡堂），约束 Agent 的所有操作行为。

### 🟢 绿灯 · 直接做

| 场景 | 具体操作 |
|------|---------|
| 读代码 | 读 `server.js`、`game.js`、`roomManager.js`、`gameLoop.js`、`botAI.js`、`mapGenerator.js` 等源文件 |
| 查文档 | 读 `docs/` 目录下所有 .md；查 Context7 获取 Phaser.js / `ws` 库最新文档 |
| 语法验证 | `node --check server.js` / `gameLoop.js` / `roomManager.js` 等 |
| 搜索代码 | `search_files` 搜函数定义、调用链、错误信息 |
| 查 git | `git status`、`git log`、`git diff` |
| 搜历史 | `session_search` 回溯过往 bug 修复记录和讨论 |
| 存经验 | `skill_manage` 保存调试技巧；`memory` 记录环境/偏好（不存敏感信息） |

### 🟡 黄灯 · 做后报告

| 场景 | 具体操作 | 附带约束 |
|------|---------|---------|
| 改 `game.js` | patch / write_file 编辑前端代码 | **必须同步更新** `index.html` 中 `?v=bN`（当前 b12） |
| 改后端文件 | 改 `server.js`、`gameLoop.js`、`roomManager.js`、`botAI.js`、`mapGenerator.js` | 改完跑 `node --check` |
| 改 `index.html` | 修改页面结构或样式 | 禁止 blue-purple gradient |
| 新增文件 | 新建脚本、资源、配置文件 | 放在合理目录 |
| 安装依赖 | `npm install <pkg>` | 确认是项目真正需要的 |
| 启动服务器 | `node server.js`（后台） | 先 `taskkill` 杀旧进程，端口固定 3000 |
| 浏览器测试 | 访问 `http://localhost:3000` 或 `http://192.168.60.21:3000` | 测试完关进程+关页面 |
| 本地 git | `git add`、`git commit` | **不 push** |

### 🔴 红灯 · 必须先问

| 场景 | 为什么不能直接做 |
|------|-----------------|
| 删除源文件 | `server.js`、`game.js`、精灵图、道具图标等 |
| 删除大段代码 | 函数、类、完整逻辑块 |
| 改端口 | 3000 是固定端口，不可变 |
| 改 WebSocket 协议 | 消息 type、字段名变更会破坏前后端兼容 |
| `git push` | 外发操作 |
| 改 `node_modules/` | 第三方代码 |
| 读/写 `.env` | 密钥和密码 |
| 改 Phaser 引擎文件 | `public/js/lib/phaser.min.js` 是本地托管 |
| 修改精灵图素材 | `public/assets/characters/` 和 `items/` 下的 png |
| 跨 profile 操作 | 改其他 Hermes profile 的 skills/plugins/cron/memories |
| 任何花钱操作 | 云服务、付费 API |

---

## 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-19 | MVP完成，支持联机+Bot+战斗日志 |
| v1.1 | 2026-07-20 | 前后端分离：`?server=` 参数支持 Workers 托管；auto-start.js 防崩；5 项代码质量修复 |

---

## 许可证

MIT License

---

> 本项目由 AI 辅助开发，代码和文档沉淀便于后续扩展功能。

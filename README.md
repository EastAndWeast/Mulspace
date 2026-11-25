# Mulspace (`EastAndWeast/Mulspace`)

> 多账号工作区 AI 浏览器 — 原生支持无限账号空间隔离、单核多路由代理（Clash / V2Ray / Mihomo）、工作区隔离 AI Agent / Skills / 双向 MCP、Chrome MV3 扩展、Google Material Design 3 主题分离与 GitHub Releases 自动更新检测。

仓库地址：https://github.com/EastAndWeast/Mulspace

---

## 核心特性

1. **无限多账号工作区隔离（Vivaldi 式交互）**
   - 每个工作区绑定独立 Chromium 存储分区 `persist:ws-<id>`（Cookie、LocalStorage、IndexedDB、Cache、ServiceWorker 彻底隔离），同平台登录 $N$ 个账号互不覆盖。
   - 支持单窗左侧栏秒切、右键编辑强调色防串号、多窗口并行多开。
   - 默认启用 `WebRTC disable_non_proxied_udp` 与独立 User-Agent 隔离。

2. **单核多路由网络代理（Clash / V2Ray / Mihomo）**
   - 支持导入 Clash YAML、V2Ray Base64 订阅及 `vmess://` / `vless://` / `trojan://` / `ss://` / `hysteria2://` 节点链接。
   - 通过单一 `mihomo` 进程内的 `listeners` 为不同工作区分配独立本地回环端口，**完全不修改宿主机全局代理**，同时支持直连 / 系统 / 自定义 HTTP·SOCKS5（含账密）。

3. **现代化工作区隔离 AI 浏览器（Skills + 双向 MCP + Google A2UI）**
   - 每个工作区拥有独立的对话上下文、Skills 与工具授权，**严格禁止跨工作区读取其他账号页面或凭证**。
   - 支持 OpenAI 兼容接口（OpenAI / DeepSeek / OpenRouter）、Anthropic、Gemini 与本地 Ollama。
   - **双向 MCP**：内置本地 Bearer Token 鉴权的 `BrowserMcpServer`（`http://127.0.0.1:19789/mcp`），同时支持挂载外部 HTTP MCP Server。

4. **Chrome 扩展生态与三层内存回收**
   - 支持安装本地未解压扩展目录与 `.crx` 安装包，按工作区独立启用/禁用与隔离数据。
   - 内置 `Active → Frozen → Discarded` 三层标签页生命周期引擎，按 LRU 自动回收闲置渲染进程内存。

5. **Google Material Design 3 主题分离与自动更新检测**
   - 内置 4 套官方主题：`Material You`、`Zen Glass`、`Vivaldi Compact`、`Obsidian Pro`，支持 JSON 导入导出。
   - 内置 GitHub Releases 自动更新检测（可在设置中手动立即检查、查看更新日志并一键跳转下载匹配当前系统的安装包）。

---

## 本地开发与构建

```bash
# 1. 安装依赖（国内网络下载 Electron 可附加 ELECTRON_MIRROR）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install

# 2. 启动桌面浏览器开发环境
pnpm dev

# 3. 全量构建、类型检查与自动化测试
pnpm build && pnpm typecheck && pnpm test

# 4. 本地打包（macOS / Windows）
pnpm package:mac
pnpm package:win
```

---

## GitHub 自动构建与下载测试

推送版本 Tag（如 `v0.1.0`）或在 Actions 页面手动运行 `Release Build (macOS & Windows)`，将自动在云端构建：
- **macOS**：ARM64 / x64 `.dmg` 与 `.zip`
- **Windows**：x64 安装包 `.exe`（NSIS）与便携版 `.zip`

下载页面：https://github.com/EastAndWeast/Mulspace/releases

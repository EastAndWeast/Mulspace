# WorkspaceBrowser 架构设计文档

> 代号：`WorkspaceBrowser`（正式名称待后续确定）

## 1. 开源方案调研结论

本项目的核心目标是在“**不重复造轮子、严格控制长期维护成本、避免 License 传染**”的前提下，构建一个面向多账号管理和 AI 自动化的现代化浏览器：

- **浏览器内核与壳层**：选用 **Electron 35+（`BaseWindow` + `WebContentsView`）** 并通过接口抽象隔离底层，参考 `flow-browser` / `electron-browser-shell` 的多视图架构思路。相比直接 Fork Chromium（源码 40GB+、单次编译数小时）或 Gecko（缺乏原生完整 CDP），Electron 拥有原生 `session.fromPartition()` 隔离、`session.setProxy()` 会话级代理以及极快的 TypeScript 迭代效率。
- **单核多路由网络代理（Phase 2）**：抽象 `IProxyCore` 接口，首期集成 **`mihomo` (Clash Meta)**，同时兼容 **`sing-box`**。单进程内通过 `listeners` / 多 `inbounds` 开出多个本地回环端口并绑定到各工作区 Partition，做到宿主机全局代理零污染、极低内存占用。
- **AI 浏览器与 MCP（Phase 3）**：借鉴 `microsoft/playwright-mcp` 和 `browser-use` 的 **CDP + Accessibility Tree** 方案降低 Token 消耗；基于 `@modelcontextprotocol/sdk` 实现双向 MCP（内置 Agent 调用外部 MCP + 作为 MCP Server 供外部 IDE/Agent 操控指定工作区）；采用标准 `SKILL.md` 规范。
- **Chrome 扩展生态（Phase 4）**：集成 `electron-chrome-extensions` + `electron-chrome-web-store`，配合 Electron 35+ Service Worker Preload 支持 MV3 扩展。
- **Google 开源 UI 与主题分离**：采用 `@material/material-color-utilities`（HCT 色彩算法）生成 Material Design 3 三层 Design Tokens，配合 Google **A2UI** 声明式 UI 协议渲染结构化 Agent 交互卡片。

## 2. Monorepo 分层与依赖边界

严格遵循 **Contract-First + 微内核依赖注入**：

1. `packages/contracts`：零运行时依赖，定义领域模型、模块契约、IPC 通道与 Typed Event Map。
2. `packages/kernel`：只依赖 `contracts`，提供 `TypedEventBus`、`ServiceRegistry` 和 `BrowserKernel` 生命周期编排。
3. 核心领域模块（互不直接引用，只通过 `contracts` 与 `kernel` 协同）：
   - `packages/storage`：持久化仓储（Phase 1 为原子 JSON 存储，接口异步兼容后续平滑切换 SQLite）。
   - `packages/workspace-core`：工作区 CRUD、`persist:ws-<id>` 隔离分区与多窗口调度。
   - `packages/tab-lifecycle`：三层标签页生命周期状态机（Active → Frozen → Discarded）。
   - `packages/proxy-engine`（Phase 2）：`IProxyCore`、订阅解析、多端口路由与测速。
   - `packages/ai-runtime`（Phase 3）：工作区隔离 Agent、CDP 执行器、Skill 注册表、双向 MCP。
   - `packages/extension-host`（Phase 4）：Chrome MV3 扩展宿主与工作区启停。
4. 表现层（主题与组件 100% 解耦）：
   - `packages/themes`：Material Design 3 动态色板生成器、主题注册表与官方预设主题包。
   - `packages/ui-kit`：React 19 基础组件库与 Google A2UI 渲染器，仅消费 `--wb-sys-*` CSS 变量。
   - `apps/desktop`：Electron `BaseWindow` + `WebContentsView` 薄组装层。

## 3. 五阶段实施路线图

- **Phase 1（当前）**：微内核骨架 + 主题分离底座 + 多工作区多账号强隔离 + 三层标签内存回收 MVP。
- **Phase 2**：单核多路由代理系统（Mihomo 首期 + 订阅导入 + 测速 + 工作区节点绑定 + WebRTC 防泄漏）。
- **Phase 3**：AI 浏览器核心（工作区隔离 Agent + CDP Accessibility Tree 自动化 + 双向 MCP + `SKILL.md` + A2UI）。
- **Phase 4**：Chrome MV3 扩展宿主与工作区独立插件管理。
- **Phase 5**：4 套官方默认主题精修、多工作区并发批量任务编排与跨平台打包发布。

# Privacy Policy / 隐私政策

This policy explains how **Mulspace** (`https://github.com/EastAndWeast/Mulspace`) handles user data.

## Core Privacy Guarantee

**This program does not collect telemetry, analytics, or personal data, and will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.**

## Local-First Storage

All workspace data is stored locally on the user's device, including:
- Isolated browser workspace profiles (`persist:ws-<id>` cookies, LocalStorage, IndexedDB, cache, ServiceWorkers)
- Multab personal workbench data (bookmark categories, pinned items, recent records, quick notes)
- User preferences, Material Design 3 theme settings, and local proxy routing configurations

Mulspace operates no central tracking server and sends no crash reports, usage metrics, or behavioral telemetry.

## User-Initiated Network Connections

External network requests occur **only** when explicitly initiated or configured by the user:
1. **Web browsing & workspace proxies**: Navigating to websites or routing traffic through proxy servers configured by the user.
2. **AI integrations (optional)**: Calling user-configured AI endpoints (OpenAI-compatible APIs, Anthropic, Gemini, or local Ollama) with API keys and prompts supplied by the user.
3. **Multab 6-digit sync (optional)**: When a user explicitly uploads or restores a Multab backup using a 6-digit sync code, data is encrypted client-side with **AES-256-GCM** before leaving the device.
4. **Update checks (optional)**: Checking `https://api.github.com/repos/EastAndWeast/Mulspace/releases/latest` when triggered by the user or enabled in settings.

---

## 隐私政策（中文摘要）

**本软件不收集任何遥测、统计分析或个人身份数据；除非用户本人或安装操作者明确发起请求，否则不会向外部网络系统传输任何信息。**

- **本地优先存储**：工作区隔离会话、Multab 书签与速记、主题与代理规则全部仅保存在本地设备。
- **按需发起连接**：仅在用户主动访问网页、配置外部 AI 模型接口、主动执行端到端加密（AES-256-GCM）6 位口令同步，或检查 GitHub Releases 更新时才会产生对应网络请求。

## Contact

For privacy questions or security reports, please open an issue at:
https://github.com/EastAndWeast/Mulspace/issues

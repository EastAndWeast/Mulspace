# Multab 6-Digit E2E Sync Relay (Cloudflare Workers)

零账号、无明文存储的 Multab 6 位验证码跨设备同步中转服务，可免费部署在 Cloudflare Workers + KV 套餐（每日 10 万次免费请求）。

## 工作原理
- 客户端先使用随机 **6 位数字验证码** 经 `PBKDF2-SHA256` 派生密钥，在本地用 **AES-256-GCM** 加密所有书签与分组。
- 中转服务仅根据 `SHA-256("multab-slot-v1:" + code)` 临时存放加密信封，默认 **300 秒（5 分钟）** 后由 KV 自动销毁。

## 3 步免费部署
1. 安装 Wrangler 并登录 Cloudflare：
   ```bash
   npm i -g wrangler
   wrangler login
   ```
2. 创建 KV 命名空间并把返回的 `id` 填入 `wrangler.toml`：
   ```bash
   wrangler kv namespace create MULTAB_SYNC_KV
   ```
3. 发布上线：
   ```bash
   wrangler deploy
   ```
4. 将部署得到的 `https://multab-sync-relay.<你的子域>.workers.dev` 填入 Mulspace → Multab「同步」弹窗中的中转地址即可使用。

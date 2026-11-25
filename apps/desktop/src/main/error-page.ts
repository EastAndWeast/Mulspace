export interface LoadErrorDiagnosis {
  title: string
  summary: string
  isSslOrConnection: boolean
}

export interface BuildLoadErrorHtmlParams {
  url: string
  errorCode: number
  errorDescription: string
  workspaceName: string
  proxyMode: string
  proceedUnsafeUrl?: string
  hostname?: string
  certSubject?: string
  certIssuer?: string
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function diagnoseChromiumError(
  errorCode: number,
  errorDescription: string,
): LoadErrorDiagnosis {
  if (errorCode === -107 || errorCode === -113 || errorDescription.includes('ERR_SSL')) {
    return {
      title: 'TLS / SSL 安全连接失败',
      summary:
        '目标服务器未能完成 HTTPS 握手（例如站点未配置有效的 SSL 证书或仅开放了 HTTP 服务）。如果这是内网或测试站点，可尝试改用 HTTP 访问。',
      isSslOrConnection: true,
    }
  }
  if (errorCode <= -200 && errorCode >= -217) {
    return {
      title: '您的连接不是私密连接（网站安全证书无效）',
      summary:
        '目标站点的 HTTPS 证书不受信任、已过期、自签名或与域名不匹配。如果您确认目标站点安全，可以选择仅在当前工作区临时信任该证书并继续访问。',
      isSslOrConnection: true,
    }
  }
  if (errorCode === -105 || errorDescription.includes('ERR_NAME_NOT_RESOLVED')) {
    return {
      title: '无法解析域名（DNS 错误）',
      summary: '请检查网址拼写是否正确，或确认当前工作区的网络代理节点是否可用。',
      isSslOrConnection: false,
    }
  }
  if (
    errorCode === -130 ||
    errorCode === -131 ||
    errorCode === -136 ||
    errorDescription.includes('ERR_PROXY')
  ) {
    return {
      title: '代理服务器连接失败',
      summary: '当前工作区配置的代理节点无响应或认证失败，请点击地址栏右侧的代理徽章检查或切换节点。',
      isSslOrConnection: false,
    }
  }
  if (errorCode === -102 || errorCode === -100 || errorCode === -101 || errorCode === -118) {
    return {
      title: '无法连接到目标服务器',
      summary: '目标服务器拒绝连接、连接被重置或响应超时。请确认服务已启动或切换当前工作区的网络出口。',
      isSslOrConnection: true,
    }
  }
  return {
    title: '无法访问此网站',
    summary: '页面加载时发生网络错误，请检查网络连接或当前工作区的代理设置后重试。',
    isSslOrConnection: false,
  }
}

export function buildLoadErrorHtml(params: BuildLoadErrorHtmlParams): string {
  const diag = diagnoseChromiumError(params.errorCode, params.errorDescription)
  const safeUrl = escapeHtml(params.url)
  const safeDesc = escapeHtml(params.errorDescription || `CODE_${params.errorCode}`)
  const safeWs = escapeHtml(params.workspaceName)
  const safeProxy = escapeHtml(params.proxyMode)
  const canTryHttp = params.url.startsWith('https://') && diag.isSslOrConnection
  const httpFallback = canTryHttp ? params.url.replace(/^https:\/\//i, 'http://') : ''
  const hasProceedUnsafe = Boolean(params.proceedUnsafeUrl && params.hostname)
  const safeHost = params.hostname ? escapeHtml(params.hostname) : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(diag.title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --primary: #2563eb;
      --primary-fg: #ffffff;
      --pill: #eff6ff;
      --pill-fg: #1d4ed8;
      --warn-bg: #fef2f2;
      --warn-border: #fca5a5;
      --warn-fg: #b91c1c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0d12;
        --card: #151821;
        --text: #f1f5f9;
        --muted: #94a3b8;
        --border: #262b38;
        --primary: #3b82f6;
        --primary-fg: #ffffff;
        --pill: #1e293b;
        --pill-fg: #93c5fd;
        --warn-bg: #2a1215;
        --warn-border: #7f1d1d;
        --warn-fg: #fca5a5;
      }
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .card {
      width: 100%;
      max-width: 580px;
      padding: 28px 32px;
      border-radius: 16px;
      background: var(--card);
      border: 1px solid var(--border);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
    }
    .pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--pill);
      color: var(--pill-fg);
      margin-bottom: 12px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 20px;
    }
    p {
      margin: 0 0 14px;
      line-height: 1.6;
      font-size: 14px;
      color: var(--muted);
    }
    .meta {
      padding: 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
      word-break: break-all;
      margin-bottom: 18px;
      line-height: 1.6;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    button {
      height: 36px;
      padding: 0 16px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    button.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--primary-fg);
    }
    button.unsafe {
      background: var(--warn-bg);
      border-color: var(--warn-border);
      color: var(--warn-fg);
    }
  </style>
</head>
<body>
  <div class="card">
    <span class="pill">Mulspace 网络诊断 · ${safeDesc} (${params.errorCode})</span>
    <h1>${escapeHtml(diag.title)}</h1>
    <p>${escapeHtml(diag.summary)}</p>
    <div class="meta">
      <div><strong>目标地址：</strong>${safeUrl}</div>
      <div><strong>当前工作区：</strong>${safeWs}（代理模式：${safeProxy}）</div>
      ${
        params.certSubject || params.certIssuer
          ? `<div><strong>证书信息：</strong>${escapeHtml(params.certSubject || '-')} / 颁发者：${escapeHtml(params.certIssuer || '-')}</div>`
          : ''
      }
      ${
        hasProceedUnsafe
          ? `<div><strong>隔离说明：</strong>信任该证书仅在当前工作区「${safeWs}」本次会话内生效，不会影响其他账号工作区。</div>`
          : ''
      }
    </div>
    <div class="actions">
      <button class="primary" onclick="window.location.href=${escapeHtml(JSON.stringify(params.url))}">重新加载</button>
      ${
        hasProceedUnsafe
          ? `<button id="wb-proceed-unsafe" class="unsafe" onclick="window.location.href=${escapeHtml(JSON.stringify(params.proceedUnsafeUrl!))}">继续前往 ${safeHost}（不安全）</button>`
          : ''
      }
      ${
        canTryHttp
          ? `<button onclick="window.location.href=${escapeHtml(JSON.stringify(httpFallback))}">尝试改用 HTTP 访问</button>`
          : ''
      }
    </div>
  </div>
</body>
</html>`
}

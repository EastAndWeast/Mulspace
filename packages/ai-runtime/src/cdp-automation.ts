import type { AgentA2UICard, Tab, TabId, WorkspaceId } from '@wb/contracts'

export interface AccessibilityElementRef {
  ref: string
  role: string
  name: string
  value?: string
}

export interface PageSnapshotResult {
  tabId: TabId
  url: string
  title: string
  elements: AccessibilityElementRef[]
  textExcerpt: string
}

export interface ICdpAutomationBridge {
  listWorkspaceTabs(workspaceId: WorkspaceId): Tab[]
  getActiveTabId(workspaceId: WorkspaceId): TabId | null
  getTabWorkspaceId(tabId: TabId): WorkspaceId | undefined
  setTabAiBusy(workspaceId: WorkspaceId, tabId: TabId, busy: boolean): Promise<void> | void
  getAccessibilitySnapshot(tabId: TabId): Promise<PageSnapshotResult>
  clickRef(tabId: TabId, ref: string): Promise<string>
  typeRef(tabId: TabId, ref: string, text: string, submit?: boolean): Promise<string>
  scroll(tabId: TabId, direction: 'up' | 'down', amount?: number): Promise<string>
  navigate(tabId: TabId, url: string): Promise<string>
}

const TAKEOVER_PATTERNS = [
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /verify you are human/i,
  /captcha/i,
  /人机验证/,
  /安全验证/,
  /两步验证/,
  /two-factor/i,
  /\b2fa\b/i,
  /one-time password/i,
  /\botp\b/i,
  /验证码/,
]

export function detectHumanTakeoverNeeded(snapshotText: string): AgentA2UICard | null {
  const matched = TAKEOVER_PATTERNS.find((rx) => rx.test(snapshotText))
  if (!matched) return null

  return {
    surfaceId: `takeover_${Date.now()}`,
    title: '需要人工接管（安全护栏暂停）',
    badge: 'Human-in-the-loop',
    nodes: [
      {
        type: 'text',
        id: 'reason',
        tone: 'body',
        text: '检测到当前页面包含验证码、人机校验或二次验证（2FA）。遵循安全规则，AI 已自动暂停操作，请您在浏览器主窗口手动完成后点击继续。',
      },
      {
        type: 'kv-list',
        id: 'meta',
        items: [{ label: '触发规则', value: matched.source, badge: '安全暂停' }],
      },
      {
        type: 'action-row',
        id: 'actions',
        actions: [{ id: 'resume-after-takeover', label: '我已完成验证，继续分析页面', variant: 'filled' }],
      },
    ],
  }
}

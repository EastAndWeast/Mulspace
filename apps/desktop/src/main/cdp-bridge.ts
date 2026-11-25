import {
  assertSafeAiNavigationUrl,
  type AccessibilityElementRef,
  type ICdpAutomationBridge,
  type PageSnapshotResult,
} from '@wb/ai-runtime'
import type { Tab, TabId, WorkspaceId } from '@wb/contracts'
import type { TabLifecycleManager } from '@wb/tab-lifecycle'
import type { WebContents } from 'electron'
import type { BrowserWindowManager } from './window-manager.js'

export class ElectronCdpAutomationBridge implements ICdpAutomationBridge {
  constructor(
    private readonly tabLifecycle: TabLifecycleManager,
    private readonly windowManager: BrowserWindowManager,
  ) {}

  listWorkspaceTabs(workspaceId: WorkspaceId): Tab[] {
    return this.tabLifecycle.getTabs(workspaceId)
  }

  getActiveTabId(workspaceId: WorkspaceId): TabId | null {
    return this.tabLifecycle.getActiveTabId(workspaceId)
  }

  getTabWorkspaceId(tabId: TabId): WorkspaceId | undefined {
    return this.windowManager.getWorkspaceIdForTab(tabId)
  }

  async setTabAiBusy(workspaceId: WorkspaceId, tabId: TabId, busy: boolean): Promise<void> {
    await this.tabLifecycle.updateTabMeta(workspaceId, tabId, { aiBusy: busy })
  }

  async getAccessibilitySnapshot(tabId: TabId): Promise<PageSnapshotResult> {
    const wc = this.requireWebContents(tabId)
    const url = wc.getURL()
    if (url.toLowerCase().startsWith('file:')) {
      throw new Error('安全护栏拦截：禁止 AI / MCP 读取本地 file:// 文件内容')
    }
    const title = wc.getTitle()

    // Use CDP Accessibility tree when possible, plus interactive DOM ref annotation for click/type
    let cdpHintCount = 0
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
      }
      const ax = (await wc.debugger.sendCommand('Accessibility.getFullAXTree', { depth: 4 })) as {
        nodes?: unknown[]
      }
      cdpHintCount = ax.nodes?.length ?? 0
    } catch {
      // Fallback safely to DOM evaluation if debugger is already attached by DevTools
    }

    const domResult = (await wc.executeJavaScript(`
      (() => {
        const selectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"]';
        const nodes = Array.from(document.querySelectorAll(selectors)).slice(0, 60);
        const elements = [];
        nodes.forEach((el, idx) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          const ref = 'wb_' + (idx + 1);
          el.setAttribute('data-wb-ref', ref);
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim().slice(0, 80);
          elements.push({ ref, role, name, value: 'value' in el ? String(el.value || '').slice(0, 60) : undefined });
        });
        const textExcerpt = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1800);
        return { elements, textExcerpt };
      })();
    `)) as { elements: AccessibilityElementRef[]; textExcerpt: string }

    return {
      tabId,
      url,
      title: cdpHintCount > 0 ? title : title,
      elements: domResult?.elements ?? [],
      textExcerpt: domResult?.textExcerpt ?? '',
    }
  }

  async clickRef(tabId: TabId, ref: string): Promise<string> {
    const wc = this.requireWebContents(tabId)
    const escaped = JSON.stringify(ref)
    const ok = (await wc.executeJavaScript(`
      (() => {
        const el = document.querySelector('[data-wb-ref=' + ${escaped} + ']');
        if (!el) return false;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return true;
      })();
    `)) as boolean
    return ok ? `已点击元素 ${ref}` : `未找到元素 ${ref}（请先重新获取页面快照）`
  }

  async typeRef(tabId: TabId, ref: string, text: string, submit = false): Promise<string> {
    const wc = this.requireWebContents(tabId)
    const escapedRef = JSON.stringify(ref)
    const escapedText = JSON.stringify(text)
    const ok = (await wc.executeJavaScript(`
      (() => {
        const el = document.querySelector('[data-wb-ref=' + ${escapedRef} + ']');
        if (!el) return false;
        el.focus();
        if ('value' in el) {
          el.value = ${escapedText};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.textContent = ${escapedText};
        }
        if (${submit ? 'true' : 'false'} && el.form) {
          el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
        }
        return true;
      })();
    `)) as boolean
    return ok ? `已在 ${ref} 输入文本` : `未找到输入框 ${ref}`
  }

  async scroll(tabId: TabId, direction: 'up' | 'down', amount = 500): Promise<string> {
    const wc = this.requireWebContents(tabId)
    const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount)
    await wc.executeJavaScript(`window.scrollBy({ top: ${delta}, behavior: 'smooth' })`)
    return `已向${direction === 'up' ? '上' : '下'}滚动 ${Math.abs(amount)}px`
  }

  async navigate(tabId: TabId, url: string): Promise<string> {
    const safeUrl = assertSafeAiNavigationUrl(url)
    this.windowManager.navigate(tabId, safeUrl)
    return `正在导航至 ${safeUrl}`
  }

  private requireWebContents(tabId: TabId): WebContents {
    const wc = this.windowManager.getTabWebContents(tabId)
    if (!wc || wc.isDestroyed()) {
      throw new Error(`标签页 ${tabId} 当前处于冻结/已释放状态或已关闭，请先激活后再执行页面自动化。`)
    }
    return wc
  }
}

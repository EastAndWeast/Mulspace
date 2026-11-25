import { describe, expect, it, vi } from 'vitest'
import {
  buildChromeContextMenuTemplate,
  buildPageContextMenuTemplate,
  buildReloadMenuTemplate,
  buildTabContextMenuTemplate,
  type EditFlagsSnapshot,
  type PageContextMenuActions,
} from '../context-menu.js'

const defaultEditFlags: EditFlagsSnapshot = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
}

function makePageActions(): PageContextMenuActions {
  return {
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    hardReload: vi.fn(),
    clearCacheAndReload: vi.fn(),
    openLinkInNewTab: vi.fn(),
    copyText: vi.fn(),
    copyImageAt: vi.fn(),
    downloadUrl: vi.fn(),
    searchSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    pasteAndMatchStyle: vi.fn(),
    deleteSelection: vi.fn(),
    selectAll: vi.fn(),
    toggleMute: vi.fn(),
    print: vi.fn(),
    viewSource: vi.fn(),
    inspectElement: vi.fn(),
  }
}

describe('context-menu builders', () => {
  it('builds blank page menu with navigation, reload/hard-reload, mute, print, source and inspect', () => {
    const actions = makePageActions()
    const items = buildPageContextMenuTemplate(
      {
        canGoBack: true,
        canGoForward: false,
        pageUrl: 'https://example.com/app',
        isEditable: false,
        muted: false,
        editFlags: defaultEditFlags,
      },
      actions,
    )

    const labels = items.map((i) => i.label).filter(Boolean)
    expect(labels).toContain('后退')
    expect(labels).toContain('前进')
    expect(labels).toContain('重新加载')
    expect(labels).toContain('强制刷新（忽略缓存）')
    expect(labels).toContain('清空当前工作区缓存并强制刷新')
    expect(labels).toContain('复制当前页面网址')
    expect(labels).toContain('将此标签页静音')
    expect(labels).toContain('查看页面源代码')
    expect(labels).toContain('检查元素')

    const backItem = items.find((i) => i.label === '后退')
    const fwdItem = items.find((i) => i.label === '前进')
    expect(backItem?.enabled).toBe(true)
    expect(fwdItem?.enabled).toBe(false)

    items.find((i) => i.label === '强制刷新（忽略缓存）')?.click?.({} as never, undefined, {} as never)
    expect(actions.hardReload).toHaveBeenCalledTimes(1)

    items.find((i) => i.label === '查看页面源代码')?.click?.({} as never, undefined, {} as never)
    expect(actions.viewSource).toHaveBeenCalledWith('https://example.com/app')
  })

  it('includes link and image items when right-clicking a linked image', () => {
    const actions = makePageActions()
    const items = buildPageContextMenuTemplate(
      {
        canGoBack: false,
        canGoForward: false,
        pageUrl: 'https://example.com',
        linkURL: 'https://example.com/next',
        srcURL: 'https://example.com/banner.png',
        mediaType: 'image',
        isEditable: false,
        muted: true,
        editFlags: defaultEditFlags,
      },
      actions,
    )

    const labels = items.map((i) => i.label).filter(Boolean)
    expect(labels).toContain('在新标签页中打开链接')
    expect(labels).toContain('复制链接地址')
    expect(labels).toContain('在新标签页中打开图片')
    expect(labels).toContain('复制图片')
    expect(labels).toContain('复制图片地址')
    expect(labels).toContain('图片另存为…')
    expect(labels).toContain('取消标签页静音')

    items.find((i) => i.label === '在新标签页中打开链接')?.click?.({} as never, undefined, {} as never)
    expect(actions.openLinkInNewTab).toHaveBeenCalledWith('https://example.com/next')
  })

  it('includes search action for selected non-editable text and disables view-source on data URLs', () => {
    const actions = makePageActions()
    const items = buildPageContextMenuTemplate(
      {
        canGoBack: false,
        canGoForward: false,
        pageUrl: 'data:text/html,hello',
        selectionText: 'Mulspace multi-account browser testing query',
        isEditable: false,
        muted: false,
        editFlags: defaultEditFlags,
      },
      actions,
    )

    const labels = items.map((i) => i.label).filter(Boolean)
    expect(labels.some((l) => l?.startsWith('使用必应搜索 “Mulspace'))).toBe(true)
    expect(labels).not.toContain('查看页面源代码')
    expect(items.find((i) => i.label === '复制当前页面网址')?.enabled).toBe(false)
  })

  it('includes edit actions when right-clicking editable inputs in page or chrome', () => {
    const pageActions = makePageActions()
    const pageItems = buildPageContextMenuTemplate(
      {
        canGoBack: false,
        canGoForward: false,
        pageUrl: 'https://example.com/form',
        isEditable: true,
        muted: false,
        editFlags: defaultEditFlags,
      },
      pageActions,
    )
    expect(pageItems.map((i) => i.label)).toContain('粘贴为纯文本')

    const chromeEditable = buildChromeContextMenuTemplate(
      { isEditable: true, editFlags: defaultEditFlags },
      {
        undo: vi.fn(),
        redo: vi.fn(),
        cut: vi.fn(),
        copy: vi.fn(),
        paste: vi.fn(),
        selectAll: vi.fn(),
      },
    )
    expect(chromeEditable.map((i) => i.label)).toEqual([
      '撤销',
      '重做',
      undefined,
      '剪切',
      '复制',
      '粘贴',
      '全选',
    ])

    const chromeEmpty = buildChromeContextMenuTemplate(
      { isEditable: false, selectionText: '   ', editFlags: defaultEditFlags },
      {
        undo: vi.fn(),
        redo: vi.fn(),
        cut: vi.fn(),
        copy: vi.fn(),
        paste: vi.fn(),
        selectAll: vi.fn(),
      },
    )
    expect(chromeEmpty).toEqual([])
  })

  it('builds tab context menu and reload menu properly', () => {
    const tabItems = buildTabContextMenuTemplate(
      { pinned: true, muted: true, canClose: false },
      {
        reload: vi.fn(),
        hardReload: vi.fn(),
        clearCacheAndReload: vi.fn(),
        duplicate: vi.fn(),
        togglePin: vi.fn(),
        toggleMute: vi.fn(),
        openDevTools: vi.fn(),
        close: vi.fn(),
      },
    )
    expect(tabItems.map((i) => i.label)).toContain('取消固定标签页')
    expect(tabItems.map((i) => i.label)).toContain('取消标签页静音')
    expect(tabItems.find((i) => i.label === '关闭标签页')?.enabled).toBe(false)

    const reloadItems = buildReloadMenuTemplate({
      reload: vi.fn(),
      hardReload: vi.fn(),
      clearCacheAndReload: vi.fn(),
    })
    expect(reloadItems.map((i) => i.label)).toEqual([
      '正常重新加载',
      '强制刷新（忽略缓存）',
      '清空当前工作区缓存并强制刷新',
    ])
  })
})

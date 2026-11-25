import type { MenuItemConstructorOptions } from 'electron'

export interface EditFlagsSnapshot {
  canUndo: boolean
  canRedo: boolean
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canDelete: boolean
  canSelectAll: boolean
}

export interface PageContextMenuContext {
  canGoBack: boolean
  canGoForward: boolean
  pageUrl: string
  linkURL?: string
  srcURL?: string
  mediaType?: string
  selectionText?: string
  isEditable: boolean
  muted: boolean
  editFlags: EditFlagsSnapshot
}

export interface PageContextMenuActions {
  goBack: () => void
  goForward: () => void
  reload: () => void
  hardReload: () => void
  clearCacheAndReload: () => void
  openLinkInNewTab: (url: string) => void
  copyText: (text: string) => void
  copyImageAt: () => void
  downloadUrl: (url: string) => void
  searchSelection: (text: string) => void
  undo: () => void
  redo: () => void
  cut: () => void
  copy: () => void
  paste: () => void
  pasteAndMatchStyle: () => void
  deleteSelection: () => void
  selectAll: () => void
  toggleMute: () => void
  print: () => void
  viewSource: (url: string) => void
  inspectElement: () => void
}

export interface ChromeContextMenuContext {
  isEditable: boolean
  selectionText?: string
  editFlags: EditFlagsSnapshot
}

export interface ChromeContextMenuActions {
  undo: () => void
  redo: () => void
  cut: () => void
  copy: () => void
  paste: () => void
  selectAll: () => void
}

export interface TabContextMenuContext {
  pinned: boolean
  muted: boolean
  canClose: boolean
}

export interface TabContextMenuActions {
  reload: () => void
  hardReload: () => void
  clearCacheAndReload: () => void
  duplicate: () => void
  togglePin: () => void
  toggleMute: () => void
  openDevTools: () => void
  close: () => void
}

export interface ReloadMenuActions {
  reload: () => void
  hardReload: () => void
  clearCacheAndReload: () => void
}

function appendSection(
  target: MenuItemConstructorOptions[],
  section: MenuItemConstructorOptions[],
): void {
  if (section.length === 0) return
  if (target.length > 0 && target[target.length - 1]?.type !== 'separator') {
    target.push({ type: 'separator' })
  }
  target.push(...section)
}

function truncateSelectionLabel(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized
}

export function buildPageContextMenuTemplate(
  ctx: PageContextMenuContext,
  actions: PageContextMenuActions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []

  if (ctx.linkURL) {
    const linkUrl = ctx.linkURL
    appendSection(items, [
      { label: '在新标签页中打开链接', click: () => actions.openLinkInNewTab(linkUrl) },
      { label: '复制链接地址', click: () => actions.copyText(linkUrl) },
    ])
  }

  if (ctx.mediaType === 'image' && ctx.srcURL) {
    const srcUrl = ctx.srcURL
    appendSection(items, [
      { label: '在新标签页中打开图片', click: () => actions.openLinkInNewTab(srcUrl) },
      { label: '复制图片', click: () => actions.copyImageAt() },
      { label: '复制图片地址', click: () => actions.copyText(srcUrl) },
      { label: '图片另存为…', click: () => actions.downloadUrl(srcUrl) },
    ])
  }

  if (ctx.isEditable) {
    appendSection(items, [
      { label: '撤销', enabled: ctx.editFlags.canUndo, click: () => actions.undo() },
      { label: '重做', enabled: ctx.editFlags.canRedo, click: () => actions.redo() },
      { type: 'separator' },
      { label: '剪切', enabled: ctx.editFlags.canCut, click: () => actions.cut() },
      { label: '复制', enabled: ctx.editFlags.canCopy, click: () => actions.copy() },
      { label: '粘贴', enabled: ctx.editFlags.canPaste, click: () => actions.paste() },
      { label: '粘贴为纯文本', enabled: ctx.editFlags.canPaste, click: () => actions.pasteAndMatchStyle() },
      { label: '删除', enabled: ctx.editFlags.canDelete, click: () => actions.deleteSelection() },
      { label: '全选', enabled: ctx.editFlags.canSelectAll, click: () => actions.selectAll() },
    ])
  } else {
    const trimmedSelection = ctx.selectionText?.trim()
    if (trimmedSelection) {
      appendSection(items, [
        { label: '复制', enabled: ctx.editFlags.canCopy, click: () => actions.copy() },
        {
          label: `使用必应搜索 “${truncateSelectionLabel(trimmedSelection)}”`,
          click: () => actions.searchSelection(trimmedSelection),
        },
      ])
    }
  }

  appendSection(items, [
    { label: '后退', enabled: ctx.canGoBack, click: () => actions.goBack() },
    { label: '前进', enabled: ctx.canGoForward, click: () => actions.goForward() },
    { label: '重新加载', click: () => actions.reload() },
    { label: '强制刷新（忽略缓存）', click: () => actions.hardReload() },
    { label: '清空当前工作区缓存并强制刷新', click: () => actions.clearCacheAndReload() },
  ])

  const canCopyPageUrl = Boolean(ctx.pageUrl && !ctx.pageUrl.startsWith('data:'))
  appendSection(items, [
    {
      label: '复制当前页面网址',
      enabled: canCopyPageUrl,
      click: () => actions.copyText(ctx.pageUrl),
    },
    {
      label: ctx.muted ? '取消标签页静音' : '将此标签页静音',
      click: () => actions.toggleMute(),
    },
    { label: '打印…', click: () => actions.print() },
  ])

  const inspectSection: MenuItemConstructorOptions[] = []
  if (/^https?:\/\//i.test(ctx.pageUrl)) {
    inspectSection.push({
      label: '查看页面源代码',
      click: () => actions.viewSource(ctx.pageUrl),
    })
  }
  inspectSection.push({ label: '检查元素', click: () => actions.inspectElement() })
  appendSection(items, inspectSection)

  return items
}

export function buildChromeContextMenuTemplate(
  ctx: ChromeContextMenuContext,
  actions: ChromeContextMenuActions,
): MenuItemConstructorOptions[] {
  if (ctx.isEditable) {
    return [
      { label: '撤销', enabled: ctx.editFlags.canUndo, click: () => actions.undo() },
      { label: '重做', enabled: ctx.editFlags.canRedo, click: () => actions.redo() },
      { type: 'separator' },
      { label: '剪切', enabled: ctx.editFlags.canCut, click: () => actions.cut() },
      { label: '复制', enabled: ctx.editFlags.canCopy, click: () => actions.copy() },
      { label: '粘贴', enabled: ctx.editFlags.canPaste, click: () => actions.paste() },
      { label: '全选', enabled: ctx.editFlags.canSelectAll, click: () => actions.selectAll() },
    ]
  }
  if (ctx.selectionText?.trim()) {
    return [{ label: '复制', enabled: ctx.editFlags.canCopy, click: () => actions.copy() }]
  }
  return []
}

export function buildTabContextMenuTemplate(
  ctx: TabContextMenuContext,
  actions: TabContextMenuActions,
): MenuItemConstructorOptions[] {
  return [
    { label: '重新加载', click: () => actions.reload() },
    { label: '强制刷新（忽略缓存）', click: () => actions.hardReload() },
    { label: '清空当前工作区缓存并强制刷新', click: () => actions.clearCacheAndReload() },
    { type: 'separator' },
    { label: '复制标签页', click: () => actions.duplicate() },
    { label: ctx.pinned ? '取消固定标签页' : '固定标签页', click: () => actions.togglePin() },
    { label: ctx.muted ? '取消标签页静音' : '将此标签页静音', click: () => actions.toggleMute() },
    { label: '打开开发者工具', click: () => actions.openDevTools() },
    { type: 'separator' },
    { label: '关闭标签页', enabled: ctx.canClose, click: () => actions.close() },
  ]
}

export function buildReloadMenuTemplate(actions: ReloadMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: '正常重新加载', click: () => actions.reload() },
    { label: '强制刷新（忽略缓存）', click: () => actions.hardReload() },
    { label: '清空当前工作区缓存并强制刷新', click: () => actions.clearCacheAndReload() },
  ]
}

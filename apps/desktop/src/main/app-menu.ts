import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { BrowserWindowManager } from './window-manager.js'

export function installApplicationMenu(windowManager: BrowserWindowManager): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Mulspace',
            submenu: [
              { role: 'about', label: '关于 Mulspace' },
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏 Mulspace' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出 Mulspace' },
            ] as MenuItemConstructorOptions[],
          },
        ]
      : []),
    {
      label: '标签页',
      submenu: [
        {
          label: '新建标签页',
          accelerator: 'CmdOrCtrl+T',
          click: () => void windowManager.createTabInFocusedWindow(),
        },
        {
          label: '关闭当前标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => void windowManager.closeFocusedTab(),
        },
        {
          label: '新建窗口',
          accelerator: 'CmdOrCtrl+N',
          click: () => void windowManager.createBrowserWindow(),
        },
        ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const, label: '退出' }] : []),
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => windowManager.reloadFocusedTab(false),
        },
        {
          label: '强制刷新（忽略缓存）',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => windowManager.reloadFocusedTab(true),
        },
        {
          label: '清空当前工作区缓存并强制刷新',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => void windowManager.clearCacheAndReloadFocusedTab(),
        },
        { type: 'separator' },
        {
          label: '聚焦地址栏',
          accelerator: 'CmdOrCtrl+L',
          click: () => windowManager.focusFocusedOmnibox(),
        },
        {
          label: '后退',
          accelerator: 'CmdOrCtrl+[',
          click: () => windowManager.goBackFocusedTab(),
        },
        {
          label: '前进',
          accelerator: 'CmdOrCtrl+]',
          click: () => windowManager.goForwardFocusedTab(),
        },
        { type: 'separator' },
        {
          label: '实际大小',
          accelerator: 'CmdOrCtrl+0',
          click: () => windowManager.adjustZoomFocusedTab('reset'),
        },
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+=',
          click: () => windowManager.adjustZoomFocusedTab('in'),
        },
        {
          label: '缩小',
          accelerator: 'CmdOrCtrl+-',
          click: () => windowManager.adjustZoomFocusedTab('out'),
        },
        { type: 'separator' },
        {
          label: '静音 / 取消静音当前标签页',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => void windowManager.toggleMuteFocusedTab(),
        },
        {
          label: '开发者工具',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => windowManager.openDevToolsFocusedTab(),
        },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(isMac ? [{ role: 'zoom' as const, label: '缩放' }] : []),
        { role: 'close', label: '关闭窗口' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

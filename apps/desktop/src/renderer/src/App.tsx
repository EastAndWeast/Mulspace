import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NEW_TAB_URL } from '@wb/contracts'
import type {
  AgentMessage,
  BrowserWindowSnapshot,
  SkillDefinition,
  Tab,
  Workspace,
} from '@wb/contracts'
import { A2UISurface, Button, IconButton, ThemeProvider } from '@wb/ui-kit'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Code2,
  Compass,
  ExternalLink,
  Globe,
  Lock,
  Moon,
  Network,
  PanelRight,
  Pin,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Snowflake,
  TerminalSquare,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { AiHubDialog } from './components/AiHubDialog.js'
import { ExtensionsDialog } from './components/ExtensionsDialog.js'
import { NewTabPage } from './components/NewTabPage.js'
import { ProxyManagerDialog } from './components/ProxyManagerDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { WorkspaceEditorDialog } from './components/WorkspaceEditorDialog.js'
import { WorkspaceGlyph } from './components/WorkspaceGlyph.js'
import brandIcon from '../../../build/icon.svg'

function TabSymbol({ tab }: { tab: Tab }) {
  const [faviconFailedUrl, setFaviconFailedUrl] = useState<string | null>(null)

  if (tab.loading) {
    return <span className="wb-tab__spinner" />
  }
  if (tab.url === NEW_TAB_URL) {
    return <Compass size={13} strokeWidth={1.75} />
  }
  if (tab.faviconUrl && faviconFailedUrl !== tab.faviconUrl) {
    return (
      <img
        className="wb-tab__favicon"
        src={tab.faviconUrl}
        alt=""
        onError={() => setFaviconFailedUrl(tab.faviconUrl ?? null)}
      />
    )
  }
  return <Globe size={13} strokeWidth={1.75} />
}

export function App() {
  const [snapshot, setSnapshot] = useState<BrowserWindowSnapshot | null>(null)
  const [addressInput, setAddressInput] = useState('')
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false)
  const [wsDialogOpen, setWsDialogOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false)
  const [extDialogOpen, setExtDialogOpen] = useState(false)
  const [aiHubOpen, setAiHubOpen] = useState(false)

  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([])
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [chatPrompt, setChatPrompt] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const omniboxRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void window.browserApi.getState().then(setSnapshot)
    return window.browserApi.onStateUpdated(setSnapshot)
  }, [])

  useEffect(() => {
    return window.browserApi.onFocusOmnibox(() => {
      omniboxRef.current?.focus()
      omniboxRef.current?.select()
    })
  }, [])

  const activeWorkspace = useMemo(() => {
    if (!snapshot) return null
    return (
      snapshot.workspaces.find((w) => w.id === snapshot.activeWorkspaceId) ??
      snapshot.workspaces[0] ??
      null
    )
  }, [snapshot])

  const workspaceTabs: Tab[] = useMemo(() => {
    if (!snapshot || !activeWorkspace) return []
    return snapshot.tabsByWorkspace[activeWorkspace.id] ?? []
  }, [snapshot, activeWorkspace])

  const activeTab: Tab | null = useMemo(() => {
    if (!activeWorkspace || workspaceTabs.length === 0) return null
    return (
      (snapshot?.activeTabId ? workspaceTabs.find((t) => t.id === snapshot.activeTabId) : undefined) ??
      workspaceTabs.find((t) => t.state === 'active') ??
      workspaceTabs.find((t) => t.id === activeWorkspace.activeTabId) ??
      workspaceTabs[0] ??
      null
    )
  }, [activeWorkspace, workspaceTabs, snapshot?.activeTabId])

  useEffect(() => {
    if (activeTab && document.activeElement !== omniboxRef.current) {
      setAddressInput(activeTab.url === NEW_TAB_URL ? '' : activeTab.url)
    }
  }, [activeTab?.id, activeTab?.url])

  useEffect(() => {
    if (!activeWorkspace) return
    void window.browserApi.getAgentMessages(activeWorkspace.id).then(setAgentMessages)
    void window.browserApi.listSkills(activeWorkspace.id).then(setSkills)
  }, [activeWorkspace?.id, snapshot?.aiMessageSeq])

  const syncViewportBounds = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    void window.browserApi.setViewportBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    syncViewportBounds()
    const observer = new ResizeObserver(() => syncViewportBounds())
    observer.observe(el)
    window.addEventListener('resize', syncViewportBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncViewportBounds)
    }
  }, [syncViewportBounds, aiSidebarOpen, snapshot?.settings.themeId])

  const anyModalOpen = wsDialogOpen || settingsOpen || proxyDialogOpen || extDialogOpen || aiHubOpen
  useEffect(() => {
    void window.browserApi.setOverlayOpen(anyModalOpen)
  }, [anyModalOpen])

  if (!snapshot || !activeWorkspace) {
    return (
      <div className="wb-launch" role="status">
        <img src={brandIcon} width="32" height="32" alt="" />
        <span>正在启动 Mulspace…</span>
      </div>
    )
  }

  const dynamicSeed = snapshot.settings.followWorkspaceColor
    ? activeWorkspace.seedColor
    : snapshot.settings.customSeedColor

  const showNewTab = activeTab?.url === NEW_TAB_URL
  const openWorkspaceEditor = (workspace: Workspace | null): void => {
    setEditingWorkspace(workspace)
    setWsDialogOpen(true)
  }
  const navigate = (input: string): void => {
    if (!activeTab || !input.trim()) return
    omniboxRef.current?.blur()
    void window.browserApi.navigateTab(activeWorkspace.id, activeTab.id, input)
  }

  const wsProxyStatus = snapshot.proxyStatus.workspaceStatuses[activeWorkspace.id]
  const proxyLabel =
    wsProxyStatus?.mode === 'managed-node' && wsProxyStatus.nodeName
      ? `${wsProxyStatus.nodeName}${wsProxyStatus.latencyMs ? ` · ${wsProxyStatus.latencyMs}ms` : ''}`
      : wsProxyStatus?.mode === 'custom'
        ? '自定义代理'
        : wsProxyStatus?.mode === 'system'
          ? '系统代理'
          : '直连'

  const activeWorkspaceExtensions = snapshot.extensions.filter((ext) => {
    if (ext.disabledWorkspaces.includes(activeWorkspace.id)) return false
    if (ext.enabledWorkspaces.includes(activeWorkspace.id)) return true
    return ext.enabledGlobally
  })

  const trimmedAddress = addressInput.trim()
  const isSecureHttps = !showNewTab && /^https:\/\//i.test(trimmedAddress)
  const isNavUrl = !showNewTab && /^[a-z][a-z\d+\-.]*:/i.test(trimmedAddress)

  const handleNavigateSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    navigate(addressInput)
  }

  const handleSendChat = async (promptText: string): Promise<void> => {
    if (!promptText.trim() || agentBusy) return
    setAgentBusy(true)
    setChatPrompt('')
    try {
      const updated = await window.browserApi.sendAgentMessage(activeWorkspace.id, promptText.trim())
      setAgentMessages(updated)
    } finally {
      setAgentBusy(false)
    }
  }

  return (
    <ThemeProvider
      themeId={snapshot.settings.themeId}
      mode={snapshot.settings.themeMode}
      themes={snapshot.themes}
      seedColorOverride={dynamicSeed}
    >
      <div className="wb-shell">
        <aside className="wb-rail" aria-label="账号工作区栏">
          <button
            type="button"
            className="wb-rail__brand"
            title="Mulspace · 新建标签页"
            aria-label="打开 Mulspace 新标签页"
            onClick={() => void window.browserApi.createTab(activeWorkspace.id)}
          >
            <img src={brandIcon} width="32" height="32" alt="" />
          </button>

          <div className="wb-rail__list">
            {snapshot.workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspace.id
              const tabCount = (snapshot.tabsByWorkspace[ws.id] ?? []).length
              return (
                <div
                  key={ws.id}
                  className={`wb-rail__item-wrap ${isActive ? 'wb-rail__item-wrap--active' : ''}`}
                  style={{ '--ws-accent': ws.seedColor } as CSSProperties}
                >
                  <span className="wb-rail__indicator" aria-hidden="true" />
                  <button
                    type="button"
                    className={`wb-rail__item ${isActive ? 'wb-rail__item--active' : ''}`}
                    aria-current={isActive ? true : undefined}
                    aria-label={ws.name}
                    title={`${ws.name}（${tabCount} 个标签）· 右键编辑`}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !isActive) {
                        void window.browserApi.switchWorkspace(ws.id)
                      }
                    }}
                    onClick={() => {
                      if (!isActive) {
                        void window.browserApi.switchWorkspace(ws.id)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openWorkspaceEditor(ws)
                    }}
                  >
                    <WorkspaceGlyph value={ws.icon} size={18} />
                  </button>
                  <span className="wb-rail__label">{ws.name}</span>
                </div>
              )
            })}

            <IconButton
              className="wb-rail__add"
              title="新建独立账号工作区"
              onClick={() => openWorkspaceEditor(null)}
            >
              <Plus size={17} />
            </IconButton>
          </div>

          <div className="wb-rail__tools">
            <IconButton
              title="在新窗口打开当前工作区"
              onClick={() => void window.browserApi.openWorkspaceInNewWindow(activeWorkspace.id)}
            >
              <ExternalLink size={16} />
            </IconButton>
            <IconButton title="网络代理配置" onClick={() => setProxyDialogOpen(true)}>
              <Network size={16} />
            </IconButton>
            <IconButton title="扩展程序管理" onClick={() => setExtDialogOpen(true)}>
              <Puzzle size={16} />
            </IconButton>
            <IconButton title="AI 与 MCP 中心" onClick={() => setAiHubOpen(true)}>
              <TerminalSquare size={16} />
            </IconButton>
            <IconButton
              title="编辑当前工作区"
              onClick={() => openWorkspaceEditor(activeWorkspace)}
            >
              <SlidersHorizontal size={16} />
            </IconButton>
            <IconButton title="浏览器设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
            </IconButton>
          </div>
        </aside>

        {/* Main Browser Chrome & Viewport */}
        <div className="wb-main-column">
          <div className="wb-tabbar" role="tablist" aria-label="当前工作区标签页">
            {workspaceTabs.map((tab) => {
              const isTabActive = activeTab?.id === tab.id
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={isTabActive}
                  className={`wb-tab ${isTabActive ? 'wb-tab--active' : ''}`}
                  onMouseDown={(e) => {
                    if (e.button === 0 && !isTabActive) {
                      void window.browserApi.activateTab(activeWorkspace.id, tab.id)
                    }
                  }}
                  onClick={() => {
                    if (!isTabActive) {
                      void window.browserApi.activateTab(activeWorkspace.id, tab.id)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void window.browserApi.showTabContextMenu(activeWorkspace.id, tab.id)
                  }}
                >
                  <span className="wb-tab__symbol" aria-hidden="true">
                    <TabSymbol tab={tab} />
                  </span>
                  {tab.pinned ? <Pin size={11} className="wb-tab__meta-icon" /> : null}
                  {tab.aiBusy ? <Bot size={12} className="wb-tab__meta-icon" /> : null}
                  {tab.muted || tab.audible ? (
                    <button
                      type="button"
                      className="wb-tab__audio"
                      title={tab.muted ? '取消静音' : '静音此标签页'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.browserApi.toggleMuteTab(activeWorkspace.id, tab.id)
                      }}
                    >
                      {tab.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                  ) : null}
                  {tab.state === 'frozen' ? (
                    <span className="wb-tab__meta-icon" title="后台休眠中（保留状态）">
                      <Snowflake size={11} />
                    </span>
                  ) : null}
                  {tab.state === 'discarded' ? (
                    <span className="wb-tab__meta-icon" title="已释放内存（点击恢复）">
                      <Moon size={11} />
                    </span>
                  ) : null}
                  <span className="wb-tab__title">
                    {tab.url === NEW_TAB_URL ? '新标签页' : tab.title || tab.url}
                  </span>
                  <button
                    type="button"
                    className="wb-tab__close"
                    title="关闭标签"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.browserApi.closeTab(activeWorkspace.id, tab.id)
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
            <IconButton
              className="wb-tabbar__add"
              title="新建标签页 (⌘T)"
              onClick={() => void window.browserApi.createTab(activeWorkspace.id)}
            >
              <Plus size={15} />
            </IconButton>
          </div>

          <div className="wb-toolbar">
            <div className="wb-toolbar__nav">
              <IconButton
                title="后退"
                disabled={!activeTab?.canGoBack}
                onClick={() =>
                  activeTab && void window.browserApi.goBack(activeWorkspace.id, activeTab.id)
                }
              >
                <ArrowLeft size={16} />
              </IconButton>
              <IconButton
                title="前进"
                disabled={!activeTab?.canGoForward}
                onClick={() =>
                  activeTab && void window.browserApi.goForward(activeWorkspace.id, activeTab.id)
                }
              >
                <ArrowRight size={16} />
              </IconButton>
              <IconButton
                title="刷新（Shift+点击或右键强制刷新）"
                disabled={!activeTab}
                onClick={(e) =>
                  activeTab && void window.browserApi.reloadTab(activeWorkspace.id, activeTab.id, e.shiftKey)
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (activeTab) {
                    void window.browserApi.showReloadMenu(activeWorkspace.id, activeTab.id)
                  }
                }}
              >
                <RotateCw size={15} />
              </IconButton>
            </div>

            <form onSubmit={handleNavigateSubmit} className="wb-address">
              <span className="wb-address__icon" aria-hidden="true">
                {isSecureHttps ? (
                  <Lock size={13} strokeWidth={1.8} className="wb-address__secure" />
                ) : isNavUrl ? (
                  <Globe size={14} strokeWidth={1.7} />
                ) : (
                  <Search size={14} strokeWidth={1.7} />
                )}
              </span>
              <input
                ref={omniboxRef}
                className="wb-omnibox"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="输入网址或搜索…"
                aria-label="地址栏"
                spellCheck={false}
              />
            </form>

            <div className="wb-toolbar__meta">
              <button
                type="button"
                className="wb-toolbar-chip wb-toolbar-chip--workspace"
                title={`当前工作区：${activeWorkspace.name}（分区 ${activeWorkspace.partition}）`}
                onClick={() => openWorkspaceEditor(activeWorkspace)}
              >
                <span className="wb-toolbar-chip__dot" style={{ backgroundColor: activeWorkspace.seedColor }} />
                <span>{activeWorkspace.name}</span>
              </button>

              <button
                type="button"
                className="wb-toolbar-chip wb-toolbar-chip--proxy"
                title={`当前代理：${proxyLabel} · 点击配置`}
                onClick={() => setProxyDialogOpen(true)}
              >
                <Network size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>{proxyLabel}</span>
              </button>

              {snapshot.updateState.status === 'available' ? (
                <button
                  type="button"
                  className="wb-toolbar-update"
                  title="查看新版本更新"
                  onClick={() => setSettingsOpen(true)}
                >
                  <span>v{snapshot.updateState.latestVersion}</span>
                  <ArrowUpRight size={12} strokeWidth={1.9} aria-hidden="true" />
                </button>
              ) : null}

              {activeWorkspaceExtensions.slice(0, 3).map((ext) => (
                <IconButton
                  key={ext.id}
                  title={ext.name}
                  onClick={() =>
                    ext.popupPath
                      ? void window.browserApi.openExtensionPopup(activeWorkspace.id, ext.id)
                      : setExtDialogOpen(true)
                  }
                >
                  <Puzzle size={14} />
                </IconButton>
              ))}

              <IconButton
                title={activeTab?.pinned ? '取消固定标签' : '固定当前标签'}
                active={activeTab?.pinned}
                disabled={!activeTab}
                onClick={() =>
                  activeTab && void window.browserApi.togglePinTab(activeWorkspace.id, activeTab.id)
                }
              >
                <Pin size={15} />
              </IconButton>

              <IconButton
                title="开发者工具"
                disabled={!activeTab}
                onClick={() =>
                  activeTab && void window.browserApi.openDevTools(activeWorkspace.id, activeTab.id)
                }
              >
                <Code2 size={15} />
              </IconButton>

              <IconButton
                title="AI 助手侧边栏"
                active={aiSidebarOpen}
                onClick={() => setAiSidebarOpen((prev) => !prev)}
              >
                <PanelRight size={16} />
              </IconButton>
            </div>
          </div>

          <div className="wb-content-row">
            <div ref={viewportRef} className="wb-viewport-slot">
              {showNewTab ? (
                <NewTabPage
                  key={activeTab.id}
                  workspace={activeWorkspace}
                  workspaces={snapshot.workspaces}
                  tabsByWorkspace={snapshot.tabsByWorkspace}
                  proxyLabel={proxyLabel}
                  onNavigate={navigate}
                  onSwitchWorkspace={(id) => void window.browserApi.switchWorkspace(id)}
                  onCreateWorkspace={() => openWorkspaceEditor(null)}
                />
              ) : null}
            </div>

            {aiSidebarOpen ? (
              <aside className="wb-sidebar" aria-label="工作区 AI 助手侧边栏">
                <div className="wb-sidebar__header">
                  <div className="wb-sidebar__identity">
                    <strong>浏览助手</strong>
                    <span>
                      <i className="wb-sidebar__ws-dot" style={{ backgroundColor: activeWorkspace.seedColor }} />
                      {activeWorkspace.name}
                    </span>
                  </div>
                  <div className="wb-sidebar__actions">
                    <IconButton title="AI / MCP 配置" onClick={() => setAiHubOpen(true)}>
                      <SlidersHorizontal size={14} />
                    </IconButton>
                    <IconButton
                      title="清空对话"
                      onClick={() =>
                        void window.browserApi
                          .clearAgentMessages(activeWorkspace.id)
                          .then(() => setAgentMessages([]))
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                    <IconButton title="收起侧边栏" onClick={() => setAiSidebarOpen(false)}>
                      <X size={15} />
                    </IconButton>
                  </div>
                </div>

                {skills.length > 0 ? (
                  <div className="wb-sidebar__skills">
                    {skills.slice(0, 4).map((skill) => (
                      <Button
                        key={skill.id}
                        variant="outlined"
                        disabled={agentBusy}
                        onClick={async () => {
                          setAgentBusy(true)
                          try {
                            const updated = await window.browserApi.runSkill(activeWorkspace.id, skill.id)
                            setAgentMessages(updated)
                          } finally {
                            setAgentBusy(false)
                          }
                        }}
                      >
                        {skill.name}
                      </Button>
                    ))}
                  </div>
                ) : null}

                <div className="wb-sidebar__messages">
                  {agentMessages.length === 0 ? (
                    <div className="wb-sidebar__empty">
                      <strong>围绕当前页面提问</strong>
                      <p>对话与上下文仅限「{activeWorkspace.name}」工作区。</p>
                      <div className="wb-sidebar__empty-actions">
                        <Button
                          variant="tonal"
                          onClick={() => void handleSendChat('请读取并总结当前页面内容，检查工作区环境')}
                        >
                          总结当前页
                        </Button>
                        <Button variant="text" onClick={() => setAiHubOpen(true)}>
                          模型与 MCP
                        </Button>
                      </div>
                    </div>
                  ) : (
                    agentMessages.map((msg) => (
                      <div key={msg.id} className="wb-sidebar__msg-group">
                        <div
                          className={`wb-sidebar__msg ${
                            msg.role === 'user' ? 'wb-sidebar__msg--user' : 'wb-sidebar__msg--assistant'
                          }`}
                        >
                          {msg.content}
                        </div>
                        {msg.a2uiCard ? (
                          <A2UISurface
                            schema={msg.a2uiCard}
                            onAction={(act) => {
                              if (act === 'open-ai-hub') setAiHubOpen(true)
                              if (act === 'resume-after-takeover') {
                                void handleSendChat('我已完成人工验证，请继续读取当前页面。')
                              }
                            }}
                          />
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <form
                  className="wb-sidebar__composer"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSendChat(chatPrompt)
                  }}
                >
                  <input
                    className="wb-omnibox"
                    value={chatPrompt}
                    disabled={agentBusy}
                    onChange={(e) => setChatPrompt(e.target.value)}
                    aria-label="给浏览助手发消息"
                    placeholder={agentBusy ? '正在思考…' : '围绕当前页提问…'}
                  />
                  <IconButton type="submit" disabled={agentBusy || !chatPrompt.trim()} title="发送">
                    <Send size={14} />
                  </IconButton>
                </form>
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      <WorkspaceEditorDialog
        open={wsDialogOpen}
        workspace={editingWorkspace}
        canDelete={snapshot.workspaces.length > 1}
        onClose={() => setWsDialogOpen(false)}
        onCreate={async (input) => {
          await window.browserApi.createWorkspace(input)
        }}
        onUpdate={async (wsId, input) => {
          await window.browserApi.updateWorkspace(wsId, input)
        }}
        onDelete={async (wsId) => {
          await window.browserApi.deleteWorkspace(wsId)
        }}
      />

      <ProxyManagerDialog
        open={proxyDialogOpen}
        workspace={activeWorkspace}
        proxyStatus={snapshot.proxyStatus}
        subscriptions={snapshot.proxySubscriptions}
        nodes={snapshot.proxyNodes}
        defaultBinaryPath={snapshot.settings.proxyCoreBinaryPath}
        onClose={() => setProxyDialogOpen(false)}
        onImport={async (input) => {
          await window.browserApi.importProxySubscription(input)
        }}
        onDeleteSubscription={async (subId) => {
          await window.browserApi.deleteProxySubscription(subId)
        }}
        onTestLatency={async (nodeId) => {
          await window.browserApi.testProxyNodeLatency(nodeId)
        }}
        onSetWorkspaceProxy={async (wsId, binding) => {
          await window.browserApi.setWorkspaceProxy(wsId, binding)
        }}
        onSetBinaryPath={async (p) => {
          await window.browserApi.setProxyBinaryPath(p)
        }}
      />

      <ExtensionsDialog
        open={extDialogOpen}
        workspace={activeWorkspace}
        extensions={snapshot.extensions}
        onClose={() => setExtDialogOpen(false)}
        onInstallFolder={async () => {
          const folder = await window.browserApi.pickExtensionFolder()
          if (folder) await window.browserApi.installExtensionFromFolder(folder)
        }}
        onInstallCrx={async () => {
          const file = await window.browserApi.pickCrxFile()
          if (file) await window.browserApi.installExtensionFromCrx(file)
        }}
        onToggleForWorkspace={async (extId, wsId, enabled) => {
          await window.browserApi.toggleExtensionForWorkspace(extId, wsId, enabled)
        }}
        onOpenPopup={async (wsId, extId) => {
          await window.browserApi.openExtensionPopup(wsId, extId)
        }}
        onRemove={async (extId) => {
          await window.browserApi.removeExtension(extId)
        }}
      />

      <AiHubDialog
        open={aiHubOpen}
        workspaces={snapshot.workspaces}
        activeWorkspace={activeWorkspace}
        settings={snapshot.settings}
        mcpHostStatus={snapshot.mcpHostStatus}
        onClose={() => setAiHubOpen(false)}
        onUpdateSettings={async (patch) => {
          await window.browserApi.updateSettings(patch)
        }}
        onRunSkillInWorkspace={async (skillId) => {
          setAiSidebarOpen(true)
          const updated = await window.browserApi.runSkill(activeWorkspace.id, skillId)
          setAgentMessages(updated)
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={snapshot.settings}
        themes={snapshot.themes}
        memorySummary={snapshot.memorySummary}
        updateState={snapshot.updateState}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={async (patch) => {
          await window.browserApi.updateSettings(patch)
        }}
        onSweepMemory={async () => {
          await window.browserApi.sweepMemoryNow()
        }}
        onCheckForUpdates={async () => {
          await window.browserApi.checkForUpdates()
        }}
        onOpenUpdateDownload={async () => {
          await window.browserApi.openUpdateDownload()
        }}
      />
    </ThemeProvider>
  )
}

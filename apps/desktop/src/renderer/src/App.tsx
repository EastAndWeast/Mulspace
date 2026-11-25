import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentMessage,
  BrowserWindowSnapshot,
  SkillDefinition,
  Tab,
  Workspace,
} from '@wb/contracts'
import { A2UISurface, Badge, Button, IconButton, ThemeProvider } from '@wb/ui-kit'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Code2,
  ExternalLink,
  Globe,
  Moon,
  Palette,
  Pin,
  Plus,
  Puzzle,
  RotateCw,
  Send,
  Settings,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { AiHubDialog } from './components/AiHubDialog.js'
import { ExtensionsDialog } from './components/ExtensionsDialog.js'
import { ProxyManagerDialog } from './components/ProxyManagerDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { WorkspaceEditorDialog } from './components/WorkspaceEditorDialog.js'

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

  useEffect(() => {
    void window.browserApi.getState().then(setSnapshot)
    return window.browserApi.onStateUpdated(setSnapshot)
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
      workspaceTabs.find((t) => t.state === 'active') ??
      workspaceTabs.find((t) => t.id === activeWorkspace.activeTabId) ??
      workspaceTabs[0] ??
      null
    )
  }, [activeWorkspace, workspaceTabs])

  useEffect(() => {
    if (activeTab) {
      setAddressInput(activeTab.url)
    }
  }, [activeTab?.id, activeTab?.url])

  useEffect(() => {
    if (!activeWorkspace) return
    void window.browserApi.getAgentMessages(activeWorkspace.id).then(setAgentMessages)
    void window.browserApi.listSkills(activeWorkspace.id).then(setSkills)
  }, [activeWorkspace?.id])

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
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>正在初始化 WorkspaceBrowser 内核...</div>
    )
  }

  const dynamicSeed = snapshot.settings.followWorkspaceColor
    ? activeWorkspace.seedColor
    : snapshot.settings.customSeedColor

  const wsProxyStatus = snapshot.proxyStatus.workspaceStatuses[activeWorkspace.id]
  const proxyLabel =
    wsProxyStatus?.mode === 'managed-node' && wsProxyStatus.nodeName
      ? `代理: ${wsProxyStatus.nodeName}${wsProxyStatus.latencyMs ? ` · ${wsProxyStatus.latencyMs}ms` : ''}`
      : wsProxyStatus?.mode === 'custom'
        ? '代理: 自定义节点'
        : wsProxyStatus?.mode === 'system'
          ? '代理: 跟随系统'
          : '代理: 直连'

  const activeWorkspaceExtensions = snapshot.extensions.filter((ext) => {
    if (ext.disabledWorkspaces.includes(activeWorkspace.id)) return false
    if (ext.enabledWorkspaces.includes(activeWorkspace.id)) return true
    return ext.enabledGlobally
  })

  const handleNavigateSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!activeTab) return
    void window.browserApi.navigateTab(activeWorkspace.id, activeTab.id, addressInput)
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
      seedColorOverride={dynamicSeed}
    >
      <div className="wb-shell">
        {/* Left Vivaldi-style Workspace Rail */}
        <aside className="wb-rail" aria-label="账号工作区栏">
          <div className="wb-rail__list">
            {snapshot.workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspace.id
              const tabCount = (snapshot.tabsByWorkspace[ws.id] ?? []).length
              return (
                <div key={ws.id} className="wb-rail__item-wrap">
                  <button
                    type="button"
                    className={`wb-rail__item ${isActive ? 'wb-rail__item--active' : ''}`}
                    style={{ borderColor: isActive ? ws.seedColor : undefined }}
                    title={`${ws.name} (${tabCount} 个标签) — 右键编辑`}
                    onClick={() => void window.browserApi.switchWorkspace(ws.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setEditingWorkspace(ws)
                      setWsDialogOpen(true)
                    }}
                  >
                    {isActive ? (
                      <span className="wb-rail__dot" style={{ backgroundColor: ws.seedColor }} />
                    ) : null}
                    <span>{ws.icon}</span>
                  </button>
                  <span className="wb-rail__label">{ws.name}</span>
                </div>
              )
            })}

            <IconButton
              title="新建独立账号工作区"
              onClick={() => {
                setEditingWorkspace(null)
                setWsDialogOpen(true)
              }}
            >
              <Plus size={18} />
            </IconButton>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <IconButton
              title="在新窗口打开当前工作区（多开）"
              onClick={() => void window.browserApi.openWorkspaceInNewWindow(activeWorkspace.id)}
            >
              <ExternalLink size={16} />
            </IconButton>
            <IconButton title="网络代理配置 (Clash / V2Ray)" onClick={() => setProxyDialogOpen(true)}>
              <Globe size={16} />
            </IconButton>
            <IconButton title="Chrome 扩展管理" onClick={() => setExtDialogOpen(true)}>
              <Puzzle size={16} />
            </IconButton>
            <IconButton title="AI 模型 / Skills / MCP / 批量任务" onClick={() => setAiHubOpen(true)}>
              <Sparkles size={16} />
            </IconButton>
            <IconButton
              title="编辑当前工作区"
              onClick={() => {
                setEditingWorkspace(activeWorkspace)
                setWsDialogOpen(true)
              }}
            >
              <Settings size={16} />
            </IconButton>
            <IconButton title="主题与内存调度设置" onClick={() => setSettingsOpen(true)}>
              <Palette size={16} />
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
                  onClick={() => void window.browserApi.activateTab(activeWorkspace.id, tab.id)}
                >
                  {tab.pinned ? <Pin size={12} /> : null}
                  {tab.aiBusy ? <Bot size={12} /> : null}
                  {tab.state === 'frozen' ? (
                    <span title="轻量冻结中（保留 DOM）">
                      <Snowflake size={12} />
                    </span>
                  ) : null}
                  {tab.state === 'discarded' ? (
                    <span title="已深度释放内存（点击恢复）">
                      <Moon size={12} />
                    </span>
                  ) : null}
                  <span className="wb-tab__title">
                    {tab.loading ? '加载中… ' : ''}
                    {tab.title || tab.url}
                  </span>
                  <button
                    type="button"
                    className="wb-tab__close"
                    title="关闭标签"
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
              title="新建标签页"
              onClick={() => void window.browserApi.createTab(activeWorkspace.id)}
            >
              <Plus size={15} />
            </IconButton>
          </div>

          <div className="wb-toolbar">
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
              title="刷新"
              disabled={!activeTab}
              onClick={() =>
                activeTab && void window.browserApi.reloadTab(activeWorkspace.id, activeTab.id)
              }
            >
              <RotateCw size={15} />
            </IconButton>

            <form onSubmit={handleNavigateSubmit} style={{ flex: 1, display: 'flex' }}>
              <input
                className="wb-omnibox"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="输入网址或搜索关键词..."
                aria-label="地址栏"
              />
            </form>

            <Badge
              tone="primary"
              style={{ cursor: 'pointer' }}
              title={`存储分区: ${activeWorkspace.partition}`}
              onClick={() => {
                setEditingWorkspace(activeWorkspace)
                setWsDialogOpen(true)
              }}
            >
              <ShieldCheck size={12} />
              <span>
                {activeWorkspace.icon} {activeWorkspace.name}
              </span>
            </Badge>

            <Badge
              style={{ cursor: 'pointer' }}
              title="点击配置当前工作区代理节点"
              onClick={() => setProxyDialogOpen(true)}
            >
              <Globe size={11} />
              <span>{proxyLabel}</span>
            </Badge>

            {snapshot.updateState.status === 'available' ? (
              <Badge
                tone="primary"
                style={{ cursor: 'pointer' }}
                title="点击查看更新详情并下载"
                onClick={() => setSettingsOpen(true)}
              >
                新版本 v{snapshot.updateState.latestVersion}
              </Badge>
            ) : null}

            {activeWorkspaceExtensions.slice(0, 3).map((ext) => (
              <IconButton
                key={ext.id}
                title={`扩展：${ext.name}`}
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
              title="切换固定当前标签"
              active={activeTab?.pinned}
              disabled={!activeTab}
              onClick={() =>
                activeTab && void window.browserApi.togglePinTab(activeWorkspace.id, activeTab.id)
              }
            >
              <Pin size={15} />
            </IconButton>

            <IconButton
              title="打开当前标签 DevTools"
              disabled={!activeTab}
              onClick={() =>
                activeTab && void window.browserApi.openDevTools(activeWorkspace.id, activeTab.id)
              }
            >
              <Code2 size={15} />
            </IconButton>

            <IconButton
              title="工作区隔离 AI Agent 侧边栏"
              active={aiSidebarOpen}
              onClick={() => setAiSidebarOpen((prev) => !prev)}
            >
              <Bot size={16} />
            </IconButton>
          </div>

          <div className="wb-content-row">
            <div ref={viewportRef} className="wb-viewport-slot">
              <span style={{ fontSize: 12, color: 'var(--wb-sys-color-on-surface-variant)' }}>
                正在承载工作区「{activeWorkspace.name}」的独立渲染视图…
              </span>
            </div>

            {aiSidebarOpen ? (
              <aside className="wb-sidebar" aria-label="工作区 AI 助手侧边栏">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>
                    {activeWorkspace.icon} {activeWorkspace.name} · 隔离 Agent
                  </strong>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <IconButton title="AI / Skills / MCP 中心" onClick={() => setAiHubOpen(true)}>
                      <Sparkles size={14} />
                    </IconButton>
                    <IconButton
                      title="清空本空间对话"
                      onClick={() =>
                        void window.browserApi
                          .clearAgentMessages(activeWorkspace.id)
                          .then(() => setAgentMessages([]))
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>

                {/* Quick Skills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {skills.slice(0, 4).map((skill) => (
                    <Button
                      key={skill.id}
                      variant="tonal"
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

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {agentMessages.length === 0 ? (
                    <A2UISurface
                      schema={{
                        surfaceId: 'welcome-card',
                        title: '工作区专属 AI 助手已就绪',
                        badge: 'Strict Isolation',
                        nodes: [
                          {
                            type: 'text',
                            id: 't1',
                            tone: 'muted',
                            text: '所有对话、Skill 与 MCP 工具调用均锁定在当前工作区内，绝不跨账号泄露 Cookie 或上下文。',
                          },
                          {
                            type: 'action-row',
                            id: 'a1',
                            actions: [
                              { id: 'open-hub', label: '配置模型 / MCP', variant: 'tonal' },
                              { id: 'audit', label: '立即体检当前页', variant: 'filled' },
                            ],
                          },
                        ],
                      }}
                      onAction={(act) => {
                        if (act === 'open-hub') setAiHubOpen(true)
                        if (act === 'audit') void handleSendChat('请读取并总结当前页面内容，检查工作区环境')
                      }}
                    />
                  ) : (
                    agentMessages.map((msg) => (
                      <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: 'var(--wb-sys-radius-sm)',
                            fontSize: 12,
                            lineHeight: 1.5,
                            userSelect: 'text',
                            backgroundColor:
                              msg.role === 'user'
                                ? 'var(--wb-sys-color-primary-container)'
                                : 'var(--wb-sys-color-surface-container)',
                            color:
                              msg.role === 'user'
                                ? 'var(--wb-sys-color-on-primary-container)'
                                : 'var(--wb-sys-color-on-surface)',
                          }}
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

                {/* Chat Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSendChat(chatPrompt)
                  }}
                  style={{ display: 'flex', gap: 6 }}
                >
                  <input
                    className="wb-omnibox"
                    value={chatPrompt}
                    disabled={agentBusy}
                    onChange={(e) => setChatPrompt(e.target.value)}
                    placeholder={agentBusy ? 'Agent 执行中…' : '向当前工作区 AI 下达指令...'}
                  />
                  <IconButton type="submit" disabled={agentBusy || !chatPrompt.trim()} title="发送">
                    <Send size={15} />
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

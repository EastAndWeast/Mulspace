import { useEffect, useState } from 'react'
import type {
  AppSettings,
  BatchJob,
  LLMProviderConfig,
  McpHostStatus,
  McpServerConfig,
  SkillDefinition,
  Workspace,
} from '@wb/contracts'
import { Badge, Button, Dialog, Input } from '@wb/ui-kit'

export interface AiHubDialogProps {
  open: boolean
  workspaces: Workspace[]
  activeWorkspace: Workspace
  settings: AppSettings
  mcpHostStatus: McpHostStatus
  onClose: () => void
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>
  onRunSkillInWorkspace: (skillId: string) => Promise<void>
}

type HubTab = 'llm' | 'skills' | 'mcp' | 'batch'

export function AiHubDialog({
  open,
  workspaces,
  activeWorkspace,
  settings,
  mcpHostStatus,
  onClose,
  onUpdateSettings,
  onRunSkillInWorkspace,
}: AiHubDialogProps) {
  const [tab, setTab] = useState<HubTab>('llm')
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([])

  // LLM Provider editor state
  const activeProvider: LLMProviderConfig =
    settings.llmProviders.find((p) => p.id === settings.activeLlmProviderId) ??
    settings.llmProviders[0]!
  const [apiKey, setApiKey] = useState(activeProvider?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(activeProvider?.baseUrl ?? '')
  const [model, setModel] = useState(activeProvider?.model ?? '')

  // Skill editor state
  const [skillName, setSkillName] = useState('')
  const [skillPrompt, setSkillPrompt] = useState('')

  // External MCP client editor
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')

  // Batch Job state
  const [selectedWsIds, setSelectedWsIds] = useState<string[]>([])
  const [batchPrompt, setBatchPrompt] = useState('检查当前页面内容并总结关键状态')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setApiKey(activeProvider?.apiKey ?? '')
    setBaseUrl(activeProvider?.baseUrl ?? '')
    setModel(activeProvider?.model ?? '')
    setSelectedWsIds(workspaces.map((w) => w.id))
    void window.browserApi.listSkills(activeWorkspace.id).then(setSkills)
    void window.browserApi.listMcpServers(activeWorkspace.id).then(setMcpServers)
    void window.browserApi.listBatchJobs().then(setBatchJobs)
  }, [open, activeWorkspace.id, activeProvider?.id])

  const handleSaveProvider = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = settings.llmProviders.map((p) =>
        p.id === activeProvider.id ? { ...p, apiKey, baseUrl, model, enabled: true } : p,
      )
      await onUpdateSettings({ llmProviders: next, activeLlmProviderId: activeProvider.id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title="AI 引擎 · Skills · MCP · 多工作区批量编排"
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(
          [
            { id: 'llm', label: '模型 Provider' },
            { id: 'skills', label: 'Skills 技能' },
            { id: 'mcp', label: '双向 MCP' },
            { id: 'batch', label: '多工作区批量执行' },
          ] as Array<{ id: HubTab; label: string }>
        ).map((item) => (
          <Button
            key={item.id}
            variant={tab === item.id ? 'filled' : 'tonal'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {tab === 'llm' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {settings.llmProviders.map((p) => (
              <Button
                key={p.id}
                variant={p.id === activeProvider.id ? 'filled' : 'outlined'}
                onClick={async () => {
                  await onUpdateSettings({ activeLlmProviderId: p.id })
                  setApiKey(p.apiKey ?? '')
                  setBaseUrl(p.baseUrl)
                  setModel(p.model)
                }}
              >
                {p.name}
              </Button>
            ))}
          </div>
          <label className="wb-field-label">
            Base URL
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="wb-field-label">
            模型名称
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          {activeProvider.kind !== 'ollama' ? (
            <label className="wb-field-label">
              API Key（本地保存，不会跨工作区泄露）
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </label>
          ) : null}
          <Button variant="filled" disabled={busy} onClick={() => void handleSaveProvider()}>
            保存模型配置
          </Button>
        </div>
      ) : null}

      {tab === 'skills' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
            {skills.map((skill) => (
              <div
                key={skill.id}
                style={{
                  padding: 8,
                  borderRadius: 'var(--wb-sys-radius-sm)',
                  backgroundColor: 'var(--wb-sys-color-surface-container)',
                  border: '1px solid var(--wb-sys-color-outline-variant)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {skill.name} {skill.builtIn ? <Badge>内置</Badge> : <Badge tone="primary">自定义</Badge>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)' }}>
                    {skill.description}
                  </div>
                </div>
                <Button
                  variant="tonal"
                  onClick={async () => {
                    await onRunSkillInWorkspace(skill.id)
                    onClose()
                  }}
                >
                  在当前空间运行
                </Button>
                {!skill.builtIn ? (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      const next = await window.browserApi.deleteSkill(skill.id)
                      setSkills(next)
                    }}
                  >
                    删
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <strong style={{ fontSize: 12 }}>新建 Skill（兼容 SKILL.md 规范）</strong>
          <Input
            value={skillName}
            onChange={(e) => setSkillName(e.target.value)}
            placeholder="Skill 名称（如：提取订单列表）"
          />
          <textarea
            className="wb-input"
            style={{ height: 64, padding: 8 }}
            value={skillPrompt}
            onChange={(e) => setSkillPrompt(e.target.value)}
            placeholder="输入执行步骤指令..."
          />
          <Button
            variant="filled"
            disabled={!skillName.trim() || !skillPrompt.trim()}
            onClick={async () => {
              const next = await window.browserApi.saveSkill({
                id: `custom_${Date.now()}`,
                name: skillName.trim(),
                description: skillPrompt.trim().slice(0, 60),
                promptTemplate: skillPrompt.trim(),
                allowedTools: ['get_page_snapshot', 'click_element', 'type_text'],
                scope: 'global',
              })
              setSkills(next)
              setSkillName('')
              setSkillPrompt('')
            }}
          >
            保存 Skill
          </Button>
        </div>
      ) : null}

      {tab === 'mcp' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              padding: 10,
              borderRadius: 'var(--wb-sys-radius-md)',
              backgroundColor: 'var(--wb-sys-color-surface-container)',
              border: '1px solid var(--wb-sys-color-outline-variant)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 12 }}>内置 Browser MCP Server（供 Cursor / Claude Code 调用）</strong>
              <Badge tone={mcpHostStatus.running ? 'primary' : 'neutral'}>
                {mcpHostStatus.running ? `监听中 ${mcpHostStatus.endpointUrl}` : '已关闭'}
              </Badge>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 8,
                fontSize: 11,
                borderRadius: 'var(--wb-sys-radius-xs)',
                backgroundColor: 'var(--wb-sys-color-surface-container-lowest)',
                overflowX: 'auto',
                userSelect: 'text',
              }}
            >
              {mcpHostStatus.clientSnippet}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="tonal"
                onClick={async () => {
                  await navigator.clipboard?.writeText(mcpHostStatus.clientSnippet)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                }}
              >
                {copied ? '已复制配置' : '复制客户端配置 JSON'}
              </Button>
              <Button
                variant="outlined"
                onClick={() =>
                  void window.browserApi.updateMcpHostConfig({ enabled: !mcpHostStatus.config.enabled })
                }
              >
                {mcpHostStatus.config.enabled ? '暂停 MCP Server' : '启用 MCP Server'}
              </Button>
            </div>
          </div>

          <strong style={{ fontSize: 12 }}>挂载外部 HTTP MCP Server（供工作区内置 Agent 调用）</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="名称（如：Notion）" />
            <Input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="http://127.0.0.1:3001/mcp" />
            <Button
              variant="filled"
              disabled={!mcpName.trim() || !mcpUrl.trim()}
              onClick={async () => {
                const next = await window.browserApi.saveMcpServer({
                  id: `mcp_${Date.now()}`,
                  name: mcpName.trim(),
                  transport: 'http',
                  url: mcpUrl.trim(),
                  enabled: true,
                  scope: 'global',
                })
                setMcpServers(next)
                setMcpName('')
                setMcpUrl('')
              }}
            >
              添加
            </Button>
          </div>
          {mcpServers.map((srv) => (
            <div
              key={srv.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
                padding: '6px 8px',
                borderRadius: 'var(--wb-sys-radius-xs)',
                backgroundColor: 'var(--wb-sys-color-surface-container)',
              }}
            >
              <span>
                {srv.name} ({srv.url})
              </span>
              <Button
                variant="danger"
                onClick={async () => setMcpServers(await window.browserApi.deleteMcpServer(srv.id))}
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'batch' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--wb-sys-color-on-surface-variant)' }}>
            只有在此处由您显式勾选工作区并启动批量任务，AI 才会在多个隔离工作区中分别并发运行，仍严格禁止任何跨区凭证互读。
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {workspaces.map((ws) => {
              const checked = selectedWsIds.includes(ws.id)
              return (
                <label
                  key={ws.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedWsIds((prev) =>
                        e.target.checked ? [...prev, ws.id] : prev.filter((id) => id !== ws.id),
                      )
                    }
                  />
                  <span>
                    {ws.icon} {ws.name}
                  </span>
                </label>
              )
            })}
          </div>
          <Input value={batchPrompt} onChange={(e) => setBatchPrompt(e.target.value)} />
          <Button
            variant="filled"
            disabled={busy || selectedWsIds.length === 0 || !batchPrompt.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await window.browserApi.runBatchJob({
                  name: '多账号并发任务',
                  prompt: batchPrompt.trim(),
                  workspaceIds: selectedWsIds,
                })
                setBatchJobs(await window.browserApi.listBatchJobs())
              } finally {
                setBusy(false)
              }
            }}
          >
            在所选 {selectedWsIds.length} 个工作区并发执行
          </Button>
          {batchJobs.slice(0, 3).map((job) => (
            <div
              key={job.id}
              style={{
                padding: 8,
                borderRadius: 'var(--wb-sys-radius-sm)',
                backgroundColor: 'var(--wb-sys-color-surface-container)',
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <strong>
                {job.name} — {job.status}
              </strong>
              {Object.values(job.results).map((res) => (
                <div key={res.workspaceId}>
                  • {res.workspaceId}: [{res.status}] {res.summary ?? res.error ?? ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </Dialog>
  )
}

import { useState } from 'react'
import type { AppSettings, TabMemorySummary, ThemeManifest, ThemeMode, UpdateState } from '@wb/contracts'
import { Badge, Button, Dialog } from '@wb/ui-kit'

export interface SettingsDialogProps {
  open: boolean
  settings: AppSettings
  themes: ThemeManifest[]
  memorySummary: TabMemorySummary
  updateState: UpdateState
  onClose: () => void
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>
  onSweepMemory: () => Promise<void>
  onCheckForUpdates: () => Promise<void>
  onOpenUpdateDownload: () => Promise<void>
}

export function SettingsDialog({
  open,
  settings,
  themes,
  memorySummary,
  updateState,
  onClose,
  onUpdateSettings,
  onSweepMemory,
  onCheckForUpdates,
  onOpenUpdateDownload,
}: SettingsDialogProps) {
  const [themeJsonText, setThemeJsonText] = useState('')
  const [themeMsg, setThemeMsg] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      title="外观主题分离与内存调度设置"
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="wb-field-label">
        <span>主题包（Google Material Design 3 主题分离架构）</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {themes.map((theme) => {
            const active = settings.themeId === theme.id
            return (
              <div
                key={theme.id}
                onClick={() => void onUpdateSettings({ themeId: theme.id })}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 'var(--wb-sys-radius-sm)',
                  border: active
                    ? '2px solid var(--wb-sys-color-primary)'
                    : '1px solid var(--wb-sys-color-outline-variant)',
                  backgroundColor: active
                    ? 'var(--wb-sys-color-primary-container)'
                    : 'var(--wb-sys-color-surface-container)',
                  color: active
                    ? 'var(--wb-sys-color-on-primary-container)'
                    : 'var(--wb-sys-color-on-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }}>{theme.name}</strong>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Badge tone={active ? 'primary' : 'neutral'}>{theme.density}</Badge>
                    <Button
                      variant="text"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const json = await window.browserApi.exportThemeJson(theme.id)
                        setThemeJsonText(json)
                        setThemeMsg(`已导出「${theme.name}」配置 JSON 到下方文本框`)
                      }}
                    >
                      导出
                    </Button>
                  </div>
                </div>
                <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>{theme.description}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="wb-field-label">
        <span>导入自定义主题 JSON（可在导出模板基础上修改 Token）</span>
        <textarea
          className="wb-input"
          style={{ height: 68, padding: 8, fontFamily: 'var(--wb-sys-font-mono)' }}
          value={themeJsonText}
          onChange={(e) => setThemeJsonText(e.target.value)}
          placeholder='{"id":"my-theme","name":"My Theme","density":"comfortable","defaultSeedColor":"#10B981"}'
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            variant="tonal"
            disabled={!themeJsonText.trim()}
            onClick={async () => {
              try {
                await window.browserApi.importThemeJson(themeJsonText)
                setThemeMsg('主题导入成功！已出现在上方列表。')
              } catch (err) {
                setThemeMsg(err instanceof Error ? err.message : String(err))
              }
            }}
          >
            导入并注册主题
          </Button>
          {themeMsg ? <span style={{ fontSize: 11 }}>{themeMsg}</span> : null}
        </div>
      </div>

      <div className="wb-field-label">
        <span>色彩模式</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => (
            <Button
              key={mode}
              variant={settings.themeMode === mode ? 'filled' : 'outlined'}
              onClick={() => void onUpdateSettings({ themeMode: mode })}
            >
              {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
            </Button>
          ))}
        </div>
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--wb-sys-color-on-surface)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={settings.followWorkspaceColor}
          onChange={(e) => void onUpdateSettings({ followWorkspaceColor: e.target.checked })}
        />
        <span>切换工作区时动态切换 Material 3 强调色（强烈推荐用于防串号）</span>
      </label>

      <div
        style={{
          padding: 12,
          borderRadius: 'var(--wb-sys-radius-md)',
          backgroundColor: 'var(--wb-sys-color-surface-container)',
          border: '1px solid var(--wb-sys-color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 13 }}>三层标签页内存回收状态</strong>
          <Button variant="tonal" onClick={() => void onSweepMemory()}>
            立即休眠后台标签
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="primary">活跃 Active: {memorySummary.activeTabs}</Badge>
          <Badge>冻结 Frozen: {memorySummary.frozenTabs}</Badge>
          <Badge>已释放 Discarded: {memorySummary.discardedTabs}</Badge>
          <Badge>总标签: {memorySummary.totalTabs}</Badge>
        </div>
      </div>

      {/* Auto-Update Section */}
      <div
        style={{
          padding: 12,
          borderRadius: 'var(--wb-sys-radius-md)',
          backgroundColor: 'var(--wb-sys-color-surface-container)',
          border: '1px solid var(--wb-sys-color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <strong style={{ fontSize: 13 }}>自动更新检测（GitHub Releases）</strong>
            <div style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)' }}>
              当前版本 v{updateState.currentVersion} · 仓库 {updateState.repoSlug}
            </div>
          </div>
          <Button
            variant="tonal"
            disabled={updateState.status === 'checking'}
            onClick={() => void onCheckForUpdates()}
          >
            {updateState.status === 'checking' ? '正在检测…' : '立即检查更新'}
          </Button>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--wb-sys-color-on-surface)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates}
            onChange={(e) => void onUpdateSettings({ autoCheckUpdates: e.target.checked })}
          />
          <span>启动时及后台定期自动检测新版本</span>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={updateState.status === 'available' ? 'primary' : 'neutral'}>
            {updateState.status === 'available'
              ? `发现新版本 v${updateState.latestVersion}`
              : updateState.status === 'up-to-date'
                ? '当前已是最新版本'
                : updateState.status === 'checking'
                  ? '正在连接 GitHub Releases…'
                  : updateState.status === 'error'
                    ? `检测失败：${updateState.error ?? '未知错误'}`
                    : '尚未检测'}
          </Badge>
          {updateState.checkedAt ? (
            <span style={{ fontSize: 11, color: 'var(--wb-sys-color-on-surface-variant)' }}>
              上次检测：{new Date(updateState.checkedAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        {updateState.status === 'available' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {updateState.releaseNotes ? (
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  maxHeight: 100,
                  overflowY: 'auto',
                  fontSize: 11,
                  borderRadius: 'var(--wb-sys-radius-xs)',
                  backgroundColor: 'var(--wb-sys-color-surface-container-lowest)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {updateState.releaseNotes}
              </pre>
            ) : null}
            <Button variant="filled" onClick={() => void onOpenUpdateDownload()}>
              {updateState.matchedAsset
                ? `下载新版本 (${updateState.matchedAsset.name})`
                : '前往 GitHub Releases 下载新版本'}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

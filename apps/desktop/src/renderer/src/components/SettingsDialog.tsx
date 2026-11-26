import { useState } from 'react'
import type { AppSettings, TabMemorySummary, ThemeManifest, ThemeMode, UpdateState } from '@wb/contracts'
import { Button, Dialog } from '@wb/ui-kit'
import { Check } from 'lucide-react'
import { formatIpcError } from '../utils/format-error.js'

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

  const updateSummary =
    updateState.status === 'available'
      ? `发现新版本 v${updateState.latestVersion}`
      : updateState.status === 'up-to-date'
        ? '已是最新版本'
        : updateState.status === 'checking'
          ? '正在检查…'
          : updateState.status === 'error'
            ? `检查失败：${updateState.error ?? '未知错误'}`
            : '尚未检查'

  return (
    <Dialog
      open={open}
      title="浏览器设置"
      onClose={onClose}
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="wb-field-label">
        <span>外观与主题</span>
        <div className="wb-theme-list">
          {themes.map((theme) => {
            const active = settings.themeId === theme.id
            return (
              <div key={theme.id} className="wb-theme-choice">
                <button
                  type="button"
                  className="wb-theme-choice__select"
                  aria-pressed={active}
                  onClick={() => void onUpdateSettings({ themeId: theme.id })}
                >
                  <span
                    className="wb-theme-choice__sample"
                    style={{ color: theme.defaultSeedColor }}
                    aria-hidden="true"
                  />
                  <span className="wb-theme-choice__text">
                    <strong>{theme.name}</strong>
                    <span>{theme.description}</span>
                  </span>
                  {active ? (
                    <Check className="wb-theme-choice__check" size={15} strokeWidth={1.9} aria-hidden="true" />
                  ) : null}
                </button>
                <Button
                  variant="text"
                  onClick={async () => {
                    const json = await window.browserApi.exportThemeJson(theme.id)
                    setThemeJsonText(json)
                    setThemeMsg(`已导出「${theme.name}」配置`)
                  }}
                >
                  导出
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="wb-field-label">
        <span>色彩模式</span>
        <div className="wb-segmented" role="group" aria-label="色彩模式">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => {
            const active = settings.themeMode === mode
            return (
              <button
                key={mode}
                type="button"
                className={`wb-segmented__item ${active ? 'wb-segmented__item--active' : ''}`}
                aria-pressed={active}
                onClick={() => void onUpdateSettings({ themeMode: mode })}
              >
                {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
              </button>
            )
          })}
        </div>
      </div>

      <label className="wb-check-row">
        <input
          type="checkbox"
          checked={settings.followWorkspaceColor}
          onChange={(e) => void onUpdateSettings({ followWorkspaceColor: e.target.checked })}
        />
        <span>界面强调色跟随当前工作区</span>
      </label>

      <details className="wb-details">
        <summary>导入自定义主题 JSON</summary>
        <div className="wb-details__body">
          <textarea
            className="wb-input wb-details__textarea"
            value={themeJsonText}
            onChange={(e) => setThemeJsonText(e.target.value)}
            placeholder='{"id":"my-theme","name":"My Theme","density":"comfortable","defaultSeedColor":"#147A6B"}'
          />
          <div className="wb-details__actions">
            <Button
              variant="tonal"
              disabled={!themeJsonText.trim()}
              onClick={async () => {
                try {
                  await window.browserApi.importThemeJson(themeJsonText)
                  setThemeMsg('主题已导入，可在上方列表选用。')
                } catch (err) {
                  setThemeMsg(formatIpcError(err))
                }
              }}
            >
              导入并注册主题
            </Button>
            {themeMsg ? <span className="wb-details__msg">{themeMsg}</span> : null}
          </div>
        </div>
      </details>

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title">标签页内存调度</div>
            <div className="wb-dialog-card__sub">自动休眠或释放闲置标签以控制内存占用</div>
          </div>
          <Button variant="tonal" onClick={() => void onSweepMemory()}>
            立即休眠后台标签
          </Button>
        </div>
        <div className="wb-stat-strip">
          <div className="wb-stat-cell">
            <strong>{memorySummary.activeTabs}</strong>
            <span>活跃</span>
          </div>
          <div className="wb-stat-cell">
            <strong>{memorySummary.frozenTabs}</strong>
            <span>休眠</span>
          </div>
          <div className="wb-stat-cell">
            <strong>{memorySummary.discardedTabs}</strong>
            <span>已释放</span>
          </div>
          <div className="wb-stat-cell">
            <strong>{memorySummary.totalTabs}</strong>
            <span>总标签</span>
          </div>
        </div>
      </div>

      <div className="wb-dialog-card">
        <div className="wb-dialog-card__head">
          <div>
            <div className="wb-dialog-card__title">版本更新</div>
            <div className="wb-dialog-card__sub">
              v{updateState.currentVersion} · {updateSummary}
              {updateState.checkedAt
                ? ` · ${new Date(updateState.checkedAt).toLocaleTimeString()}`
                : ''}
            </div>
          </div>
          <Button
            variant="tonal"
            disabled={updateState.status === 'checking'}
            onClick={() => void onCheckForUpdates()}
          >
            {updateState.status === 'checking' ? '检查中…' : '检查更新'}
          </Button>
        </div>

        <label className="wb-check-row">
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates}
            onChange={(e) => void onUpdateSettings({ autoCheckUpdates: e.target.checked })}
          />
          <span>启动时及后台自动检查更新</span>
        </label>

        {updateState.status === 'available' ? (
          <>
            {updateState.releaseNotes ? (
              <pre className="wb-update-notes">{updateState.releaseNotes}</pre>
            ) : null}
            <Button variant="filled" onClick={() => void onOpenUpdateDownload()}>
              {updateState.matchedAsset
                ? `下载新版本 (${updateState.matchedAsset.name})`
                : '前往 Releases 下载新版本'}
            </Button>
          </>
        ) : null}
      </div>
    </Dialog>
  )
}

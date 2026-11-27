import { type CSSProperties, memo, useState } from 'react'
import type { Tab, Workspace } from '@wb/contracts'
import { ArrowRight, Plus, Search } from 'lucide-react'
import brandIcon from '../../../../build/icon.svg'
import { WorkspaceGlyph } from './WorkspaceGlyph.js'

interface NewTabPageProps {
  workspace: Workspace
  workspaces: Workspace[]
  tabsByWorkspace: Record<string, Tab[]>
  proxyLabel: string
  onNavigate: (input: string) => void
  onSwitchWorkspace: (id: string) => void
  onCreateWorkspace: () => void
}

export const NewTabPage = memo(function NewTabPage({
  workspace,
  workspaces,
  tabsByWorkspace,
  proxyLabel,
  onNavigate,
  onSwitchWorkspace,
  onCreateWorkspace,
}: NewTabPageProps) {
  const [query, setQuery] = useState('')
  const visibleWorkspaces = workspaces.slice(0, 6)

  return (
    <section className="wb-start" aria-label="新标签页">
      <div className="wb-start__inner">
        <header className="wb-start__header">
          <div className="wb-start__brand">
            <img src={brandIcon} alt="" width="24" height="24" />
            <span>Mulspace</span>
          </div>
          <div
            className="wb-start__context"
            style={{ '--ws-accent': workspace.seedColor } as CSSProperties}
          >
            <span className="wb-start__context-dot" />
            <span>{workspace.name}</span>
            <span className="wb-start__context-sep">·</span>
            <span>{proxyLabel}</span>
          </div>
        </header>

        <form
          className="wb-start__search"
          onSubmit={(event) => {
            event.preventDefault()
            if (query.trim()) onNavigate(query.trim())
          }}
        >
          <Search size={18} strokeWidth={1.7} aria-hidden="true" />
          <input
            autoFocus
            aria-label="搜索或输入网址"
            placeholder="搜索关键词或输入网址，按 Enter 打开"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
          <button type="submit" aria-label="前往" disabled={!query.trim()}>
            <ArrowRight size={17} strokeWidth={1.85} />
          </button>
        </form>

        <div className="wb-start__section">
          <div className="wb-start__section-title">
            <h2>账号工作区</h2>
            <span>{workspaces.length} 个独立空间</span>
          </div>
          <button type="button" className="wb-start__add" onClick={onCreateWorkspace}>
            <Plus size={14} strokeWidth={1.8} /> 新建工作区
          </button>
        </div>

        <div className="wb-start__spaces">
          {visibleWorkspaces.map((item) => {
            const active = item.id === workspace.id
            const tabCount = (tabsByWorkspace[item.id] ?? []).length
            return (
              <button
                key={item.id}
                className={`wb-start__space ${active ? 'wb-start__space--active' : ''}`}
                style={{ '--ws-accent': item.seedColor } as CSSProperties}
                type="button"
                aria-current={active ? true : undefined}
                disabled={active}
                onClick={() => onSwitchWorkspace(item.id)}
                title={`${item.name}（${tabCount} 个标签）`}
              >
                <span className="wb-start__space-icon">
                  <WorkspaceGlyph value={item.icon} size={16} />
                </span>
                <span className="wb-start__space-meta">
                  <span className="wb-start__space-name">{item.name}</span>
                  <span className="wb-start__space-sub">{tabCount} 个标签</span>
                </span>
                {active ? (
                  <span className="wb-start__current">当前</span>
                ) : (
                  <ArrowRight size={14} strokeWidth={1.7} className="wb-start__arrow" />
                )}
              </button>
            )
          })}
        </div>

        <footer className="wb-start__shortcuts" aria-hidden="true">
          <span>⌘T 新建标签</span>
          <span>·</span>
          <span>⌘L 聚焦地址栏</span>
          <span>·</span>
          <span>⌘⇧R 强制刷新</span>
        </footer>
      </div>
    </section>
  )
})

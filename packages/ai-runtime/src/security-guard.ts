import type { WorkspaceId } from '@wb/contracts'

export class WorkspaceBoundaryViolationError extends Error {
  constructor(agentWorkspaceId: WorkspaceId, targetWorkspaceId: WorkspaceId) {
    super(
      `安全护栏拦截：工作区 "${agentWorkspaceId}" 的 Agent 禁止跨区访问工作区 "${targetWorkspaceId}" 的页面或凭证。`,
    )
    this.name = 'WorkspaceBoundaryViolationError'
  }
}

export function assertSafeAiNavigationUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    throw new Error('安全护栏拦截：导航 URL 不能为空')
  }

  let normalized = trimmed
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    if (trimmed.includes(' ')) {
      throw new Error('安全护栏拦截：无效的导航 URL')
    }
    if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) {
      normalized = `http://${trimmed}`
    } else if (trimmed.includes('.')) {
      normalized = `https://${trimmed}`
    } else {
      throw new Error('安全护栏拦截：无效的导航 URL')
    }
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('安全护栏拦截：无效的导航 URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `安全护栏拦截：AI / MCP 仅允许导航至 http:// 或 https:// 网址，已拒绝协议 "${parsed.protocol}"`,
    )
  }

  return parsed.toString()
}

export class WorkspaceBoundaryGuard {
  assertSameWorkspace(agentWorkspaceId: WorkspaceId, targetWorkspaceId: WorkspaceId): void {
    if (agentWorkspaceId !== targetWorkspaceId) {
      throw new WorkspaceBoundaryViolationError(agentWorkspaceId, targetWorkspaceId)
    }
  }

  assertSafeNavigationUrl(rawUrl: string): string {
    return assertSafeAiNavigationUrl(rawUrl)
  }
}

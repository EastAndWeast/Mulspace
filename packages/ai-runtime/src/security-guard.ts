import type { WorkspaceId } from '@wb/contracts'

export class WorkspaceBoundaryViolationError extends Error {
  constructor(agentWorkspaceId: WorkspaceId, targetWorkspaceId: WorkspaceId) {
    super(
      `安全护栏拦截：工作区 "${agentWorkspaceId}" 的 Agent 禁止跨区访问工作区 "${targetWorkspaceId}" 的页面或凭证。`,
    )
    this.name = 'WorkspaceBoundaryViolationError'
  }
}

export class WorkspaceBoundaryGuard {
  assertSameWorkspace(agentWorkspaceId: WorkspaceId, targetWorkspaceId: WorkspaceId): void {
    if (agentWorkspaceId !== targetWorkspaceId) {
      throw new WorkspaceBoundaryViolationError(agentWorkspaceId, targetWorkspaceId)
    }
  }
}

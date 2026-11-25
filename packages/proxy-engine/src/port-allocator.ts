import { createServer } from 'node:net'
import type { WorkspaceId } from '@wb/contracts'

export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

export async function findFreePort(startPort: number, endPort: number, reserved: Set<number>): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    if (reserved.has(port)) continue
    if (await isPortFree(port)) {
      return port
    }
  }
  throw new Error(`No free ports available in range ${startPort}-${endPort}`)
}

export class PortAllocator {
  private readonly workspacePorts = new Map<WorkspaceId, number>()
  private readonly usedPorts = new Set<number>()

  constructor(
    private readonly basePort = 18100,
    private readonly maxPort = 18999,
  ) {}

  async allocateForWorkspace(workspaceId: WorkspaceId): Promise<number> {
    const existing = this.workspacePorts.get(workspaceId)
    if (existing !== undefined) return existing

    const port = await findFreePort(this.basePort, this.maxPort, this.usedPorts)
    this.workspacePorts.set(workspaceId, port)
    this.usedPorts.add(port)
    return port
  }

  getPort(workspaceId: WorkspaceId): number | undefined {
    return this.workspacePorts.get(workspaceId)
  }

  releaseWorkspace(workspaceId: WorkspaceId): void {
    const port = this.workspacePorts.get(workspaceId)
    if (port !== undefined) {
      this.workspacePorts.delete(workspaceId)
      this.usedPorts.delete(port)
    }
  }
}

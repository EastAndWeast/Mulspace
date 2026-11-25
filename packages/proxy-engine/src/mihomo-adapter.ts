import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import type { ProxyNode } from '@wb/contracts'
import { generateMihomoConfig, type WorkspaceListenerMapping } from './config-generator.js'
import { findFreePort } from './port-allocator.js'

export async function resolveMihomoBinary(candidates: Array<string | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Try next candidate
    }
  }

  // Search PATH
  const exeName = process.platform === 'win32' ? 'mihomo.exe' : 'mihomo'
  const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  for (const dir of pathDirs) {
    const full = join(dir, exeName)
    try {
      await access(full, fsConstants.X_OK)
      return full
    } catch {
      // Continue
    }
  }
  return null
}

export class MihomoCoreAdapter {
  private process: ChildProcess | null = null
  private controllerPort: number | null = null
  private readonly controllerSecret = randomUUID().replace(/-/g, '')
  private binaryPath: string | null = null
  private lastError: string | undefined

  constructor(private readonly runtimeDir: string) {}

  async findBinary(customPath?: string, resourcesPath?: string): Promise<string | null> {
    const exeName = process.platform === 'win32' ? 'mihomo.exe' : 'mihomo'
    const platformTag = `${process.platform}-${process.arch}`
    this.binaryPath = await resolveMihomoBinary([
      customPath,
      resourcesPath ? join(resourcesPath, 'bin', exeName) : undefined,
      resourcesPath ? join(resourcesPath, 'bin', platformTag, exeName) : undefined,
      join(process.cwd(), 'resources', 'bin', exeName),
      join(process.cwd(), 'resources', 'bin', platformTag, exeName),
    ])
    return this.binaryPath
  }

  getStatusSnapshot() {
    return {
      binaryFound: this.binaryPath !== null,
      binaryPath: this.binaryPath,
      running: this.process !== null && !this.process.killed,
      controllerUrl: this.controllerPort ? `http://127.0.0.1:${this.controllerPort}` : null,
      lastError: this.lastError,
    }
  }

  async applyConfig(
    nodes: ProxyNode[],
    workspaceMappings: WorkspaceListenerMapping[],
    customBinaryPath?: string,
    resourcesPath?: string,
  ): Promise<void> {
    const bin = await this.findBinary(customBinaryPath, resourcesPath)
    await mkdir(this.runtimeDir, { recursive: true })

    if (!this.controllerPort) {
      this.controllerPort = await findFreePort(19100, 19499, new Set())
    }

    const yamlText = generateMihomoConfig({
      nodes,
      workspaceMappings,
      controllerPort: this.controllerPort,
      controllerSecret: this.controllerSecret,
    })

    const configPath = join(this.runtimeDir, 'mihomo.yaml')
    await writeFile(configPath, yamlText, 'utf8')

    if (workspaceMappings.length === 0) {
      await this.stop()
      return
    }

    if (!bin) {
      this.lastError =
        '未检测到 mihomo 内核可执行文件：已生成单核多端口配置文件，请将 mihomo 放入 resources/bin 或在代理设置中指定内核路径以启用托管节点。'
      return
    }

    this.lastError = undefined
    if (this.process && !this.process.killed) {
      // Reload config via External Controller REST API
      try {
        const res = await fetch(`http://127.0.0.1:${this.controllerPort}/configs?force=true`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.controllerSecret}`,
          },
          body: JSON.stringify({ path: configPath }),
        })
        if (res.ok) return
      } catch {
        // Fallback to clean restart below
      }
      await this.stop()
    }

    this.process = spawn(bin, ['-d', this.runtimeDir, '-f', configPath], {
      detached: false,
      stdio: 'ignore',
    })
    this.process.on('error', (err) => {
      this.lastError = err.message
      this.process = null
    })
    this.process.on('exit', () => {
      this.process = null
    })
  }

  async testNodeDelay(nodeName: string): Promise<number | null> {
    if (!this.process || !this.controllerPort) return null
    try {
      const url = `http://127.0.0.1:${this.controllerPort}/proxies/${encodeURIComponent(nodeName)}/delay?timeout=5000&url=http://www.gstatic.com/generate_204`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.controllerSecret}` },
      })
      if (!res.ok) return null
      const json = (await res.json()) as { delay?: number }
      return typeof json.delay === 'number' ? json.delay : null
    } catch {
      return null
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return
    const proc = this.process
    this.process = null
    if (!proc.killed) {
      proc.kill()
    }
  }
}

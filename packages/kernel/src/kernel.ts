import type { IKernelContext, IKernelModule, KernelEventMap } from '@wb/contracts'
import { TypedEventBus } from './event-bus.js'
import { ServiceRegistry } from './service-registry.js'

export class BrowserKernel {
  readonly events = new TypedEventBus<KernelEventMap>()
  readonly services = new ServiceRegistry()

  private readonly modules: IKernelModule[] = []
  private readonly initializedModules: IKernelModule[] = []
  private started = false

  use(module: IKernelModule): this {
    if (this.started) {
      throw new Error(`Cannot register module "${module.id}" after kernel has started`)
    }
    if (this.modules.some((m) => m.id === module.id)) {
      throw new Error(`Duplicate kernel module id: ${module.id}`)
    }
    this.modules.push(module)
    return this
  }

  get context(): IKernelContext {
    return {
      events: this.events,
      services: this.services,
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    for (const module of this.modules) {
      await module.init(this.context)
      this.initializedModules.push(module)
    }
    this.started = true
  }

  async stop(): Promise<void> {
    if (!this.started) return
    for (const module of [...this.initializedModules].reverse()) {
      await module.dispose?.()
    }
    this.initializedModules.length = 0
    this.started = false
  }
}

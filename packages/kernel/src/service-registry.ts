import type { IServiceRegistry, ServiceToken } from '@wb/contracts'

export class ServiceRegistry implements IServiceRegistry {
  private readonly instances = new Map<symbol, unknown>()

  register<T>(token: ServiceToken<T>, instance: T): void {
    if (this.instances.has(token.id)) {
      throw new Error(`Service already registered: ${token.description}`)
    }
    this.instances.set(token.id, instance)
  }

  resolve<T>(token: ServiceToken<T>): T {
    if (!this.instances.has(token.id)) {
      throw new Error(`Service not registered: ${token.description}`)
    }
    return this.instances.get(token.id) as T
  }

  has<T>(token: ServiceToken<T>): boolean {
    return this.instances.has(token.id)
  }
}

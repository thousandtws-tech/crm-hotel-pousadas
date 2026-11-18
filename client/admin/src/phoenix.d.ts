// Tipagens mínimas do cliente oficial `phoenix` (JS puro, sem .d.ts).
// Cobre apenas a superfície usada pelo RealtimeService.

declare module 'phoenix' {
  export interface SocketOptions {
    params?: Record<string, unknown> | (() => Record<string, unknown>);
    reconnectAfterMs?: (tries: number) => number;
    rejoinAfterMs?: (tries: number) => number;
    heartbeatIntervalMs?: number;
    timeout?: number;
    logger?: (kind: string, msg: string, data: unknown) => void;
  }

  export class Push {
    receive(status: string, callback: (response?: unknown) => void): Push;
  }

  export class Channel {
    constructor(topic: string, params?: Record<string, unknown>, socket?: Socket);
    join(timeout?: number): Push;
    leave(timeout?: number): Push;
    rejoin(timeout?: number): void;
    on(event: string, callback: (payload?: unknown) => void): number;
    off(event: string, ref?: number): void;
    push(event: string, payload?: Record<string, unknown>, timeout?: number): Push;
    isJoined(): boolean;
    readonly topic: string;
  }

  export class Socket {
    constructor(endPoint: string, opts?: SocketOptions);
    connect(params?: Record<string, unknown>): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;
    channel(topic: string, chanParams?: Record<string, unknown>): Channel;
    remove(channel: Channel): void;
    onOpen(callback: (...args: unknown[]) => void): number;
    onClose(callback: (...args: unknown[]) => void): number;
    onError(callback: (...args: unknown[]) => void): number;
    onMessage(callback: (msg: Record<string, unknown>) => unknown): number;
    isConnected(): boolean;
    connectionState(): string;
    endPointURL(): string;
  }

  export interface PresenceOnJoinLeave {
    (key: string, currentPresence: unknown, newPresence: unknown): void;
  }

  export class Presence {
    constructor(channel: Channel);
    onJoin(callback: PresenceOnJoinLeave): void;
    onLeave(callback: PresenceOnJoinLeave): void;
    onSync(callback: () => void): void;
    list<T = Record<string, unknown>>(by?: (key: string, presence: T) => unknown): unknown[];
  }
}

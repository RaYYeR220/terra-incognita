import { HuntStatus } from '@terra-incognita/core';
import type { LogEntry, Vec3 } from '@terra-incognita/core';

import { explain } from './errors';
import type { FromSim, SimConfig, ToSim } from './sim-protocol';
import { EMPTY_ME } from './types';
import type { HuntSession, Pending, ReadAttempt, SessionSnapshot } from './types';

const DEFAULTS: Omit<SimConfig, 'id'> = {
  number: 12,
  title: 'The Roaring Forties',
  bots: 7,
  prizeSol: 1.6,
  entryFeeSol: 0.05,
  durationSecs: 1500,
  zoneIntervalSecs: 120,
  warmupSecs: 400,
};

const ASKERS = ['You', 'The organiser', 'A rival ship', 'Us'];

/** A hunt played against the simulator and its bots, all inside a worker. */
export class SimHuntSession implements HuntSession {
  readonly huntId: string;
  private readonly worker: Worker;
  private snapshot: SessionSnapshot = { phase: 'loading', info: null, view: null, me: EMPTY_ME, error: null };
  private readonly listeners = new Set<() => void>();
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private reads = 0;

  constructor(huntId: string, overrides: Partial<SimConfig> = {}) {
    this.huntId = huntId;
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromSim>) => this.receive(event.data);
    this.worker.onerror = () => this.update({ phase: 'error', error: 'The simulator stopped. Reload the page to start a new hunt.' });
    this.send({ type: 'init', config: { ...DEFAULTS, ...overrides, id: huntId } });
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  now(): number {
    const read = this.snapshot.view?.readAt ?? 0;
    return Math.max(read, Date.now() / 1000);
  }

  embark(start: Vec3): Promise<void> {
    return this.request('embark', { type: 'embark', id: 0, at: start }).then(() => undefined);
  }

  setCourse(dest: Vec3): Promise<void> {
    return this.request('course', { type: 'course', id: 0, at: dest }).then(() => undefined);
  }

  probe(): Promise<LogEntry> {
    return this.request('probe', { type: 'probe', id: 0 }) as Promise<LogEntry>;
  }

  async attemptRead(): Promise<ReadAttempt> {
    const asker = ASKERS[this.reads % ASKERS.length] as string;
    this.reads += 1;
    await new Promise((r) => setTimeout(r, 420));
    return {
      readable: false,
      asker,
      detail: 'Came back empty. The coordinates sit in an account that refuses every reader: players, the organiser, us.',
    };
  }

  dispose(): void {
    this.worker.terminate();
    this.listeners.clear();
    for (const w of this.waiting.values()) w.reject(new Error('closed'));
    this.waiting.clear();
  }

  private request(pending: Exclude<Pending, null>, msg: ToSim): Promise<unknown> {
    this.seq += 1;
    const id = this.seq;
    this.update({ me: { ...this.snapshot.me, pending, error: null } });
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.send({ ...msg, id } as ToSim);
    });
  }

  private send(msg: ToSim): void {
    this.worker.postMessage(msg);
  }

  private receive(msg: FromSim): void {
    if (msg.type === 'failed') {
      this.update({ phase: 'error', error: 'The simulator could not start a hunt. Reload to try again.' });
      return;
    }
    if (msg.type === 'snapshot') {
      const strikeUnconfirmed = msg.logbook.some((e) => e.band === 0) && msg.view.status === HuntStatus.Live;
      this.update({
        phase: 'ready',
        info: msg.info,
        view: msg.view,
        me: {
          ...this.snapshot.me,
          identity: { kind: 'guest', label: 'guest' },
          shipIndex: msg.shipIndex,
          joined: true,
          logbook: msg.logbook,
          strikeUnconfirmed,
        },
      });
      return;
    }
    const waiter = this.waiting.get(msg.id);
    if (!waiter) return;
    this.waiting.delete(msg.id);
    if (msg.ok) {
      this.update({ me: { ...this.snapshot.me, pending: null } });
      waiter.resolve(msg.value);
    } else {
      const text = explain(msg.error);
      this.update({ me: { ...this.snapshot.me, pending: null, error: text } });
      waiter.reject(new Error(text));
    }
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
}

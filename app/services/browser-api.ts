import type { Json, TelemetryEvent } from '@/entities/models/mathmate';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
interface PendingRecord {
  id: string;
  userId: string;
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  kind: 'event' | 'mutation';
}
export interface SyncStatus {
  pending: number;
  error: string;
  durable: boolean;
}

class PendingStore {
  private fallback = new Map<string, PendingRecord>();
  private database?: Promise<IDBDatabase | null>;
  durable = true;
  private db() {
    if (!this.database)
      this.database = new Promise<IDBDatabase | null>((resolve) => {
        try {
          const request = indexedDB.open('mathmate-delivery', 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('pending', { keyPath: 'id' });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => {
            this.durable = false;
            resolve(null);
          };
          request.onblocked = () => {
            this.durable = false;
            resolve(null);
          };
        } catch {
          this.durable = false;
          resolve(null);
        }
      });
    return this.database;
  }
  async all(): Promise<PendingRecord[]> {
    const db = await this.db();
    if (!db) return [...this.fallback.values()];
    return new Promise((resolve, reject) => {
      const request = db.transaction('pending').objectStore('pending').getAll();
      request.onsuccess = () => resolve(request.result as PendingRecord[]);
      request.onerror = () =>
        reject(new Error('Kunne ikke lese ventende data i nettleseren.'));
    });
  }
  async put(record: PendingRecord) {
    const db = await this.db();
    if (!db) {
      this.fallback.set(record.id, record);
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('pending', 'readwrite');
      transaction.objectStore('pending').put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          new Error(
            'Kunne ikke mellomlagre ventende data. Kontroller nettleserlagringen.',
          ),
        );
    });
  }
  async remove(ids: string[]) {
    const db = await this.db();
    if (!db) {
      ids.forEach((id) => this.fallback.delete(id));
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('pending', 'readwrite');
      ids.forEach((id) => transaction.objectStore('pending').delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new Error('Kunne ikke oppdatere leveringskøen.'));
    });
  }
}

export class BrowserApi {
  private store = new PendingStore();
  private known = new Map<string, PendingRecord>();
  private flushing?: Promise<void>;
  private error = '';
  private timer?: ReturnType<typeof setInterval>;
  private inFlight = new Set<string>();
  constructor(
    readonly userId: string,
    public sessionId: string,
    private readonly onStatus: (status: SyncStatus) => void,
  ) {}

  static async request<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/${path}`, {
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(path === 'chat' ? 55000 : 20000),
      });
    } catch {
      throw new ApiError(
        'Fikk ikke kontakt med serveren. Data som venter, sendes på nytt når forbindelsen er tilbake.',
        'network_error',
        0,
      );
    }
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: string;
      code?: string;
    };
    if (!response.ok)
      throw new ApiError(
        data.error || 'Kunne ikke fullføre forespørselen.',
        data.code || 'request_failed',
        response.status,
      );
    return data;
  }
  private notify() {
    this.onStatus({
      pending: this.known.size,
      error: this.known.size ? this.error : '',
      durable: this.store.durable,
    });
  }
  async start() {
    const rows = await this.store.all();
    rows
      .filter((row) => row.userId === this.userId)
      .forEach((row) => this.known.set(row.id, row));
    this.notify();
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, 5000);
    window.addEventListener('online', this.online);
    void this.flush().catch(() => undefined);
  }
  private online = () => {
    void this.flush().catch(() => undefined);
  };
  stop() {
    clearInterval(this.timer);
    window.removeEventListener('online', this.online);
    this.beacon();
  }

  async mutation<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const record: PendingRecord = {
      id: String(body.id),
      userId: this.userId,
      path,
      body,
      createdAt: new Date().toISOString(),
      kind: 'mutation',
    };
    this.inFlight.add(record.id);
    this.known.set(record.id, record);
    try {
      await this.store.put(record);
    } catch (error) {
      this.inFlight.delete(record.id);
      this.error =
        error instanceof Error ? error.message : 'Kunne ikke mellomlagre data.';
      this.notify();
      throw error;
    }
    this.notify();
    try {
      const data = await BrowserApi.request<T>(path, body);
      await this.store.remove([record.id]);
      this.known.delete(record.id);
      this.error = '';
      this.notify();
      return data;
    } catch (error) {
      // Server validation/provider errors are final responses; transient delivery errors remain queued.
      if (
        (error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500) ||
        (error instanceof ApiError &&
          path === 'chat' &&
          [
            'ai_unavailable',
            'ai_key_invalid',
            'ai_not_configured',
            'ai_empty_response',
          ].includes(error.code))
      ) {
        await this.store.remove([record.id]);
        this.known.delete(record.id);
      }
      this.error = error instanceof Error ? error.message : 'Lagring venter.';
      this.notify();
      throw error;
    } finally {
      this.inFlight.delete(record.id);
    }
  }
  async record(
    type: string,
    payload: Record<string, Json> = {},
    attemptId?: string,
    activeMs = 0,
    stepId?: string,
  ) {
    const event = {
      id: crypto.randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      payload,
      ...(attemptId ? { attemptId } : {}),
      ...(stepId ? { stepId } : {}),
      activeMs,
    };
    const record: PendingRecord = {
      id: event.id,
      userId: this.userId,
      path: 'events',
      body: { sessionId: this.sessionId, event },
      createdAt: event.occurredAt,
      kind: 'event',
    };
    this.known.set(record.id, record);
    try {
      await this.store.put(record);
    } catch {
      this.error =
        'Nettleseren kunne ikke mellomlagre aktiviteten. Hold siden åpen og prøv synkronisering igjen.';
    }
    this.notify();
  }
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.deliver().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  private async deliver() {
    try {
      // Include durable records from prior tabs/reloads. Each id is deduplicated in PostgreSQL.
      (await this.store.all())
        .filter((row) => row.userId === this.userId)
        .forEach((row) => {
          if (!this.known.has(row.id)) this.known.set(row.id, row);
        });
      const rows = [...this.known.values()]
        .filter((row) => !this.inFlight.has(row.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (let index = 0; index < rows.length; ) {
        const row = rows[index];
        if (row.kind === 'event') {
          const batch: PendingRecord[] = [];
          while (
            index < rows.length &&
            rows[index].kind === 'event' &&
            rows[index].body.sessionId === row.body.sessionId &&
            batch.length < 40
          )
            batch.push(rows[index++]);
          await BrowserApi.request('events', {
            sessionId: row.body.sessionId,
            events: batch.map((item) => item.body.event),
          });
          await this.store.remove(batch.map((item) => item.id));
          batch.forEach((item) => this.known.delete(item.id));
        } else {
          // Requests currently awaited by the UI are not automatically regenerated.
          // A replay either returns the stored result or observes a pending chat turn.
          try {
            await BrowserApi.request(row.path, row.body);
          } catch (error) {
            if (
              !(error instanceof ApiError) ||
              error.status === 0 ||
              error.status >= 500
            )
              throw error;
          }
          await this.store.remove([row.id]);
          this.known.delete(row.id);
          index++;
        }
      }
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Lagring venter.';
      throw error;
    } finally {
      this.notify();
    }
  }
  beacon() {
    const rows = [...this.known.values()].filter((row) => row.kind === 'event');
    for (const sessionId of new Set(
      rows.map((row) => String(row.body.sessionId)),
    )) {
      const events = rows
        .filter((row) => row.body.sessionId === sessionId)
        .slice(0, 20)
        .map((row) => row.body.event);
      const payload = JSON.stringify({ sessionId, events });
      if (new TextEncoder().encode(payload).length < 60000)
        navigator.sendBeacon?.(
          '/api/events',
          new Blob([payload], { type: 'application/json' }),
        );
    }
  }
}

export type { TelemetryEvent };

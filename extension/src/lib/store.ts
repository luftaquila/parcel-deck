import browser from "webextension-polyfill";
import type { MallId, Order, ShipmentStage, SessionStatus } from "@parceldeck/shared";

/**
 * storage.local wrapper. Holds session state, last-collection
 * timestamps, and the order list. Everything lives in the browser's
 * local storage — nothing is transmitted or kept on any server.
 * (Policy: mall cookies are never persisted.)
 */

export type UpsertOrderInput = {
  mall: MallId;
  mallOrderId: string;
  /** Required for new orders. May be omitted when updating only tracking info on an existing one. */
  orderedAt?: string;
  displayName?: string | null;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  stageHint?: ShipmentStage;
  lastEventAt?: string | null;
  lastEventDescription?: string | null;
};

export type SortMode = "time" | "stage";

/** Korea Customs UNI-PASS public API settings. Without a key the customs panel is hidden. */
export type CustomsSettings = {
  unipassApiKey: string | null;    // CRKY — public API key from unipass.customs.go.kr
};

export type UserSettings = {
  fetchWindowDays: number;             // Collection and retention window (days). Default: 14.
  sortMode: SortMode;                  // Popup sort mode. Default: "stage".
  mallFilter: Partial<Record<MallId, boolean>>;  // Popup mall checkboxes (true = visible, false = hidden). Unset = visible.
  collectEnabled: boolean;             // Master collection toggle. When off, auto / manual / post-reset collection is all blocked. Default: true.
  customs: CustomsSettings;            // UNI-PASS customs lookup settings.
};

const DEFAULT_SETTINGS: UserSettings = {
  fetchWindowDays: 14,
  sortMode: "stage",
  mallFilter: {},
  collectEnabled: true,
  customs: { unipassApiKey: null },
};

/** Per-order user override. Kept separately from Order so it does not collide with auto-collected fields. */
export type OrderOverride = {
  international?: boolean;   // "Overseas" checkbox — triggers customs lookup. AliExpress is true by default.
};

export type SessionRecord = {
  status: SessionStatus;
  lastProbedAt: number | null;     // epoch ms
  lastChangedAt: number;
  failureCount: number;
  lastReason?: string;
};

type Schema = {
  sessions?: Partial<Record<MallId, SessionRecord>>;
  lastCollectAt?: Partial<Record<MallId, number>>;
  collecting?: Partial<Record<MallId, boolean>>;  // per-mall "collecting in progress" flag (for the UI spinner)
  orders?: Order[];
  settings?: UserSettings;
  orderOverrides?: Record<string, OrderOverride>;  // orderId → user override
};

const KEY = "parceldeck_state";

async function read(): Promise<Schema> {
  const got = await browser.storage.local.get(KEY);
  return (got[KEY] as Schema) ?? {};
}

async function write(next: Schema): Promise<void> {
  await browser.storage.local.set({ [KEY]: next });
}

async function patch(updater: (s: Schema) => Schema): Promise<Schema> {
  const cur = await read();
  const next = updater({ ...cur });
  await write(next);
  return next;
}

function makeOrderKey(mall: MallId, mallOrderId: string): string {
  return `${mall}:${mallOrderId}`;
}

export const store = {
  async getSession(mall: MallId): Promise<SessionRecord> {
    const s = await read();
    return (
      s.sessions?.[mall] ?? {
        status: "unknown",
        lastProbedAt: null,
        lastChangedAt: Date.now(),
        failureCount: 0,
      }
    );
  },
  async getAllSessions(): Promise<Partial<Record<MallId, SessionRecord>>> {
    const s = await read();
    return s.sessions ?? {};
  },
  async setSession(mall: MallId, rec: SessionRecord) {
    await patch((s) => ({ ...s, sessions: { ...s.sessions, [mall]: rec } }));
  },
  async setLastCollectAt(mall: MallId, ts: number) {
    await patch((s) => ({ ...s, lastCollectAt: { ...s.lastCollectAt, [mall]: ts } }));
  },
  async getLastCollectAt(mall: MallId): Promise<number | null> {
    const s = await read();
    return s.lastCollectAt?.[mall] ?? null;
  },
  async setCollecting(mall: MallId, value: boolean) {
    await patch((s) => ({ ...s, collecting: { ...s.collecting, [mall]: value } }));
  },
  async getCollectingMap(): Promise<Partial<Record<MallId, boolean>>> {
    const s = await read();
    return s.collecting ?? {};
  },

  // ─── Orders ─────────────────────────────────────────────────────────────
  async listOrders(): Promise<Order[]> {
    const s = await read();
    const orders = s.orders ?? [];
    // Default sort: newest order first.
    return [...orders].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
  },

  async upsertOrders(inputs: UpsertOrderInput[]): Promise<Order[]> {
    if (inputs.length === 0) return await this.listOrders();
    await patch((s) => {
      const cur = s.orders ?? [];
      const map = new Map(cur.map((o) => [makeOrderKey(o.mall, o.mallOrderId), o]));
      const now = new Date().toISOString();
      for (const item of inputs) {
        const key = makeOrderKey(item.mall, item.mallOrderId);
        const prev = map.get(key);
        const merged: Order = prev
          ? {
              ...prev,
              // Keep existing values; only overwrite when a new value is provided.
              orderedAt: item.orderedAt ?? prev.orderedAt,
              displayName: item.displayName ?? prev.displayName,
              trackingNumber: item.trackingNumber ?? prev.trackingNumber,
              carrierCode: item.carrierCode ?? prev.carrierCode,
              stage: item.stageHint ?? prev.stage,
              lastEventAt: item.lastEventAt ?? prev.lastEventAt,
              lastEventDescription: item.lastEventDescription ?? prev.lastEventDescription,
              updatedAt: now,
            }
          : {
              id: crypto.randomUUID(),
              mall: item.mall,
              mallOrderId: item.mallOrderId,
              orderedAt: item.orderedAt ?? now,  // If a new order has no order date, fall back to collection time.
              displayName: item.displayName ?? null,
              trackingNumber: item.trackingNumber ?? null,
              carrierCode: item.carrierCode ?? null,
              stage: item.stageHint ?? "pending",
              lastEventAt: item.lastEventAt ?? null,
              lastEventDescription: item.lastEventDescription ?? null,
              updatedAt: now,
            };
        map.set(key, merged);
      }
      return { ...s, orders: Array.from(map.values()) };
    });
    return await this.listOrders();
  },

  async patchOrder(id: string, changes: Partial<Order>): Promise<Order | null> {
    let out: Order | null = null;
    await patch((s) => {
      const cur = s.orders ?? [];
      const next = cur.map((o) => {
        if (o.id !== id) return o;
        out = { ...o, ...changes, updatedAt: new Date().toISOString() };
        return out;
      });
      return { ...s, orders: next };
    });
    return out;
  },

  /** Apply the same patch to every order matching predicate. Returns the number of updated orders. */
  async patchOrdersWhere(
    predicate: (o: Order) => boolean,
    changes: Partial<Order>
  ): Promise<number> {
    let updated = 0;
    await patch((s) => {
      const cur = s.orders ?? [];
      const nowIso = new Date().toISOString();
      const next = cur.map((o) => {
        if (!predicate(o)) return o;
        updated++;
        return { ...o, ...changes, updatedAt: nowIso };
      });
      return { ...s, orders: next };
    });
    return updated;
  },

  async deleteOrdersWhere(predicate: (o: Order) => boolean): Promise<number> {
    let removed = 0;
    await patch((s) => {
      const cur = s.orders ?? [];
      const next = cur.filter((o) => {
        const shouldRemove = predicate(o);
        if (shouldRemove) removed++;
        return !shouldRemove;
      });
      return { ...s, orders: next };
    });
    return removed;
  },

  /** Remove orders whose orderedAt is before the cutoff (used when the retention window shrinks). */
  async deleteOrdersOrderedBefore(cutoffMs: number): Promise<number> {
    let removed = 0;
    await patch((s) => {
      const cur = s.orders ?? [];
      const next = cur.filter((o) => {
        const ts = Date.parse(o.orderedAt);
        const shouldRemove = Number.isFinite(ts) && ts < cutoffMs;
        if (shouldRemove) removed++;
        return !shouldRemove;
      });
      return { ...s, orders: next };
    });
    return removed;
  },

  async deleteOrdersBefore(cutoffMs: number, onlyDelivered = true): Promise<number> {
    let removed = 0;
    await patch((s) => {
      const cur = s.orders ?? [];
      const next = cur.filter((o) => {
        const ts = Date.parse(o.updatedAt);
        const shouldRemove =
          (!onlyDelivered || o.stage === "delivered") &&
          Number.isFinite(ts) &&
          ts < cutoffMs;
        if (shouldRemove) removed++;
        return !shouldRemove;
      });
      return { ...s, orders: next };
    });
    return removed;
  },

  // ─── Settings ───────────────────────────────────────────────────────────
  async getSettings(): Promise<UserSettings> {
    const s = await read();
    const raw = s.settings ?? {};
    // retentionDays was dropped — strip it from any legacy payload.
    const { retentionDays: _r, ...rest } = raw as UserSettings & { retentionDays?: unknown };
    void _r;
    const merged = { ...DEFAULT_SETTINGS, ...rest };
    if (merged.sortMode !== "time" && merged.sortMode !== "stage") merged.sortMode = "stage";
    return merged;
  },
  async updateSettings(changes: Partial<UserSettings>): Promise<UserSettings> {
    let out: UserSettings = { ...DEFAULT_SETTINGS };
    await patch((s) => {
      const cur = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
      // `customs` is a nested object, so merge it explicitly to avoid the shallow spread wiping fields.
      const customs = changes.customs
        ? { ...cur.customs, ...changes.customs }
        : cur.customs;
      out = { ...cur, ...changes, customs };
      return { ...s, settings: out };
    });
    return out;
  },

  // ─── Reset ──────────────────────────────────────────────────────────────
  /** Preserves user settings (UNI-PASS key, sort mode, mall filter, retention window,
   *  collection toggle) while wiping sessions, orders, collection flags, and overrides. */
  async reset(): Promise<void> {
    const settings = await this.getSettings();
    await browser.storage.local.clear();
    await this.updateSettings(settings);
  },

  // ─── Order overrides ────────────────────────────────────────────────────
  async getOrderOverride(id: string): Promise<OrderOverride> {
    const s = await read();
    return s.orderOverrides?.[id] ?? {};
  },
  async getAllOrderOverrides(): Promise<Record<string, OrderOverride>> {
    const s = await read();
    return s.orderOverrides ?? {};
  },
  async setOrderOverride(id: string, patchObj: Partial<OrderOverride>): Promise<OrderOverride> {
    let out: OrderOverride = {};
    await patch((s) => {
      const prev = s.orderOverrides?.[id] ?? {};
      out = { ...prev, ...patchObj };
      return { ...s, orderOverrides: { ...s.orderOverrides, [id]: out } };
    });
    return out;
  },
};

import type { MallId, ShipmentStage } from "@parceldeck/shared";

/**
 * Collector contract.
 * Collection happens entirely inside the extension and results are
 * kept only in browser.storage.local. Collectors throw
 * UnauthenticatedError the moment they detect that the session is no
 * longer valid during an HTTP exchange.
 */

export class UnauthenticatedError extends Error {
  constructor(public readonly reason: string) {
    super(`unauthenticated: ${reason}`);
  }
}

export class UnsupportedError extends Error {
  constructor(public readonly reason: string) {
    super(`unsupported: ${reason}`);
  }
}

export type CollectedOrder = {
  mall: MallId;
  mallOrderId: string;
  orderedAt: string;       // ISO
  displayName: string;
  trackingNumber: string | null;
  carrierCode: string | null;
  stageHint?: ShipmentStage;
  lastEventAt?: string | null;
  lastEventDescription?: string | null;
};

export interface MallCollector {
  readonly id: MallId;
  /** Lightweight check of the session. */
  probe(): Promise<"authenticated" | "expired">;
  /** Collect recent orders (only those newer than `sinceMs` if provided). */
  collect(options: { sinceMs?: number | null }): Promise<CollectedOrder[]>;
  /** Keep-alive ping. Failures are harmless. */
  keepAlive?(): Promise<void>;
}

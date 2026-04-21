import { z } from "zod";

export const MallId = z.enum(["coupang", "naver", "aliexpress"]);
export type MallId = z.infer<typeof MallId>;

/**
 * Session state machine.
 * unknown       : not probed yet
 * authenticated : login confirmed (recent probe succeeded)
 * expired       : login lost (401/302/login page observed)
 * refreshing    : user is re-logging in (sitting on the login page)
 * unsupported   : automatic collection blocked (2FA, captcha, repeated failures)
 */
export const SessionStatus = z.enum([
  "unknown",
  "authenticated",
  "expired",
  "refreshing",
  "unsupported",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/**
 * Shipment stage — a simplified subset of tracker.delivery's taxonomy.
 */
export const ShipmentStage = z.enum([
  "pending",       // waiting to ship (no tracking number yet)
  "information_received",
  "at_pickup",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "unknown",
]);
export type ShipmentStage = z.infer<typeof ShipmentStage>;

/**
 * Locally stored Order — minimal fields only. Addresses, contacts, and
 * payment data are not persisted. Since data stays inside the browser
 * profile (storage.local), the item name is kept in plain text.
 */
export const Order = z.object({
  id: z.string(),
  mall: MallId,
  mallOrderId: z.string(),
  orderedAt: z.iso.datetime(),
  displayName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  carrierCode: z.string().nullable(),   // tracker.delivery carrier id (e.g. "kr.cjlogistics")
  stage: ShipmentStage,
  lastEventAt: z.iso.datetime().nullable(),
  lastEventDescription: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type Order = z.infer<typeof Order>;

/**
 * Customs stage — a simplified view of the UNI-PASS cargo progress
 * events. Used for timeline colors and labels.
 */
export const CustomsStage = z.enum([
  "arrived",      // port arrival / unloading declaration
  "warehoused",   // admission into a bonded warehouse
  "declared",     // import (manifest) declaration
  "inspecting",   // review / inspection
  "cleared",      // import declaration accepted
  "released",     // release from bonded area
  "other",        // unknown or out-of-scope event
]);
export type CustomsStage = z.infer<typeof CustomsStage>;

export const CustomsEvent = z.object({
  time: z.iso.datetime(),
  description: z.string(),     // raw UNI-PASS text (for example, bonded-warehouse admission / import declaration accepted)
  stage: CustomsStage,
  location: z.string().nullable(),   // bonded area, port, etc. (shedNm)
});
export type CustomsEvent = z.infer<typeof CustomsEvent>;

/** Customs progress per tracking number. Kept only in UI caches (never persisted to Order). */
export const CustomsProgress = z.object({
  cargMtNo: z.string().nullable(),       // cargo management number
  hsCode: z.string().nullable(),
  declaredValueKrw: z.number().nullable(),
  events: z.array(CustomsEvent),         // chronological (oldest first)
  fetchedAt: z.iso.datetime(),
});
export type CustomsProgress = z.infer<typeof CustomsProgress>;

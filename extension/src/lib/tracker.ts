import type { ShipmentStage } from "@parceldeck/shared";

/**
 * tracker.delivery V1 REST client.
 *
 * Unauthenticated API with IP-based rate limiting.
 * Endpoint: GET https://apis.tracker.delivery/carriers/:carrier_id/tracks/:track_id
 */

const BASE_URL = "https://apis.tracker.delivery";

export type TrackEvent = {
  time: string;
  description: string;
  stage: ShipmentStage;
};

export type TrackResult = {
  stage: ShipmentStage;
  lastEvent: TrackEvent | null;
};

export type TrackDetail = {
  stage: ShipmentStage;
  progresses: TrackEvent[];   // chronological (oldest first)
};

export class TrackerCarrierNotSupported extends Error {
  constructor(carrierCode: string) {
    super(`tracker.delivery doesn't support carrier: ${carrierCode}`);
    this.name = "TrackerCarrierNotSupported";
  }
}

const warnedStatuses = new Set<string>();
function warnUnmappedStatus(value: string) {
  if (warnedStatuses.has(value)) return;
  warnedStatuses.add(value);
  console.warn(`[ParcelDeck tracker] unmapped status.id: ${JSON.stringify(value)}`);
}

function mapStage(id: string | undefined): ShipmentStage {
  switch (id) {
    case "information_received": return "information_received";
    case "at_pickup": return "at_pickup";
    case "in_transit": return "in_transit";
    case "out_for_delivery": return "out_for_delivery";
    case "delivered": return "delivered";
    default:
      if (id) warnUnmappedStatus(id);
      return "unknown";
  }
}

type V1Response = {
  state?: { id?: string; text?: string };
  progresses?: Array<{
    time?: string;
    status?: { id?: string; text?: string };
    description?: string;
  }>;
};

export async function trackShipment(carrierCode: string, trackingNumber: string): Promise<TrackResult | null> {
  const url = `${BASE_URL}/carriers/${encodeURIComponent(carrierCode)}/tracks/${encodeURIComponent(trackingNumber)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "ParcelDeck/0.1",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 400) throw new TrackerCarrierNotSupported(carrierCode);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tracker.delivery: HTTP ${res.status}`);

  const json = (await res.json()) as V1Response;
  const stage = mapStage(json.state?.id);
  const lastProgress = json.progresses?.[json.progresses.length - 1];
  const lastEvent: TrackEvent | null = lastProgress?.time
    ? {
      time: lastProgress.time,
      description: lastProgress.description ?? "",
      stage: mapStage(lastProgress.status?.id),
    }
    : null;

  return { stage, lastEvent };
}

/**
 * For tracking numbers without an identified carrier, probes
 * tracker.delivery's Korean-courier endpoints in parallel and picks
 * the first 200 OK in priority order.
 *
 * The priority roughly follows domestic market share, so we confirm
 * common carriers first. The requests run in parallel but the answer
 * is selected in priority order — when a tracking number happens to
 * match multiple carriers, the same one is chosen deterministically.
 */
const PROBE_CARRIER_IDS = [
  "kr.cjlogistics",
  "kr.hanjin",
  "kr.lotte",
  "kr.epost",
  "kr.logen",
  "kr.coupangls",
  "kr.kdexp",
  "kr.cvsnet",
  "kr.cupost",
  "kr.chunilps",
  "kr.hdexp",
  "kr.daesin",
  "kr.ilyanglogis",
  "kr.slx",
  "kr.honamlogis",
  "kr.yongmalogis",
  "kr.kunyoung",
  "kr.homepick",
  "kr.epost.ems",
];

export type ProbeResult = { carrierId: string; detail: TrackDetail };

export async function probeCarrierForTracking(trackingNumber: string): Promise<ProbeResult | null> {
  // Shared cancel controller — once the first winner is locked in, abort the rest to save bandwidth.
  const ac = new AbortController();
  const timeoutSignal = AbortSignal.timeout(6_000);
  timeoutSignal.addEventListener("abort", () => ac.abort(), { once: true });

  type TaskResult = { id: string; ok: boolean; detail?: TrackDetail };
  const tasks = PROBE_CARRIER_IDS.map(async (id, idx): Promise<TaskResult> => {
    try {
      const url = `${BASE_URL}/carriers/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackingNumber)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ac.signal,
      });
      if (res.status !== 200) return { id, ok: false };
      const json = (await res.json()) as V1Response;
      const stage = mapStage(json.state?.id);
      const progresses: TrackEvent[] = [];
      for (const p of json.progresses ?? []) {
        if (!p.time) continue;
        progresses.push({ time: p.time, description: p.description ?? "", stage: mapStage(p.status?.id) });
      }
      return { id, ok: true, detail: { stage, progresses } };
    } catch {
      return { id, ok: false };
    } finally {
      void idx;
    }
  });

  // Wait only as far as the earliest confirmed carrier, then cancel the rest.
  // But because a tracking number can hit multiple carriers, we keep waiting past
  // earlier entries that return "false" in case a later entry matches.
  try {
    for (let i = 0; i < tasks.length; i++) {
      const r = await tasks[i]!;
      if (r.ok && r.detail) {
        ac.abort();
        return { carrierId: r.id, detail: r.detail };
      }
    }
    return null;
  } finally {
    ac.abort();
  }
}

/** Returns the full event history. Called from the popup detail panel. */
export async function trackShipmentDetail(carrierCode: string, trackingNumber: string): Promise<TrackDetail | null> {
  const url = `${BASE_URL}/carriers/${encodeURIComponent(carrierCode)}/tracks/${encodeURIComponent(trackingNumber)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "ParcelDeck/0.1",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 400) throw new TrackerCarrierNotSupported(carrierCode);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tracker.delivery: HTTP ${res.status}`);

  const json = (await res.json()) as V1Response;
  const stage = mapStage(json.state?.id);
  const progresses: TrackEvent[] = [];
  for (const p of json.progresses ?? []) {
    if (!p.time) continue;
    progresses.push({
      time: p.time,
      description: p.description ?? "",
      stage: mapStage(p.status?.id),
    });
  }
  return { stage, progresses };
}

/** Seconds to wait before the next poll, by stage. Tighter cadence the closer delivery gets. */
export function nextPollDelaySec(stage: ShipmentStage, failureCount = 0): number {
  const base =
    stage === "out_for_delivery" ? 1200 :
    stage === "in_transit" ? 3600 :
    stage === "delivered" ? 0 :
    1800;
  if (failureCount === 0) return base;
  const backoff = base * Math.pow(2, Math.min(failureCount, 5));
  return Math.min(backoff, 21600);
}

import type { MallId } from "@parceldeck/shared";
import type { MallCollector } from "./types.js";
import { coupangCollector } from "./coupang.js";
import { naverCollector } from "./naver.js";
import { aliexpressCollector } from "./aliexpress.js";

export const COLLECTORS: Record<MallId, MallCollector> = {
  coupang: coupangCollector,
  naver: naverCollector,
  aliexpress: aliexpressCollector,
};

export type { MallCollector };

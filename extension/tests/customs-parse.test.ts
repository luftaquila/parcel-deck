import { describe, it, expect } from "vitest";
import { CustomsApiError, parseResponse } from "../src/lib/customs.js";

/**
 * XML parser tests for the UNI-PASS cargo-clearance-progress response
 * (cargCsclPrgsInfoQry).
 * Uses a minimal fixed sample shaped like the real
 * cargCsclPrgsInfoQryRtnVo schema.
 */

describe("parseResponse — UNI-PASS cargCsclPrgsInfoQry", () => {
  it("classifies multiple progress events and sorts them chronologically", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <tCnt>1</tCnt>
  <cargMtNo>21ABCDEF01234</cargMtNo>
  <hsSgn>8471.30</hsSgn>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>하선신고</csclPrgsStts>
    <prcsDttm>202604201030</prcsDttm>
    <shedNm>인천공항</shedNm>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>반입신고</csclPrgsStts>
    <prcsDttm>202604201415</prcsDttm>
    <shedNm>인천공항 자유무역지역</shedNm>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>수입신고</csclPrgsStts>
    <prcsDttm>202604210900</prcsDttm>
    <shedNm>인천공항 자유무역지역</shedNm>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>수입신고수리</csclPrgsStts>
    <prcsDttm>202604211145</prcsDttm>
    <shedNm>인천공항 자유무역지역</shedNm>
  </cargCsclPrgsInfoDtlQryVo>
</cargCsclPrgsInfoQryRtnVo>`;
    const progress = parseResponse(xml);
    expect(progress).not.toBeNull();
    expect(progress!.cargMtNo).toBe("21ABCDEF01234");
    expect(progress!.hsCode).toBe("8471.30");
    expect(progress!.events.length).toBe(4);

    // Chronological order (oldest -> newest)
    expect(progress!.events[0]!.description).toBe("하선신고");
    expect(progress!.events[1]!.description).toBe("반입신고");
    expect(progress!.events[2]!.description).toBe("수입신고");
    expect(progress!.events[3]!.description).toBe("수입신고수리");

    // Stage classification
    expect(progress!.events[0]!.stage).toBe("arrived");      // unloading declaration
    expect(progress!.events[1]!.stage).toBe("warehoused");   // warehouse admission
    expect(progress!.events[2]!.stage).toBe("declared");     // import declaration, not yet accepted
    expect(progress!.events[3]!.stage).toBe("cleared");      // declaration accepted

    // Time normalization (KST -> ISO)
    expect(progress!.events[0]!.time).toBe("2026-04-20T10:30:00+09:00");

    // Location extraction
    expect(progress!.events[0]!.location).toBe("인천공항");
  });

  it("returns null for an empty response (tCnt=0)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <tCnt>0</tCnt>
</cargCsclPrgsInfoQryRtnVo>`;
    expect(parseResponse(xml)).toBeNull();
  });

  it("returns null when the response has no detail elements", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <cargMtNo>21TEST</cargMtNo>
</cargCsclPrgsInfoQryRtnVo>`;
    expect(parseResponse(xml)).toBeNull();
  });

  it("throws CustomsApiError when errMsgCn is present", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <errMsgCn>인증키가 올바르지 않습니다.</errMsgCn>
</cargCsclPrgsInfoQryRtnVo>`;
    expect(() => parseResponse(xml)).toThrow(CustomsApiError);
    try { parseResponse(xml); } catch (e) {
      expect((e as CustomsApiError).code).toBe("api");
      expect((e as CustomsApiError).message).toContain("인증키");
    }
  });

  it("treats 'no results' messages as empty results, not errors", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <errMsgCn>조회 결과가 없습니다.</errMsgCn>
  <tCnt>0</tCnt>
</cargCsclPrgsInfoQryRtnVo>`;
    expect(parseResponse(xml)).toBeNull();
  });

  it("throws CustomsApiError on XML parse failure", () => {
    expect(() => parseResponse("not-xml-at-all<<>>")).toThrow(CustomsApiError);
  });

  it("skips detail rows that are missing time or description", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <tCnt>1</tCnt>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>반입신고</csclPrgsStts>
    <prcsDttm></prcsDttm>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>수입신고수리</csclPrgsStts>
    <prcsDttm>202604211145</prcsDttm>
  </cargCsclPrgsInfoDtlQryVo>
</cargCsclPrgsInfoQryRtnVo>`;
    const progress = parseResponse(xml);
    expect(progress).not.toBeNull();
    expect(progress!.events.length).toBe(1);
    expect(progress!.events[0]!.description).toBe("수입신고수리");
    expect(progress!.events[0]!.location).toBeNull();
  });

  it("drops events whose timestamps are outside valid month/day/hour ranges", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <tCnt>1</tCnt>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>잘못된시간</csclPrgsStts>
    <prcsDttm>202613321650</prcsDttm>
  </cargCsclPrgsInfoDtlQryVo>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>정상</csclPrgsStts>
    <prcsDttm>202604210900</prcsDttm>
  </cargCsclPrgsInfoDtlQryVo>
</cargCsclPrgsInfoQryRtnVo>`;
    const progress = parseResponse(xml);
    expect(progress).not.toBeNull();
    expect(progress!.events.length).toBe(1);
    expect(progress!.events[0]!.description).toBe("정상");
  });

  it("accepts ISO 8601 timestamps too", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cargCsclPrgsInfoQryRtnVo>
  <tCnt>1</tCnt>
  <cargCsclPrgsInfoDtlQryVo>
    <csclPrgsStts>반출</csclPrgsStts>
    <prcsDttm>2026-04-22T14:30:00+09:00</prcsDttm>
  </cargCsclPrgsInfoDtlQryVo>
</cargCsclPrgsInfoQryRtnVo>`;
    const progress = parseResponse(xml);
    expect(progress!.events[0]!.stage).toBe("released");
  });
});

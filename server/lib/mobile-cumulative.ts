// server/lib/mobile-cumulative.ts
//
// 작업명: MCC_VERIFIED_HTML_OUTPUT_PORT_TO_BACKEND_1
//
// 모바일 "누적"(월 누적, 마감 공지텍스트의 앞 숫자) — 어제 확정한 REFERENCE SNAPSHOT
// ("텔링크: 221/17" 등)의 앞 숫자(누적) source를 실제 스프레드시트에서 추적해서 찾은
// 결과를 그대로 이식한 것이다. 새 공식을 만든 것이 아니다.
//
// [추적 근거]
// - 스프레드시트 25개 시트 전체를 수식 스캔한 결과, "개통처리부" 시트가 "■당일완료"/
//   "1.SK"/"2.KT"/"3.LG"와 완전히 동일한 VLOOKUP 수식 구조(작업자/요청점 등 같은 컬럼
//   배치, 같은 "필터링"/"담당_판매점명" 참조)를 갖고 있다 — 같은 워크플로의 다른 단계
//   (당일 완료 뷰 vs 월 전체 누적 로그)임을 구조적으로 확인했다.
// - 이번 달 파일("★개통현황_9월26년") 안의 "개통처리부"는 현재 라이브 기준 4,664행,
//   개통일 9/1~9/16 분포 — 날짜 필터 없이 기존 classifyReq()로 전체를 분류한 카테고리별
//   건수가 REFERENCE SNAPSHOT 숫자와 근접/정확 일치했다(예: 중고LG 2=2, 밸류컴 11=11,
//   카카오SK 4=4, 프리티LG 6=6 완전 일치 / 텔링크·엠모바일·미디어 등은 라이브가 더 큼 —
//   스냅샷 캡처 이후 라이브 시트가 계속 늘어난 자연스러운 시간차로 설명됨).
// - "개통처리부"의 필터 수식(원본에서 요청점이 "후불)/선불)/단말)"로 시작하는 행만 포함)이
//   "■당일완료"와 동일해서, 두 시트가 같은 모집단(기타업무/유심 제외, 모바일 개통 완료
//   건)을 다루고 있음도 확인했다.
// - "취소" 시트는 이 계산에서 전혀 읽지 않았다(기존 절대 원칙 유지). "개통처리부" 행수가
//   REFERENCE와 이미 잘 맞는다는 사실 자체가 취소 건이 이 시트에서 빠진 상태로 유지된다는
//   간접 증거이지만, 이 이상은 추측하지 않는다 — "취소가 반영되는 메커니즘 자체"를 코드로
//   재구현하지 않고, 이미 취소 반영이 끝난 결과물("개통처리부")을 그대로 읽기만 한다.
// - "데이터유심"은 예외다 — 요청점/classifyReq 체계가 아니라 전용 시트이고, 그 시트 자체의
//   행수가 곧 값이다(카테고리 분류 없음).
//
// 절대 원칙:
// - classifyReq()(performance-classify.ts)를 그대로 재사용한다 — 새 분류 규칙 없음.
// - 날짜 필터를 걸지 않는다(전체 스프레드시트 파일 자체가 이미 월 단위로 분리되어 있으므로
//   "개통처리부" 전체 = 이번 달 누적).
// - "취소" 시트는 절대 읽지 않는다.

import { fetchSheetValues } from "./google-sheets-client";
import { classifyReq, type Network } from "./performance-classify";

export const MOBILE_MASTER_LEDGER_SHEET = "개통처리부";
export const DATA_USIM_SHEET = "데이터유심";

export interface MobileCumulativeCategoryCount {
  net: Network;
  cat: string;
  count: number;
}

export interface MobileCumulativeRaw {
  sourceSheet: string;
  raw: number; // "개통처리부" 요청점 유효 행수 (날짜 필터 없음 = 이번 달 누적)
  byCategory: MobileCumulativeCategoryCount[];
  byCategoryMap: Record<string, number>; // cat -> count
  dataUsimSourceSheet: string;
  dataUsimCumulative: number; // "데이터유심" 시트 전체 유효 행수
}

/**
 * "개통처리부"(이번 달 전체 개통 마스터 로그, 날짜 필터 없음)를 기존 classifyReq()로
 * 분류해서 카테고리별 누적 건수를 계산한다. + "데이터유심" 시트 자체 행수(누적).
 */
export async function computeMobileCumulativeRaw(): Promise<MobileCumulativeRaw> {
  const values = await fetchSheetValues(MOBILE_MASTER_LEDGER_SHEET);
  const byCategoryMap: Record<string, number> = {};
  const netByCat: Record<string, Network> = {};
  let raw = 0;

  if (values.length > 0) {
    const header = values[0];
    const reqIdx = header.indexOf("요청점");
    if (reqIdx < 0) {
      throw new Error(
        `[MobileCumulative] "${MOBILE_MASTER_LEDGER_SHEET}" 시트에서 요청점 컬럼을 찾지 못했습니다. ` +
          `헤더: ${header.join(", ")}`,
      );
    }
    const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
    for (const r of rows) {
      const req = String(r[reqIdx] ?? "").trim();
      if (!req) continue;
      const c = classifyReq(req);
      byCategoryMap[c.cat] = (byCategoryMap[c.cat] || 0) + 1;
      netByCat[c.cat] = c.net;
      raw++;
    }
  }

  const dataUsimValues = await fetchSheetValues(DATA_USIM_SHEET);
  const dataUsimCumulative =
    dataUsimValues.length > 0
      ? dataUsimValues.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== "")).length
      : 0;

  const byCategory: MobileCumulativeCategoryCount[] = Object.entries(byCategoryMap).map(([cat, count]) => ({
    net: netByCat[cat],
    cat,
    count,
  }));

  return {
    sourceSheet: MOBILE_MASTER_LEDGER_SHEET,
    raw,
    byCategory,
    byCategoryMap,
    dataUsimSourceSheet: DATA_USIM_SHEET,
    dataUsimCumulative,
  };
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "데이터유심" 시트에는 개통일 개념이 없어(요청점/개통 이벤트 없음), 접수일이 오늘인 건을 당일로 본다. */
export async function computeDataUsimDaily(date: Date): Promise<number> {
  const values = await fetchSheetValues(DATA_USIM_SHEET);
  if (values.length === 0) return 0;
  const header = values[0];
  const receiptIdx = header.indexOf("접수일");
  if (receiptIdx < 0) return 0;

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const variants = [`${m}/${d}`, `${two(m)}/${two(d)}`, `${m}.${d}`];

  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return rows.filter((r) => variants.includes(String(r[receiptIdx] ?? "").trim())).length;
}

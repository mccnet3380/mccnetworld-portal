// server/lib/activation-dealer-matcher.ts
//
// 작업명: MCC_SETTLEMENT_GOOGLE_SHEETS_ACTIVATION_IMPORT_IMPLEMENTATION_1
//
// server/routes.ts의 기존 POST /api/admin/activations/upload 핸들러 안에 있는 "M코드 기반
// 5단계 매칭 엔진"을 그대로(우선순위/조건 한 글자도 안 바꾸고) 복제했다. 기존 Excel 라우트
// 자체는 건드리지 않고(§ 계획 3의 안전 판단), Google Sheets import 경로가 동일한 판매점
// 매칭 규칙을 쓰도록 이 모듈을 신규로 둔다. contact_codes/dealer_registrations 조회는
// 전부 기존 IStorage 메서드(getContactCodesByMCodeAndCode 등, 무수정) 그대로 사용한다.

import { getStorage } from "../storage";

export interface DealerMatchResult {
  dealerRegistrationId: number | null;
  contactCodeId: number | null;
  dealerName: string | null;
  codeName: string | null;
  realSalesPOS: string | null;
  subDealerName: string | null;
  matchingStatus: string;
  matchingBasis: string | null;
}

export type DealerMatchCache = Map<string, any[]>;

export function createDealerMatchCache(): DealerMatchCache {
  return new Map();
}

async function cachedList(cache: DealerMatchCache, key: string, fetcher: () => Promise<any[]>): Promise<any[]> {
  if (cache.has(key)) return cache.get(key)!;
  const v = await fetcher();
  cache.set(key, v);
  return v;
}

/**
 * mccCodeRaw/contactCodeVal/codeNameRaw/dealerNameRaw = 원본 Excel/Sheets 행에서 그대로 뽑은
 * 문자열(정규화 없이). 우선순위: M코드+접점코드 → M코드+코드명 → 접점코드단독 → M코드단독 →
 * 판매점명/코드명 보조. 기존 activations/upload 라우트의 동일 로직과 완전히 동일하다.
 */
export async function matchActivationDealer(
  mccCodeRaw: string | null,
  contactCodeVal: string | null,
  codeNameRaw: string | null,
  dealerNameRaw: string | null,
  cache: DealerMatchCache,
): Promise<DealerMatchResult> {
  let dealerRegistrationId: number | null = null;
  let contactCodeId: number | null = null;
  let resolvedDealerName: string | null = dealerNameRaw;
  let resolvedCodeName: string | null = codeNameRaw;
  let realSalesPOS: string | null = null;
  let subDealerName: string | null = null;
  let matchingStatus = 'unmatched';
  let matchingBasis: string | null = null;

  const resolveFromCC = (ccRec: any) => {
    contactCodeId = ccRec.id ?? null;
    dealerRegistrationId = ccRec.dealerRegistrationId ?? null;
    if (!resolvedDealerName) resolvedDealerName = ccRec.dealerName ?? null;
    realSalesPOS = ccRec.realSalesPOS ?? null;
    subDealerName = ccRec.subDealerName ?? null;
    if (!resolvedCodeName) resolvedCodeName = ccRec.codeName ?? null;
  };

  // Step 1: M코드 + 접점코드
  if (matchingStatus === 'unmatched' && mccCodeRaw && contactCodeVal) {
    const hits = await cachedList(cache, `mc+cc:${mccCodeRaw}:${contactCodeVal}`,
      () => getStorage().getContactCodesByMCodeAndCode(mccCodeRaw!, contactCodeVal!));
    if (hits.length === 1) {
      resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = 'M코드+접점코드';
    } else if (hits.length > 1) {
      resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = 'M코드+접점코드(중복)';
    }
  }

  // Step 2: M코드 + 코드명
  if (matchingStatus === 'unmatched' && mccCodeRaw && codeNameRaw) {
    const hits = await cachedList(cache, `mc+cn:${mccCodeRaw}:${codeNameRaw}`,
      () => getStorage().getContactCodesByMCodeAndCodeName(mccCodeRaw!, codeNameRaw!));
    if (hits.length === 1) {
      resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = 'M코드+코드명';
    } else if (hits.length > 1) {
      resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = 'M코드+코드명(중복)';
    }
  }

  // Step 3: 접점코드 단독
  if (matchingStatus === 'unmatched' && contactCodeVal) {
    const hits = await cachedList(cache, `cc:${contactCodeVal}`,
      () => getStorage().getContactCodesByCodeAll(contactCodeVal!));
    if (hits.length === 1) {
      resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = '접점코드단독';
    } else if (hits.length > 1) {
      resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = '접점코드단독(중복)';
    }
  }

  // Step 4: M코드 단독
  if (matchingStatus === 'unmatched' && mccCodeRaw) {
    const hits = await cachedList(cache, `mc:${mccCodeRaw}`,
      () => getStorage().getContactCodesByMCode(mccCodeRaw!));
    if (hits.length === 1) {
      resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = 'M코드단독';
    } else if (hits.length > 1) {
      resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = 'M코드단독(중복)';
    }
  }

  // Step 5: 판매점명/코드명 보조
  if (matchingStatus === 'unmatched') {
    const dn = dealerNameRaw;
    const cn = codeNameRaw;
    if (dn || cn) {
      const hits = await cachedList(cache, `nm:${dn ?? ''}:${cn ?? ''}`,
        () => getStorage().getContactCodesByNameFields(dn, cn));
      if (hits.length === 1) {
        resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = '판매점명/코드명보조';
      } else if (hits.length > 1) {
        resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = '판매점명/코드명보조(중복)';
      }
    }
  }

  return {
    dealerRegistrationId,
    contactCodeId,
    dealerName: resolvedDealerName,
    codeName: resolvedCodeName,
    realSalesPOS,
    subDealerName,
    matchingStatus,
    matchingBasis,
  };
}

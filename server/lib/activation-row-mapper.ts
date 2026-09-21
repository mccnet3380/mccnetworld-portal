// server/lib/activation-row-mapper.ts
//
// 작업명: MCC_SETTLEMENT_GOOGLE_SHEETS_ACTIVATION_IMPORT_IMPLEMENTATION_1
//
// "개통처리부"(Google Sheets) 한 행을 activation_records insert 입력으로 변환하는 순수
// 함수(DB 호출 없음). ACTIVATION_COL_MAP은 server/routes.ts의 기존
// POST /api/admin/activations/upload 핸들러 안 COL_MAP을 값 그대로 복제한 것이다(감사
// 보고서 근거, 한 글자도 임의 변경하지 않음) — 기존 Excel 라우트 자체는 건드리지 않고
// (§ 계획 3의 안전 판단) 동일한 매핑표만 신규 모듈로 복제해서 "동일한 normalized
// activation input 구조"를 만든다.
//
// dedupe key 규칙(감사 근거): subscriptionNumber(가입번호)가 있으면 그 값 기준, 없으면
// contactCode+activationDate+customerName+activationNumber 4개 조합(전화번호/고객명
// 단독 사용 금지 원칙). 이마저 계산 불가(접점코드/개통일 없음)하면 null — "중복검사 불가"로
// 별도 처리한다(무조건 통과/스킵하지 않음, 호출부에서 명시적으로 분류).

import { normalizeCustomerType, parseActivationDateStr } from "./activation-normalize";

// 기존 activations/upload 라우트의 COL_MAP과 완전히 동일(값 복제, 1:1 대응)
export const ACTIVATION_COL_MAP: Record<string, string> = {
  '고객명': 'customerName',
  '연락처': 'customerPhone',
  '고객번호': 'customerPhone',
  '고객 연락처': 'customerPhone',
  '고객전화번호': 'customerPhone',
  '전화번호': 'customerPhone',
  '휴대폰번호': 'customerPhone',
  '이메일': 'customerEmail',
  '통신사': 'channel',
  '유형': 'customerType',
  '판매점명': 'dealerName',
  '요금제': 'planName',
  '가입번호': 'subscriptionNumber',
  '가입자번호': 'subscriptionNumber',
  '청약번호': 'subscriptionNumber',
  '개통번호': 'activationNumber',
  '처리자': 'receptionist',
  '개통완료시간': '_activationDatetime',
  '문서번호': '_documentNumber',
  '접점코드': 'contactCode',
  '이전통신사': 'previousCarrier',
  '접수일시': '_receptionDatetime',
  '메모': 'memo',
  '유심개수': '_simCount',
  '결합': 'bundleType',
  '부가서비스': 'addService',
  '가입비': 'regFeeType',
  '요청점': 'channel',
  '개통일': '_activationDatetime',
  '접수일': '_receptionDatetime',
  '부가': 'addService',
  '작업자': 'receptionist',
  'M코드': '_mccCodeRaw',
  '코드명': '_codeNameRaw',
  '고객유형': 'nationalityType',
  '국적': 'nationalityType',
  '내외국인': 'nationalityType',
};

export interface MappedActivationRow {
  data: {
    channel: string | null;
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    subscriptionNumber: string | null;
    activationNumber: string | null;
    receptionist: string | null;
    contactCode: string | null;
    previousCarrier: string | null;
    memo: string | null;
    bundleType: string | null;
    addService: string | null;
    regFeeType: string | null;
    dealerName: string | null;
    planName: string | null;
    customerType: string;
    nationalityType: string;
    activationDatetime: Date | null;
    receptionDatetime: Date | null;
  };
  mccCodeRaw: string | null;
  codeNameRaw: string | null;
  missing: string[];
}

/** raw = 헤더 텍스트로 키가 매겨진 한 행(XLSX.utils.sheet_to_json 결과와 동일 모양) */
export function mapSheetRowToActivationInput(raw: Record<string, unknown>): MappedActivationRow {
  const get = (ko: string): string => String((raw as any)[ko] ?? '').trim();

  const missing: string[] = [];
  if (!get('고객명')) missing.push('고객명');
  if (!get('통신사') && !get('요청점')) missing.push('통신사/요청점');
  if (!get('개통완료시간') && !get('개통일')) missing.push('개통완료시간/개통일');
  if (!get('요금제')) missing.push('요금제');
  if (!get('접점코드') && !get('판매점명')) missing.push('접점코드/판매점명');

  const m: Record<string, string | null> = {};
  for (const [koKey, enKey] of Object.entries(ACTIVATION_COL_MAP)) {
    m[enKey] = String((raw as any)[koKey] ?? '').trim() || null;
  }

  const rawNat = m['nationalityType'];
  const nationalityType = rawNat && rawNat.includes('외국인') ? '외국인' : '내국인';

  const activationDatetime = parseActivationDateStr(m['_activationDatetime']);
  const receptionDatetime = parseActivationDateStr(m['_receptionDatetime']);

  return {
    data: {
      channel: m['channel'],
      customerName: m['customerName'],
      customerPhone: m['customerPhone'],
      customerEmail: m['customerEmail'],
      subscriptionNumber: m['subscriptionNumber'],
      activationNumber: m['activationNumber'],
      receptionist: m['receptionist'],
      contactCode: m['contactCode'],
      previousCarrier: m['previousCarrier'],
      memo: m['memo'],
      bundleType: m['bundleType'],
      addService: m['addService'],
      regFeeType: m['regFeeType'],
      dealerName: m['dealerName'],
      planName: m['planName'],
      customerType: normalizeCustomerType(m['customerType']),
      nationalityType,
      activationDatetime,
      receptionDatetime,
    },
    mccCodeRaw: m['_mccCodeRaw'],
    codeNameRaw: m['_codeNameRaw'],
    missing,
  };
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** null = 중복검사 불가(호출부에서 별도 분류) */
export function computeActivationDedupeKey(fields: {
  contactCode: string | null;
  activationDatetime: Date | null;
  customerName: string | null;
  activationNumber: string | null;
  subscriptionNumber: string | null;
}): string | null {
  const contactCode = (fields.contactCode || '').trim();
  if (fields.subscriptionNumber && fields.subscriptionNumber.trim() && contactCode) {
    return `sub:${contactCode}:${fields.subscriptionNumber.trim()}`;
  }
  const customerName = (fields.customerName || '').trim();
  const activationNumber = (fields.activationNumber || '').trim();
  if (contactCode && fields.activationDatetime && customerName && activationNumber) {
    const d = fields.activationDatetime;
    const dateStr = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    return `fallback:${contactCode}:${dateStr}:${customerName}:${activationNumber}`;
  }
  return null;
}

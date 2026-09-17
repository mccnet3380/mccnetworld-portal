// server/lib/spreadsheet-resolver.ts
//
// 작업명: MCC_INTERNET_RULE_AND_MONTHLY_SHEET_AUTO_ROUTING_1
//
// 매월 새로 만들어지는 "★개통현황_N월YY년" 스프레드시트를 자동으로 찾아서 반환한다.
//
// 안전 규칙 (지침 그대로):
// - 정확히 1개 발견 → 자동 연결
// - 0개 발견 → 이전 달 파일로 몰래 대체하지 않고 명시적 오류
// - 2개 이상 발견 → 임의 선택하지 않고 명시적 오류
// - Drive API 권한/활성화 오류는 별도로 구분해서 안내
//
// GOOGLE_SHEETS_AUTO_ROUTE=true 가 아니면 기존과 동일하게
// GOOGLE_SHEETS_SPREADSHEET_ID 값을 그대로 사용한다 (기본값 false — 기존 동작 100% 유지).

import { findSpreadsheetsByExactName, findSpreadsheetsContaining } from "./google-drive-client";

export interface ResolvedSpreadsheet {
  id: string;
  name: string;
  targetYearMonth: string; // YYYY-MM
  resolvedVia: "auto-drive-search" | "env-fallback";
  resolvedAt: string; // ISO
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간 — 월 변경 시에는 TTL과 무관하게 즉시 재탐색됨

let cache: { key: string; value: ResolvedSpreadsheet; expiresAt: number } | null = null;
let lastError: { message: string; at: string } | null = null;

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function yearMonthKey(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}`;
}

/** 실제 운영 파일명 패턴: ★개통현황_9월26년 (월=leading zero 없음, 연도=2자리) */
export function buildExpectedFileName(date: Date): string {
  const month = date.getMonth() + 1;
  const yy = String(date.getFullYear()).slice(-2);
  return `★개통현황_${month}월${yy}년`;
}

function isAutoRouteEnabled(): boolean {
  return process.env.GOOGLE_SHEETS_AUTO_ROUTE?.trim().toLowerCase() === "true";
}

async function resolveViaDrive(date: Date): Promise<ResolvedSpreadsheet> {
  const expectedName = buildExpectedFileName(date);
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || undefined;

  let exact;
  try {
    exact = await findSpreadsheetsByExactName(expectedName, folderId);
  } catch (err: any) {
    if (err?.status === 403) {
      throw new Error(
        `[SpreadsheetResolver] Google Drive API 호출이 거부되었습니다(403). ` +
          `Google Cloud Console에서 이 프로젝트의 "Google Drive API"가 활성화돼 있는지, ` +
          `서비스 계정에 대상 파일/폴더 접근 권한이 있는지 확인하세요. 원본 오류: ${err.message}`,
      );
    }
    throw new Error(`[SpreadsheetResolver] Drive 검색 중 오류: ${err.message}`);
  }

  if (exact.length === 1) {
    return {
      id: exact[0].id,
      name: exact[0].name,
      targetYearMonth: yearMonthKey(date),
      resolvedVia: "auto-drive-search",
      resolvedAt: new Date().toISOString(),
    };
  }

  if (exact.length === 0) {
    let candidateText = "";
    try {
      const near = await findSpreadsheetsContaining("개통현황", folderId);
      candidateText =
        near.length > 0
          ? `서비스 계정이 접근 가능한 "개통현황" 포함 파일 후보: ${near.map((f) => `${f.name} (${f.id})`).join(", ")}`
          : `"개통현황"을 포함하는 파일도 서비스 계정 접근 범위에서 찾지 못했습니다 — 새 월 파일 공유 여부를 확인하세요.`;
    } catch {
      candidateText = "(진단용 후보 검색도 실패 — 아래 원본 오류만 참고)";
    }
    throw new Error(
      `[SpreadsheetResolver] "${expectedName}" 이름의 스프레드시트를 정확히 찾지 못했습니다(0개). ` +
        `이전 달 파일을 대신 사용하지 않고 오류로 처리합니다. ${candidateText}`,
    );
  }

  const dupList = exact.map((f) => `${f.name} (${f.id}, modified=${f.modifiedTime})`).join(", ");
  throw new Error(
    `[SpreadsheetResolver] "${expectedName}" 이름의 스프레드시트가 ${exact.length}개 발견됐습니다. ` +
      `임의로 하나를 선택하지 않고 오류로 처리합니다. 중복 파일을 정리해주세요: ${dupList}`,
  );
}

/**
 * 현재(또는 지정한) 연월 기준으로 사용할 스프레드시트를 반환한다.
 * - GOOGLE_SHEETS_AUTO_ROUTE=true 가 아니면 GOOGLE_SHEETS_SPREADSHEET_ID를 그대로 반환 (기존 동작 유지)
 * - true 면 Drive에서 "★개통현황_N월YY년"을 검색해서 안전 규칙에 따라 반환/오류
 * - 같은 연월 내에서는 최대 1시간 캐시 (opts.force로 강제 재탐색 가능)
 */
export async function resolveActiveSpreadsheet(
  date: Date = new Date(),
  opts?: { force?: boolean },
): Promise<ResolvedSpreadsheet> {
  const key = yearMonthKey(date);
  if (!opts?.force && cache && cache.key === key && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  if (!isAutoRouteEnabled()) {
    const fallbackId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
    if (!fallbackId) {
      throw new Error(
        "[SpreadsheetResolver] GOOGLE_SHEETS_AUTO_ROUTE가 꺼져 있고 GOOGLE_SHEETS_SPREADSHEET_ID도 비어 있습니다.",
      );
    }
    const result: ResolvedSpreadsheet = {
      id: fallbackId,
      name: "(env-fallback — 자동탐색 꺼짐, 실제 파일명 미확인)",
      targetYearMonth: key,
      resolvedVia: "env-fallback",
      resolvedAt: new Date().toISOString(),
    };
    cache = { key, value: result, expiresAt: Date.now() + CACHE_TTL_MS };
    lastError = null;
    return result;
  }

  try {
    const result = await resolveViaDrive(date);
    cache = { key, value: result, expiresAt: Date.now() + CACHE_TTL_MS };
    lastError = null;
    return result;
  } catch (err: any) {
    lastError = { message: err.message, at: new Date().toISOString() };
    throw err;
  }
}

export function invalidateSpreadsheetCache(): void {
  cache = null;
}

/** 관리자 상태 API용 — 비밀정보(private key 등) 없이 현재 연결 상태만 노출 */
export function getResolverStatusSnapshot(): {
  autoRouteEnabled: boolean;
  cached: ResolvedSpreadsheet | null;
  lastError: { message: string; at: string } | null;
} {
  return {
    autoRouteEnabled: isAutoRouteEnabled(),
    cached: cache?.value ?? null,
    lastError,
  };
}

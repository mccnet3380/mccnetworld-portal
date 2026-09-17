// server/lib/google-drive-client.ts
//
// 작업명: MCC_INTERNET_RULE_AND_MONTHLY_SHEET_AUTO_ROUTING_1
//
// 월별로 바뀌는 "개통현황" 스프레드시트 파일을 서비스 계정 권한으로 검색하기 위한
// Google Drive API(read-only) 클라이언트. google-sheets-client.ts(검증 완료, 변경 없음)와
// 별도의 자격증명 로딩 경로를 사용한다 — 기존 검증된 Sheets 연결 코드를 건드리지 않기 위함.
//
// [Google Cloud 설정이 추가로 필요할 수 있는 부분]
// - Google Cloud Console > APIs & Services > Library 에서 "Google Drive API" 활성화 필요
// - 이미 등록된 서비스 계정(GOOGLE_SERVICE_ACCOUNT_EMAIL)을 그대로 재사용 (신규 계정 불필요)
// - 매월 새로 만드는 "★개통현황_N월YY년" 파일에도 이 서비스 계정이 "뷰어"로 공유되어 있어야 함
//   (권장: 파일을 특정 Drive 폴더 안에서 관리하고, 그 폴더를 서비스 계정과 공유 —
//    그러면 폴더 안에 새로 만드는 파일마다 매번 재공유할 필요가 없음.
//    폴더로 관리할 경우 GOOGLE_DRIVE_FOLDER_ID 환경변수에 폴더 ID를 넣으면 검색 범위가 좁혀짐)

import { JWT } from "google-auth-library";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files";

let cachedClient: JWT | null = null;

function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function getDriveClient(): JWT {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!email || !rawKey) {
    throw new Error(
      "[GoogleDrive] GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY 환경변수가 필요합니다.",
    );
  }

  cachedClient = new JWT({
    email,
    key: normalizePrivateKey(rawKey),
    scopes: [DRIVE_SCOPE],
  });
  return cachedClient;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface DriveApiError extends Error {
  status?: number;
  body?: string;
}

function escapeForDriveQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFilesList(q: string): Promise<DriveFileMeta[]> {
  const client = getDriveClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("[GoogleDrive] 액세스 토큰 발급에 실패했습니다.");

  const params = new URLSearchParams({
    q,
    fields: "files(id,name,modifiedTime)",
    pageSize: "50",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const res = await fetch(`${DRIVE_API_BASE}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: DriveApiError = new Error(
      `[GoogleDrive] 파일 검색 실패 (status=${res.status}): ${body.slice(0, 500)}`,
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }

  const json = (await res.json()) as { files?: DriveFileMeta[] };
  return json.files || [];
}

/** 이름이 정확히 일치하는 스프레드시트 검색 (자동 선택용) */
export async function findSpreadsheetsByExactName(name: string, folderId?: string): Promise<DriveFileMeta[]> {
  const parts = [
    `name = '${escapeForDriveQuery(name)}'`,
    `mimeType = 'application/vnd.google-apps.spreadsheet'`,
    `trashed = false`,
  ];
  if (folderId) parts.push(`'${escapeForDriveQuery(folderId)}' in parents`);
  return driveFilesList(parts.join(" and "));
}

/** 이름에 특정 문자열을 포함하는 스프레드시트 후보 검색 — 진단/오류 메시지용, 자동 선택에는 사용하지 않음 */
export async function findSpreadsheetsContaining(fragment: string, folderId?: string): Promise<DriveFileMeta[]> {
  const parts = [
    `name contains '${escapeForDriveQuery(fragment)}'`,
    `mimeType = 'application/vnd.google-apps.spreadsheet'`,
    `trashed = false`,
  ];
  if (folderId) parts.push(`'${escapeForDriveQuery(folderId)}' in parents`);
  return driveFilesList(parts.join(" and "));
}

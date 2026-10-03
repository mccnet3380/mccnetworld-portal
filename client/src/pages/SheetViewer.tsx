// client/src/pages/SheetViewer.tsx
//
// 작업명: MCC_MONTHLY_SPREADSHEET_SELECTIVE_SHEET_VIEWER_1
//
// 월별 ★개통현황 Spreadsheet에서 사용자가 원하는 시트만 골라 조회하는 READ ONLY 화면.
// 시트 이름은 코드에 하드코딩하지 않는다 — /api/sheet-viewer/sheets가 반환하는 실제
// metadata 목록을 그대로 체크박스로 렌더링한다. 정산/실적 계산과 무관한 순수 조회 기능.
//
// [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 위 원본 조회 기능은 그대로 두고,
// 화면 상단에 "개통 후 자동검수" 섹션을 추가한다. 검수는 /api/activation-audit/summary만
// 호출한다(개통처리부+■당일완료 2개 시트만 사용 — server/lib/activation-audit.ts 참고).
// 이 섹션은 admin/내부 middle_manager만 접근하는 화면이므로(App.tsx/Sidebar.tsx에서
// 이미 게이트) 별도 권한 분기 없이 렌더링한다 — 서버도 동일 권한을 강제한다.

import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiRequest, useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FileSpreadsheet, Search, Loader2, Bookmark, Trash2, ShieldAlert, ShieldCheck, HelpCircle, Download } from "lucide-react";

type AuditCode =
  | "ACTIVATION_PHONE_MISSING"
  | "CONTACT_CODE_MISSING"
  | "PLAN_MISSING"
  | "ACTIVATION_NUMBER_MISSING"
  | "FOREIGNER_GRADE_MISSING"
  | "DEVICE_MODEL_MISSING"
  | "DEVICE_SERIAL_MISSING"
  | "MEMI_DEVICE_NOT_FOUND"
  | "MEMI_DATA_UNAVAILABLE";

type RowAuditStatus = "PASS" | "ERROR" | "DATA_UNAVAILABLE";

interface AuditIssue {
  code: AuditCode;
  severity: "ERROR" | "DATA_UNAVAILABLE";
  label: string;
}

interface AuditedActivationRow {
  auditDate: string;
  worker: string;
  activationDate: string;
  requestPoint: string;
  customerName: string;
  activationNumber: string;
  code: string;
  contactCode: string;
  planName: string;
  subscriptionNumber: string;
  customerType: string;
  foreignerGrade: string;
  model: string;
  serial: string;
  memiStatus?: "MATCHED" | "NOT_FOUND" | "DATA_UNAVAILABLE";
  memiModel?: string;
  memiSerial?: string;
  status: RowAuditStatus;
  issues: AuditIssue[];
}

interface MemiSyncStatus {
  status: "ok" | "unavailable";
  syncedAt: string | null;
  rowCount: number;
  error?: string;
}

// [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] date/sourceSheet(단일 날짜) →
// startDate/endDate/sourceSheets(기간, §1~§8)로 확장. 서버 응답 shape과 1:1 대응.
interface ActivationAuditResult {
  startDate: string;
  endDate: string;
  sourceSheets: string[];
  total: number;
  summary: { pass: number; error: number; dataUnavailable: number };
  byCode: Partial<Record<AuditCode, number>>;
  rows: AuditedActivationRow[];
  memiSync: MemiSyncStatus;
  // [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
  // 시트별 캐시 신선도(§4) — 429로 최근 캐시를 대신 보여주고 있는지 화면에서 구분할 때 사용.
  sourceFreshness?: Record<string, { stale: boolean; fetchedAt: string | null }>;
}

// [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §10 —
// 상단 "개통 후 자동검수" 원본 선택. 하단 "시트 선택"(selected/sheets state)과는 완전히
// 독립적인 별도 state다(역할이 다르므로 억지로 같은 state로 묶지 않는다, §10 지시).
// "auto"는 서버에 source 파라미터를 전혀 보내지 않는다 = 기존 날짜 기준 자동 선택
// (오늘=■당일완료, 과거=개통처리부) 그대로. 기간이 과거로 바뀌어도 이유 없이 결과가
// 달라지지 않도록 기본값은 반드시 "auto"여야 한다(§7/§11 — 명시적으로 고르기 전까지는
// 기존 동작과 100% 동일해야 함).
const AUDIT_SOURCE_OPTIONS = ["auto", "■당일완료", "개통처리부"] as const;
type AuditSource = (typeof AUDIT_SOURCE_OPTIONS)[number];
const AUDIT_SOURCE_LABEL: Record<AuditSource, string> = {
  auto: "자동(날짜 기준)",
  "■당일완료": "당일완료",
  "개통처리부": "개통처리부",
};

const AUDIT_CODE_ORDER: AuditCode[] = [
  "ACTIVATION_PHONE_MISSING",
  "ACTIVATION_NUMBER_MISSING",
  "CONTACT_CODE_MISSING",
  "PLAN_MISSING",
  "FOREIGNER_GRADE_MISSING",
  "DEVICE_MODEL_MISSING",
  "DEVICE_SERIAL_MISSING",
  "MEMI_DEVICE_NOT_FOUND",
  "MEMI_DATA_UNAVAILABLE",
];

const AUDIT_CODE_LABEL: Record<AuditCode, string> = {
  ACTIVATION_PHONE_MISSING: "개통번호",
  ACTIVATION_NUMBER_MISSING: "가입번호",
  CONTACT_CODE_MISSING: "접점코드",
  PLAN_MISSING: "요금제",
  FOREIGNER_GRADE_MISSING: "외국인등급",
  DEVICE_MODEL_MISSING: "단말 모델명",
  DEVICE_SERIAL_MISSING: "단말 일련번호",
  MEMI_DEVICE_NOT_FOUND: "매미 자료 없음",
  MEMI_DATA_UNAVAILABLE: "매미 조회불가",
};

type StatusFilter = "all" | "problem" | "pass" | "unavailable";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ROWS_PER_PAGE = 100;
const SAVED_VIEWS_KEY = "mcc-sheet-viewer-views";

interface SheetMeta {
  title: string;
  index: number;
  rowCount: number;
}

interface SheetData {
  header: string[];
  rows: string[][];
  totalRows: number;
  error?: string;
}

interface SavedView {
  name: string;
  sheetTitles: string[];
}

function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedView[]) {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등) — 조용히 무시, 화면 동작에는 영향 없음
  }
}

export function SheetViewer() {
  const apiRequest = useApiRequest();
  const { toast } = useToast();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [spreadsheetName, setSpreadsheetName] = useState("");
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [sheetsError, setSheetsError] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dataBySheet, setDataBySheet] = useState<Map<string, SheetData>>(new Map());
  const [loadingSheets, setLoadingSheets] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<string>("");
  const [searchBySheet, setSearchBySheet] = useState<Map<string, string>>(new Map());
  const [pageBySheet, setPageBySheet] = useState<Map<string, number>>(new Map());

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [newViewName, setNewViewName] = useState("");

  // ── [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 자동검수 상태 ──────────
  // [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] §1 — 단일 날짜 → 기간(시작일~종료일).
  // 기본값 시작일=종료일=오늘이라 기존처럼 "오늘 하루만" 조회하는 사용 방식도 그대로 된다.
  const [auditStartDate, setAuditStartDate] = useState<string>(() => todayStr());
  const [auditEndDate, setAuditEndDate] = useState<string>(() => todayStr());
  // [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §10 —
  // 기본값 "■당일완료"는 기존 동작(날짜 기준 자동 선택과 동일한 결과)을 그대로 유지한다.
  // 사용자가 명시적으로 "개통처리부"를 고르기 전까지는 §7/§11에서 요구한 "기존 정상
  // 결과가 이유 없이 변하면 안 된다" 원칙이 그대로 보장된다.
  const [auditSource, setAuditSource] = useState<AuditSource>("auto");
  const [auditData, setAuditData] = useState<ActivationAuditResult | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("problem");
  const [codeFilter, setCodeFilter] = useState<AuditCode | null>(null);
  const [workerFilter, setWorkerFilter] = useState<string>("ALL");
  const [memiRefreshing, setMemiRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  // §2 — 시작일>종료일이면 API 요청을 아예 실행하지 않고 명확히 안내한다.
  const rangeInvalid = auditStartDate > auditEndDate;

  async function loadAudit(startDate: string, endDate: string, source: AuditSource) {
    setAuditLoading(true);
    setAuditError("");
    try {
      // [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
      // source==="auto"면 파라미터 자체를 보내지 않는다 — 서버 기본 동작(날짜 기준
      // 자동 선택)과 완전히 동일하게 유지하기 위함(§7/§11).
      const sourceParam = source === "auto" ? "" : `&source=${encodeURIComponent(source)}`;
      const res = await apiRequest(`/api/activation-audit/summary?startDate=${startDate}&endDate=${endDate}${sourceParam}`);
      setAuditData(res);
    } catch (e: any) {
      setAuditData(null);
      setAuditError(e.message || "검수 데이터를 불러오지 못했습니다.");
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (rangeInvalid) {
      setAuditLoading(false);
      setAuditData(null);
      setAuditError("시작일이 종료일보다 늦을 수 없습니다.");
      return;
    }
    loadAudit(auditStartDate, auditEndDate, auditSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditStartDate, auditEndDate, auditSource]);

  // [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1] 보조 수동 새로고침(§14) — 기본 흐름은
  // 자동이므로 이 버튼은 캐시가 stale해 보일 때만 쓰는 보조 기능이다. 매미 새로고침 자체는
  // 단일 날짜 캐시 무효화(memi-client.ts LOCK, 기존 동작 그대로) — 기간 조회 중이면 종료일
  // 기준으로 무효화하고 전체 기간을 다시 계산한다.
  // [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §12 —
  // 이제 매미 캐시 무효화뿐 아니라, 현재 선택된 자동검수 원본(auditSource)의 Google
  // Sheets 캐시도 함께 강제로 다시 읍는다(필요한 시트 1개만, forceRefresh). source가
  // "auto"면 서버가 날짜 기준으로 고른 그 시트 하나만 강제 새로고침한다.
  async function handleMemiRefresh() {
    setMemiRefreshing(true);
    try {
      await apiRequest(`/api/activation-audit/memi-refresh`, {
        method: "POST",
        body: JSON.stringify({ date: auditEndDate, source: auditSource === "auto" ? undefined : auditSource }),
      });
      await loadAudit(auditStartDate, auditEndDate, auditSource);
    } catch (e: any) {
      toast({ title: "매미 새로고침 실패", description: e.message, variant: "destructive" });
    } finally {
      setMemiRefreshing(false);
    }
  }

  // [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] §15~§23 — 현재 화면 필터 조건 그대로
  // 서버에 다시 전달해서(§17 — 화면 DOM이 아니라 서버 계산 결과 기준) Excel을 생성한다.
  async function handleAuditExport() {
    if (filteredAuditRows.length === 0) {
      toast({ title: "다운로드할 검수 데이터가 없습니다.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams({
        startDate: auditStartDate,
        endDate: auditEndDate,
        status: statusFilter,
      });
      if (codeFilter) params.set("code", codeFilter);
      if (workerFilter !== "ALL") params.set("worker", workerFilter);
      if (auditSource !== "auto") params.set("source", auditSource);

      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch(`/api/activation-audit/export?${params.toString()}`, {
        method: "GET",
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "다운로드 실패" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("content-disposition") || "";
      const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
      const filename = match ? decodeURIComponent(match[1]) : `MCC_개통후자동검수_${auditStartDate}_${auditEndDate}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: any) {
      toast({ title: "다운로드 실패", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const auditWorkers = useMemo(() => {
    if (!auditData) return [];
    const names = new Set(auditData.rows.map((r) => r.worker).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
  }, [auditData]);

  const filteredAuditRows = useMemo(() => {
    if (!auditData) return [];
    return auditData.rows.filter((r) => {
      if (workerFilter !== "ALL" && r.worker !== workerFilter) return false;
      if (codeFilter && !r.issues.some((i) => i.code === codeFilter)) return false;
      if (statusFilter === "problem" && r.status === "PASS") return false;
      if (statusFilter === "pass" && r.status !== "PASS") return false;
      if (statusFilter === "unavailable" && r.status !== "DATA_UNAVAILABLE") return false;
      return true;
    });
  }, [auditData, statusFilter, codeFilter, workerFilter]);

  function selectStatus(f: StatusFilter) {
    setStatusFilter(f);
    setCodeFilter(null);
  }
  function selectCode(code: AuditCode) {
    setCodeFilter((prev) => (prev === code ? null : code));
    setStatusFilter("all");
  }

  async function loadSheets() {
    setSheetsLoading(true);
    setSheetsError("");
    try {
      const res = await apiRequest(`/api/sheet-viewer/sheets?year=${year}&month=${month}`);
      setSheets(res.sheets || []);
      setSpreadsheetName(res.spreadsheetName || "");
      // 월 변경 시 더 이상 존재하지 않는 시트는 선택에서 자동 제외(§13)
      const availableTitles = new Set<string>((res.sheets || []).map((s: SheetMeta) => s.title));
      setSelected((prev) => new Set(Array.from(prev).filter((t) => availableTitles.has(t))));
      setDataBySheet(new Map());
      setActiveTab("");
    } catch (e: any) {
      setSheets([]);
      setSheetsError(e.message || "시트 목록을 불러오지 못했습니다.");
    } finally {
      setSheetsLoading(false);
    }
  }

  useEffect(() => {
    loadSheets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  function toggleSheet(title: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(sheets.map((s) => s.title)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  async function fetchOneSheet(title: string) {
    setLoadingSheets((prev) => new Set(prev).add(title));
    try {
      const res = await apiRequest(`/api/sheet-viewer/data?year=${year}&month=${month}&sheet=${encodeURIComponent(title)}`);
      setDataBySheet((prev) => new Map(prev).set(title, { header: res.header || [], rows: res.rows || [], totalRows: res.totalRows || 0 }));
    } catch (e: any) {
      setDataBySheet((prev) => new Map(prev).set(title, { header: [], rows: [], totalRows: 0, error: e.message || "조회 실패" }));
    } finally {
      setLoadingSheets((prev) => {
        const next = new Set(prev);
        next.delete(title);
        return next;
      });
    }
  }

  async function handleQuery() {
    if (selected.size === 0) {
      toast({ title: "시트를 하나 이상 선택하세요.", variant: "destructive" });
      return;
    }
    const titles = Array.from(selected);
    setActiveTab(titles[0]);
    await Promise.all(titles.map((t) => fetchOneSheet(t)));
  }

  function applyView(view: SavedView) {
    const availableTitles = new Set(sheets.map((s) => s.title));
    setSelected(new Set(view.sheetTitles.filter((t) => availableTitles.has(t))));
  }

  function saveCurrentAsView() {
    const name = newViewName.trim();
    if (!name) {
      toast({ title: "보기 이름을 입력하세요.", variant: "destructive" });
      return;
    }
    if (selected.size === 0) {
      toast({ title: "저장할 시트를 먼저 선택하세요.", variant: "destructive" });
      return;
    }
    const next = [...savedViews.filter((v) => v.name !== name), { name, sheetTitles: Array.from(selected) }];
    setSavedViews(next);
    persistSavedViews(next);
    setNewViewName("");
    toast({ title: `"${name}" 보기를 저장했습니다.` });
  }

  function deleteView(name: string) {
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    persistSavedViews(next);
  }

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = today.getFullYear(); y >= today.getFullYear() - 2; y--) arr.push(y);
    return arr;
  }, [today]);

  return (
    <Layout title="개통현황 조회">
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold text-gray-900">개통현황 조회</h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-4">
          월별 개통현황 Spreadsheet에서 원하는 시트만 선택해서 원본 그대로 확인합니다. 조회 전용이며 원본은 변경되지 않습니다.
        </p>

        {/* [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 개통 후 자동검수 섹션.
            개통처리부+■당일완료 2개 시트만 사용(다른 시트는 이 계산에 전혀 관여하지 않음). */}
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-base font-semibold">개통 후 자동검수</h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
                    §10 — 하단 "시트 선택"(selected/sheets)과는 완전히 독립된 상태. */}
                <span className="text-sm font-medium">검수 원본</span>
                <Select value={auditSource} onValueChange={(v) => setAuditSource(v as AuditSource)}>
                  <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUDIT_SOURCE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{AUDIT_SOURCE_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm font-medium ml-2">검수 기간</span>
                <Input
                  type="date"
                  className="w-40 h-9"
                  value={auditStartDate}
                  onChange={(e) => setAuditStartDate(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">~</span>
                <Input
                  type="date"
                  className="w-40 h-9"
                  value={auditEndDate}
                  onChange={(e) => setAuditEndDate(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={handleAuditExport}
                  disabled={exporting || rangeInvalid || auditLoading || !auditData}
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                  엑셀 다운로드
                </Button>
              </div>
            </div>

            {rangeInvalid && (
              <p className="text-sm text-red-600 font-semibold">시작일이 종료일보다 늦을 수 없습니다. 검수 기간을 다시 선택해 주세요.</p>
            )}
            {!rangeInvalid && auditLoading && <p className="text-sm text-muted-foreground">검수 데이터를 불러오는 중...</p>}
            {!rangeInvalid && auditError && <p className="text-sm text-red-600 font-semibold">{auditError}</p>}

            {!auditLoading && !auditError && auditData && (
              <>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    데이터 원본: {auditData.sourceSheets.length > 0 ? auditData.sourceSheets.join(" + ") : "(해당 기간 원본 없음)"} · {auditData.startDate === auditData.endDate ? `${auditData.startDate} 기준` : `${auditData.startDate} ~ ${auditData.endDate} 기준`}
                    {/* [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1]
                        §4 — Google 429 등으로 최근 캐시를 대신 보여주고 있을 때만 표시 */}
                    {auditData.sourceFreshness && auditData.sourceSheets.some((s) => auditData.sourceFreshness?.[s]?.stale) && (
                      <span className="text-amber-600 font-medium"> · Google Sheets 요청 제한으로 최근 조회 데이터를 표시 중입니다</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded border",
                        auditData.memiSync.status === "ok"
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-amber-300 bg-amber-50 text-amber-700",
                      )}
                    >
                      매미 {auditData.memiSync.status === "ok" ? "정상" : "조회불가"}
                      {auditData.memiSync.status === "ok" && auditData.memiSync.syncedAt && (
                        <> · 마지막 동기화 {new Date(auditData.memiSync.syncedAt).toLocaleString("ko-KR")}</>
                      )}
                      {auditData.memiSync.status === "unavailable" && auditData.memiSync.error && (
                        <span className="text-muted-foreground"> ({auditData.memiSync.error.slice(0, 60)})</span>
                      )}
                    </span>
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={handleMemiRefresh} disabled={memiRefreshing}>
                      {memiRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : "매미 새로고침"}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => selectStatus("all")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm border",
                      statusFilter === "all" && !codeFilter ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                    )}
                  >
                    전체 대상 {auditData.total}
                  </button>
                  <button
                    onClick={() => selectStatus("pass")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm border flex items-center gap-1",
                      statusFilter === "pass" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> 정상 {auditData.summary.pass}
                  </button>
                  <button
                    onClick={() => selectStatus("problem")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm border flex items-center gap-1",
                      statusFilter === "problem" && !codeFilter ? "bg-red-600 text-white border-red-600" : "border-red-300 text-red-700 hover:bg-red-50",
                    )}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" /> 오류·누락 {auditData.summary.error}
                  </button>
                  <button
                    onClick={() => selectStatus("unavailable")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm border flex items-center gap-1",
                      statusFilter === "unavailable" ? "bg-amber-500 text-white border-amber-500" : "border-amber-300 text-amber-700 hover:bg-amber-50",
                    )}
                  >
                    <HelpCircle className="h-3.5 w-3.5" /> 확인필요 {auditData.summary.dataUnavailable}
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {AUDIT_CODE_ORDER.filter((c) => (auditData.byCode[c] ?? 0) > 0).map((c) => (
                    <button
                      key={c}
                      onClick={() => selectCode(c)}
                      className={cn(
                        "px-2.5 py-1 rounded text-xs border",
                        codeFilter === c ? "bg-foreground text-background border-foreground" : "bg-muted hover:bg-muted/70",
                      )}
                    >
                      {AUDIT_CODE_LABEL[c]} {auditData.byCode[c]}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">작업자</span>
                  <Select value={workerFilter} onValueChange={setWorkerFilter}>
                    <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">전체 작업자</SelectItem>
                      {auditWorkers.map((w) => (
                        <SelectItem key={w} value={w}>{w}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    표시 중 {filteredAuditRows.length.toLocaleString()}건
                  </span>
                </div>

                <div className="overflow-auto border rounded-md max-h-[55vh]">
                  <table className="text-xs min-w-full">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        {["작업자", "개통일", "요청점", "고객명", "개통번호", "코드", "접점코드", "요금제", "가입번호", "외국인등급", "모델명", "일련번호", "검수상태", "오류사유"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap border-b">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAuditRows.map((r, i) => (
                        <tr key={i} className={cn("border-b hover:bg-muted/50", r.status === "ERROR" && "bg-red-50")}>
                          <td className="px-2 py-1 whitespace-nowrap">{r.worker}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.activationDate}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.requestPoint}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.customerName}</td>
                          <td className={cn("px-2 py-1 whitespace-nowrap", !r.activationNumber && "text-red-600 font-semibold")}>{r.activationNumber || "[누락]"}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.code}</td>
                          <td className={cn("px-2 py-1 whitespace-nowrap", !r.contactCode && "text-red-600 font-semibold")}>{r.contactCode || "[누락]"}</td>
                          <td className={cn("px-2 py-1 whitespace-nowrap", !r.planName && "text-red-600 font-semibold")}>{r.planName || "[누락]"}</td>
                          <td className={cn("px-2 py-1 whitespace-nowrap", !r.subscriptionNumber && r.worker !== "본사" && "text-red-600 font-semibold")}>
                            {r.subscriptionNumber || (r.worker === "본사" ? "-" : "[누락]")}
                          </td>
                          <td className={cn("px-2 py-1 whitespace-nowrap", r.customerType.includes("외국인") && !r.foreignerGrade && "text-red-600 font-semibold")}>
                            {r.foreignerGrade || (r.customerType.includes("외국인") ? "[누락]" : "-")}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.model || (r.requestPoint.startsWith("단말)") ? "[누락]" : "-")}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {r.serial || (r.requestPoint.startsWith("단말)") ? "[누락]" : "-")}
                            {r.memiStatus === "MATCHED" && (
                              <span className="ml-1 text-green-700" title={r.memiModel ? `매미 모델명: ${r.memiModel}` : undefined}>
                                [매미 확인]
                              </span>
                            )}
                            {r.memiStatus === "NOT_FOUND" && <span className="ml-1 text-red-600 font-semibold">[매미 자료 없음]</span>}
                            {r.memiStatus === "DATA_UNAVAILABLE" && <span className="ml-1 text-amber-600">[매미 조회불가]</span>}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {r.status === "PASS" && <span className="text-green-700">PASS</span>}
                            {r.status === "ERROR" && <span className="text-red-600 font-semibold">ERROR {r.issues.filter((iss) => iss.severity === "ERROR").length}</span>}
                            {r.status === "DATA_UNAVAILABLE" && <span className="text-amber-600">확인필요</span>}
                          </td>
                          <td className="px-2 py-1">
                            {r.issues.length === 0 ? (
                              "-"
                            ) : (
                              <ul className="list-disc list-inside space-y-0.5">
                                {r.issues.map((iss, ii) => (
                                  <li key={ii} className={iss.severity === "ERROR" ? "text-red-600" : "text-amber-600"}>
                                    {iss.label}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filteredAuditRows.length === 0 && (
                        <tr><td colSpan={14} className="px-2 py-6 text-center text-muted-foreground">해당 조건의 건이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">조회 월</span>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
                </SelectContent>
              </Select>
              {spreadsheetName && <span className="text-xs text-muted-foreground">{spreadsheetName}</span>}
            </div>

            {sheetsLoading && <p className="text-sm text-muted-foreground">시트 목록을 불러오는 중...</p>}
            {sheetsError && <p className="text-sm text-red-600 font-semibold">{sheetsError}</p>}

            {!sheetsLoading && !sheetsError && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium mr-1">시트 선택</span>
                  <Button size="sm" variant="outline" onClick={selectAll}>전체 선택</Button>
                  <Button size="sm" variant="outline" onClick={clearAll}>전체 해제</Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {sheets.map((s) => (
                    <label key={s.title} className="flex items-center gap-2 text-sm border rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted">
                      <Checkbox checked={selected.has(s.title)} onCheckedChange={() => toggleSheet(s.title)} />
                      <span className="truncate">{s.title}</span>
                    </label>
                  ))}
                  {sheets.length === 0 && <p className="text-sm text-muted-foreground col-span-full">이 월에 조회 가능한 시트가 없습니다.</p>}
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <Button onClick={handleQuery} disabled={selected.size === 0}>선택 조회 ({selected.size})</Button>

                  {savedViews.length > 0 && (
                    <Select onValueChange={(name) => { const v = savedViews.find((sv) => sv.name === name); if (v) applyView(v); }}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="저장된 보기 불러오기" /></SelectTrigger>
                      <SelectContent>
                        {savedViews.map((v) => (
                          <SelectItem key={v.name} value={v.name}>{v.name} ({v.sheetTitles.length}개)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <div className="flex items-center gap-1 ml-auto">
                    <Input className="w-40 h-9" placeholder="보기 이름" value={newViewName} onChange={(e) => setNewViewName(e.target.value)} />
                    <Button size="sm" variant="outline" onClick={saveCurrentAsView}><Bookmark className="h-3.5 w-3.5 mr-1" />현재 선택 저장</Button>
                  </div>
                </div>

                {savedViews.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {savedViews.map((v) => (
                      <span key={v.name} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                        {v.name}
                        <button onClick={() => deleteView(v.name)} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {dataBySheet.size > 0 && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex-wrap h-auto">
              {Array.from(dataBySheet.keys()).map((title) => (
                <TabsTrigger key={title} value={title}>
                  {title}
                  {loadingSheets.has(title) && <Loader2 className="h-3 w-3 ml-1 animate-spin" />}
                </TabsTrigger>
              ))}
            </TabsList>
            {Array.from(dataBySheet.entries()).map(([title, data]) => (
              <TabsContent key={title} value={title}>
                <SheetTable
                  title={title}
                  data={data}
                  search={searchBySheet.get(title) ?? ""}
                  onSearchChange={(v) => setSearchBySheet((prev) => new Map(prev).set(title, v))}
                  page={pageBySheet.get(title) ?? 0}
                  onPageChange={(p) => setPageBySheet((prev) => new Map(prev).set(title, p))}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </Layout>
  );
}

function SheetTable({
  title,
  data,
  search,
  onSearchChange,
  page,
  onPageChange,
}: {
  title: string;
  data: SheetData;
  search: string;
  onSearchChange: (v: string) => void;
  page: number;
  onPageChange: (p: number) => void;
}) {
  if (data.error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-red-600 font-semibold">"{title}" 조회 실패: {data.error}</p>
        </CardContent>
      </Card>
    );
  }

  const filteredRows = search.trim()
    ? data.rows.filter((row) => row.some((cell) => String(cell ?? "").toLowerCase().includes(search.trim().toLowerCase())))
    : data.rows;

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filteredRows.slice(safePage * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE + ROWS_PER_PAGE);

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">전체 {data.totalRows.toLocaleString()}행{search.trim() ? ` · 검색결과 ${filteredRows.length.toLocaleString()}행` : ""}</span>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-8 h-8 text-sm" placeholder="이 시트에서 검색" value={search} onChange={(e) => { onSearchChange(e.target.value); onPageChange(0); }} />
          </div>
        </div>

        <div className="overflow-auto border rounded-md max-h-[60vh]">
          <table className="text-xs min-w-full">
            <thead className="bg-muted sticky top-0">
              <tr>
                {data.header.map((h, i) => (
                  <th key={i} className="px-2 py-1.5 text-left font-medium whitespace-nowrap border-b">{h || `열${i + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, ri) => (
                <tr key={ri} className="border-b hover:bg-muted/50">
                  {data.header.map((_, ci) => (
                    <td key={ci} className="px-2 py-1 whitespace-nowrap">{row[ci] ?? ""}</td>
                  ))}
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={Math.max(1, data.header.length)} className="px-2 py-6 text-center text-muted-foreground">표시할 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => onPageChange(safePage - 1)}>이전</Button>
            <span className="text-xs text-muted-foreground">{safePage + 1} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={safePage >= totalPages - 1} onClick={() => onPageChange(safePage + 1)}>다음</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// client/src/components/performance/ResultManagementBoard.tsx
//
// 작업명: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1
//
// "실적관리"(/performance) 화면 — MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/
// result_management.html(index.html routes.result가 가리키는 실제 파일, 내부 <title>은
// "실적관리 V7 실제데이터 검증")의 실제 DOM 구조를 그대로 React로 포팅했다.
//
// "실적현황" 탭만 실데이터(dataset.workers)로 연결한다. 계산 기준 경고 문구, 정적 예시
// 카드("지원업무 포함 개인 실적 계산 예시")는 원본 HTML에 고정 하드코딩된 예시 데이터이며
// 실데이터와 무관하다 — 삭제하지 않고 verbatim 그대로 유지한다.
//
// [MCC_RESULT_MANAGEMENT_DEMO_TO_LIVE_DATA_BINDING_AUDIT_1] 원본 result_management.html은
// 이 예시(.metrics 카드 4개 + "지원업무 포함 개인 실적 계산 예시" 표, S)지은/S)윤희/S)영미
// 30/80/100% 하드코딩값)를 "실적현황" 진입 시 항상 노출한다(simBtn 클릭도 alert만 띄울 뿐
// 표시/숨김을 바꾸지 않는다 — 원본 JS 그대로임을 확인함). 그런데 실사용 화면에서 이 예시가
// 실제 dataset.workers 라이브 표("실제 데이터 연결 시 출력 형태") 바로 위에 항상 떠 있어
// 사용자가 예시 100건/30%/80%/100%를 오늘(2026-09-17)의 실제 실적으로 오인하는 문제가
// 발견됐다 — API(dataset.workers)는 이미 정상 라이브 값이었다(S)지은 denominator=22는
// /performance/daily의 SK 공식 개통 22와 정확히 일치, UI 바인딩만의 문제였음을 확인).
// 따라서 예시 섹션은 "계산 예시 보기" 버튼을 눌렀을 때만 보이도록 토글 처리한다 — 표/카드
// 자체의 레이아웃·색상·폰트·간격은 전혀 바꾸지 않았고 노출 여부만 바꿨다.
//
// "근무자 관리" admin-only 탭은 MCC_PERFORMANCE_SITE_INTEGRATION_1에서 확정된 범위
// 결정("이번 1차 사이트 연결에서는 실제 실적 조회를 우선 완성한다 — 억지로 한꺼번에 새로
// 개발하지 않는다")에 따라 원본 HTML의 정적 데모 구조를 그대로 유지한다(정보 삭제 없음,
// 새 백엔드 연결 없음).
//
// [MCC_PERFORMANCE_ADMIN_GOAL_MANAGEMENT_UI_SIMPLIFICATION_1] "월별 인원·목표" 탭과
// "이번 달 실적자료 연결" 탭을 UI에서 제거했다(요구사항). DB/API는 전혀 삭제하지 않았다:
// - 목표 편집 기능(개통/변경 목표 입력·저장, worker_performance_targets +
//   /api/admin/performance/targets)은 "실적현황" 표 안으로 그대로 이동했다(아래
//   targetsByWorker/StatusGoalCell). 저장 로직 자체는 기존 PUT API를 변경 없이 재사용.
// - "이번 달 실적자료 연결"은 애초에 실제 백엔드가 없는 정적 데모였고(수동 스프레드시트
//   연결 UI), resolveActiveSpreadsheet()의 자동 월별 탐색이 이미 실제로 동작 중임을
//   재확인했으므로(수동 연결이 필요 없음) 탭 자체를 제거한다. 자동 탐색 로직
//   (spreadsheet-resolver.ts)은 전혀 건드리지 않았다.

import { useEffect, useMemo, useState } from "react";
import type { PerformanceDataset, WorkerPerformanceRow } from "@/types/performance";
import { useToast } from "@/hooks/use-toast";
import { useApiRequest } from "@/lib/auth";
import "./ResultManagementBoard.css";

interface Props {
  dataset: PerformanceDataset;
}

const TABS = [
  { id: "status", label: "실적현황" },
  { id: "people", label: "근무자 관리" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function fmt(v: number | null): string {
  if (v == null) return "-";
  return Math.round(v).toLocaleString("ko-KR");
}

function supportDetail(w: PerformanceDataset["workers"][number]): string {
  const parts: string[] = [];
  if (w.supportSK > 0) parts.push(`SK ${w.supportSK}`);
  if (w.supportKT > 0) parts.push(`KT ${w.supportKT}`);
  if (w.supportLG > 0) parts.push(`LG ${w.supportLG}`);
  if (w.supportTOSS > 0) parts.push(`토스 ${w.supportTOSS}`);
  return parts.length ? parts.join(", ") : "-";
}

// [MCC_PERFORMANCE_ADMIN_GOAL_MANAGEMENT_UI_SIMPLIFICATION_1] 목표(개통/변경) 편집을
// "월별 인원·목표" 탭에서 "실적현황" 표 안으로 이동했다. mapping(실적 작업자)은 여전히
// AdminPanel 사용자 수정 다이얼로그(PerformanceMappingField)에서만 관리한다(중복 관리
// UI 방지) — 여기서는 dataset.workers(그 조회일에 실제 등장한 Sheets worker 이름)를
// /api/admin/performance/targets 응답의 performanceWorkerName으로 매칭해서, 매핑된
// 행에만 그 달 목표 입력/저장을 제공한다. 저장 API(PUT, userId 기준)는 기존 그대로 재사용.
interface TargetWorkerRow {
  userId: number;
  name: string;
  username: string;
  performanceWorkerName: string | null;
  homeNetwork: string | null;
  targetContributionRate: number | null;
  changeTargetRate: number | null;
  hireDate: string | null;
  terminationDate: string | null;
}

// [MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1] 조회 날짜 기준 재직 여부 판정.
// 기존 시스템에 이 개념이 전혀 없었다(조사 완료 — users에 입/퇴사 필드 없음, "근무자
// 관리" 탭은 100% 정적 데모). 확정된 기존 정의가 없으므로 다음을 이번 작업에서 명시적으로
// 정의한다(보고서 명시): hireDate가 없으면 하한 없음(기존 계정 전부 이 상태 — 항상 재직
// 취급, 회귀 없음). terminationDate는 "그 날짜까지 재직"(당일 포함, inclusive)으로 해석—
// 즉 퇴사일 당일 조회는 여전히 재직자 명단에 포함된다. 이 해석은 확정된 사내 규정을
// 대체하는 것이 아니라 미정 상태에서 내린 합리적 기본값이며, 보고서에 그대로 명시한다.
function isEmployedOn(row: { hireDate: string | null; terminationDate: string | null }, dateStr: string): boolean {
  if (row.hireDate && dateStr < row.hireDate) return false;
  if (row.terminationDate && dateStr > row.terminationDate) return false;
  return true;
}

/** 관리자 매핑/등록 다이얼로그의 "실적 작업자" 선택지 — 8bcf3b4의 기존 discovery API 재사용. */
function useWorkerOptions() {
  const apiRequest = useApiRequest();
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    apiRequest("/api/admin/performance/worker-options")
      .then((res: any) => setOptions(res?.workers || []))
      .catch(() => setOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return options;
}

function useMonthlyTargets(dateStr: string) {
  const apiRequest = useApiRequest();
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const [byWorker, setByWorker] = useState<Map<string, TargetWorkerRow>>(new Map());
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/admin/performance/targets?year=${year}&month=${month}`);
      const map = new Map<string, TargetWorkerRow>();
      for (const w of res.workers || []) {
        if (w.performanceWorkerName) map.set(w.performanceWorkerName, w);
      }
      setByWorker(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  return { year, month, byWorker, loading, reload };
}

function StatusGoalCells({
  workerName,
  target,
  year,
  month,
  onSaved,
}: {
  workerName: string;
  target: TargetWorkerRow | undefined;
  year: number;
  month: number;
  onSaved: () => void;
}) {
  const apiRequest = useApiRequest();
  const { toast } = useToast();
  const [actValue, setActValue] = useState(target?.targetContributionRate != null ? String(target.targetContributionRate) : "");
  const [chgValue, setChgValue] = useState(target?.changeTargetRate != null ? String(target.changeTargetRate) : "");
  const [saving, setSaving] = useState<"" | "targetContributionRate" | "changeTargetRate">("");

  useEffect(() => {
    setActValue(target?.targetContributionRate != null ? String(target.targetContributionRate) : "");
    setChgValue(target?.changeTargetRate != null ? String(target.changeTargetRate) : "");
  }, [target?.targetContributionRate, target?.changeTargetRate]);

  if (!target) {
    // 이 Sheets worker 이름에 매핑된 MCC 계정이 없다 — 저장할 userId가 없으므로 편집 불가.
    return (
      <>
        <td className="rmb-empty" style={{ fontSize: 12 }}>
          매핑 필요
        </td>
        <td className="rmb-empty" style={{ fontSize: 12 }}>
          매핑 필요
        </td>
      </>
    );
  }

  // [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] 개통 목표와 변경 목표는
  // 독립된 값이라 저장 요청에도 그 kind에 해당하는 필드만 담아 보낸다 — 다른 쪽 값은
  // body에 아예 넣지 않아서(undefined) storage 계층이 건드리지 않는다(기존 값 보존).
  const save = async (kind: "targetContributionRate" | "changeTargetRate", rate: string) => {
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) {
      toast({ title: "오류", description: "목표(%)는 0 이상 숫자여야 합니다.", variant: "destructive" });
      return;
    }
    setSaving(kind);
    try {
      await apiRequest("/api/admin/performance/targets", {
        method: "PUT",
        body: JSON.stringify({ userId: target.userId, year, month, [kind]: value }),
      });
      await onSaved();
      toast({ title: "성공", description: `${workerName} ${kind === "targetContributionRate" ? "개통" : "변경"} 목표가 저장되었습니다.` });
    } catch (err: any) {
      toast({ title: "오류", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving("");
    }
  };

  return (
    <>
      <td>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="number" step="0.1" style={{ width: 80 }} value={actValue} onChange={(e) => setActValue(e.target.value)} />
          <button className="rmb-btn" disabled={saving === "targetContributionRate"} onClick={() => save("targetContributionRate", actValue)}>
            {saving === "targetContributionRate" ? "저장 중..." : "저장"}
          </button>
        </div>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="number" step="0.1" style={{ width: 80 }} value={chgValue} onChange={(e) => setChgValue(e.target.value)} />
          <button className="rmb-btn" disabled={saving === "changeTargetRate"} onClick={() => save("changeTargetRate", chgValue)}>
            {saving === "changeTargetRate" ? "저장 중..." : "저장"}
          </button>
        </div>
      </td>
    </>
  );
}

// [MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1] 근무자 등록 — 기존
// POST /api/admin/create-worker(+ createWorkerSchema)를 그대로 재사용한다(AdminPanel의
// "근무자 생성" 다이얼로그와 동일 API, 이번에 hireDate 필드만 추가됨). 사용자 한글 이름을
// 보고 Sheets 작업자명을 추론하지 않는다 — worker-options에서 실제 발견된 이름만 선택.
function RegisterWorkerDialog({ open, onOpenChange, onRegistered }: { open: boolean; onOpenChange: (v: boolean) => void; onRegistered: () => void }) {
  const apiRequest = useApiRequest();
  const { toast } = useToast();
  const workerOptions = useWorkerOptions();
  const todayStr = new Date().toISOString().slice(0, 10);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [performanceWorkerName, setPerformanceWorkerName] = useState("");
  const [hireDate, setHireDate] = useState(todayStr);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setUsername("");
    setPassword("");
    setPerformanceWorkerName("");
    setHireDate(todayStr);
  };

  const submit = async () => {
    if (!name.trim() || username.trim().length < 3 || password.length < 6) {
      toast({ title: "오류", description: "이름/아이디(3자 이상)/비밀번호(6자 이상)를 확인해주세요.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/api/admin/create-worker", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          password,
          performanceWorkerName: performanceWorkerName || null,
          hireDate: hireDate || null,
        }),
      });
      toast({ title: "성공", description: "근무자 계정이 생성되었습니다." });
      reset();
      onOpenChange(false);
      onRegistered();
    } catch (err: any) {
      toast({ title: "오류", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="rmb-modal-backdrop" onClick={() => onOpenChange(false)}>
      <div className="rmb-card rmb-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>근무자 등록</h3>
        <div className="rmb-note">
          기존 사용자 계정 생성 기능을 그대로 사용합니다. 실적 작업자는 이름으로 추측하지 않고 Google Sheets에서 실제
          발견된 이름 중에서만 선택합니다.
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>
            이름
            <input style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 신유리" />
          </label>
          <label>
            아이디
            <input style={{ width: "100%" }} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="로그인 아이디" />
          </label>
          <label>
            비밀번호
            <input style={{ width: "100%" }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상" />
          </label>
          <label>
            실적 작업자 (Google 스프레드시트 작업자 매핑)
            <select style={{ width: "100%" }} value={performanceWorkerName} onChange={(e) => setPerformanceWorkerName(e.target.value)}>
              <option value="">(매핑 없음)</option>
              {workerOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label>
            입사일
            <input style={{ width: "100%" }} type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="rmb-btn" onClick={() => onOpenChange(false)}>
            취소
          </button>
          <button className="rmb-btn primary" disabled={saving} onClick={submit}>
            {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

// [MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1] 퇴사 처리 — 기존 안내 문구("퇴사일을
// 지정해...")와 실제 UI가 불일치하던 문제 수정. 퇴사일은 오늘을 기본값으로 하되 관리자가
// 과거 날짜도 선택 가능해야 한다(요구사항) — <input type="date">에 max 제한을 두지 않는다.
// 사용자 계정/과거 실적을 삭제하지 않는다 — terminationDate 필드만 변경.
function TerminateWorkerDialog({
  open,
  onOpenChange,
  worker,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: TargetWorkerRow | null;
  onSaved: () => void;
}) {
  const apiRequest = useApiRequest();
  const { toast } = useToast();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [terminationDate, setTerminationDate] = useState(todayStr);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setTerminationDate(todayStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worker?.userId]);

  if (!open || !worker) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await apiRequest(`/api/admin/users/${worker.userId}/employment`, {
        method: "PATCH",
        body: JSON.stringify({ terminationDate }),
      });
      toast({ title: "성공", description: `${worker.name}님을 ${terminationDate}자로 퇴사 처리했습니다. 계정/과거 실적은 삭제되지 않습니다.` });
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast({ title: "오류", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rmb-modal-backdrop" onClick={() => onOpenChange(false)}>
      <div className="rmb-card rmb-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>퇴사 처리 — {worker.name}</h3>
        <div className="rmb-note">퇴사일을 지정해 퇴사 처리합니다. 계정과 과거 실적은 삭제하지 않습니다.</div>
        <div style={{ marginTop: 12 }}>
          <label>
            퇴사일
            <input style={{ width: "100%" }} type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="rmb-btn" onClick={() => onOpenChange(false)}>
            취소
          </button>
          <button className="rmb-btn" disabled={saving} onClick={submit}>
            {saving ? "처리 중..." : "퇴사 처리"}
          </button>
        </div>
      </div>
    </div>
  );
}

// [MCC_PERFORMANCE_CALCULATION_AND_WORKER_LIFECYCLE_FINAL_FIX_1] 로그인 ID 변경 —
// 새 계정 생성이 아니라 같은 userId의 username만 바꾼다. performanceWorkerName/hireDate/
// terminationDate/targets/과거 실적은 전부 userId 기준으로 연결되어 있어 그대로 유지된다
// (재매핑/재등록/데이터 이전 없음).
function ChangeUsernameDialog({
  open,
  onOpenChange,
  worker,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  worker: TargetWorkerRow | null;
  onSaved: () => void;
}) {
  const apiRequest = useApiRequest();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && worker) setUsername(worker.username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worker?.userId]);

  if (!open || !worker) return null;

  const submit = async () => {
    const next = username.trim();
    if (next.length < 3) {
      toast({ title: "오류", description: "로그인 ID는 최소 3자 이상이어야 합니다.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/admin/users/${worker.userId}/username`, {
        method: "PATCH",
        body: JSON.stringify({ username: next }),
      });
      toast({ title: "성공", description: `${worker.name}님의 로그인 ID가 "${next}"(으)로 변경되었습니다.` });
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast({ title: "오류", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rmb-modal-backdrop" onClick={() => onOpenChange(false)}>
      <div className="rmb-card rmb-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>로그인 ID 변경 — {worker.name}</h3>
        <div className="rmb-note">
          동일한 계정입니다(사용자 번호/실적 작업자 매핑/입사일·퇴사일/목표/과거 실적 그대로 유지). 로그인 아이디만
          변경됩니다.
        </div>
        <div style={{ marginTop: 12 }}>
          <label>
            새 로그인 ID
            <input
              style={{ width: "100%" }}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="최소 3자 이상"
            />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="rmb-btn" onClick={() => onOpenChange(false)}>
            취소
          </button>
          <button className="rmb-btn primary" disabled={saving} onClick={submit}>
            {saving ? "변경 중..." : "변경"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResultManagementBoard({ dataset }: Props) {
  const [tab, setTab] = useState<TabId>("status");
  const [showExample, setShowExample] = useState(false);
  // [MCC_PERFORMANCE_ADMIN_GOAL_MANAGEMENT_UI_SIMPLIFICATION_1] 목표 편집을 실적현황
  // 표 안으로 옮기면서 필요해진 조회일 기준 월별 목표 매핑(그 달의 targetContributionRate/
  // changeTargetRate를 performanceWorkerName으로 조회).
  const monthlyTargets = useMonthlyTargets(dataset.date);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState<TargetWorkerRow | null>(null);
  const [usernameTarget, setUsernameTarget] = useState<TargetWorkerRow | null>(null);

  // [MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1] 실적현황 roster 병합 — "사람의
  // 존재 여부"는 근무자 관리(조회일 재직자) 기준, "실적 숫자"는 기존 LOCK 계산 결과
  // (dataset.workers) 기준으로 역할을 분리한다(요구사항). 새 계산식을 만들지 않는다 —
  // 0건 재직자의 소속채널 공식총수량도 같은 망의 실제 dataset.workers 값을 그대로
  // 재사용한다(그 값 자체가 이미 회사 전체 공통값이라 특정 개인 행이 없어도 유효).
  const mergedStatusRows = useMemo(() => {
    const officialTotalByNetwork = new Map<string, number>();
    for (const w of dataset.workers) {
      if (w.homeNetworkOfficialTotal != null && !officialTotalByNetwork.has(w.homeNetwork)) {
        officialTotalByNetwork.set(w.homeNetwork, w.homeNetworkOfficialTotal);
      }
    }
    const datasetByWorker = new Map(dataset.workers.map((w) => [w.worker, w]));
    const rosterRows = Array.from(monthlyTargets.byWorker.values()).filter(
      (r) => r.performanceWorkerName && isEmployedOn(r, dataset.date),
    );
    const rosterNames = new Set(rosterRows.map((r) => r.performanceWorkerName!));

    const rows: WorkerPerformanceRow[] = [];
    for (const r of rosterRows) {
      const name = r.performanceWorkerName!;
      const existing = datasetByWorker.get(name);
      if (existing) {
        rows.push(existing);
      } else {
        // 실적 0건인 재직자 — 표시용 0 상태(새 계산식 아님, 기존 값 재사용/0 채움뿐).
        const home = (r.homeNetwork as WorkerPerformanceRow["homeNetwork"]) ?? "기타";
        const officialTotal = officialTotalByNetwork.get(r.homeNetwork ?? "") ?? null;
        rows.push({
          worker: name,
          homeNetwork: home,
          homeCount: 0,
          supportSK: 0,
          supportKT: 0,
          supportLG: 0,
          supportTOSS: 0,
          supportTotal: 0,
          totalHandled: 0,
          homeNetworkOfficialTotal: officialTotal,
          performanceRate: officialTotal && officialTotal > 0 ? 0 : null,
        });
      }
    }
    // Sheets 실적은 있으나 조회일 기준 재직 roster에 없는 worker(매핑 없음 또는 그
    // 날짜에 비재직) — 데이터를 숨기지 않는다(요구사항 H).
    for (const w of dataset.workers) {
      if (!rosterNames.has(w.worker)) rows.push(w);
    }
    return rows;
  }, [dataset.workers, dataset.date, monthlyTargets.byWorker]);

  // "근무자 관리" 탭 표시용 — 전체 내부 근무자(재직/퇴사 무관), 이름순.
  const allWorkers = useMemo(
    () => Array.from(monthlyTargets.byWorker.values()).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [monthlyTargets.byWorker],
  );

  return (
    <div className="rmb-wrap">
      <div className="rmb-head">
        <div>
          <h1>실적관리</h1>
          <div className="rmb-sub">기존 실적 HTML의 계산 기준을 그대로 사용한 실데이터 연결 화면</div>
        </div>
        <span className="rmb-badge">근무자 자동발견·승인 V10</span>
      </div>

      <div className="rmb-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`rmb-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <section className={`rmb-panel ${tab === "status" ? "on" : ""}`}>
        <div className="rmb-warn">
          <b>계산 기준:</b> 채널 공식 총수량에는 타 채널 지원수량을 합산하지 않습니다. 개인 인정실적에는 본인 소속
          채널 처리량 + 타 채널 지원 처리량을 모두 합산합니다.
        </div>

        <div className="rmb-card">
          <div className="rmb-toolbar">
            <div>
              <label>조회일</label>
              <input type="date" value={dataset.date} readOnly />
            </div>
            <div>
              <label>소속 채널</label>
              <select defaultValue="SK">
                <option>SK</option>
                <option>KT</option>
                <option>LG</option>
              </select>
            </div>
            <button className="rmb-btn primary" onClick={() => setShowExample((v) => !v)}>
              {showExample ? "계산 예시 닫기" : "계산 예시 보기"}
            </button>
          </div>
        </div>

        {showExample && (
          <>
            <div className="rmb-metrics">
              <div className="rmb-metric">
                <small>SK 공식 총 개통</small>
                <strong>100건</strong>
              </div>
              <div className="rmb-metric">
                <small>SK 소속 본업 합계</small>
                <strong>100건</strong>
              </div>
              <div className="rmb-metric">
                <small>지원실적</small>
                <strong>개인에게만 합산</strong>
              </div>
              <div className="rmb-metric">
                <small>공식 총수량</small>
                <strong>지원건 제외</strong>
              </div>
            </div>

            <div className="rmb-card">
              <h3 style={{ marginTop: 0 }}>지원업무 포함 개인 실적 계산 예시</h3>
              <div className="rmb-tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>근무자</th>
                      <th>소속</th>
                      <th>SK 본업</th>
                      <th>KT 지원</th>
                      <th>LG 지원</th>
                      <th>개인 인정 처리량</th>
                      <th>분모: SK 공식 총수량</th>
                      <th>실적률</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="left">
                        <b>S)지은</b>
                      </td>
                      <td>SK</td>
                      <td>30</td>
                      <td>0</td>
                      <td>0</td>
                      <td>
                        <b>30</b>
                      </td>
                      <td>100</td>
                      <td>
                        <b>30%</b>
                      </td>
                    </tr>
                    <tr>
                      <td className="left">
                        <b>S)윤희</b>
                      </td>
                      <td>SK</td>
                      <td>30</td>
                      <td>0</td>
                      <td>50</td>
                      <td>
                        <b>80</b>
                      </td>
                      <td>100</td>
                      <td>
                        <b>80%</b>
                      </td>
                    </tr>
                    <tr>
                      <td className="left">
                        <b>S)영미</b>
                      </td>
                      <td>SK</td>
                      <td>40</td>
                      <td>30</td>
                      <td>30</td>
                      <td>
                        <b>100</b>
                      </td>
                      <td>100</td>
                      <td>
                        <b>100%</b>
                      </td>
                    </tr>
                    <tr style={{ background: "#f2f5f9", fontWeight: 900 }}>
                      <td className="left">SK 공식 합계</td>
                      <td>SK</td>
                      <td>100</td>
                      <td colSpan={2}>지원건은 SK 총수량에 미합산</td>
                      <td>-</td>
                      <td>
                        <b>100</b>
                      </td>
                      <td>-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="rmb-note">
                <span className="rmb-formula">
                  개인 실적률 = (소속채널 본업 + 타채널 지원업무 전체) ÷ 소속채널 당일 공식 총수량 × 100
                </span>
                <br />
                따라서 위 예시에서 개인 인정 처리량 합계가 210건이어도 SK 공식 총수량은 100건 그대로입니다.
              </div>
            </div>
          </>
        )}

        <div className="rmb-card">
          <h3 style={{ marginTop: 0 }}>실제 데이터 연결 시 출력 형태</h3>
          <div className="rmb-tablewrap">
            <table>
              <thead>
                <tr>
                  <th>근무자</th>
                  <th>소속</th>
                  <th>본업 처리</th>
                  <th>지원업무 상세</th>
                  <th>인정 처리량</th>
                  <th>소속채널 당일 총수량</th>
                  <th>현재 실적률</th>
                  <th>개통 목표(%)</th>
                  <th>변경 목표(%)</th>
                </tr>
              </thead>
              <tbody>
                {mergedStatusRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="rmb-empty">
                      {dataset.date} 기준으로 표시할 근무자가 없습니다(재직 중인 근무자가 없거나 아직 등록되지
                      않았습니다).
                    </td>
                  </tr>
                ) : (
                  mergedStatusRows.map((w) => (
                    <tr key={w.worker}>
                      <td className="left">
                        <b>{w.worker}</b>
                      </td>
                      <td>{w.homeNetwork}</td>
                      <td>{fmt(w.homeCount)}</td>
                      <td>{supportDetail(w)}</td>
                      <td>
                        <b>{fmt(w.totalHandled)}</b>
                      </td>
                      <td>{fmt(w.homeNetworkOfficialTotal)}</td>
                      <td>
                        <b>{w.performanceRate != null ? `${w.performanceRate.toFixed(1)}%` : "-"}</b>
                      </td>
                      <StatusGoalCells
                        workerName={w.worker}
                        target={monthlyTargets.byWorker.get(w.worker)}
                        year={monthlyTargets.year}
                        month={monthlyTargets.month}
                        onSaved={monthlyTargets.reload}
                      />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rmb-note">
            00700을 포함한 등록된 모든 업무 항목의 지원실적을 개인 인정 처리량에 반영합니다. 개통 목표와 변경 목표는
            서로 독립된 값입니다(한쪽만 저장해도 다른 쪽은 유지됩니다) — {monthlyTargets.year}-
            {String(monthlyTargets.month).padStart(2, "0")} 목표 기준. "매핑 필요"로 표시되면 사용자 관리에서 이
            Sheets 작업자 이름을 먼저 계정에 연결해야 목표를 저장할 수 있습니다. 변경 목표는 목표값만 저장하며,
            달성률 계산 공식은 아직 확정되지 않아 표시하지 않습니다.
          </div>
        </div>
      </section>

      <section className={`rmb-panel ${tab === "people" ? "on" : ""}`}>
        <div className="rmb-card">
          <div className="rmb-toolbar" style={{ justifyContent: "space-between" }}>
            <div>
              <h3 style={{ margin: 0 }}>근무자 관리</h3>
              <p style={{ margin: "4px 0 0" }}>ADMIN 전용. 신입/재직/퇴사와 적용기간을 관리하는 영역입니다.</p>
            </div>
            <button className="rmb-btn primary" onClick={() => setRegisterOpen(true)}>
              근무자 등록
            </button>
          </div>
        </div>
        <div className="rmb-card">
          <h3 style={{ margin: "0 0 6px" }}>근무자 등록 현황</h3>
          <div className="rmb-note">
            직원은 삭제하지 않고 재직/퇴사 상태와 근무기간으로 관리합니다. 퇴사 처리해도 계정과 과거 실적은 그대로
            보존됩니다.
          </div>
          <div className="rmb-tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>근무자</th>
                  <th>로그인 ID</th>
                  <th>실적 작업자</th>
                  <th>소속</th>
                  <th>입사일</th>
                  <th>퇴사일</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {allWorkers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="rmb-empty">
                      등록된 내부 근무자 계정이 없습니다. [근무자 등록]으로 추가하세요.
                    </td>
                  </tr>
                ) : (
                  allWorkers.map((w) => {
                    const employed = !w.terminationDate;
                    return (
                      <tr key={w.userId}>
                        <td className="left">{w.name}</td>
                        <td>{w.username}</td>
                        <td>{w.performanceWorkerName ?? "(매핑 없음)"}</td>
                        <td>{w.homeNetwork ?? "-"}</td>
                        <td>{w.hireDate ?? "-"}</td>
                        <td>{w.terminationDate ?? "-"}</td>
                        <td>
                          <b>{employed ? "재직" : "퇴사"}</b>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                            <button className="rmb-btn" onClick={() => setUsernameTarget(w)}>
                              아이디 변경
                            </button>
                            {employed ? (
                              <button className="rmb-btn" onClick={() => setTerminateTarget(w)}>
                                퇴사 처리
                              </button>
                            ) : (
                              <span style={{ fontSize: 12, color: "#667085", alignSelf: "center" }}>과거 실적 보존</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <RegisterWorkerDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={monthlyTargets.reload} />
      <TerminateWorkerDialog
        open={!!terminateTarget}
        onOpenChange={(v) => !v && setTerminateTarget(null)}
        worker={terminateTarget}
        onSaved={monthlyTargets.reload}
      />
      <ChangeUsernameDialog
        open={!!usernameTarget}
        onOpenChange={(v) => !v && setUsernameTarget(null)}
        worker={usernameTarget}
        onSaved={monthlyTargets.reload}
      />
    </div>
  );
}

export default ResultManagementBoard;

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

import { useEffect, useState } from "react";
import type { PerformanceDataset } from "@/types/performance";
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
  performanceWorkerName: string | null;
  targetContributionRate: number | null;
  changeTargetRate: number | null;
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

export function ResultManagementBoard({ dataset }: Props) {
  const [tab, setTab] = useState<TabId>("status");
  const [showExample, setShowExample] = useState(false);
  const { toast } = useToast();
  // [MCC_PERFORMANCE_ADMIN_GOAL_MANAGEMENT_UI_SIMPLIFICATION_1] 목표 편집을 실적현황
  // 표 안으로 옮기면서 필요해진 조회일 기준 월별 목표 매핑(그 달의 targetContributionRate/
  // changeTargetRate를 performanceWorkerName으로 조회).
  const monthlyTargets = useMonthlyTargets(dataset.date);

  const demoToast = (msg: string) => toast({ title: "검토용 화면", description: msg });

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
                {dataset.workers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="rmb-empty">
                      {dataset.date} 기준으로 표시할 근무자 실적이 없습니다.
                    </td>
                  </tr>
                ) : (
                  dataset.workers.map((w) => (
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
          <h3>근무자 관리</h3>
          <p>ADMIN 전용. 신입/재직/근무지원/퇴사와 적용기간을 관리하는 영역입니다.</p>
        </div>
        <div className="rmb-card">
          <h3 style={{ margin: "0 0 6px" }}>근무자 등록 기준</h3>
          <div className="rmb-note">직원은 삭제하지 않고 재직/퇴사 상태와 근무기간으로 관리합니다.</div>
          <div className="rmb-tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>근무자</th>
                  <th>소속</th>
                  <th>입사일</th>
                  <th>퇴사일</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>H)민지</td>
                  <td>유선</td>
                  <td>2026-09-16</td>
                  <td>-</td>
                  <td>
                    <b>재직</b>
                  </td>
                  <td>
                    <button
                      className="rmb-btn"
                      onClick={() => demoToast("퇴사일을 지정해 퇴사 처리합니다. 직원과 과거 실적은 삭제하지 않습니다.")}
                    >
                      퇴사 처리
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>H)유미</td>
                  <td>유선</td>
                  <td>2025-01-01</td>
                  <td>2026-08-31</td>
                  <td>퇴사</td>
                  <td>과거 실적 보존</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ResultManagementBoard;

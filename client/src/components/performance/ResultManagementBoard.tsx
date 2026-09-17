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
// "월별 인원·목표"/"근무자 관리"/"이번 달 실적자료 연결" 3개 admin-only 탭은
// MCC_PERFORMANCE_SITE_INTEGRATION_1에서 확정된 범위 결정("이번 1차 사이트 연결에서는
// 실제 실적 조회를 우선 완성한다 — 억지로 한꺼번에 새로 개발하지 않는다")에 따라 원본
// HTML의 정적 데모 구조를 그대로 유지하되(정보 삭제 없음), 새로운 백엔드 연결은 하지 않는다
// (원본도 버튼 클릭 시 alert()만 띄우는 시뮬레이션 UI였다 — 동일하게 토스트로 대체).

import { useState } from "react";
import type { PerformanceDataset } from "@/types/performance";
import { useToast } from "@/hooks/use-toast";
import "./ResultManagementBoard.css";

interface Props {
  dataset: PerformanceDataset;
}

const TABS = [
  { id: "status", label: "실적현황" },
  { id: "goals", label: "월별 인원·목표" },
  { id: "people", label: "근무자 관리" },
  { id: "sources", label: "이번 달 실적자료 연결" },
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

export function ResultManagementBoard({ dataset }: Props) {
  const [tab, setTab] = useState<TabId>("status");
  const [showExample, setShowExample] = useState(false);
  const { toast } = useToast();

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
                  <th>목표%</th>
                  <th>차이</th>
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
                      <td>-</td>
                      <td>-</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rmb-note">00700을 포함한 등록된 모든 업무 항목의 지원실적을 개인 인정 처리량에 반영합니다.</div>
        </div>
      </section>

      <section className={`rmb-panel ${tab === "goals" ? "on" : ""}`}>
        <div className="rmb-card">
          <h3>월별 인원·목표</h3>
          <p>ADMIN 전용입니다. 실제 MCC에서는 로그인 권한으로 제어합니다.</p>
          <div className="rmb-toolbar">
            <div>
              <label>적용월</label>
              <input type="month" defaultValue={dataset.date.slice(0, 7)} />
            </div>
            <div>
              <label>담당범위</label>
              <select>
                <option>SK 전체</option>
                <option>텔링크</option>
                <option>KT 전체</option>
                <option>엠모바일</option>
                <option>LG 전체</option>
                <option>헬로</option>
              </select>
            </div>
            <div>
              <label>개통 목표%</label>
              <input type="number" placeholder="%" />
            </div>
            <div>
              <label>기타 목표%</label>
              <input type="number" placeholder="%" />
            </div>
            <button
              className="rmb-btn primary"
              onClick={() => demoToast("입력값 저장 버튼이 정상 반응합니다. 실제 MCC 통합 시 DB에 저장됩니다.")}
            >
              설정 저장
            </button>
          </div>
          <div className="rmb-note">
            설정값을 바꾸면 실적현황의 목표 대비 결과가 바뀌는 구조로 MCC에 연결합니다. 이번 1차 연결은 실제 실적
            조회를 우선 완성하는 범위라 저장은 시뮬레이션 UI입니다.
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

      <section className={`rmb-panel ${tab === "sources" ? "on" : ""}`}>
        <div className="rmb-card">
          <h3 style={{ margin: "0 0 6px" }}>이번 달 실적자료 연결</h3>
          <div className="rmb-note" style={{ fontSize: 13 }}>
            매달 새로 사용하는 스프레드시트 주소만 연결하면 됩니다. 어려운 열 번호나 GID를 직접 입력할 필요 없이{" "}
            <b>주소 붙여넣기 → 시트 선택 → 자료 확인 → 저장</b> 순서로 진행합니다.
          </div>
          <div className="rmb-toolbar" style={{ marginTop: 14 }}>
            <div>
              <label>설정할 월</label>
              <input type="month" defaultValue={dataset.date.slice(0, 7)} />
            </div>
            <button className="rmb-btn" onClick={() => demoToast("지난달 주소와 시트 설정을 복사한 뒤 이번 달 주소만 바꾸는 흐름입니다.")}>
              지난달 설정 복사
            </button>
            <button
              className="rmb-btn primary"
              onClick={() => demoToast("이번 달 실적자료 연결 설정을 저장합니다. 실제 MCC에서는 관리자 설정으로 DB에 저장됩니다.")}
            >
              이번 달 설정 저장
            </button>
          </div>
        </div>

        {["① 개통 실적", "② 기타업무 실적", "③ 00700 실적"].map((name) => (
          <div className="rmb-card" key={name}>
            <h3 style={{ margin: "0 0 5px" }}>{name}</h3>
            <div className="rmb-note">이번 달 스프레드시트를 연결합니다.</div>
            <div className="rmb-toolbar" style={{ marginTop: 12 }}>
              <div style={{ flex: 1, minWidth: 330 }}>
                <label>스프레드시트 주소</label>
                <input style={{ width: "100%" }} placeholder="여기에 이번 달 주소를 붙여넣으세요" />
              </div>
              <div>
                <label>사용할 시트</label>
                <select>
                  <option value="">주소 확인 후 선택</option>
                </select>
              </div>
              <button className="rmb-btn" onClick={() => demoToast("주소 확인 ✓ 사용할 시트를 선택한 뒤 다시 [자료 확인]을 누르세요.")}>
                자료 확인
              </button>
            </div>
            <div className="rmb-note" style={{ marginTop: 12 }}>
              아직 연결하지 않았습니다.
            </div>
          </div>
        ))}

        <div className="rmb-card">
          <h3 style={{ margin: "0 0 6px" }}>새로운 근무자 확인</h3>
          <div className="rmb-note">
            실적자료에서 처음 보는 이름이 나오면 자동 등록하지 않고 한 번만 확인합니다. 승인 후에는 같은 이름의
            실적이 자동 연결됩니다.
          </div>
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#f7f9fc" }}>
            <b>퇴사자는 자동 삭제하지 않습니다.</b>
            <div className="rmb-note" style={{ marginTop: 5 }}>
              관리자가 근무자 관리에서 퇴사일을 지정합니다. 과거 실적은 그대로 보존되고 퇴사일 이후 현재 실적에서만
              제외됩니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default ResultManagementBoard;

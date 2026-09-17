// client/src/components/performance/EnterpriseDailyReportBoard.tsx
//
// 작업명: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1
// (원래 포팅: MCC_ENTERPRISE_DAILY_REPORT_EXACT_HTML_RESTORE_1 /
//  그룹 제목행 제거·테두리·정렬: MCC_ENTERPRISE_DAILY_REPORT_JPG_TABLE_FINAL_FIX_1)
//
// MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/closing.html("마감보고 · 공지텍스트",
// index.html routes.closing이 가리키는 실제 파일)의 실제 DOM 구조를 그대로 React로
// 포팅했다 — 새로 디자인하지 않았다. 이 컴포넌트는 /performance/closing(마감보고 ·
// 공지텍스트) 화면에서만 사용한다 — /performance/daily(전사 공지용 당일실적)는
// performance.html을 이식한 NetworkDetailBoard를 사용한다.
//
// [MCC_ENTERPRISE_DAILY_REPORT_JPG_TABLE_FINAL_FIX_1]
// - 강/구/수/영/우/웅/준/형/호 그룹마다 있던 별도 제목 행(.edrb-manager-title)은 삭제했다.
//   그룹 구분은 판매점 행 배경색(9색 순환)만으로 한다 — 색상 규칙 자체는 그대로 유지.
//
// [MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1]
// - tableExportRef는 "전사 공지용 실적" <h2> 제목을 포함하지 않는다 — 표(전체합계 포함)만
//   감싼다. 제목은 화면에는 표시되지만 JPG에는 포함되지 않아야 하므로 ref 바깥에 둔다.
// - 판매점명 셀(.edrb-dealer)은 텍스트를 .edrb-dealer-inner(flex, align-items:center)로
//   감싸서 실제 DOM 측정 기준으로 상하 중앙 정렬한다 — vertical-align:middle 단독으로는
//   폰트 메트릭 차이 때문에 위/아래 여백이 비대칭이었다(사용자 실측 기준 폐기).
//
// 데이터는 dataset.closing(공지텍스트)과 dataset.dealerMatrix(담당판매점별 상세 실적)를
// 그대로 표시만 한다 — 여기서 재계산하지 않는다.

import type { RefObject } from "react";
import type { PerformanceDataset } from "@/types/performance";
import "./EnterpriseDailyReportBoard.css";

const SECTION_COLORS = [
  "#dbe5f1",
  "#ddd9c4",
  "#dce6f1",
  "#fce4d6",
  "#fff2cc",
  "#e2f0d9",
  "#ffd966",
  "#d9e1f2",
  "#f4cccc",
];

interface Props {
  dataset: PerformanceDataset;
  /** JPG 캡처 대상(오른쪽 표 영역: 제목+표+전체합계만) — 왼쪽 공지텍스트는 포함하지 않는다 */
  tableExportRef?: RefObject<HTMLDivElement>;
}

export function EnterpriseDailyReportBoard({ dataset, tableExportRef }: Props) {
  const { closing, dealerMatrix } = dataset;
  const columns = dealerMatrix.columns;

  return (
    <div className="edrb-layout">
      {/* 왼쪽: 공지 텍스트 (closing.html section.card #1) — JPG 캡처 대상 아님 */}
      <section className="edrb-card">
        <h2 style={{ margin: "0 0 12px" }}>공지 텍스트</h2>
        <div className="edrb-rule">
          앞 숫자 = <b>당일을 포함한 누적값</b> / 뒤 숫자 = <b>당일값</b>
          <br />※ 이 설명은 복사되는 공지 텍스트에는 포함되지 않습니다.
        </div>
        <textarea className="edrb-textarea" readOnly value={closing.noticeText} />
      </section>

      {/* 오른쪽: 전사 공지용 실적 — 담당판매점별 상세 실적표 (closing.html section.card #2) */}
      <section className="edrb-card">
        <h2 style={{ margin: "0 0 12px" }}>전사 공지용 실적</h2>
        {/* tableExportRef가 감싸는 범위 = 표 + 전체합계만(제목 제외). JPG는 이 div만 캡처한다. */}
        <div ref={tableExportRef} className="edrb-table-export">
          {dealerMatrix.groups.map((group, i) => {
            const color = SECTION_COLORS[i % SECTION_COLORS.length];
            return (
              <div className="edrb-sales-block" key={group.group}>
                <table className="edrb-pivot">
                  <thead>
                    <tr>
                      <th className="edrb-dealer">담당)판매점명</th>
                      <th>총합계</th>
                      {columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.dealer}>
                        <td className="edrb-dealer" style={{ background: color }}>
                          <span className="edrb-dealer-inner">{row.dealer}</span>
                        </td>
                        <td style={{ background: color }}>{row.total}</td>
                        {columns.map((c) => (
                          <td key={c} style={{ background: color }}>
                            {row.counts[c] || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="edrb-totalrow">
                      <td className="edrb-dealer">
                        <span className="edrb-dealer-inner">총합계</span>
                      </td>
                      <td>{group.totalRow.total}</td>
                      {columns.map((c) => (
                        <td key={c}>{group.totalRow.counts[c] || ""}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}

          <div className="edrb-sales-block edrb-grand">
            <table className="edrb-pivot">
              <thead>
                <tr>
                  <th className="edrb-dealer">담당)판매점명</th>
                  <th>총합계</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="edrb-totalrow">
                  <td className="edrb-dealer">
                    <span className="edrb-dealer-inner">전체 총합계</span>
                  </td>
                  <td>{dealerMatrix.grandTotal.total}</td>
                  {columns.map((c) => (
                    <td key={c}>{dealerMatrix.grandTotal.counts[c] || ""}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="edrb-note">
          표시 기준은 기존 Excel 실적 시트입니다. 담당자별 색상 구역은 유지하되 전체 판매점·소계·전체합계를 하나의
          연속 장표로 표시하며 JPG도 한 장으로 저장합니다.
        </div>
      </section>
    </div>
  );
}

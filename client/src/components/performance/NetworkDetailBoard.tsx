// client/src/components/performance/NetworkDetailBoard.tsx
//
// 작업명: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1
//
// "전사 공지용 당일실적"(/performance/daily) 화면 — MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/
// performance.html(index.html routes.daily가 실제로 가리키는 파일, 내부 <title>은
// "모바일 당일 실적 전용"이지만 메뉴명은 "전사 공지용 당일실적")의 실제 대시보드 구조를
// 그대로 React로 포팅했다 — KPI 카드 7개, KT/LG/SK 페어(개통현황+기타현황), 하단 3분할
// (스마텔/토스 개통, 통신망 당일 요약, 인터넷 요약), 인터넷 작업자별 당일.
//
// 데이터는 dataset.networkDetail(KT/LG/SK/TOSS 개통·기타 현황, 이미 서버에서 정렬/기여도
// 계산 완료)과 dataset.mobile.daily/dataset.internet을 그대로 표시만 한다 — 여기서
// 재계산하지 않는다(통신망 당일 요약/인터넷 요약/인터넷 작업자별 당일은 기존 값을
// performance.html과 동일한 표 모양으로 재배열만 한다).
//
// [MCC_PERFORMANCE_TWO_JPG_EXPORTS_FINAL_RESTORE_1] performance.html 원본의 exportJpg()는
// #dashboard(이 컴포넌트의 최상위 .ndb-dashboard div 그대로)를 캡처 대상으로 삼는다.
// dashboardRef를 최상위 div에 연결해서 부모(DailyPerformanceBoard.tsx)가 원본과 동일한
// 범위(헤더+KPI 7개+KT/LG/SK 개통·기타+하단 3분할+인터넷 작업자별 당일 전체)를 캡처할 수
// 있게 한다 — closing.html의 #jpgSheet(담당판매점별 표만)과는 완전히 다른, 별도의 JPG다.

import type { RefObject } from "react";
import type { PerformanceDataset, NetworkDetailTable } from "@/types/performance";
import "./NetworkDetailBoard.css";

interface Props {
  dataset: PerformanceDataset;
  /** performance.html #dashboard 전체를 캡처하는 "PPT 한장 JPG" 대상 ref */
  dashboardRef?: RefObject<HTMLDivElement>;
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString("ko-KR") + "건";
}
function numFmt(v: number): string {
  return Math.round(v).toLocaleString("ko-KR");
}

function DetailTable({
  table,
  totalLabel,
  showContribution,
}: {
  table: NetworkDetailTable;
  totalLabel: string;
  showContribution: boolean;
}) {
  const headers = [
    "작업자",
    totalLabel,
    ...(showContribution ? ["기여도"] : []),
    ...table.columns,
  ];

  const totalRow: Record<string, number> = {};
  for (const c of table.columns) totalRow[c] = table.rows.reduce((s, r) => s + (r.categories[c] || 0), 0);

  if (table.rows.length === 0) {
    return (
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={headers.length} className="ndb-empty">
              표시할 데이터가 없습니다.
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r) => (
          <tr key={r.worker}>
            <td className="left">{r.worker}</td>
            <td>{numFmt(r.total)}</td>
            {showContribution && <td>{r.contribution.toFixed(1)}%</td>}
            {table.columns.map((c) => (
              <td key={c}>{r.categories[c] ? numFmt(r.categories[c]) : ""}</td>
            ))}
          </tr>
        ))}
        <tr className="ndb-total-row">
          <td className="ndb-total-label">총합계</td>
          <td className="ndb-total-num">{numFmt(table.total)}</td>
          {showContribution && <td className="ndb-total-num">{table.total > 0 ? "100%" : "0.0%"}</td>}
          {table.columns.map((c) => (
            <td key={c} className="ndb-total-num">
              {totalRow[c] ? numFmt(totalRow[c]) : ""}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function Section({
  title,
  kind,
  totalCount,
  children,
}: {
  title: string;
  kind: "kt" | "lg" | "sk" | "etc" | "sum";
  totalCount: number;
  children: React.ReactNode;
}) {
  return (
    <div className={`ndb-section ${kind}`}>
      <div className={`ndb-head ${kind}`}>
        <span>{title}</span>
        <small>합계 {numFmt(totalCount)}</small>
      </div>
      {children}
    </div>
  );
}

export function NetworkDetailBoard({ dataset, dashboardRef }: Props) {
  const { networkDetail, mobile, internet } = dataset;
  const { activation, extra } = networkDetail;

  const kt = activation.KT.total;
  const lg = activation.LG.total;
  const sk = activation.SK.total;
  const toss = activation.TOSS.total;
  const ext = extra.KT.total + extra.LG.total + extra.SK.total;
  const activationSum = kt + lg + sk + toss;

  // 통신망 당일 요약 (dataset.mobile.daily 재배열, 재계산 없음)
  const summaryRows: [string, number][] = [
    ["SK", mobile.daily.SK],
    ["KT", mobile.daily.KT],
    ["LG", mobile.daily.LG],
    ["토스", mobile.daily.TOSS],
  ];
  const summaryTotal = mobile.daily.합계;

  // 인터넷 요약 (dataset.internet.categories 재배열)
  const internetRows = internet
    ? [...internet.categories].sort((a, b) => a.category.localeCompare(b.category, "ko"))
    : [];

  // 인터넷 작업자별 당일 (dataset.internet.workerDaily를 요청점×작업자로 피벗)
  const workerDaily = internet?.workerDaily ?? [];
  const workers = Array.from(new Set(workerDaily.map((w) => w.worker))).sort((a, b) => a.localeCompare(b, "ko"));
  const requestPoints = Array.from(new Set(workerDaily.map((w) => w.requestPoint))).sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
  const pivot = requestPoints.map((rp) => {
    const counts = workers.map((w) => workerDaily.filter((e) => e.requestPoint === rp && e.worker === w).reduce((s, e) => s + e.count, 0));
    return { requestPoint: rp, counts, total: counts.reduce((a, b) => a + b, 0) };
  });
  const pivotWorkerTotals = workers.map((_, i) => pivot.reduce((s, row) => s + row.counts[i], 0));
  const pivotGrandTotal = pivot.reduce((s, row) => s + row.total, 0);

  return (
    <div className="ndb-dashboard" ref={dashboardRef}>
      <div className="ndb-dash-head">
        <h2>모바일 당일 실적</h2>
        <div className="ndb-file">기준일 {dataset.date} · Google Sheets 실시간 연동</div>
      </div>

      <div className="ndb-kpis">
        <div className="ndb-kpi kt">
          <div className="ndb-label">KT 개통</div>
          <div className="ndb-num">{fmt(kt)}</div>
          <div className="ndb-small">모바일당일실적 KT 블록</div>
        </div>
        <div className="ndb-kpi lg">
          <div className="ndb-label">LG 개통</div>
          <div className="ndb-num">{fmt(lg)}</div>
          <div className="ndb-small">모바일당일실적 LG 블록</div>
        </div>
        <div className="ndb-kpi sk">
          <div className="ndb-label">SK 개통</div>
          <div className="ndb-num">{fmt(sk)}</div>
          <div className="ndb-small">모바일당일실적 SK 블록</div>
        </div>
        <div className="ndb-kpi sum">
          <div className="ndb-label">스마텔/토스</div>
          <div className="ndb-num">{fmt(toss)}</div>
          <div className="ndb-small">별도 블록</div>
        </div>
        <div className="ndb-kpi etc">
          <div className="ndb-label">기타 총합</div>
          <div className="ndb-num">{fmt(ext)}</div>
          <div className="ndb-small">기타 총합계</div>
        </div>
        <div className="ndb-kpi sum">
          <div className="ndb-label">개통 총합</div>
          <div className="ndb-num">{fmt(activationSum)}</div>
          <div className="ndb-small">KT+LG+SK+기타</div>
        </div>
        <div className="ndb-kpi sum">
          <div className="ndb-label">전체 합계</div>
          <div className="ndb-num">{fmt(activationSum + ext)}</div>
          <div className="ndb-small">개통+기타</div>
        </div>
      </div>

      <div className="ndb-carrierRows">
        <div className="ndb-carrierPair">
          <Section title="KT 개통 현황" kind="kt" totalCount={activation.KT.total}>
            <DetailTable table={activation.KT} totalLabel="당일총합계" showContribution />
          </Section>
          <Section title="KT 기타 현황" kind="kt" totalCount={extra.KT.total}>
            <DetailTable table={extra.KT} totalLabel="합계" showContribution={false} />
          </Section>
        </div>
        <div className="ndb-carrierPair">
          <Section title="LG 개통 현황" kind="lg" totalCount={activation.LG.total}>
            <DetailTable table={activation.LG} totalLabel="당일총합계" showContribution />
          </Section>
          <Section title="LG 기타 현황" kind="lg" totalCount={extra.LG.total}>
            <DetailTable table={extra.LG} totalLabel="합계" showContribution={false} />
          </Section>
        </div>
        <div className="ndb-carrierPair">
          <Section title="SK 개통 현황" kind="sk" totalCount={activation.SK.total}>
            <DetailTable table={activation.SK} totalLabel="당일총합계" showContribution />
          </Section>
          <Section title="SK 기타 현황" kind="sk" totalCount={extra.SK.total}>
            <DetailTable table={extra.SK} totalLabel="합계" showContribution={false} />
          </Section>
        </div>
      </div>

      <div className="ndb-gridBottom">
        <Section title="스마텔/토스 개통" kind="sum" totalCount={activation.TOSS.total}>
          <DetailTable table={activation.TOSS} totalLabel="당일총합계" showContribution={false} />
        </Section>

        <Section title="통신망 당일 요약" kind="sum" totalCount={summaryTotal}>
          <table>
            <thead>
              <tr>
                <th>통신망</th>
                <th>당일총합계</th>
                <th>기여도</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(([label, value]) => (
                <tr key={label}>
                  <td className="left">{label}</td>
                  <td>{numFmt(value)}</td>
                  <td>{summaryTotal > 0 ? ((value / summaryTotal) * 100).toFixed(1) + "%" : "0.0%"}</td>
                </tr>
              ))}
              <tr className="ndb-total-row">
                <td className="ndb-total-label">총합계</td>
                <td className="ndb-total-num">{numFmt(summaryTotal)}</td>
                <td className="ndb-total-num">{summaryTotal > 0 ? "100%" : "0.0%"}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="인터넷 요약" kind="sum" totalCount={internet?.totalDaily ?? 0}>
          {internet ? (
            <table>
              <thead>
                <tr>
                  <th>인터넷</th>
                  <th>총누적</th>
                  <th>당일접수</th>
                </tr>
              </thead>
              <tbody>
                {internetRows.map((c) => (
                  <tr key={c.category}>
                    <td className="left">{c.category}</td>
                    <td>{numFmt(c.cumulative)}</td>
                    <td>{numFmt(c.daily)}</td>
                  </tr>
                ))}
                <tr className="ndb-total-row">
                  <td className="ndb-total-label">총합계</td>
                  <td className="ndb-total-num">{numFmt(internet.totalCumulative)}</td>
                  <td className="ndb-total-num">{numFmt(internet.totalDaily)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="ndb-empty">유선 실적 데이터를 불러오지 못했습니다.</div>
          )}
        </Section>
      </div>

      <div style={{ marginTop: 12 }}>
        <Section title="인터넷 작업자별 당일" kind="sum" totalCount={pivotGrandTotal}>
          {internet && pivot.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>인터넷</th>
                  {workers.map((w) => (
                    <th key={w}>{w}</th>
                  ))}
                  <th>당일총합계</th>
                </tr>
              </thead>
              <tbody>
                {pivot.map((row) => (
                  <tr key={row.requestPoint}>
                    <td className="left">{row.requestPoint}</td>
                    {row.counts.map((c, i) => (
                      <td key={workers[i]}>{c || ""}</td>
                    ))}
                    <td>{numFmt(row.total)}</td>
                  </tr>
                ))}
                <tr className="ndb-total-row">
                  <td className="ndb-total-label">총합계</td>
                  {pivotWorkerTotals.map((t, i) => (
                    <td key={workers[i]} className="ndb-total-num">
                      {t || ""}
                    </td>
                  ))}
                  <td className="ndb-total-num">{numFmt(pivotGrandTotal)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="ndb-empty">표시할 데이터가 없습니다.</div>
          )}
        </Section>
      </div>
    </div>
  );
}

export default NetworkDetailBoard;

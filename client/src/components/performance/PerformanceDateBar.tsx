// client/src/components/performance/PerformanceDateBar.tsx
//
// 작업명: MCC_PERFORMANCE_SITE_INTEGRATION_1
// 3개 실적 화면 공통 상단 바 — 기준일 선택 + 새로고침. 현재 보고 있는 날짜를 명확히 표시한다.

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface PerformanceDateBarProps {
  title: string;
  date: string;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
  isFetching?: boolean;
  extra?: React.ReactNode;
}

export function PerformanceDateBar({ title, date, onDateChange, onRefresh, isFetching, extra }: PerformanceDateBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">
          기준일 <span className="font-medium text-gray-700">{date}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-40"
        />
        <Button variant="outline" onClick={onRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          새로고침
        </Button>
        {extra}
      </div>
    </div>
  );
}

// server/lib/training-seed.ts
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 레거시 교육자료(MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/neutral.html의 #guideTab)를
// 새 교육자료 시스템의 초기 자료로 이식한다. 원문 문장은 임의로 고치지 않았다 — 줄바꿈
// 구조만 shared/training-markdown.ts 문법(#, ##, [!주의] 등)에 맞게 재배치했다.
// 3개 항목 모두 망 구분 없는 공통 내용이라 "전체 교육"(ALL) 카테고리로만 이식한다
// (SK/KT/LG로 억지 분할하지 않음).
//
// idempotent: title 완전일치로 존재 여부를 먼저 확인하고 없을 때만 insert한다 — 이
// 스크립트를 여러 번 실행해도(예: 배포 때마다) 중복 생성되지 않는다.

import { eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { trainingArticles } from "../../shared/schema";

interface SeedArticle {
  title: string;
  summary: string;
  category: "ALL";
  content: string;
}

const SEED_ARTICLES: SeedArticle[] = [
  {
    title: "초보자 업무가이드",
    summary: "휴대폰 개통 업무 초보자를 위한 실무 교육자료(레거시 중립요청서 교육자료 이식)",
    category: "ALL",
    content: [
      "# 업무가이드",
      "**문서 목적**: 휴대폰 개통 업무 초보자를 위한 실무 교육자료",
      "[!경고] 가장 중요한 기준 — ★빠른 처리보다 정확한 처리★",
      "**업무 전체 흐름**: 판매점 개통 접수 → 각 통신망 확인 → 공엑 작성 → 판매점 회신(진행안내) → 가입자 정보 입력 → 개통 진행 → 개통 완료 → 판매점 개통 완료 안내",
      "[!경고] 중요 내용 — ★하루 통합 인증은 7회★",
      "**기본 원칙**: 확인 → 입력 → 재확인 순서 유지",
      "**질문 기준**: 애매하면 멈추고 질문",
      "[!주의] 실수 대응 — 실수는 즉시 공유, 혼자 수정 금지",
    ].join("\n"),
  },
  {
    title: "용어사전",
    summary: "신규가입/번호이동/MVNO/중립 기관 등 업무 필수 용어 정리(레거시 중립요청서 교육자료 이식)",
    category: "ALL",
    content: [
      "# 용어사전",
      "**신규가입(010)**: 새 번호로 개통",
      "**번호이동(MNP,번이)**: 번호 유지 후 통신사 변경",
      "**MVNO**: 알뜰폰 통신사",
      "**중립 기관**: 3개월 내 오류 번호이동 승인 기관",
      "**전체 조회**: 회선 요금제,청구요금,사용량,실사용일 조회 - 위약금 / 할부금 / 개통일 / 미납요금 / 청구요금 / 사용일수(정지일수제외 실사용일)",
      "**유심(USIM)**: 가입자 정보 저장 칩",
      "**eSIM**: 실물 없는 디지털 유심",
      "**IMEI**: 휴대폰 고유번호",
      "**사전동의(사동)**: 번호이동 전 이동 승인 절차",
      "**접점코드**: 판매점 식별 코드",
    ].join("\n"),
  },
  {
    title: "오류대응집",
    summary: "기타 이동 불가/명의 불일치/가입제한 등 자주 발생하는 오류와 처리 방법(레거시 중립요청서 교육자료 이식)",
    category: "ALL",
    content: [
      "# 오류대응집",
      "## 기타 이동 불가",
      "**의미**: 일반 번호이동 진행 불가 상태",
      "**확인할 것**: 1. 기존 유심 단말기 장착 여부 확인 요청 2. 기존 통신사로 정확한 사유 확인 요청",
      "**해결 방법**: 판매점에 기타불가 이동 안내(사유까지 같이 전달)",
      "## 명의변경(명변) 후 3개월 제한",
      "**의미**: 명의 변경 후 번호이동 제한",
      "**확인할 것**: 중립해제 후 진행 안내",
      "**해결 방법**: 중립 신청서 작성",
      "## 신규(010) 가입 후 3개월 제한 고객",
      "**의미**: 신규가입 후 번호 이동 제한 상태",
      "**확인할 것**: 중립해제후 진행 안내",
      "**해결 방법**: 중립 신청서 작성",
      "## 명의 불일치",
      "**의미**: 가입 정보와 실제 명의 다름",
      "**확인할 것**: 신분증 / 생년월일",
      "**해결 방법**: 명의자 및 전산상 고객명 띄어쓰기 확인 요청",
      "## 주민번호 불일치",
      "**의미**: 주민번호 정보 불일치",
      "**확인할 것**: 신분증 원본 및 전산 입력 시 오타 여부 확인",
      "**해결 방법**: 기존 통신사 명의자 및 여권 가입자 여부 확인 요청",
      "## 발급일자 불일치",
      "**의미**: 체류기간 만료 혹은 외국인 등록증 재발급",
      "**확인할 것**: 판매점에 외국인 체류기간 등록증 재발급여부 확인 할것",
      "**해결 방법**: 재발급 신분증 OCR 스캔으로 재접수 요청",
      "## 가입제한",
      "**의미**: 고객이 개통 제한 걸어서 진행 불가한건",
      "**확인할 것**: 판매점에 고객 가입제한 걸려잇어 진행 안됨 안내 할 것",
      "[!팁] 해결 방법 — 가입제한 고객: ★가입제한 해제 방법(2가지)★ 1) 모바일 어플(PASS) 접속 → 하단 '추천' 탭 → 명의도용방지(내명의 휴대폰번호 통합조회) 2) 한국정보통신진흥협회(KAIT) 엠세이퍼(http://www.msafer.or.kr) 접속하여 고객이 직접 가입제한/해제. 판매점 안내 후 해제 회신 오면 진행",
      "## 14일 이내 고객",
      "**의미**: 번호이동 하기 전 통신사 개통한지 14일 이내인 고객",
      "**확인할 것**: 판매점에 전 통신사 사용일수 확인요청. 운영 중 전산은 조회 하여 안내 / 미운영 전산은 확인 요청",
      "**해결 방법**: 14일이내 고객 개통 불가. 개통일수 확인 후 14일 이후 재접수 안내",
      "## 단기간 다회선",
      "**의미**: 짧은 일수 이내에 신규 개통을 많이 한 고객",
      "**해결 방법**: 신규 개통 마지막일 기준 180일 뒤 개통 가능 안내",
      "## 납부주장",
      "**의미**: 전통신사에 체납을 납부 할수 있다는 주장을 하여 선진행 가능",
      "**확인할 것**: 체납금액 10만원미만/10만원이상 인지 확인",
      "**해결 방법**: 10만원 미만이면 판매점에 금액 안내 후 납부주장으로 진행 / 10만원 이상이면 금액 안내 후 납부 후 진행 가능 안내",
    ].join("\n"),
  },
];

export async function seedTrainingArticles(actorUserId: number | null): Promise<{ inserted: string[]; skipped: string[] }> {
  const db = await getDatabase();
  const inserted: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < SEED_ARTICLES.length; i++) {
    const seed = SEED_ARTICLES[i];
    const existing = await db.select().from(trainingArticles).where(eq(trainingArticles.title, seed.title)).limit(1);
    if (existing.length > 0) {
      skipped.push(seed.title);
      continue;
    }
    await db.insert(trainingArticles).values({
      title: seed.title,
      summary: seed.summary,
      category: seed.category,
      content: seed.content,
      status: "PUBLISHED",
      isPinned: true,
      sortOrder: i,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    inserted.push(seed.title);
  }

  return { inserted, skipped };
}

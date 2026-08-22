# MCCNETWORLD Dashboard Development Rules

이 문서는 MCCNETWORLD 대시보드 프로젝트의 개발 기준 문서입니다. 대화 세션이 초기화되어도 다음 작업자가 같은 기준으로 작업을 이어갈 수 있도록 작성합니다.

---

## 1. 프로젝트 기본 정보

### 프로젝트 종류

MCCNETWORLD 업무/정산/판매점 관리 대시보드

### 주요 목적

- 판매점 원장 관리
- 접점코드 관리
- 정산 정책/단가표 관리
- 개통 엑셀 업로드
- 정산 자동 매칭
- 정산 결과 상세 확인
- 관리자/작업자/판매점 계정 관리
- 운영 사이트와 로컬 개발 환경 분리 운영

### 주요 기술 스택

- Frontend: React
- Build: Vite
- Styling: Tailwind CSS
- UI: shadcn/ui 계열 컴포넌트
- Backend: Node.js + Express
- Runtime: tsx 개발 서버
- Database: PostgreSQL
- ORM/Schema: Drizzle ORM
- Auth: session 기반 인증, Authorization Bearer sessionId 사용 구간 존재
- Excel 처리: xlsx 라이브러리
- Production Process: PM2
- Production Web Server: Nginx
- Production Backend Port: 5000
- Local Dev Port: 3000

---

## 2. 주요 경로

### 로컬 프로젝트 루트

```text
C:\Users\admin1000\Desktop\업무\MCCNETWORLDPORTAL\MCCNETWORLD
```

### 운영 서버

```text
root@114.207.245.152
```

### 운영 서버 프로젝트 경로

```text
/var/www/app
```

### 운영 사이트

```text
https://mccnetworld.com/admin-panel
https://mccnetworld.com/dashboard
```

### 로컬 개발 주소

```text
http://localhost:3000/admin-panel
http://localhost:3000/dashboard
```

---

## 3. 절대 지켜야 할 운영 원칙

### DB 관련 금지 사항

- 운영 DB 전체 초기화 금지
- 운영 DB에 `npm run db:push` 직접 실행 금지
- 기존 dealer_registrations 데이터 삭제 금지
- 기존 contact_codes 데이터 삭제 금지
- 기존 activation_records 데이터 삭제 금지
- 기존 settlement_items 데이터 삭제 금지
- 운영 DB 수정은 반드시 migration SQL 또는 명시적 ALTER SQL 방식으로 진행

### 배포 원칙

- 운영 배포 전 반드시 app 백업
- 운영 배포 전 반드시 DB 백업
- `.env.production`은 절대 삭제하지 않음
- `uploads`, `attached_assets`는 보존
- 코드만 교체하고 운영 데이터는 유지
- 배포 후 `npm install`, `npm run build`, `pm2 restart portal-backend --update-env` 순서 유지

### 백업 필수 명령

```bash
cd /var/www

BACKUP_DIR="/root/mcc_backup/app_before_deploy_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -a /var/www/app "$BACKUP_DIR/app"
```

```bash
cd /var/www/app
source .env.production

mkdir -p /root/mcc_db_backup

pg_dump \
  --no-owner \
  --no-acl \
  -Fc \
  -f "/root/mcc_db_backup/backup_before_deploy_$(date +%Y%m%d_%H%M%S).dump" \
  "$DATABASE_URL"
```

---

## 4. 로컬 개발 실행 규칙

### 로컬 서버 실행

```powershell
cd "C:\Users\admin1000\Desktop\업무\MCCNETWORLDPORTAL\MCCNETWORLD"
npm run dev
```

### 로컬 접속

```text
http://localhost:3000/admin-panel
```

### 서버 종료

```text
Ctrl + C
```

### 3000 포트 점유 확인

```powershell
netstat -ano | findstr :3000
```

### 프로세스 강제 종료

```powershell
taskkill /PID 숫자 /F
```

### 화면 반영이 안 될 때

- 개발 서버 재시작
- 브라우저 강력 새로고침

```text
Ctrl + Shift + R
```

또는

```text
Ctrl + F5
```

---

## 5. UI/스타일 가이드

### 공통 UI 기준

- 기존 레이아웃을 최대한 유지한다.
- 사용자가 이미 적응한 화면 구조를 임의로 변경하지 않는다.
- 탭 위치, 버튼 위치, 주요 테이블 순서는 업무 흐름 기준으로 유지한다.
- 기능 추가 시 기존 버튼/탭을 삭제하지 않는다.
- 오류 메시지는 사용자가 이해할 수 있는 한국어로 표시한다.

### 버튼 기준

- 주요 작업 버튼은 명확한 명칭 사용
  - 현재 원장 다운로드
  - 엑셀 업로드
  - 양식 다운로드
  - 자동 매칭
  - 정산 확정
- 위험 작업은 즉시 실행하지 않고 확인 절차를 둔다.
- 삭제/초기화 기능은 운영 데이터에 영향을 줄 수 있으므로 별도 확인이 필요하다.

### 테이블 기준

- 정산 결과 상세 테이블은 엑셀처럼 보기 쉬워야 한다.
- 컬럼 경계선, 상태 색상, 금액 천 단위 표기 필수
- 컬럼이 많으면 가로 스크롤 허용
- 금액 컬럼은 우측 정렬 권장
- 상태 컬럼은 색상 또는 배지로 구분

### 정산 결과 상세 컬럼 순서

```text
개통일
채널
판매점명
고객명
개통번호
접점코드
실판매점명
요금제
가입유형
고객구분
결합조건
부가서비스
가입비
매칭상태
정책금액
추가금
차감금
히든금액
조정금액
확정금액
메모
```

주의:

```text
고객번호가 아니라 개통번호를 사용한다.
표시값은 activationNumber / activation_number 기준이다.
customerPhone 또는 subscriptionNumber를 개통번호로 대체하지 않는다.
```

---

## 6. 판매점 원장 관리 규칙

### 판매점 원장의 의미

판매점 원장은 사업자 단위가 아니라 **정산지급처 단위**이다.

### 고유 기준

```text
dealer_registrations.id
dealer_registrations.dealer_code
```

### 사업자번호 규칙

- 사업자번호 중복 허용
- 사업자번호는 참고 정보
- 사업자번호가 같아도 다른 판매점/하부점일 수 있음

예시:

```text
MCC0001 | 썬플러스
MCC0002 | 썬플러스 중계
MCC0003 | 썬플러스 강변
```

위 항목들은 같은 사업자번호를 가질 수 있다.

### 이메일 규칙

판매점 원장 운영에서 이메일은 사용하지 않는다.

- 등록/수정 모달에서 이메일 필드 제거
- 목록 테이블에서 이메일 컬럼 제거
- 엑셀 업로드 양식에서 이메일 제거
- 현재 원장 다운로드에서 이메일 제거
- DB 컬럼은 남아 있어도 nullable이어야 함
- 이메일 unique 제약 금지

### 판매점 원장 다운로드 컬럼

```text
판매점코드
판매점명
사업자번호
대표자명
연락처
주소
상태
히든정책대상
접점정책대상
정산전용
생성일
수정일
```

---

## 7. 접점코드 관리 규칙

### 접점코드의 의미

접점코드는 개통 데이터에서 들어오는 실제 코드이며, 정산지급처와 실판매점을 연결하는 기준이다.

예시:

```text
K엠48830
K엠52810
L프638840
```

### 핵심 연결 구조

```text
접점코드 → dealer_registration_id → 정산지급처
접점코드 → real_sales_pos / real_sales_pos_code → 실판매점/하부점
```

### 접점코드 필수 개념

```text
접점코드
채널
정산지급처ID
정산지급처코드
정산지급처명
실판매점코드
실판매점명
담당영업과장
활성여부
메모
```

### 정산지급처 선택 허용 입력

접점코드 업로드 시 정산지급처선택은 아래 3가지 방식 허용:

```text
MCC0001
[MCC0001] 썬플러스
썬플러스
```

### 매칭 규칙

```text
[MCC0001] 썬플러스 → dealer_code 추출 후 매칭
MCC0001 → dealer_code 매칭
썬플러스 → business_name 정확 일치 매칭
```

### 중복 처리

- 이름 매칭 결과가 1개면 자동 연결
- 이름 매칭 결과가 2개 이상이면 업로드 실패 또는 검토 필요 처리
- 이름 매칭 결과가 0개면 업로드 실패 또는 검토 필요 처리

---

## 8. 하부점/실판매점 판단 규칙

### 기본 구조

```text
판매점명 = 정산지급처명
실판매점명 = 실제 판매점/하부점명
```

### 본점/하부점 판단

```text
정산지급처명과 실판매점명이 같으면 → 본점
정산지급처명과 실판매점명이 다르면 → 하부점
```

### 비교 전 정규화

아래 접두어는 비교 전에 제거한다.

```text
원)
준)
우)
웅)
구)
협)
협력)
```

그리고 양쪽 문자열 모두 trim 처리한다.

### 예시

```text
정산지급처명: 원)썬플러스
실판매점명: 썬플러스
→ 정규화 후 같음
→ 본점
```

```text
정산지급처명: 썬플러스
실판매점명: 썬플러스 중계
→ 다름
→ 하부점
```

---

## 9. 정산 정책/단가표 규칙

### 정책 차수

정산 정책은 월별 차수 기준으로 관리한다.

예시:

```text
2026년 6월
```

### 활성 정책

- 활성 정책 차수는 1개만 사용하는 것이 안전하다.
- 자동 생성 정책과 수동 생성 정책이 동시에 활성화되지 않도록 주의한다.

### 단가표 양식

```text
채널
요금제
내국인_신규
내국인_번이
외국인_신규
외국인_번이
결합조건
부가서비스조건
가입비조건
메모
```

### 단가 입력 규칙

```text
3.0  → 30,000원
10.0 → 100,000원
47.5 → 475,000원
```

계산 기준:

```text
입력값 * 10000
```

### 조건값 규칙

- 조건을 보지 않을 경우 빈칸으로 둔다.
- 빈칸은 NULL wildcard로 처리한다.
- 부가서비스조건에는 금액이 아니라 조건값을 넣는다.
- 예: `캐치콜+`
- 조건 없이 모든 건에 적용할 단가는 조건 칸을 비워둔다.

---

## 10. 개통 업로드 규칙

### AA열 고객구분

개통 엑셀 AA열은 내국인/외국인 구분이다.

### 변환 규칙

```text
내 / 내국 / 내국인 → 내국인
외 / 외국 / 외국인 → 외국인
빈칸 → 내국인
```

### 가입유형

기존 `customer_type`은 신규/번이 의미로 사용한다.

```text
1 → 신규
2 → 번이
```

표시명은 `가입유형`으로 사용한다.

### 개통번호

정산 상세에서 개통번호는 반드시 `activationNumber` 또는 `activation_number` 기준으로 표시한다.

---

## 11. 정산 자동 매칭 규칙

자동 매칭 기준:

```text
채널
요금제
가입유형
고객구분
결합조건
부가서비스조건
가입비조건
접점코드
정산지급처
```

### 미매칭 주요 원인

```text
요금제명 불일치
요금제 접두어 불일치
부가서비스조건 불일치
가입비조건 불일치
내국인/외국인 단가 없음
접점코드 미등록
정산지급처 미연결
정책 차수 불일치
```

### 미매칭 처리

- 데이터 삭제보다 원인 확인 우선
- 상세 테이블에서 채널/요금제/가입유형/고객구분/조건값 확인
- 단가표 수정 후 재매칭
- 접점코드 수정 후 재매칭

---

## 12. API 연동 표준

### 인증 헤더

관리자 API 호출 시 sessionId가 필요한 경우 아래 형식을 사용한다.

```ts
Authorization: `Bearer ${sessionId}`
```

### 다운로드 API 처리

정상 응답은 blob 또는 arrayBuffer로 처리한다.

```ts
const response = await fetch("/api/admin/dealer-registrations/export", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${sessionId}`,
  },
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(text || `다운로드 실패 (${response.status})`);
}

const contentType = response.headers.get("content-type") || "";
if (!contentType.includes("spreadsheetml")) {
  const text = await response.text();
  throw new Error(`xlsx가 아닌 응답입니다: ${text.slice(0, 300)}`);
}

const arrayBuffer = await response.arrayBuffer();
```

주의:

```text
정상 xlsx 응답에서 response.text() 또는 response.json()을 먼저 읽으면 안 된다.
오류 응답일 때만 text/json을 읽는다.
```

### XLSX 응답 헤더

```ts
res.setHeader(
  "Content-Type",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
);
res.setHeader(
  "Content-Disposition",
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
);
res.setHeader("Content-Length", buffer.length);
res.setHeader("Cache-Control", "no-cache, no-transform");
return res.end(buffer);
```

### 정상 XLSX 기준

정상 xlsx 파일의 첫 바이트는 `PK`이다.

PowerShell 확인:

```powershell
Get-Content "파일경로.xlsx" -Encoding Byte -TotalCount 20
```

정상:

```text
80
75
```

비정상 예시:

```text
255
216
```

`255 216`은 JPG 파일이다.

---

## 13. 에러 처리 규칙

### 프론트 에러

- 사용자가 이해 가능한 한국어로 표시
- 서버 응답의 error/message를 최대한 그대로 표시
- 다운로드 오류는 status, content-type, response text 확인 가능해야 함

### 서버 에러

- catch에서 console.error 출력
- 운영 데이터에 영향을 주는 API는 실패 원인을 명확히 반환
- 단순히 `실패했습니다`만 반환하지 않는다.

### 라우트 충돌 주의

Express 라우트는 순서가 중요하다.

아래처럼 구체 라우트가 동적 라우트보다 위에 있어야 한다.

```ts
router.get('/api/admin/dealer-registrations/export', ...);
router.get('/api/admin/dealer-registrations/:id', ...);
```

반대로 작성하면 `/export`가 `id = export`로 처리된다.

---

## 14. 배포 절차

### 로컬 빌드

```powershell
cd "C:\Users\admin1000\Desktop\업무\MCCNETWORLDPORTAL\MCCNETWORLD"

npm run build

tar -czf .\mcc_full_code_latest.tar.gz `
  client `
  server `
  shared `
  dist `
  drizzle `
  package.json `
  package-lock.json `
  vite.config.ts `
  tsconfig.json `
  tailwind.config.ts `
  postcss.config.js `
  drizzle.config.ts `
  components.json
```

### 서버 업로드

```powershell
scp -i "$env:USERPROFILE\.ssh\id_ed25519_mcccmd" .\mcc_full_code_latest.tar.gz root@114.207.245.152:/tmp/mcc_full_code_latest.tar.gz
```

### 서버 접속

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_mcccmd" root@114.207.245.152
```

### 운영 코드 교체

```bash
cd /var/www/app

mkdir -p /tmp/mcc_keep

cp -a .env.production /tmp/mcc_keep/.env.production
cp -a ecosystem.config.cjs /tmp/mcc_keep/ecosystem.config.cjs 2>/dev/null || true
cp -a uploads /tmp/mcc_keep/uploads 2>/dev/null || true
cp -a attached_assets /tmp/mcc_keep/attached_assets 2>/dev/null || true

rm -rf client server shared dist drizzle
rm -f package.json package-lock.json vite.config.ts tsconfig.json tailwind.config.ts postcss.config.js drizzle.config.ts components.json

tar -xzf /tmp/mcc_full_code_latest.tar.gz -C /var/www/app

cp -a /tmp/mcc_keep/.env.production .env.production
cp -a /tmp/mcc_keep/ecosystem.config.cjs ecosystem.config.cjs 2>/dev/null || true
cp -a /tmp/mcc_keep/uploads uploads 2>/dev/null || true
cp -a /tmp/mcc_keep/attached_assets attached_assets 2>/dev/null || true
```

### 설치/빌드/재시작

```bash
cd /var/www/app

npm install
npm run build

pm2 restart portal-backend --update-env
pm2 logs portal-backend --lines 60
```

---

## 15. 커밋 규칙

### 커밋 전 확인

```powershell
git status
git diff --stat
npm run build
```

### 파일 추가

무조건 `git add .`를 먼저 하지 않는다. 변경 파일을 확인한 뒤 필요한 파일만 add한다.

예시:

```powershell
git add server/routes.ts
git add client/src/pages/AdminPanel.tsx
git add shared/schema.ts
git add drizzle
```

### 커밋 메시지 예시

```powershell
git commit -m "판매점 원장 다운로드 및 하부점 접점코드 구조 개선"
```

또는

```powershell
git commit -m "Fix dealer registry export and sub-dealer contact mapping"
```

---

## 16. 작업 보고 규칙

작업 완료 보고는 아래 형식으로 한다.

```text
1. 수정 파일 목록
2. 수정 내용 요약
3. DB migration 필요 여부
4. 기존 데이터 영향 여부
5. 로컬 테스트 결과
6. 빌드 결과
7. 운영 배포 필요 여부
8. 남은 이슈
```

보고 시 “완료”라고만 하지 말고, 실제 확인한 화면/명령/로그를 함께 적는다.

---

## 17. 중요 판단 기준

### 기능이 안 될 때 우선 확인할 것

```text
1. 실제 요청 URL
2. Network Status
3. Response body
4. 서버 콘솔 로그
5. 라우트 순서
6. 현재 실행 중인 서버가 최신 코드인지
7. 브라우저 캐시 여부
8. dist 빌드 반영 여부
```

### 캐시 문제 가능성

UI가 수정됐는데 화면에 남아 있으면:

```text
1. npm run dev 재시작
2. Ctrl + Shift + R
3. dist/public/assets 안의 빌드 결과 검색
4. client/src 원본 검색
```

검색 예시:

```powershell
Select-String -Path ".\client\src\pages\AdminPanel.tsx" -Pattern "이메일|contactEmail|email" -Context 2,2
Select-String -Path ".\dist\public\assets\*.js" -Pattern "이메일|contactEmail|email" -Context 1,1
```

---

## 18. 작업명/티켓명 규칙

모든 작업은 아래 형식의 고유 작업명을 먼저 붙여 진행한다.

형식:

```text
MCC_[범위]_[기능]_[순번]
```

예시:

```text
MCC_DEALER_MCODE_SCHEMA_MIGRATION_AUDIT_1
MCC_DEALER_MCODE_MASTER_UPLOAD_IMPORT_1
MCC_ACTIVATION_UPLOAD_MCODE_MATCHING_ENGINE_1
MCC_ADMINPANEL_DEALER_REGISTRY_COMPONENT_SPLIT_1
MCC_ADMINPANEL_CONTACT_CODE_COMPONENT_SPLIT_1
MCC_ADMINPANEL_SETTLEMENT_COMPONENT_SPLIT_1
```

원칙:

- 영문 대문자 사용
- 단어 구분은 언더스코어 사용
- 작업 범위가 드러나야 함
- 마지막에는 순번을 붙임
- 완료 보고, 검증 보고, 후속 작업 연결 시 반드시 동일한 작업명을 사용함
- `1단계`, `2단계`처럼 일반적인 제목 사용 금지

작업명은 추후 작업 추적, 오류 원인 분석, Claude 재요청, 운영 반영 내역 정리에 사용한다.

---

## 19. 화면/컴포넌트 분리 원칙

`AdminPanel.tsx`에 모든 기능을 계속 추가하지 않는다.

### 기본 원칙

- 기존 정상 기능을 한 번에 대규모 분리하지 않는다.
- 새로 추가되는 기능부터 별도 컴포넌트로 분리한다.
- `AdminPanel.tsx`는 메뉴, 탭, 진입점, 공통 레이아웃 역할만 담당하게 한다.
- 실제 화면, 업로드 UI, 결과 요약, 검토필요 목록, 대량 테이블은 별도 컴포넌트로 분리한다.
- 기존 기능 분리는 후속 작업명으로 별도 진행한다.
- 기능 분리 시 기존 UI 스타일과 사용자 흐름은 유지한다.

### 분리 우선 대상

아래 기능은 AdminPanel.tsx에 직접 추가하지 않고 별도 컴포넌트 분리를 우선 검토한다.

```text
M코드 기준 원장 업로드 화면
업로드 결과 요약 화면
검토필요/실패 행 목록 화면
판매점 원장 대량 업로드 화면
접점코드 원장 관리 화면
정산 상세 검토 화면
정산 결과 테이블
대량 엑셀 업로드/다운로드 기능
독립성이 강한 업무 도구 화면
```

### 권장 분리 경로 예시

```text
client/src/components/admin/mcode/McodeMasterUploadPanel.tsx
client/src/components/admin/mcode/McodeUploadResultSummary.tsx
client/src/components/admin/mcode/McodeUploadReviewTable.tsx
```

### 기존 기능 분리 후속 작업명

```text
MCC_ADMINPANEL_DEALER_REGISTRY_COMPONENT_SPLIT_1
MCC_ADMINPANEL_CONTACT_CODE_COMPONENT_SPLIT_1
MCC_ADMINPANEL_SETTLEMENT_COMPONENT_SPLIT_1
```

### 독립 HTML vs React 컴포넌트 분리 기준

독립 HTML/iframe이 적합한 경우 (DB/API/권한과 무관한 독립 도구):

```text
날짜 계산 도구
안내문 생성기
단순 계산/복사 업무 도구
기존에 완성되어 독립적으로 동작하는 업무 HTML
```

React 컴포넌트 분리가 적합한 경우 (DB/API/권한/업로드와 연결):

```text
M코드 기준 원장 업로드
판매점 원장 생성/갱신
접점코드 원장 생성/갱신
개통 엑셀 업로드
정산 결과 상세
검토필요/미매칭 처리
관리자 권한이 필요한 기능
```

---

## 20. M코드/판매점 원장 구조 확정 원칙

M코드는 판매점 1개를 의미하는 단일 unique 값이 아니다.

하나의 M코드 안에 여러 운영 채널과 여러 접점코드가 포함될 수 있다.

예시:

```text
M02458 안에 후불)중고SK, L미디어, S텔링크, L프리티, K엠모바일, K카카오 등 여러 채널 공존 가능
```

반드시 지켜야 할 원칙:

```text
dealer_registrations.m_code에 UNIQUE 제약 걸지 않음
contact_codes.m_code에도 UNIQUE 제약 걸지 않음
M코드 단독으로 판매점/접점코드를 임의 확정하지 않음
정확한 자동 매칭은 contact_codes 중심으로 처리
M코드 + 접점코드 또는 M코드 + 채널/코드명 조합을 우선 사용
M코드 단독 조회 결과가 여러 건이면 임의로 첫 번째 값을 선택하지 않고 중복검토 상태로 저장
미확정/중복/이상 데이터는 업로드 전체 실패가 아니라 검토필요로 분리
```

---

## 21. 개통 업로드 매칭 우선순위

개통 엑셀 업로드 시 판매점/접점코드 매칭 우선순위:

```text
1순위: M코드 + 접점코드 매칭
2순위: M코드 + 코드명 매칭
3순위: 접점코드 단독이 전체에서 unique일 때 매칭
4순위: M코드 단독 결과가 정확히 1건일 때만 매칭
5순위: 판매점명/코드명 보조 매칭
6순위: 여러 건이면 중복검토
7순위: 없으면 미매칭
```

정산 결과 상세에 반드시 매칭 기준을 표시한다:

```text
M코드+접점코드 매칭
M코드+코드명 매칭
접점코드 단독 매칭
M코드 단독 1건 매칭
M코드 중복검토
미매칭
```

---

## UI 변경 승인 원칙 - 2026-08-22

### 기존 화면 틀 유지 원칙

앞으로 모든 개발 작업에서 기존 화면 구조, 모달 크기, 버튼 위치, 테이블 배치, 카드 배치, 탭 구조, 스크롤 방식, 색상 체계, 컬럼 구조를 임의로 변경하지 않는다.

기능 수정 중 UI 변경이 필요하더라도 기존 화면 틀 안에서 최소 수정으로 처리한다.

특히 아래 항목은 사용자 승인 없이 변경 금지한다.

- 기존 모달 크기 변경
- 기존 버튼 위치 변경
- 기존 결과 표시 방식 변경
- 기존 테이블을 화면 밖으로 확장
- 기존 카드 레이아웃 변경
- 기존 탭/메뉴 구조 변경
- 기존 색상/뱃지/상태 표시 방식 변경
- 기존 접기/펼치기 구조 변경
- 기존 스크롤 방식 변경
- 기존 화면을 넓히거나 높이를 강제로 확장
- 기존 UI를 새 디자인으로 재구성

### UI 변경 사전 승인 규칙

기존 UI 틀을 바꿔야 할 가능성이 있으면, 코드를 수정하기 전에 반드시 먼저 보고하고 사용자 승인을 받아야 한다.

보고 형식:

```text
[UI 변경 필요 여부]
- 변경 필요한 화면:
- 기존 UI:
- 변경하려는 UI:
- 변경 사유:
- 기존 틀 유지 가능 여부:
- 변경 시 영향 범위:
- 사용자 승인 필요 여부:
```

사용자가 승인하기 전까지 UI 구조 변경 작업을 진행하지 않는다.

### 기능 수정과 UI 변경 분리 원칙

기능 오류 수정과 UI 변경은 별도 작업으로 분리한다.

예:

- API 오류 수정
- DB 저장 로직 수정
- 업로드 처리 로직 수정
- 매칭 로직 수정

위 작업을 하면서 화면 구조를 임의로 바꾸지 않는다.

UI 변경이 필요하면 별도 작업명으로 분리한다.

예:

```text
MCC_MCODE_UPLOAD_RESULT_UI_LAYOUT_FIX_1
MCC_ADMINPANEL_TABLE_LAYOUT_ADJUST_1
MCC_UPLOAD_MODAL_DETAIL_VIEW_UI_APPROVAL_1
```

### 결과 화면 상세 표시 원칙

업로드 결과 화면에서는 상세 확인 기능이 필요하더라도 기존 모달 틀을 깨지 않는다.

원칙:

- 요약 카드는 기존 위치 유지
- 상세 목록은 기본 접힘 또는 내부 스크롤로 처리
- 상세 테이블은 모달 내부 폭을 넘지 않게 처리
- 하단 버튼은 항상 모달 하단에 유지
- 상세 목록 때문에 모달 전체가 화면 밖으로 밀리면 안 됨
- 실패/검토필요/스킵 목록은 확인 가능해야 하지만 화면을 깨면 안 됨

### Claude 작업 시 금지사항

Claude는 사용자의 명시 승인 없이 아래를 하면 안 된다.

- "보기 좋게" 임의 UI 변경
- "확인하기 쉽게" 기존 모달 크기 확대
- "테이블을 보여주기 위해" 화면 구조 변경
- "컴포넌트 정리" 명목으로 기존 화면 재배치
- 기능 수정 중 UI를 새로 설계
- 기존과 다른 사용 흐름 적용

UI 변경이 필요하면 먼저 사용자에게 확인을 받아야 한다.

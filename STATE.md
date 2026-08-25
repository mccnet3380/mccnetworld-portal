# MCCNETWORLD Dashboard State

이 문서는 현재 프로젝트 진행 상태를 빠르게 이어받기 위한 상태 문서입니다. 작업자는 이 문서를 먼저 읽고 현재 진행 중인 작업과 다음 액션을 확인해야 합니다.

---

## 1. 완료된 작업

### 기본 프로젝트/환경

- [x] React + Vite 기반 대시보드 구조 구성
- [x] Express 백엔드 서버 구성
- [x] PostgreSQL 연동 구성
- [x] Drizzle schema 기반 DB 사용
- [x] 로컬 개발 서버 `localhost:3000` 구동 확인
- [x] 운영 서버 `/var/www/app` 배포 구조 확인
- [x] PM2 프로세스 `portal-backend` 운영 확인
- [x] Nginx가 `dist/public` 프론트를 서빙하는 구조 확인

---

### 로그인/계정

- [x] 관리자 테이블 `admins` 구조 확인
- [x] 관리자 로그인은 `admins.username`, `admins.password` 기준임 확인
- [x] 비밀번호는 bcrypt hash 방식 사용 확인
- [x] 로컬 개발 DB 관리자 계정 확인
  - 아이디: `admin`
- [x] users 테이블에 판매점 계정이 MCC 코드 기준으로 생성되는 구조 확인
- [x] 판매점 원장 등록 시 users 테이블과 연결되는 구조 확인

---

### 운영 DB/스키마

- [x] 운영 DB 백업 절차 확정
- [x] 운영 app 백업 절차 확정
- [x] 운영 DB에 settlement 관련 테이블 생성 완료
  - activation_records
  - settlement_items
  - policy_versions
  - policy_rows
- [x] dealer_registrations 신규 컬럼 반영 완료
  - dealer_code
  - is_hidden_pos
  - is_contact_policy_pos
  - settlement_only
- [x] users.dealer_registration_id 컬럼 추가 완료
- [x] contact_codes.dealer_registration_id integer 변환 완료
- [x] activation_records.nationality_type 컬럼 추가 완료
- [x] policy_rows.nationality_type 컬럼 추가 완료
- [x] nationality_type 기본값 `내국인` 적용 완료
- [x] nationality_type 인덱스 생성 완료

---

### 판매점 원장

- [x] 판매점 원장 기본 등록 구조 구현
- [x] 판매점 원장 내부 코드 `MCC0001` 형식 사용
- [x] 판매점 원장 `현재 원장 다운로드` 기능 추가
- [x] 다운로드 API `/api/admin/dealer-registrations/export` 추가
- [x] `/export` 라우트가 `/:id`보다 위에 있어야 하는 문제 확인
- [x] 기존 잘못된 요청 `/dealer-registrations?format=xlsx` 문제 확인
- [x] 프론트 다운로드 URL을 `/api/admin/dealer-registrations/export`로 변경
- [x] xlsx 다운로드는 blob/arrayBuffer로 처리해야 함 확인
- [x] 정상 xlsx 파일 첫 바이트가 `PK`여야 함 확인
- [x] 판매점 원장 다운로드에서 이메일 컬럼 제거 요청 전달
- [x] 판매점 원장 사업자번호 중복 허용 방향 확정
- [x] 판매점 원장은 사업자 단위가 아니라 정산지급처 단위로 운영하기로 확정
- [x] 판매점 원장 이메일은 운영에서 제거하기로 확정

---

### 접점코드

- [x] 접점코드가 정산지급처를 연결하는 기준임 확정
- [x] 접점코드 업로드 양식에 판매점 원장 참조 시트 필요 확정
- [x] 정산지급처 선택 입력 3가지 허용 방향 확정
  - `MCC0001`
  - `[MCC0001] 판매점명`
  - `판매점명`
- [x] 접점코드는 `dealer_registration_id`로 판매점 원장과 연결하는 구조 확정
- [x] 접점코드 수동 등록/수정 시 정산지급처 Combobox 필요 확정
- [x] 검색 기준 확정
  - 판매점명
  - dealer_code
  - 사업자번호
  - 대표자명
- [x] 표시 형식 확정
  - `판매점명 (MCC0001)`
- [x] 저장값은 `dealer_registration_id`로 확정

---

### 하부점/실판매점

- [x] 하부점/실판매점은 사업자번호 기준으로 판단하지 않기로 확정
- [x] 실판매점명은 접점코드 기준으로 관리하기로 확정
- [x] 실판매점코드 개념 도입 방향 확정
  - 예: `SP0001`, `SP0002`
- [x] 초기에는 실판매점코드가 비어 있어도 운영 가능해야 함 확정
- [x] 같은 정산지급처 안에서 같은 실판매점명은 같은 실판매점코드를 재사용하는 방향 확정
- [x] 본점/하부점 판단 기준 확정
  - 정산지급처명 = 실판매점명 → 본점
  - 정산지급처명 ≠ 실판매점명 → 하부점
- [x] 비교 전 접두어 제거 필요 확정
  - 원)
  - 준)
  - 우)
  - 웅)
  - 구)
  - 협)
  - 협력)

---

### 정산 정책/단가표

- [x] 정산 정책 차수 개념 구현
- [x] 정책 차수는 월별 단가표 묶음으로 사용
- [x] 활성 정책 차수는 1개만 유지하는 것이 안전함 확인
- [x] 단가표 가로형 양식 확정
  - 채널
  - 요금제
  - 내국인_신규
  - 내국인_번이
  - 외국인_신규
  - 외국인_번이
  - 결합조건
  - 부가서비스조건
  - 가입비조건
  - 메모
- [x] 단가 입력값 환산 규칙 확정
  - `10.0` → `100,000`
  - `47.5` → `475,000`
- [x] 단가 환산 공식 확정
  - 입력값 * 10000
- [x] 조건 칸 blank는 NULL wildcard로 처리하는 방향 확정
- [x] 부가서비스조건에는 금액이 아니라 조건명을 넣어야 함 확인

---

### 개통 업로드/정산 매칭

- [x] 개통 엑셀 AA열이 내국인/외국인 구분임 확인
- [x] AA열 blank는 내국인으로 처리 확정
- [x] 기존 customer_type은 신규/번이 의미임 확인
- [x] `1 = 신규`, `2 = 번이`로 해석 확정
- [x] 정산 상세에서 고객번호가 아니라 개통번호를 표시하기로 확정
- [x] 개통번호 표시값은 activationNumber / activation_number 기준으로 확정
- [x] 정산 결과 상세 컬럼 순서 확정
- [x] 자동 매칭 기준 확정
  - 채널
  - 요금제
  - 가입유형
  - 고객구분
  - 결합조건
  - 부가서비스조건
  - 가입비조건

---

### 배포

- [x] 로컬 빌드 후 tar 압축 배포 방식 확정
- [x] 운영 서버 scp 업로드 방식 확인
- [x] 운영 app 백업 완료 경험 있음
- [x] 운영 DB 백업 완료 경험 있음
- [x] 운영 코드 교체 절차 확정
- [x] `.env.production`, `uploads`, `attached_assets` 보존 방식 확정
- [x] 운영 DB nationality migration 적용 완료
- [x] PM2 재시작 절차 확정

---

### MCC_DEALER_MCODE_SCHEMA_MIGRATION_AUDIT_1

상태: 완료

목표: 판매점 원장과 접점코드 원장에 M코드, 채널, 하부점, 지역, KP번호 정보를 저장할 수 있도록 DB 구조와 migration 준비.

완료 내용:

- [x] shared/schema.ts 수정
- [x] dealer_registrations 테이블 컬럼 추가 (m_code, kp_number, region_name, source_dealer_name, sub_dealer_name)
- [x] contact_codes 테이블 컬럼 추가 (m_code, channel, kp_number, region_name, alias_name, sub_dealer_name, source_dealer_name, code_name)
- [x] ContactCode / Dealer 인터페이스 업데이트
- [x] createContactCodeSchema / updateContactCodeSchema 필드 추가
- [x] migration SQL 신규 작성: `migrations/migration_20260821_mcode_channel_fields.sql`
- [x] npm run build 성공

확정 원칙:

- dealer_registrations.m_code UNIQUE 없음
- contact_codes.m_code UNIQUE 없음
- m_code 관련 컬럼은 인덱스만 생성
- actual_contact_code 불필요 (contact_codes.code가 실제 접점코드 역할)
- dealer_code(MCC0001) 내부 자동코드 유지
- 사업자번호 중복 허용 유지
- 이메일 필드 재추가 없음
- 기존 데이터 삭제 없음
- npm run db:push 미사용

주의:

```text
로컬 DB에는 migration SQL을 별도로 적용해야 함.
```

로컬 migration 적용 명령:

```powershell
cd "C:\Users\admin1000\Desktop\업무\MCCNETWORLDPORTAL\MCCNETWORLD"
$env:DATABASE_URL = (Select-String -Path ".env" -Pattern "^DATABASE_URL=").Line -replace "^DATABASE_URL=", ""
psql "$env:DATABASE_URL" -f ".\migrations\migration_20260821_mcode_channel_fields.sql"
```

---

### MCC_DEALER_MCODE_MASTER_UPLOAD_IMPORT_1

상태: 완료 (코드 기준 — 로컬 DB migration 적용 후 실제 업로드 테스트 필요)

목표: 실제 M코드/판매점 내역 엑셀을 관리자 화면에서 업로드하면 dealer_registrations + contact_codes 원장을 자동 생성/갱신.

완료 내용:

- [x] server/storage.ts — `upsertDealerRegistrationByMCode` 메서드 추가 (IStorage 인터페이스 포함)
- [x] server/storage.ts — `updateDealerRegistration` 필드 확장 (mCode, kpNumber, regionName, sourceDealerName, subDealerName, settlementOnly)
- [x] server/storage.ts — `upsertContactCode` 신규 필드 확장 (mCode, channel, kpNumber, regionName, aliasName, subDealerName, sourceDealerName, codeName)
- [x] server/routes.ts — `POST /api/admin/dealer-registrations/mcode-master-upload` 라우트 추가 (`/:id` 라우트보다 먼저 위치)
- [x] client/src/pages/AdminPanel.tsx — 상태 변수 / 핸들러 추가
- [x] client/src/pages/AdminPanel.tsx — "M코드 기준 원장 업로드" 버튼 추가 (파란색 테두리로 기존 업로드와 구분)
- [x] client/src/pages/AdminPanel.tsx — 업로드 결과 다이얼로그 추가 (8칸 요약 카드 + 검토필요 20건 + 실패 20건)
- [x] client/src/pages/AdminPanel.tsx — 판매점 원장 목록 테이블에 M코드, KP번호, 지역 컬럼 추가
- [x] npm run build 성공

엑셀 컬럼 파싱 구조 (A~J 위치 고정, header:1 배열 방식):

```text
A: 판매점명 (source_dealer_name)
B: 접점코드 (fallback)
C: 판매점명(수식) (business_name 우선 / code_name)
D: 별칭 (alias_name)
E: 하부점명 (sub_dealer_name)
F: 채널 (channel)
G: M코드 (m_code)
H: 접점코드 (우선 사용)
I: KP번호 (kp_number)
J: 지역명 (region_name)
```

dealer_registrations upsert 기준 (3단계 매칭키):

```text
1순위: m_code + kp_number + sub_dealer_name
2순위: m_code + source_dealer_name + sub_dealer_name
3순위: m_code + source_dealer_name (하부점명 없는 경우)
다건 → 중복검토 (임의 선택 금지)
0건 → 신규 create (settlementOnly: true, username 자동 생성)
```

contact_codes upsert 기준:

```text
code = H열 > B열 (둘 다 없으면 skip)
기존 code(UNIQUE) 조회 후 update/insert
```

검토필요 처리 기준:

```text
G열 M코드 없음
삭제점 / 제외 / 개인 / 테스트 키워드 포함
dealer_registrations 조회 결과 다건
```

주의:

```text
로컬 DB에 migration_20260821_mcode_channel_fields.sql 적용 후 실제 업로드 테스트 필요.
carrier 컬럼은 엑셀에 없어 '미지정'으로 저장됨 — 추후 채널→통신사 매핑 필요 시 별도 작업.
```

---

## 2. 현재 진행 중인 작업 및 주의사항

### 판매점 원장 UI 수정 확인

- [ ] 로컬 화면에서 판매점 원장 등록 모달 이메일 필드 제거 여부 최종 확인
- [ ] 로컬 화면에서 판매점 원장 등록 버튼 클릭 시 빈 폼으로 뜨는지 확인
- [ ] 수정 모달을 닫은 뒤 다시 등록 모달을 열었을 때 기존 데이터가 남지 않는지 확인
- [ ] 엑셀 업로드 안내문에서 이메일이 제거되었는지 확인
- [ ] 현재 원장 다운로드 xlsx에서 이메일 컬럼이 제거되었는지 확인
- [ ] 같은 사업자번호로 판매점 2개 이상 등록 가능한지 확인

주의:

```text
Claude 보고상으로는 코드 수정 완료라고 했지만, 실제 로컬 화면 확인은 사용자의 PC에서 필요하다.
캐시 문제일 수 있으므로 npm run dev 재시작 후 Ctrl+Shift+R 필요.
```

---

### 하부점/실판매점 구조 적용

- [ ] contact_codes에 실판매점코드 개념 적용 여부 확인
- [ ] real_sales_pos_code 컬럼 추가 필요 여부 확인
- [ ] real_sales_pos 기존 컬럼 사용 여부 확인
- [ ] 접점코드 업로드 양식에 실판매점코드/실판매점명 반영 여부 확인
- [ ] 실판매점코드 자동 생성 로직 필요 여부 결정
- [ ] 본점/하부점 판단 로직 적용 위치 결정
- [ ] 정산 결과 상세에 본점/하부점 구분 컬럼 표시 여부 결정

주의:

```text
하부점 판단은 사업자번호로 하면 안 된다.
정산지급처명과 실판매점명 비교 기준으로 처리해야 한다.
```

---

### 접점코드 양식/업로드

- [ ] 접점코드 양식 다운로드에 판매점원장참조 시트 포함 여부 확인
- [ ] 정산지급처선택 컬럼이 3가지 입력 방식을 모두 허용하는지 확인
- [ ] 이름 매칭 중복 시 검토 필요 처리되는지 확인
- [ ] 수동 등록/수정 화면에서 정산지급처 Combobox 동작 확인
- [ ] 선택값이 dealer_registration_id로 저장되는지 확인
- [ ] 접점코드 업로드 후 정산지급처명과 실판매점명이 올바르게 표시되는지 확인

---

### 정산 정책/단가표

- [ ] 정산 정책 화면에서 채널별 정렬 개선 필요
- [ ] 엠모바일/미디어/프리티/텔링크/스카이/LG헬로/유모바일 등 채널별로 보기 쉽게 정렬 필요
- [ ] 정책 차수 활성 상태가 1개만 유지되는지 확인
- [ ] 내국인/외국인 가로형 단가표 업로드 정상 동작 확인
- [ ] 단가 입력값 * 10000 환산 정상 확인
- [ ] blank 조건이 NULL wildcard로 정상 처리되는지 확인
- [ ] 부가서비스조건이 불필요한 단가는 빈칸으로 두었을 때 정상 매칭되는지 확인

---

### 개통 업로드/매칭

- [ ] 개통 엑셀 업로드 후 AA열 내국인/외국인 저장 확인
- [ ] activation_records.nationality_type 값 확인
- [ ] 가입유형 신규/번이 표시 확인
- [ ] 정산 상세 개통번호 표시 확인
- [ ] customerPhone/subscriptionNumber가 개통번호로 잘못 표시되지 않는지 확인
- [ ] 접점코드 기준 정산지급처 자동 연결 확인
- [ ] 자동 매칭 실행 후 매칭상태/정책금액/확정금액 확인
- [ ] 미매칭 상세 원인 표시 필요 여부 확인

---

### 운영 배포 주의

- [ ] 로컬 확인 전 운영 배포 금지
- [ ] 운영 배포 전 app 백업 필수
- [ ] 운영 배포 전 DB 백업 필수
- [ ] 운영 DB 전체 초기화 금지
- [ ] 기존 원장/접점/정산 데이터 삭제 금지
- [ ] migration 필요 시 SQL 내용 먼저 검토
- [ ] 운영 반영 후 Ctrl+F5로 캐시 갱신 필요

---

## 3. Next Action

### 즉시 해야 할 작업 (로컬 migration 적용)

- [ ] 로컬 DB에 migration SQL 적용

```powershell
cd "C:\Users\admin1000\Desktop\업무\MCCNETWORLDPORTAL\MCCNETWORLD"
$env:DATABASE_URL = (Select-String -Path ".env" -Pattern "^DATABASE_URL=").Line -replace "^DATABASE_URL=", ""
psql "$env:DATABASE_URL" -f ".\migrations\migration_20260821_mcode_channel_fields.sql"
```

- [ ] 로컬 서버 재시작

```powershell
npm run dev
```

- [ ] 브라우저에서 로컬 관리자 페이지 접속

```text
http://localhost:3000/admin-panel
```

- [ ] 강력 새로고침 (Ctrl + Shift + R)

---

### M코드 기준 원장 업로드 테스트

- [ ] 판매점 원장 탭 진입
- [ ] "M코드 기준 원장 업로드" 버튼(파란색 테두리) 확인
- [ ] 실제 M코드 엑셀 파일 업로드 실행
- [ ] 결과 요약 카드 확인 (판매점 신규/갱신, 접점코드 신규/갱신, 검토필요, 실패)
- [ ] 검토필요 샘플 내용 확인 (삭제점/제외/M코드없음 등)
- [ ] 목록 테이블에 M코드, KP번호, 지역 컬럼 확인
- [ ] 같은 파일 재업로드 시 중복 생성이 아닌 갱신 처리되는지 확인

---

### 화면 확인 후 문제가 있으면 실행할 검색

```powershell
Select-String -Path ".\client\src\pages\AdminPanel.tsx" -Pattern "이메일|contactEmail|email" -Context 2,2
```

```powershell
Select-String -Path ".\dist\public\assets\*.js" -Pattern "이메일|contactEmail|email" -Context 1,1
```

---

### M코드 원장 업로드 테스트 정상 완료 후 다음 작업

다음 작업명: `MCC_ACTIVATION_UPLOAD_MCODE_MATCHING_ENGINE_1`

- [ ] 개통 엑셀 업로드 시 M코드+접점코드 기반 7단계 매칭 엔진 구현
- [ ] 정산 결과 상세에 매칭 기준 레이블 표시 추가
- [ ] 하부점/실판매점코드 구조 추가 필요 여부 확인
- [ ] 정산 정책 화면 채널별 정렬 개선
- [ ] 전체 로컬 테스트 → git commit → 운영 배포

---

## 4. 운영 순서

실제 정산 운영 시 순서는 아래를 따른다.

```text
1. 판매점 원장 등록
2. 접점코드 등록
3. 정산 정책 차수 생성
4. 단가표 업로드
5. 개통 엑셀 업로드
6. 자동 매칭 실행
7. 미매칭/검토필요 확인
8. 수정 후 재매칭
9. 정산 확정
10. 엑셀 다운로드
```

---

## 5. 현재 가장 중요한 판단

현재 프로젝트에서 가장 중요한 기준은 아래와 같다.

```text
판매점 원장 = 정산지급처 기준
접점코드 = 정산지급처 + 실판매점 연결 기준
단가표 = 채널 + 요금제 + 가입유형 + 고객구분 + 조건 기준
개통 업로드 = 접점코드와 단가표를 연결하는 실제 데이터
정산 결과 = 정산지급처/실판매점/정책금액/확정금액을 검증하는 화면
```

작업자는 이 기준을 변경하지 말고, 기존 구조 위에서 누락된 기능을 보완해야 한다.

---

## MCC 정책표 자동 분리/업로드 흐름 진행 상태 - 2026-08-24

작업명: MCC_POLICY_AUTO_UPLOAD_FLOW_STATE_SAVE_20260824

### 1. 최종 확정된 운영 의도

사용자는 원본 MCC 정책 통합본 엑셀을 직접 다시 정리하거나 161개 요금제 단가를 수동 입력하는 방식을 원하지 않는다.

원하는 최종 운영 흐름:

1. 원본 MCC 정책 통합본 엑셀을 업로드한다.
2. 시스템이 원본 정책표를 자동 분석한다.
3. 채널/통신사별로 결과 엑셀 파일을 생성한다.
   예: 엠모바일.xlsx / 미디어.xlsx / 스카이.xlsx / 텔링크.xlsx / 프리티SK.xlsx / 프리티LG.xlsx / 헬로.xlsx
4. 각 채널 파일 안에는 정책차수/적용일/적용시간/접수기준/개통기준별로 시트를 생성한다.
   예: 8월1차 / 8월2차_14일접수 / 8월3차_14일접수_수정 / 8월4차_24일접수 / 검토필요
5. 사용자는 생성된 채널별 파일을 직접 열어서 확인/수정한다.
   - 금액 수정 / 누락 금액 입력 / 불필요 행 삭제 / 메모 수정 / 적용 차수 확인
6. 수정 완료된 채널별 파일을 다시 업로드한다.
7. 업로드된 해당 채널 파일만 policy_rows에 반영한다.

중요:
- 전체를 하나의 파일에 몰아넣는 방식이 아니다.
- 조건별로 파일을 쪼개는 것도 아니다.
- 채널별 파일을 만들고, 그 파일 안에서 정책 차수별 시트를 만든다.
- 생성된 *_upload.xlsx 파일은 자동 일괄 DB 반영용이 아니라, 사용자가 수정/검토 후 다시 업로드할 최종 업로드 후보 파일이다.

---

### 2. 완료된 작업

#### MCC_POLICY_ORIGINAL_EXCEL_STRUCTURE_AUDIT_1 완료

원본 파일: ■MCC정책_통합본_8월 8차(24일~)_유선_8월_20차(21일12시~) 송부용.xlsx

전체 시트 12개 확인:
1. ※공지사항
2. ⓞ후불(주력요약)
3. ①후불(스테이지5,7모바일,프리티)
4. ①후불(M모바일)
5. ①후불(skyLife)
6. ①후불(유모바일,LG헬로)
7. ②단말(KTM)
8. ③KT중고후불&동판
9. ③SK,LG중고후불
10. ④유선
11. ⑤선불
12. ⑥선불인터넷&단기SIM

1차 자동화 가능 시트:
- ①후불(M모바일)
- ①후불(skyLife)
- ①후불(스테이지5,7모바일,프리티)
- ①후불(유모바일,LG헬로)

1차 제외/별도 파서 대상:
- ※공지사항 / ⓞ후불(주력요약) / ②단말(KTM) / ③KT중고후불&동판 / ③SK,LG중고후불 / ④유선 / ⑤선불 / ⑥선불인터넷&단기SIM

후불 유심 공통 컬럼:
- 요금제명: B열 / 내국인 신규: L열 / 내국인 MNP/번이: M열 / 외국인 신규: N열 / 외국인 MNP/번이: O열
- 정책차수: 대부분 Q열 행6 또는 블록 헤더 위치

유선 예외: 정책차수가 M열 행1에 위치 → 별도 파서 필요

---

#### MCC_POLICY_CHANNEL_FILE_SPLIT_DESIGN_1 완료

- 파일 분리 기준: 채널/통신사별
- 시트 분리 기준: 정책차수별 / 적용일별 / 적용시간별 / 접수기준/개통기준별 / 동일 채널 안에서 조건이 다른 정책별

---

#### MCC_POLICY_ROW20_PLUS_AUDIT_1 완료

확정된 1차 자동화 대상 채널 파일 9개:
1. 스테이지SK.xlsx
2. 스테이지KT.xlsx
3. 텔링크.xlsx
4. 프리티SK.xlsx
5. 프리티LG.xlsx
6. 엠모바일.xlsx
7. 스카이.xlsx
8. 미디어.xlsx
9. 헬로.xlsx

- 7모바일: 이번 원본 파일에 실제 블록 없음 → 이번 자동 생성 대상 제외
- 텔링크: ①후불(스테이지5,7모바일,프리티) 시트 행23~48에 존재 → 1차 자동화 대상 추가
- 프리티SK: [SK알뜰폰] 프리텔레콤 / FRD3204
- 프리티LG: [LG알뜰폰] 인스코비 / 332109
- 헬로: [LG알뜰폰] LG헬로비전 / 316829, 시트명: 8월4차_24일접수

---

#### MCC_POLICY_SPLIT_ENGINE_1 완료

신규 스크립트: scripts/split-mcc-policy-excel.ts

실행: `npx tsx scripts/split-mcc-policy-excel.ts`
다른 파일 지정: `npx tsx scripts/split-mcc-policy-excel.ts "파일경로.xlsx"`
출력 경로: output/mcc_policy_split/

생성된 채널별 파일 9개 (스테이지SK/스테이지KT/텔링크/프리티SK/프리티LG/엠모바일/스카이/미디어/헬로)

결과:
- 자동인식 행: 214행
- 검토필요 행: 18행 (원본 빈 행/구분자 행, 미디어 K-Pass 계열 R/B 공란/#N/A)

---

#### MCC_POLICY_OUTPUT_VALIDATION_1 완료

- 파일 생성 / 시트명 규칙 / 행 수 9/9 검증 통과
- 원본 행 수 214행 = 출력 행 수 214행
- 금액 샘플 27건 전량 원본과 일치
- 검토필요 18건 정상 격리

기존 정책 업로드 양식과 직접 호환되지 않는 문제 확인:
- 시스템채널 → 채널 변경 필요
- 비고 → 메모 변경 필요
- 원본파일명/원본시트명/원본행번호/자동인식상태/검토필요사유 등 추적 컬럼 제거 필요

---

#### MCC_POLICY_UPLOAD_READY_EXPORT_1 완료

신규 스크립트: scripts/export-policy-upload-ready.ts

실행: `npx tsx scripts/export-policy-upload-ready.ts`
출력 경로: output/mcc_policy_upload_ready/

생성된 업로드용 파일 9개 (*_upload.xlsx), 총 214행

기존 정책 업로드 10컬럼과 일치 확인:
1. 채널 / 2. 요금제 / 3. 내국인_신규 / 4. 내국인_번이 / 5. 외국인_신규 / 6. 외국인_번이 / 7. 결합조건 / 8. 부가서비스조건 / 9. 가입비조건 / 10. 메모

검토필요 행은 업로드용 파일에서 제외됨 (빈 행/구분자/미디어 K-Pass #N/A 행)

---

### 3. 현재 사용자가 정정한 중요한 운영 흐름

중요: *_upload.xlsx 파일들을 자동으로 한 번에 전체 DB에 넣는 흐름이 아니다.

사용자가 원하는 흐름:
1. 원본 정책표를 자동 분리한다.
2. 채널별 업로드 후보 파일을 만든다.
3. 사용자가 각 채널별 파일을 열어서 직접 수정/확인한다.
4. 수정 완료된 파일을 다시 업로드한다.
5. 업로드된 해당 파일만 정책 DB에 반영한다.

따라서 다음 작업은 "9개 파일 일괄 업로드"가 아니라,
"사용자가 수정한 채널별 파일을 다시 업로드하는 흐름이 현재 API/UI에서 가능한지 분석"이다.

---

### 4. 내일 이어서 해야 할 작업

다음 작업명: MCC_POLICY_CHANNEL_FILE_REUPLOAD_FLOW_AUDIT_1

목표: 채널별로 생성된 *_upload.xlsx 파일을 사용자가 수정한 뒤, 다시 정책 업로드에 올리는 운영 흐름이 현재 시스템에서 안전하게 가능한지 분석한다.

분석 요청:
1. 현재 정책 업로드 API가 채널별 수정 파일 업로드 흐름을 지원하는지 확인
2. 다중 시트 업로드를 지원하는지 확인
3. 시트명 기준 정책차수/적용일 정보를 읽는지 확인
4. 사용자가 수정한 금액이 정상 반영되는지 확인
5. 중복 업로드 시 기존 행 처리 방식 확인 (skip / update / duplicate insert)
6. 같은 채널/요금제/유형/국적이 기존에 있으면 skip인지, 중복 생성인지, 갱신인지 확인
7. policy_rows에 정책차수/적용시작일시/적용종료일시/접수개통기준 컬럼 존재 여부 확인
8. 현재 구조에서 위험한 점 확인
9. 필요한 수정 사항 정리

중요: 코드 수정하지 말고 분석만 먼저 진행

내일 Claude에게 보낼 프롬프트:

```
작업명: MCC_POLICY_CHANNEL_FILE_REUPLOAD_FLOW_AUDIT_1

목표:
MCC_POLICY_UPLOAD_READY_EXPORT_1에서 생성된 채널별 업로드 후보 파일을 사용자가 수정한 뒤 다시 정책 업로드에 올리는 운영 흐름이 현재 시스템에서 가능한지 분석합니다.

현재 확정된 운영 흐름:
1. 원본 MCC 정책 통합본 업로드
2. 채널별 파일 자동 생성
3. 각 채널 파일 안에는 정책차수/적용일/시간 기준 시트 생성
4. 사용자가 채널별 파일을 열어 금액/메모/불필요 행을 수정
5. 수정 완료된 채널별 파일을 다시 업로드
6. 업로드된 파일만 policy_rows에 반영

중요: *_upload.xlsx 파일은 자동 일괄 DB 반영용이 아닙니다. 사용자 수정/검토 후 다시 업로드하는 최종 후보 파일입니다.

분석 요청:
1. 현재 POST /api/admin/policies/upload-excel API가 다중 시트를 읽는지 확인
2. 여러 시트가 있을 때 첫 시트만 읽는지, 전체 시트를 읽는지 확인
3. 시트명에 들어있는 정책차수/적용일/적용시간 정보가 DB에 저장되는지 확인
4. 현재 policy_rows 테이블에 정책차수, 적용시작일시, 적용종료일시, 접수/개통 기준을 저장할 컬럼이 있는지 확인
5. 없다면 어떤 문제가 생기는지 분석
6. 사용자가 수정한 금액이 업로드 시 정상 반영되는지 확인
7. 중복 업로드 시 기존 행 처리 방식 확인 (skip / update / duplicate insert)
8. 같은 채널/요금제/customerType/nationalityType인데 차수만 다른 경우 현재 시스템이 구분할 수 있는지 확인
9. 구분할 수 없다면 정책 기간 관리 컬럼이 필요한지 보고
10. 코드 수정 전 분석 결과만 보고

중요: 코드 수정 금지 / DB migration 금지 / DB 삭제 금지 / 기존 policy_rows 삭제/초기화 금지 / 기존 UI 임의 변경 금지 / 운영 DB에서 npm run db:push 금지

보고 형식:
[현재 업로드 API 동작]
[다중 시트 지원 여부]
[시트명/차수 정보 저장 여부]
[policy_rows 기간/차수 컬럼 존재 여부]
[중복 업로드 처리 방식]
[사용자 수정 파일 업로드 가능 여부]
[현재 구조의 위험]
[필요한 수정 사항]
[추천 다음 작업]
```

---

### 5. 현재 위험/주의사항

1. 현재 업로드용 파일은 10컬럼 호환까지는 완료됐지만, 정책차수/적용일시 정보가 10컬럼 양식에는 포함되지 않는다.
2. 시트명에는 차수/적용일 정보가 있으나, 기존 업로드 API가 시트명을 읽어서 저장하는지 아직 확인되지 않았다.
3. policy_rows에 적용시작일시/적용종료일시/정책차수 컬럼이 없다면, 같은 요금제의 8월1차/8월3차/8월4차 정책을 구분하지 못할 수 있다.
4. 같은 채널/요금제/customerType/nationalityType 조합이 중복되면 기존 API가 skip 처리할 가능성이 있다.
5. 그러면 차수별 정책을 제대로 누적 관리하지 못할 수 있다.
6. 따라서 실제 DB 반영 전에 반드시 reupload flow audit이 필요하다.

---

### 6. 절대 하지 말 것

- 9개 *_upload.xlsx 파일을 한 번에 운영 DB에 일괄 업로드하지 말 것
- 사용자가 수정하지 않은 자동 생성 파일을 최종 정책으로 확정하지 말 것
- policy_rows 삭제/초기화 금지
- 운영 DB에서 npm run db:push 금지
- 기존 UI 임의 변경 금지
- DB migration은 사용자 승인 전 금지
- 정산 rematch는 정책 업로드 구조 확정 전 금지

---

### 7. 다음 우선순위

1순위: MCC_POLICY_CHANNEL_FILE_REUPLOAD_FLOW_AUDIT_1
2순위: 필요 시 policy_rows에 정책차수/적용시작일시/적용종료일시/접수개통기준 컬럼 추가 설계
3순위: 사용자 수정 파일 업로드 처리 개선
4순위: 정책 업로드 후 settlement/rematch 테스트
5순위: 선불/유선/단말/중고 파서 별도 구현

---

## UI 변경 승인 규칙 추가 - 2026-08-22

### 발생 배경

MCC_DEALER_MCODE_MASTER_UPLOAD_IMPORT_1 작업 중 업로드 결과 상세 목록을 추가하면서 기존 모달 UI 틀이 깨지는 문제가 발생했다.

문제 사례:

- 검토필요/대표행 스킵/실패 목록 테이블이 모달 내부에 고정되지 않음
- 상세 테이블이 화면 하단을 밀어냄
- 버튼 영역이 아래로 밀림
- 기존 결과 화면 구조가 임의로 변경됨
- 기능 로직은 정상인데 UI가 운영 화면 기준에 맞지 않게 변경됨

### 확정 규칙

앞으로 기존 화면/UI 틀을 변경해야 하는 경우, Claude는 반드시 사전에 사용자 승인을 받아야 한다.

기능 수정 중에는 기존 UI 구조를 유지한다.

UI 변경이 필요한 경우 별도 작업명으로 분리하고, 변경 전 아래 내용을 먼저 보고한다.

- 어떤 화면을 바꾸는지
- 기존 화면 구조가 무엇인지
- 왜 변경이 필요한지
- 기존 틀 안에서 해결 가능한지
- 변경 시 영향 범위
- 사용자 승인 필요 여부

### 현재 적용 대상

이 규칙은 특히 아래 화면에 적용한다.

- AdminPanel.tsx
- 판매점 원장 화면
- 접점코드 관리 화면
- M코드 기준 원장 업로드 모달
- 업로드 결과 요약 화면
- 검토필요/실패/스킵 상세 목록
- 정산 결과 상세 화면
- 정산 정책/단가표 화면
- 개통 업로드 화면

### 현재 작업 상태

MCC_DEALER_MCODE_MASTER_UPLOAD_IMPORT_1 기능 로직은 정상화 완료.

현재 확인된 정상 결과:

- 전체행 270
- 읽은행 270
- 검토필요 0
- 실패 0
- 판매점 신규 0
- 판매점 갱신 270
- 접점코드 신규 0
- 접점코드 갱신 224
- 대표행 스킵 46

업로드 결과 상세 UI는 아코디언 접기/펼치기 방식으로 정리 완료. 기존 모달 틀(max-w-2xl) 유지.

후속 작업명(참고):

```text
MCC_MCODE_UPLOAD_RESULT_UI_LAYOUT_RESTORE_1
```

작업 원칙:

- 기능 로직 변경 금지
- server/routes.ts 처리 로직 변경 금지
- McodeUploadResultSummary.tsx UI 레이아웃만 정리
- 기존 모달 틀 유지
- 상세 목록은 접기/펼치기 또는 내부 스크롤 처리
- 하단 버튼 위치 유지

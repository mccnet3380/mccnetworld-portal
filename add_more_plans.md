# 요금제 추가 방법 가이드

현재 약 40개의 요금제가 추가되었습니다. 300개를 만들기 위해 다음 방법들을 사용하실 수 있습니다:

## 1. 관리자 패널에서 이미지 업로드
- 관리자 로그인 (admin@portal.com / admin123!)
- 관리자 패널 → 요금제 관리 → 이미지로 요금제 추가
- 통신사 선택하고 요금제 이미지 업로드

## 2. Excel 파일로 대량 추가
이전에 업로드한 Excel 파일(통합 문서1_1752894519617.xlsx)을 다시 처리하여 더 많은 요금제를 추가할 수 있습니다.

## 3. SQL 직접 실행
service_plans_bulk.sql 파일을 수정해서 더 많은 요금제를 추가:

```sql
INSERT INTO service_plans (plan_name, carrier, plan_type, data_allowance, monthly_fee, is_active, created_at, updated_at) VALUES
('새요금제명', '통신사', 'LTE/5G', '데이터용량', 월요금, 1, datetime('now'), datetime('now'));
```

## 4. 관리자 패널에서 개별 추가
- 요금제 관리 탭에서 "새 요금제 추가" 버튼 사용
- 요금제명, 통신사, 타입, 데이터 용량, 월요금 입력

## 5. API 엔드포인트 직접 호출
POST /api/service-plans 로 JSON 데이터 전송

## 현재 추가된 요금제들:
- 미래엔 LTE/5G 요금제들 (약 30개)
- KT텔레콤 LTE/5G 요금제들 (약 15개)
- 기타 이미지에서 추출한 요금제들

가장 쉬운 방법은 관리자 패널의 이미지 업로드 기능을 사용하는 것입니다!
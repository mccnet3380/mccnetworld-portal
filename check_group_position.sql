-- 1. 전체 고유 dealer_name 수 (totalGroups)
SELECT count(DISTINCT dealer_name) as total_groups FROM settlement_items;

-- 2. dealer_name 알파벳/한글 정렬 순서에서 우)코리아텔레콤의 위치
SELECT position, dealer_name, cnt FROM (
  SELECT
    ROW_NUMBER() OVER (ORDER BY dealer_name COLLATE "ko-KR-x-icu") as position,
    dealer_name,
    count(*) as cnt
  FROM settlement_items
  GROUP BY dealer_name
) ranked
WHERE dealer_name = '우)코리아텔레콤';

-- 3. 정렬 기준 상위 120개 (page1=1~100, page2=101~200 확인용)
SELECT
  ROW_NUMBER() OVER (ORDER BY dealer_name COLLATE "ko-KR-x-icu") as pos,
  dealer_name,
  count(*) as cnt
FROM settlement_items
GROUP BY dealer_name
ORDER BY dealer_name COLLATE "ko-KR-x-icu"
LIMIT 120;

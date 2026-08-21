-- 작업 2: POLICY_NOT_FOUND 상위 30개 채널+요금제+유형 조합
SELECT
  ar.channel,
  ar.plan_name,
  ar.customer_type,
  count(*) as cnt
FROM settlement_items si
JOIN activation_records ar ON ar.id = si.activation_id
WHERE si.match_status = 'POLICY_NOT_FOUND'
GROUP BY ar.channel, ar.plan_name, ar.customer_type
ORDER BY cnt DESC
LIMIT 30;

-- 작업 3: 현재 policy_rows 전체 (비교용)
SELECT channel, plan_name, customer_type, rebate_amount, is_active
FROM policy_rows
ORDER BY channel, plan_name;

-- 작업 4: customer_type 현황
SELECT customer_type, count(*) as cnt
FROM policy_rows
GROUP BY customer_type
ORDER BY cnt DESC;

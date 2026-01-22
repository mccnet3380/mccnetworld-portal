-- Test data for verifying service plan information is preserved
SELECT 
  d.id,
  d.customer_name,
  d.activation_status,
  d.service_plan_id,
  sp.plan_name,
  d.additional_service_ids,
  d.registration_fee_prepaid,
  d.registration_fee_postpaid,
  d.sim_fee_prepaid,
  d.sim_fee_postpaid,
  d.bundle_applied,
  d.bundle_not_applied,
  d.device_model,
  d.sim_number,
  d.subscription_number
FROM documents d
LEFT JOIN service_plans sp ON d.service_plan_id = sp.id
WHERE d.activation_status = '개통'
ORDER BY d.updated_at DESC;
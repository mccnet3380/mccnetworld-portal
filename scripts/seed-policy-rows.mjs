// 테스트용 policy_rows 시드 스크립트 (인코딩 안전)
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: 'postgresql://postgres:password@127.0.0.1:5432/mccnetworld' });

const rows = [
  // AUTO_MATCH 대상: channel + plan_name + customer_type 완전일치, 부가필드 null(와일드카드)
  { channel: '선불)스마텔',   plan_name: '스선)363/3M',            customer_type: '신규', rebate_amount: 30000 },
  { channel: '선불)스마텔',   plan_name: '스선)383/1M',            customer_type: '신규', rebate_amount: 25000 },
  { channel: '선불)프리티SK', plan_name: '프선S)절약',             customer_type: '신규', rebate_amount: 15000 },
  // REVIEW_REQUIRED 대상: add_service 필드가 있어서 폴백 매칭됨
  { channel: '선불)프리티SK', plan_name: '프선S)선불데이터안심/1', customer_type: '신규', rebate_amount: 20000, add_service: '특정서비스' },
  // customerType='' 인 행 매칭 (POLICY_NOT_FOUND 대상)
  { channel: '선불)스마텔',   plan_name: '스선)363/3M',            customer_type: '번이', rebate_amount: 28000 },
];

for (const r of rows) {
  await pool.query(
    `INSERT INTO policy_rows (policy_version_id, channel, plan_name, customer_type, add_service, rebate_amount, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [1, r.channel, r.plan_name, r.customer_type, r.add_service ?? null, r.rebate_amount]
  );
  console.log('inserted:', r.channel, r.plan_name, r.customer_type);
}
await pool.end();
console.log('done');

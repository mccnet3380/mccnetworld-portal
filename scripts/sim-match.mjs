import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { pgTable, serial, integer, varchar, boolean, text, timestamp, numeric, sql } from 'drizzle-orm/pg-core';
import { eq, and, gte, lte } from 'drizzle-orm';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:password@127.0.0.1:5432/mccnetworld' });
const db = drizzle(pool);

const activationRecords = pgTable("activation_records", {
  id: serial("id").primaryKey(),
  channel: varchar("channel", { length: 100 }),
  planName: varchar("plan_name", { length: 200 }),
  customerType: varchar("customer_type", { length: 20 }),
  simCount: integer("sim_count"),
  bundleType: varchar("bundle_type", { length: 100 }),
  addService: varchar("add_service", { length: 200 }),
  regFeeType: varchar("reg_fee_type", { length: 50 }),
  dealerRegistrationId: integer("dealer_registration_id"),
  dealerName: varchar("dealer_name", { length: 255 }),
});

const policyRows = pgTable("policy_rows", {
  id: serial("id").primaryKey(),
  policyVersionId: integer("policy_version_id"),
  channel: varchar("channel", { length: 100 }),
  planName: varchar("plan_name", { length: 200 }),
  customerType: varchar("customer_type", { length: 20 }),
  simCount: integer("sim_count"),
  bundleType: varchar("bundle_type", { length: 100 }),
  addService: varchar("add_service", { length: 200 }),
  regFeeType: varchar("reg_fee_type", { length: 50 }),
  isActive: boolean("is_active"),
  rebateAmount: numeric("rebate_amount", { precision: 10, scale: 2 }),
});

const settlementItems = pgTable("settlement_items", {
  id: serial("id").primaryKey(),
  activationId: integer("activation_id"),
});

const allRows = await db.select().from(policyRows);
const activeRows = allRows.filter(r => r.isActive !== false);

const unmatched = await db.select()
  .from(activationRecords)
  .where(sql`NOT EXISTS (SELECT 1 FROM settlement_items si WHERE si.activation_id = ${activationRecords.id})`);

console.log('activeRows count:', activeRows.length);
console.log('unmatched count:', unmatched.length);

const normalize = (v) => String(v ?? '').trim();

const matchRow = (activation, row, exclude) => {
  if (activation.channel !== row.channel) return false;
  if (activation.planName !== row.planName) return false;
  if (normalize(activation.customerType) !== normalize(row.customerType)) return false;

  const optionals = [
    { actKey: 'simCount',   rowKey: 'simCount'   },
    { actKey: 'bundleType', rowKey: 'bundleType' },
    { actKey: 'addService', rowKey: 'addService' },
    { actKey: 'regFeeType', rowKey: 'regFeeType' },
  ];
  for (const { actKey, rowKey } of optionals) {
    if (exclude.has(rowKey)) continue;
    const rv = row[rowKey];
    if (rv === null || rv === undefined || rv === '') continue;
    if (normalize(activation[actKey]) !== normalize(rv)) return false;
  }
  return true;
};

const MATCH_PASSES = [
  { exclude: new Set([]),             isAuto: true  },
  { exclude: new Set(['addService']), isAuto: false },
  { exclude: new Set(['bundleType']), isAuto: false },
  { exclude: new Set(['regFeeType']), isAuto: false },
];

let autoMatch=0, reviewRequired=0, policyNotFound=0;

for (const activation of unmatched) {
  let matchedRow = null;
  let matchStatus = 'POLICY_NOT_FOUND';

  for (const { exclude, isAuto } of MATCH_PASSES) {
    const found = activeRows.find(r => matchRow(activation, r, exclude));
    if (found) {
      matchedRow = found;
      matchStatus = isAuto ? 'AUTO_MATCH' : 'REVIEW_REQUIRED';
      break;
    }
  }

  if (matchStatus === 'AUTO_MATCH' && !activation.dealerRegistrationId) {
    matchStatus = 'REVIEW_REQUIRED';
  }

  if (activation.id <= 37) {
    console.log(`ar[${activation.id}] ${activation.channel}/${activation.planName}/${activation.customerType} → ${matchStatus} (row: ${matchedRow?.id ?? 'none'})`);
  }

  if (matchStatus === 'AUTO_MATCH') autoMatch++;
  else if (matchStatus === 'REVIEW_REQUIRED') reviewRequired++;
  else policyNotFound++;
}

console.log('\n=== 결과 ===');
console.log('autoMatch:', autoMatch);
console.log('reviewRequired:', reviewRequired);
console.log('policyNotFound:', policyNotFound);

await pool.end();

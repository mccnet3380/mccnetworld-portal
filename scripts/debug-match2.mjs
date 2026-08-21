// Drizzle ORM이 실제 반환하는 camelCase 값 확인
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:password@127.0.0.1:5432/mccnetworld' });
const db = drizzle(pool);

// schema 직접 import (ESM 방식으로 재현)
import { pgTable, serial, integer, varchar, boolean, text, timestamp, numeric } from 'drizzle-orm/pg-core';

const activationRecords = pgTable("activation_records", {
  id: serial("id").primaryKey(),
  channel: varchar("channel", { length: 100 }),
  planName: varchar("plan_name", { length: 200 }),
  customerType: varchar("customer_type", { length: 20 }),
  simCount: integer("sim_count"),
  bundleType: varchar("bundle_type", { length: 100 }),
  addService: varchar("add_service", { length: 200 }),
  regFeeType: varchar("reg_fee_type", { length: 50 }),
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
});

const arRows = await db.select().from(activationRecords).limit(3);
const prRows = await db.select().from(policyRows);

console.log('=== activation_records (Drizzle) ===');
arRows.forEach(r => console.log(JSON.stringify({ id: r.id, channel: r.channel, planName: r.planName, customerType: r.customerType, addService: r.addService })));

console.log('\n=== policy_rows (Drizzle) ===');
prRows.forEach(r => console.log(JSON.stringify({ id: r.id, channel: r.channel, planName: r.planName, customerType: r.customerType, addService: r.addService, isActive: r.isActive })));

// 직접 비교
const ar = arRows[0];
const pr = prRows.find(r => r.id === 9);
if (ar && pr) {
  console.log('\n=== ar[0] vs pr[id=9] ===');
  console.log('channel match:', ar.channel === pr.channel);
  console.log('planName match:', ar.planName === pr.planName);
  console.log('customerType match:', ar.customerType === pr.customerType);
  console.log('addService: ar=', JSON.stringify(ar.addService), 'pr=', JSON.stringify(pr.addService));
}

await pool.end();

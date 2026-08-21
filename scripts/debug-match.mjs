import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:password@127.0.0.1:5432/mccnetworld' });

const { rows: arRows } = await pool.query('SELECT * FROM activation_records WHERE id = 33');
const { rows: prRows } = await pool.query('SELECT * FROM policy_rows WHERE id = 8 OR id = 9');

const ar = arRows[0];
const pr8 = prRows.find(r => r.id === 8);
const pr9 = prRows.find(r => r.id === 9);

console.log('=== activation_record (id=33) ===');
console.log('channel:', JSON.stringify(ar.channel));
console.log('plan_name:', JSON.stringify(ar.plan_name));
console.log('customer_type:', JSON.stringify(ar.customer_type));
console.log('sim_count:', ar.sim_count);

console.log('\n=== policy_row (id=8, 363/3M 신규) ===');
console.log('channel:', JSON.stringify(pr8?.channel));
console.log('plan_name:', JSON.stringify(pr8?.plan_name));
console.log('customer_type:', JSON.stringify(pr8?.customer_type));
console.log('sim_count:', pr8?.sim_count);

console.log('\n=== policy_row (id=9, 383/1M 신규) ===');
console.log('channel:', JSON.stringify(pr9?.channel));
console.log('plan_name:', JSON.stringify(pr9?.plan_name));
console.log('customer_type:', JSON.stringify(pr9?.customer_type));

console.log('\n=== comparison ===');
console.log('channel eq:', ar.channel === pr9?.channel);
console.log('plan_name eq:', ar.plan_name === pr9?.plan_name);
console.log('customer_type eq:', ar.customer_type === pr9?.customer_type);

// Check hex bytes of plan_name
const arPlanBuf = Buffer.from(ar.plan_name ?? '', 'utf8');
const prPlanBuf = Buffer.from(pr9?.plan_name ?? '', 'utf8');
console.log('\nar plan_name hex:', arPlanBuf.toString('hex'));
console.log('pr plan_name hex:', prPlanBuf.toString('hex'));
console.log('hex equal:', arPlanBuf.toString('hex') === prPlanBuf.toString('hex'));

await pool.end();

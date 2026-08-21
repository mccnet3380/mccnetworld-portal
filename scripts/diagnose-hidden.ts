/**
 * 히든금액 계산 단계별 진단 스크립트
 * 실행: npx tsx scripts/diagnose-hidden.ts
 */
import { getDatabase } from '../server/db';
import { contactCodes, dealerRegistrations, hiddenPolicyRows, activationRecords, settlementItems } from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

const TARGET_CODE = 'K엠45172';
const DATE_FROM   = '2026-05-01';
const DATE_TO     = '2026-05-31';

async function main() {
  const db = await getDatabase();
  const n = (v: any) => String(v ?? '').trim();

  console.log('\n======================================================');
  console.log(`히든금액 계산 진단: contactCode="${TARGET_CODE}"`);
  console.log('======================================================\n');

  // STEP 1: activation_records
  // 날짜 입력은 KST 기준 → +09:00으로 UTC 변환
  const toKST = (d: string, t: string) => new Date(`${d}T${t}+09:00`);
  console.log('[STEP 1] activation_records 조회');
  console.log(`  날짜 범위(KST): ${DATE_FROM} ~ ${DATE_TO}`);
  console.log(`  날짜 범위(UTC): ${toKST(DATE_FROM,'00:00:00').toISOString()} ~ ${toKST(DATE_TO,'23:59:59').toISOString()}`);
  const arRows = await db.select({
    id: activationRecords.id,
    contactCode: activationRecords.contactCode,
    channel: activationRecords.channel,
    planName: activationRecords.planName,
    customerType: activationRecords.customerType,
    activationDatetime: activationRecords.activationDatetime,
  }).from(activationRecords)
    .where(and(
      eq(activationRecords.contactCode, TARGET_CODE),
      gte(activationRecords.activationDatetime, toKST(DATE_FROM, '00:00:00')),
      lte(activationRecords.activationDatetime, toKST(DATE_TO,   '23:59:59')),
    ));
  console.log(`  → 건수: ${arRows.length}`);
  if (arRows.length === 0) {
    console.log('  ❌ 해당 접점코드 건이 없음. 날짜 범위 또는 contactCode 확인 필요.');
    // 날짜 범위 없이 전체 조회
    const arAll = await db.select({ id: activationRecords.id, contactCode: activationRecords.contactCode, activationDatetime: activationRecords.activationDatetime })
      .from(activationRecords).where(eq(activationRecords.contactCode, TARGET_CODE)).limit(5);
    console.log(`  전체(날짜 무관) 건수: ${arAll.length}`, arAll);
  } else {
    arRows.forEach(r => console.log(`  arId=${r.id} date=${r.activationDatetime} channel="${r.channel}" plan="${r.planName}" type="${r.customerType}"`));
  }

  // STEP 2: settlement_items 연결
  console.log('\n[STEP 2] settlement_items 연결 확인');
  const siRows = await db.select({
    siId: settlementItems.id,
    status: settlementItems.status,
    lockedAmount: settlementItems.lockedAmount,
    hiddenAmount: settlementItems.hiddenAmount,
    activationId: settlementItems.activationId,
  }).from(settlementItems)
    .innerJoin(activationRecords, eq(settlementItems.activationId, activationRecords.id))
    .where(eq(activationRecords.contactCode, TARGET_CODE));
  console.log(`  → 연결된 settlement_items: ${siRows.length}건`);
  siRows.forEach(r => console.log(`  siId=${r.siId} status="${r.status}" locked=${r.lockedAmount} hiddenAmount=${r.hiddenAmount}`));

  // STEP 3: contact_codes 조회 (active/inactive 모두)
  console.log('\n[STEP 3] contact_codes 조회 (전체)');
  const ccAll = await db.select().from(contactCodes).where(eq(contactCodes.code, TARGET_CODE));
  console.log(`  → 전체 건수: ${ccAll.length}`);
  ccAll.forEach(r => console.log(`  id=${r.id} isActive=${r.isActive} dealerRegId=${r.dealerRegistrationId} dealerName="${r.dealerName}" realSalesPOS="${r.realSalesPOS}" carrier="${r.carrier}"`));

  const ccActive = ccAll.filter((r: any) => r.isActive !== false);
  console.log(`  → isActive=true 건수: ${ccActive.length}`);
  if (ccActive.length === 0) {
    if (ccAll.length > 0) console.log('  ❌ contact_codes 존재하나 isActive=false → skippedNoDealer');
    else console.log('  ❌ contact_codes 레코드 없음 → skippedNoDealer');
    process.exit(0);
  }
  const cc = ccActive[0] as any;

  if (!cc.dealerRegistrationId) {
    console.log('  ❌ dealerRegistrationId가 null → skippedNoDealer');
    process.exit(0);
  }

  // STEP 4: dealer_registrations
  console.log('\n[STEP 4] dealer_registrations 조회 (dealerRegistrationId 기준)');
  const drRows = await db.select().from(dealerRegistrations).where(eq(dealerRegistrations.id, cc.dealerRegistrationId));
  console.log(`  → 건수: ${drRows.length}`);
  drRows.forEach((r: any) => console.log(`  id=${r.id} code="${r.dealerCode}" name="${r.businessName}" isHiddenPos=${r.isHiddenPos} isActive=${r.isActive}`));

  if (!drRows[0]) {
    console.log('  ❌ dealer_registrations 레코드 없음');
    process.exit(0);
  }
  const dr = drRows[0] as any;
  if (!dr.isHiddenPos) {
    console.log(`  ❌ dealer_registrations.isHiddenPos=false → skippedNotHiddenPos`);
    console.log(`     → 정산지급처 "${dr.businessName}"은 히든점이 아님`);
    console.log(`     → realSalesPOS="${cc.realSalesPOS}"을 히든점으로 등록해야 할 수 있음`);

    // realSalesPOS로 DR 조회
    if (cc.realSalesPOS) {
      console.log(`\n[STEP 4-b] realSalesPOS="${cc.realSalesPOS}" 기준 dealer_registrations 조회`);
      const drByPOS = await db.select({ id: dealerRegistrations.id, businessName: dealerRegistrations.businessName, isHiddenPos: dealerRegistrations.isHiddenPos })
        .from(dealerRegistrations).where(eq(dealerRegistrations.businessName, cc.realSalesPOS));
      console.log(`  → 건수: ${drByPOS.length}`);
      drByPOS.forEach((r: any) => console.log(`  id=${r.id} name="${r.businessName}" isHiddenPos=${r.isHiddenPos}`));
      if (drByPOS.length === 0) console.log('  ℹ realSalesPOS와 일치하는 판매점 원장 없음');
    }
    process.exit(0);
  }

  // STEP 5: hidden_policy_rows 전체
  console.log('\n[STEP 5] hidden_policy_rows (isActive=true)');
  const allPolicies = await db.select().from(hiddenPolicyRows).where(eq(hiddenPolicyRows.isActive, true));
  console.log(`  → 활성 정책 수: ${allPolicies.length}`);
  allPolicies.forEach((p: any) => console.log(`  pId=${p.id} dealerRegId=${p.dealerRegistrationId} contactCode="${p.contactCode}" channel="${p.channel}" plan="${p.planName}" type="${p.customerType}" amount=${p.hiddenAmount} from=${p.effectiveFrom} to=${p.effectiveTo}`));

  if (allPolicies.length === 0) {
    console.log('  ❌ 활성 히든정책 없음');
    process.exit(0);
  }

  // STEP 6: 매칭 시뮬레이션
  if (arRows.length === 0) {
    console.log('\n[STEP 6] 시뮬레이션 건너뜀 (activation_records 없음)');
    process.exit(0);
  }
  const sample = arRows[0];
  const activationDate = sample.activationDatetime ? new Date(sample.activationDatetime) : null;
  console.log(`\n[STEP 6] 정책 매칭 시뮬레이션`);
  console.log(`  샘플 ar: id=${sample.id} date=${sample.activationDatetime}`);
  console.log(`  cc.dealerRegistrationId: ${cc.dealerRegistrationId}`);

  let matchTotal = 0;
  for (const policy of allPolicies as any[]) {
    let reason = '';
    if (policy.dealerRegistrationId != null && policy.dealerRegistrationId !== cc.dealerRegistrationId) {
      reason = `dealerRegistrationId 불일치: policy=${policy.dealerRegistrationId} vs cc=${cc.dealerRegistrationId}`;
    } else if (policy.contactCode && n(policy.contactCode) !== n(sample.contactCode)) {
      reason = `contactCode 불일치: policy="${policy.contactCode}" vs "${sample.contactCode}"`;
    } else if (policy.channel && n(policy.channel) !== n(sample.channel)) {
      reason = `channel 불일치: policy="${policy.channel}" vs "${sample.channel}"`;
    } else if (policy.planName && n(policy.planName) !== n(sample.planName)) {
      reason = `planName 불일치: policy="${policy.planName}" vs "${sample.planName}"`;
    } else if (policy.customerType && n(policy.customerType) !== n(sample.customerType)) {
      reason = `customerType 불일치: policy="${policy.customerType}" vs "${sample.customerType}"`;
    } else if (activationDate && policy.effectiveFrom && activationDate < new Date(policy.effectiveFrom)) {
      reason = `기간 전: effectiveFrom=${policy.effectiveFrom}`;
    } else if (activationDate && policy.effectiveTo && activationDate > new Date(policy.effectiveTo)) {
      reason = `기간 후: effectiveTo=${policy.effectiveTo}`;
    }

    if (reason) {
      console.log(`  ✗ pId=${policy.id} SKIP: ${reason}`);
    } else {
      console.log(`  ✓ pId=${policy.id} MATCH! amount=${policy.hiddenAmount}`);
      matchTotal += Number(policy.hiddenAmount) || 0;
    }
  }

  console.log(`\n[결론]`);
  if (matchTotal > 0) {
    console.log(`  ✅ 매칭 성공 합계: ${matchTotal}원`);
    console.log(`     → 재계산 실행 시 updated 처리되어야 함`);
    if (siRows.length === 0) console.log(`  ⚠ 단, settlement_items 연결 건이 없음 → 정산 업로드 확인 필요`);
    const locked = siRows.filter(r => r.lockedAmount != null || r.status === '정산완료');
    if (locked.length > 0) console.log(`  ⚠ 확정(locked) 건 ${locked.length}개 → onlyUnsettled=true 시 스킵됨`);
  } else {
    console.log(`  ❌ 매칭 정책 없음 → hiddenAmount=0 → skippedNoPolicy`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });

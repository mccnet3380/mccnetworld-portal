// generate-subsidy.js
// 실행: node generate-subsidy.js
// 목적: plan_catalog.json의 "모든 요금제 id"에 대해 deviceId|planId 키를 전부 생성하여 subsidy/latest.json에 저장

const fs = require("fs");
const path = require("path");

const DATA_DIR = __dirname;

const DEVICE_CATALOG = path.join(DATA_DIR, "device_catalog.json");
const PLAN_CATALOG   = path.join(DATA_DIR, "plan_catalog.json");
const OUT_DIR        = path.join(DATA_DIR, "subsidy");
const OUT_FILE       = path.join(OUT_DIR, "latest.json");

// ✅ 여기만 관리하시면 됩니다: 단말별 공시지원금(기본값)
// - "모든 요금제에 동일 공시"를 원하면 이렇게 device별로만 금액을 넣으면 됩니다.
// - 특정 요금제만 다르게 주려면 아래 "planOverrides"를 사용하세요.
const subsidyByDevice = {
  "omd_sm_a165n": 220000,
  "omd_sm_a245n": 396000,
  "omd_sm_a226l": 299200,
  "at-m140l": 138600
};


// ✅ (선택) 특정 요금제는 예외로 다른 금액 주고 싶을 때
// 키: `${deviceId}|${planId}`
const planOverrides = {
  // 예: "sm_a245n|lte_tonghwa_mamkkeot_45gb_m": 300000,
};

// ✅ (선택) “특정 요금제만 공시 적용”하고 싶으면 true로 바꾸고 필터 함수 수정
const APPLY_ONLY_FILTERED_PLANS = false;
function planFilter(planId) {
  // 예시: 실속 계열만 적용
  // return /^lte_data_silsok_/.test(planId);

  // 기본: 전부 적용
  return true;
}

// 최신 파일 메타(원하시면 수정)
const meta = {
  effectiveFrom: "2025-12-15",
  effectiveTo:   "2025-12-31",
  memo:          "미디어로그 단말 공시 최신(자동생성)",
  aprPercent: 5.9,
  defaultInstallmentMonths: 24,
};

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function main() {
  if (!fs.existsSync(DEVICE_CATALOG)) {
    throw new Error(`device_catalog.json not found: ${DEVICE_CATALOG}`);
  }
  if (!fs.existsSync(PLAN_CATALOG)) {
    throw new Error(`plan_catalog.json not found: ${PLAN_CATALOG}`);
  }

  const deviceCatalog = readJson(DEVICE_CATALOG);
  const planCatalog   = readJson(PLAN_CATALOG);

  const devices = Array.isArray(deviceCatalog.devices) ? deviceCatalog.devices : [];
  const plans   = Array.isArray(planCatalog.plans) ? planCatalog.plans : [];

  const subsidyMap = {};

  const usablePlans = APPLY_ONLY_FILTERED_PLANS
    ? plans.filter(p => planFilter(p.id))
    : plans;

  for (const d of devices) {
    const dvId = d.id;
    const base = Number(subsidyByDevice[dvId] ?? 0) || 0;

    for (const p of usablePlans) {
      const plId = p.id;
      const key = `${dvId}|${plId}`;

      // override가 있으면 override 우선
      const ov = planOverrides[key];
      subsidyMap[key] = (ov != null) ? Number(ov) : base;
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const out = {
    ...meta,
    subsidyMap
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf-8");

  console.log("✅ generated:", OUT_FILE);
  console.log("   devices:", devices.length);
  console.log("   plans:", plans.length, APPLY_ONLY_FILTERED_PLANS ? "(filtered)" : "(all)");
  console.log("   keys:", Object.keys(subsidyMap).length);
}

main();

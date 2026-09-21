// scripts/seed-training.ts
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 레거시 교육자료(업무가이드/용어사전/오류대응집)를 training_articles에 1회 이식한다.
// idempotent — 이미 있으면 건너뛴다(server/lib/training-seed.ts 참고).
//
// 실행: npx tsx --env-file=.env scripts/seed-training.ts

import { seedTrainingArticles } from "../server/lib/training-seed";

async function main() {
  const result = await seedTrainingArticles(null);
  console.log("=== 교육자료 seed 결과 ===");
  console.log("신규 생성:", result.inserted.length ? result.inserted.join(", ") : "(없음)");
  console.log("이미 존재(건너뜀):", result.skipped.length ? result.skipped.join(", ") : "(없음)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export const config = { runtime: 'nodejs' };

// ━━ LLM 재정 보고서 API ━━
// POST /api/report
// body: { profile, goal, result, events, deficit, yearlyBreakdown, scenario }
//   profile: { age, grossSalary, netSalary, monthlyTakehome, totalAsset, region, size }
//   goal: { targetPrice, effectiveTarget, loanAmt, investRate, monthlyLiving }
//   result: { yearsNeeded, reachedAge, verdict }
//   events: { wedding, baby, car } (on/off + 비용)
//   deficit: { firstDeficitAge } | null
//   yearlyBreakdown: { [나이]: { income, invest, living, loan, baby, car, netSaving } }
//   scenario: { plusTwo: { investRate, yearsNeeded, yearsSaved } }
// 응답: { hooks: string[], sections: [{ title, body }], _mock: true }
//
// ⚠️ 현재 Mock. 실제 LLM 연동 시 generateReport() 내부만 교체.

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD', message: 'POST only' }); return; }

  const body = req.body || {};
  const { profile, goal, result, scenario } = body;

  // 필수 필드 검증 (events/deficit/yearlyBreakdown은 선택)
  if (!profile || !goal || !result || !scenario) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'profile/goal/result/scenario 필수' });
    return;
  }
  if (result.reachedAge == null || !scenario.plusTwo) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'result.reachedAge, scenario.plusTwo 필수' });
    return;
  }

  try {
    res.status(200).json(generateReport(body));
  } catch (e) {
    console.error('[REPORT] ERROR:', e.message, e.stack);
    res.status(500).json({ error: 'REPORT_ERROR', message: '잠시 후 다시 시도해주세요' });
  }
}

// ━━ 보고서 생성 ━━
// ⚠️ Mock 구현. 실제 LLM 연동 시 이 함수 내부만 교체 (시그니처/응답 스키마 유지).
function generateReport({ profile, goal, result, events, deficit, yearlyBreakdown, scenario }) {
  const fmtEok = man => man >= 10000 ? `${(man / 10000).toFixed(1)}억` : `${man.toLocaleString()}만원`;
  const plusTwo = scenario.plusTwo;

  const hooks = [
    `짝꿍은 ${deficit?.firstDeficitAge || 'XX'}세부터 적자로 전환됩니다`,
    `이대로면 ${result.reachedAge}세에 내 집 마련 — 하지만 ${plusTwo.yearsSaved}년 앞당길 수 있어요`,
  ];

  const sections = [
    {
      title: '현황 진단',
      body: `현재 ${profile.age}세, 세후 월 ${(profile.monthlyTakehome || 0).toLocaleString()}만원 수입에 자산 ${fmtEok(profile.totalAsset || 0)}을 보유하고 있어요. `
        + `목표 집값 ${fmtEok(goal.targetPrice || 0)} 기준으로 지금 페이스면 ${result.yearsNeeded}년 뒤인 ${result.reachedAge}세에 내 집 마련이 가능해요. `
        + `월 생활비 ${(goal.monthlyLiving || 0).toLocaleString()}만원과 인생 이벤트 비용이 자산 성장 속도를 결정하는 핵심 변수예요. `
        + `(Mock 응답 — 실제 LLM 연동 시 개인화된 진단으로 교체됩니다)`,
    },
    {
      title: '복리의 힘',
      body: `투자수익률을 ${goal.investRate || 0}%에서 ${plusTwo.investRate}%로 2%p만 올려도 `
        + `내 집 마련 시점이 ${result.yearsNeeded}년에서 ${plusTwo.yearsNeeded}년으로, 무려 ${plusTwo.yearsSaved}년 앞당겨져요. `
        + `복리는 시간이 길수록 격차가 커지기 때문에, 수익률 개선은 빠를수록 효과가 커요. `
        + `(Mock 응답 — 실제 LLM 연동 시 시나리오 비교 분석으로 교체됩니다)`,
    },
    {
      title: '실행 제안',
      body: `① 매달 고정 저축액을 자동이체로 먼저 떼어두세요. `
        + `② 예적금에 머물러 있다면 분산 투자로 수익률을 단계적으로 올려보세요. `
        + `③ 이벤트(결혼·출산·차량) 시점을 조정하면 적자 구간을 완화할 수 있어요. `
        + `(Mock 응답 — 실제 LLM 연동 시 맞춤 제안으로 교체됩니다)`,
    },
  ];

  return { hooks, sections, _mock: true };
}

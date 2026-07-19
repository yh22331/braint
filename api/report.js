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
//   couple: { soloYears, combinedYears, yearsSaved } | 생략 — couple 서비스에서만 전달 (deficit 대신, 훅 분기용. years null = 30년+)
//   scenario: { plusTwo: { investRate, yearsNeeded, yearsSaved },
//               rateScenarios: [{ deltaRate, newRate, reachedYears, reachedAge, yearsSaved }] }
//               — rateScenarios는 +1~+4%p 각 시나리오 (선택, reachedYears null = 30년 내 미도달). plusTwo는 하위호환 유지
//   survey: { region, station, build, invest, workplace } (선택 — 설문 완료 후 재호출 시에만 포함)
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
function generateReport({ profile, goal, result, events, deficit, yearlyBreakdown, scenario, survey, couple }) {
  const fmtEok = man => man >= 10000 ? `${(man / 10000).toFixed(1)}억` : `${man.toLocaleString()}만원`;
  const plusTwo = scenario.plusTwo;
  // rateScenarios 있으면 "도달 가능 + 단축 효과 있는" 최소 인상폭 시나리오를 훅/복리 문구에 활용
  const rs = Array.isArray(scenario.rateScenarios) ? scenario.rateScenarios : null;
  const best = rs?.find(s => s.reachedYears != null && s.yearsSaved > 0) || null;

  // couple 서비스: deficit 대신 혼자 vs 둘이 비교 훅 (years null = 30년 내 도달 못함)
  const fmtY = y => y == null ? '30년+' : `${y}년`;
  const hooks = couple ? [
    `혼자라면 ${fmtY(couple.soloYears)} 걸리지만, 두 분이 합치면 ${fmtY(couple.combinedYears)}${couple.yearsSaved > 0 ? ` — ${couple.yearsSaved}년 단축돼요` : '이에요'}`,
    best
      ? `투자수익률을 ${best.deltaRate}%p만 올리면 내 집 마련을 ${best.yearsSaved}년 더 앞당길 수 있어요`
      : `투자수익률을 ${plusTwo.investRate}%로 2%p만 올리면 내 집 마련을 ${plusTwo.yearsSaved}년 더 앞당길 수 있어요`,
  ] : [
    // 적자 구간이 없으면 XX 노출 대신 수익률 시나리오(→도달 나이) 폴백
    deficit?.firstDeficitAge != null
      ? `짝꿍은 ${deficit.firstDeficitAge}세부터 적자로 전환됩니다`
      : best
        ? `투자수익률 ${best.deltaRate}%p만 높이면 내 집 마련이 ${best.yearsSaved}년 앞당겨져요`
        : `지금 페이스면 ${result.reachedAge}세에 내 집 마련이 보여요`,
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
      body: (best
          ? `투자수익률을 ${goal.investRate || 0}%에서 ${best.newRate}%로 ${best.deltaRate}%p만 올려도 `
            + `내 집 마련이 ${best.reachedYears}년 후로, ${best.yearsSaved}년 앞당겨져요. `
          : `투자수익률을 ${goal.investRate || 0}%에서 ${plusTwo.investRate}%로 2%p만 올려도 `
            + `내 집 마련 시점이 ${result.yearsNeeded}년에서 ${plusTwo.yearsNeeded}년으로, 무려 ${plusTwo.yearsSaved}년 앞당겨져요. `)
        + `복리는 시간이 길수록 격차가 커지기 때문에, 수익률 개선은 빠를수록 효과가 커요. `
        + `(Mock 응답 — 실제 LLM 연동 시 시나리오 비교 분석으로 교체됩니다)`,
    },
    {
      title: '실행 제안',
      body: (survey?.region
          ? `선택하신 "${survey.region}${survey.workplace ? ` · ${survey.workplace} 출퇴근` : ''}" 조건 기준 — `
          : '')
        + `① 매달 고정 저축액을 자동이체로 먼저 떼어두세요. `
        + `② 예적금에 머물러 있다면 분산 투자로 수익률을 단계적으로 올려보세요. `
        + `③ 이벤트(결혼·출산·차량) 시점을 조정하면 적자 구간을 완화할 수 있어요. `
        + `(Mock 응답 — 실제 LLM 연동 시 맞춤 제안으로 교체됩니다)`,
    },
  ];

  return { hooks, sections, _mock: true };
}

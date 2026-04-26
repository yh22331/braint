// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// couple-api-client.js
// 커플 계산기 HTML에 <script src> 로 포함
// 모든 계산은 API에 위임, HTML은 UI만 담당
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API = {
  simulate: '/api/simulate',
  couple:   '/api/simulate-couple',
  session:  '/api/session',
};

// ── API 호출 헬퍼
async function callAPI(url, method='GET', body=null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if(!res.ok) throw new Error(data.error || 'API 오류');
  return data;
}

// ── 내 분석 호출
async function apiAnalyzeMe(inputs) {
  return callAPI(API.simulate, 'POST', inputs);
}

// ── 커플 합산 분석 호출
async function apiAnalyzeCouple(me, partner) {
  return callAPI(API.couple, 'POST', { me, partner });
}

// ── 세션 생성
async function apiCreateSession(hostData) {
  return callAPI(`${API.session}?action=create`, 'POST', { hostData });
}

// ── 세션 조회 (짝꿍 링크 접속)
async function apiGetSession(code) {
  return callAPI(`${API.session}?action=get&code=${code}`);
}

// ── 짝꿍 데이터 저장
async function apiJoinSession(sessionId, guestData) {
  return callAPI(`${API.session}?action=join&id=${sessionId}`, 'PATCH', { guestData });
}

// ── 폴링: 짝꿍 입력 여부
async function apiPollSession(sessionId) {
  return callAPI(`${API.session}?action=poll&id=${sessionId}`);
}

// ── 입력값 수집 (나 탭)
function collectMyInputs() {
  const salary = parseInt(document.getElementById('my-salary').value);
  const asset  = parseInt(document.getElementById('my-asset').value) || 0;
  if(!salary || salary < 500) throw new Error('연봉을 입력해주세요!');
  return {
    salary, asset,
    region: S.region || 'seoul',
    size:   S.size   || 'mid',
    living: monthlyLivingCost || 200,
    investRate: getInvestRate(),
    age:    parseInt(document.getElementById('my-salary').dataset.age) || 30,
    raisePct:   raiseState.rate   || 3,
    promoRaise: raiseState.promo  || true,
    maxSalary:  raiseState.maxSalary || 999999,
    // 이벤트
    weddingOn:  document.getElementById('ev-wedding')?.checked || false,
    weddingCost:parseInt(document.getElementById('cost-wedding')?.value)   || 5000,
    weddingAge: parseInt(document.getElementById('age-wedding')?.textContent?.replace('세','')) || 33,
    babyOn:     document.getElementById('ev-baby')?.checked || false,
    babyCost:   parseInt(document.getElementById('cost-baby-yr')?.value)   || 500,
    babyAge:    parseInt(document.getElementById('age-baby')?.textContent?.replace('세',''))    || 35,
    carOn:      document.getElementById('ev-car')?.checked  || false,
    carCost:    parseInt(document.getElementById('cost-car')?.value)        || 3500,
    carAge:     parseInt(document.getElementById('c-age-car-val')?.value)   || 30,
  };
}

// ── 짝꿍 이벤트 객체 변환 (partner.events 형태로)
function buildPartnerEvents(partner) {
  return {
    weddingOn:  partner.weddingOn  || false,
    weddingCost:partner.weddingCost|| 5000,
    weddingAge: partner.weddingAge || 33,
    babyOn:     partner.babyOn     || false,
    babyCost:   partner.babyCost   || 500,
    babyAge:    partner.babyAge    || 35,
    carOn:      partner.carOn      || false,
    carCost:    partner.carCost    || 3500,
    carAge:     partner.carAge     || 30,
  };
}

// ── analyzeMe (API 버전)
async function analyzeMe() {
  try {
    const inputs = collectMyInputs();
    showToast('분석 중...', 1000);

    const result = await apiAnalyzeMe(inputs);

    // 결과 저장
    S.myResult = { ...inputs, ...result };
    S.myInputs = inputs;

    // UI 렌더
    renderMyResult(result, inputs);

    // 세션 생성 (최초 1회)
    if(!S.sessionId && !S.isPartner) {
      const session = await apiCreateSession(S.myResult);
      S.sessionId = session.sessionId;
      S.coupleCode = session.code;
      const link = `${location.origin}${location.pathname}?couple=${session.code}`;
      document.getElementById('couple-link-box').textContent = link;
      document.getElementById('couple-link-box').dataset.link = link;
      startPolling();
      const wb = document.getElementById('waiting-banner');
      if(wb) wb.style.display = 'block';
    }

    // 짝꿍 있으면 합산
    if(S.partnerData) {
      const onMeTab = document.getElementById('page-me').style.display !== 'none';
      S._suppressTabSwitch = onMeTab;
      await renderCoupleResult();
    }
  } catch(e) {
    console.error('analyzeMe 에러:', e);
    showToast(e.message || '분석 중 오류가 발생했어요');
  }
}

// ── renderCoupleResult (API 버전)
async function renderCoupleResult() {
  const me      = S.myResult;
  const partner = S.partnerData;
  if(!me || !partner) return;

  try {
    // 짝꿍 events 객체 구성
    const pEvents = buildPartnerEvents(partner);
    const meForAPI = {
      ...S.myInputs,
      events: {
        weddingOn:  S.myInputs.weddingOn,
        weddingCost:S.myInputs.weddingCost,
        weddingAge: S.myInputs.weddingAge,
        babyOn:     S.myInputs.babyOn,
        babyCost:   S.myInputs.babyCost,
        babyAge:    S.myInputs.babyAge,
        carOn:      S.myInputs.carOn,
        carCost:    S.myInputs.carCost,
        carAge:     S.myInputs.carAge,
      },
    };
    const pForAPI = {
      salary:     partner.salary,
      asset:      partner.asset     || 0,
      region:     partner.region    || me.region,
      size:       partner.size      || me.size,
      living:     partner.living    || 200,
      investRate: partner.investRate|| 3,
      age:        partner.age       || 30,
      raisePct:   partner.raisePct  || 3,
      promoRaise: partner.promoRaise|| false,
      maxSalary:  partner.maxSalary || 999999,
      events:     pEvents,
    };

    const result = await apiAnalyzeCouple(meForAPI, pForAPI);

    // UI 렌더
    renderCoupleUI(result, meForAPI, pForAPI);

    if(!S._suppressTabSwitch) switchTab('partner');
    S._suppressTabSwitch = false;
  } catch(e) {
    console.error('합산 분석 오류:', e);
    showToast('합산 분석 중 오류가 발생했어요');
  }
}

// ── 폴링 (API 버전)
let pollTimer = null;
function startPolling() {
  if(!S.sessionId || pollTimer) return;
  pollTimer = setInterval(async()=>{
    try {
      const data = await apiPollSession(S.sessionId);
      if(data.hasGuest && data.guestData) {
        clearInterval(pollTimer); pollTimer = null;
        S.partnerData = data.guestData;
        const banner = document.getElementById('waiting-banner');
        if(banner) banner.style.display = 'none';
        document.getElementById('partner-tab-icon').textContent = '💑';
        document.getElementById('tab-partner-sub').textContent = '합산 결과 완성! 🎉';
        showToast('🎉 짝꿍이 데이터를 입력했어요!');
        S._suppressTabSwitch = false;
        if(S.myResult) await renderCoupleResult();
      }
    } catch(e) { /* 폴링 실패 무시 */ }
  }, 10000);
}

// ── 짝꿍 링크 진입 시 세션 로드
async function loadPartnerSession(code) {
  try {
    const row = await apiGetSession(code);
    S.partnerData = row.host_data;   // 호스트 데이터가 "짝꿍"
    S.sessionId   = row.id;
    document.getElementById('joined-notice').style.display = 'block';
    window.history.replaceState({}, '', location.pathname);
    showToast('💌 짝꿍이 공유한 링크예요! 내 정보를 입력해주세요');
  } catch(e) {
    showToast('링크가 만료됐거나 올바르지 않아요');
  }
}

// ── 짝꿍 입력 완료 후 저장
async function saveGuestAndRender() {
  if(!S.myResult || !S.partnerData) return;
  try {
    await apiJoinSession(S.sessionId, S.myResult);
    await renderCoupleResult();
  } catch(e) {
    console.error('짝꿍 저장 오류:', e);
    await renderCoupleResult(); // 실패해도 UI는 표시
  }
}

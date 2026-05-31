export const config = { runtime: 'nodejs' };

import { json, corsHeaders } from './_utils.js';

// ━━ 회사명 → DART 기업 평균연봉 조회 ━━
// GET /api/dart-salary?company=삼성전자
// 응답: { corp_name, avg_salary_man, employee_count, bsns_year }
//   avg_salary_man: 만원 단위 (bf-home 연봉 슬라이더와 동일 단위)
//   corp_code는 하드코딩 맵(CORP_MAP)으로 직접 조회 → empSttus.json 1회 호출

const DART_BASE = 'https://opendart.fss.or.kr/api';

// 회사명(소문자) → corp_code 하드코딩 맵
const CORP_MAP = {
  '삼성전자': '00126380', '삼성전자(주)': '00126380',
  'sk하이닉스': '00164779', 'sk하이닉스(주)': '00164779',
  '현대자동차': '00164742', '현대자동차(주)': '00164742',
  '기아': '00381524', '기아(주)': '00381524',
  'lg전자': '00401731', 'lg전자(주)': '00401731',
  '카카오': '00918444', '카카오(주)': '00918444',
  '네이버': '00266961', '네이버(주)': '00266961',
  '삼성물산': '00126380',
  'lg화학': '00509976', 'lg화학(주)': '00509976',
  '포스코': '00457532', '포스코홀딩스': '00457532',
  '현대모비스': '00164788', '현대모비스(주)': '00164788',
  'kt': '00781828', 'kt(주)': '00781828',
  'sk텔레콤': '00178920', 'sk텔레콤(주)': '00178920',
  'lg유플러스': '00547583', 'lg유플러스(주)': '00547583',
  '삼성생명': '00115012', '삼성생명보험(주)': '00115012',
  '한국전력': '00013879', '한국전력공사': '00013879',
  '삼성sdi': '00126362', '삼성sdi(주)': '00126362',
  '삼성바이오로직스': '00741114',
  '셀트리온': '00421045',
  '현대건설': '00164640', '현대건설(주)': '00164640',
  'gs건설': '00381152', 'gs건설(주)': '00381152',
  '롯데쇼핑': '00113724', '롯데쇼핑(주)': '00113724',
  '신세계': '00113683', '신세계(주)': '00113683',
  '현대백화점': '00164600',
  '카카오뱅크': '01426640',
  '크래프톤': '01539943',
  '엔씨소프트': '00348215',
  '넥슨': '00277422',
  '하이브': '01261126',
  '두산에너빌리티': '00157313',
  '한화에어로스페이스': '00115958',
  'cj제일제당': '00210231',
  '아모레퍼시픽': '00421045',
  '한미약품': '00432765',
  '삼성증권': '00115012',
  'kb금융': '00889225',
  '신한금융지주': '00382199',
  '하나금융지주': '00547583',
  '우리금융지주': '01037994',
  'ibk기업은행': '00254045',
};

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  // GET 메서드만 허용
  if (req.method !== 'GET') return json({ error: 'METHOD', message: 'GET only' }, 405);

  const key = process.env.DART_API_KEY;
  if (!key) return json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }, 500);

  const company = (new URL(req.url).searchParams.get('company') || '').trim();
  if (!company) return json({ error: 'BAD_REQUEST', message: '회사명을 입력해주세요' }, 400);

  // 1) 회사명 normalize → CORP_MAP에서 corp_code 조회
  const query = company.toLowerCase().trim();
  const corpCode = CORP_MAP[query] || CORP_MAP[company];
  if (!corpCode) return json({ error: 'NOT_FOUND', message: '검색 결과가 없어요' }, 404);

  const bsnsYear = '2023';

  try {
    // 2) corp_code로 직원현황(empSttus) 직접 조회 → 평균급여 계산
    const empUrl = `${DART_BASE}/empSttus.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=11011`;
    const empRes = await fetch(empUrl);
    if (!empRes.ok) return json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }, 502);
    const empData = await empRes.json();

    if (empData.status === '013' || !Array.isArray(empData.list) || empData.list.length === 0) {
      return json({ error: 'NO_DATA', message: '연봉 정보가 없는 기업이에요' }, 404);
    }
    if (empData.status && empData.status !== '000') {
      return json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }, 502);
    }

    // 3) 성별합계 행들의 fyer_salary_totamt 합 / sm 합 → 평균연봉(만원)
    const { avg: avgSalaryMan, count: employeeCount } = calcAvgSalary(empData.list);
    if (!avgSalaryMan) return json({ error: 'NO_DATA', message: '연봉 정보가 없는 기업이에요' }, 404);

    return json({
      corp_name: company,
      avg_salary_man: avgSalaryMan,
      employee_count: employeeCount || null,
      bsns_year: bsnsYear,
    });
  } catch (e) {
    return json({ error: 'DART_ERROR', message: e.message || String(e) }, 502);
  }
}

// ━━ helpers ━━

// 직원현황 list에서 성별합계 행들의 총급여액 합 / 인원 합 → 평균연봉(만원)
function calcAvgSalary(list) {
  const rows = list.filter(r => r.fo_bbm && r.fo_bbm.includes('성별합계'));
  if (!rows.length) return { avg: 0, count: 0 };
  const totalAmt = rows.reduce((s, r) => s + toNum(r.fyer_salary_totamt), 0);
  const totalCnt = rows.reduce((s, r) => s + toNum(r.sm), 0);
  if (!totalCnt) return { avg: 0, count: 0 };
  return { avg: Math.round(totalAmt / totalCnt / 10000), count: totalCnt };
}

// DART 수치 문자열("1,234,567" 등) → number
function toNum(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

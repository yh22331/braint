export const config = { runtime: 'nodejs' };

import { DART_DATA } from './_dart-data.js';

// ━━ 회사명 → 기업 평균연봉 조회 ━━
// GET /api/dart-salary?company=삼성전자
// 응답: { corp_name, avg_salary_man, employee_count, bsns_year }
//   avg_salary_man: 만원 단위 (bf-home 연봉 슬라이더와 동일 단위)
//
// 기본: api/_dart-data.js의 사전 수집값(scripts/collect-dart.js가 생성)으로 즉답.
// 폴백: 사전 수집값이 없는 항목(avg_salary_man null — 수집 실행 전 시드 상태)만
//       DART empSttus.json 실시간 호출. DART_API_KEY는 폴백에서만 사용.

const DART_BASE = 'https://opendart.fss.or.kr/api';
const FALLBACK_YEAR = '2025';

// 회사명/별칭 정규화(소문자·공백 제거) → 데이터 항목
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
const LOOKUP = (() => {
  const m = new Map();
  for (const c of DART_DATA) {
    m.set(norm(c.name), c);
    for (const a of (c.aliases || [])) m.set(norm(a), c);
  }
  return m;
})();

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD', message: 'GET only' }); return; }

  const company = (req.query.company || '').trim();
  if (!company) { res.status(400).json({ error: 'BAD_REQUEST', message: '회사명을 입력해주세요' }); return; }

  const entry = LOOKUP.get(norm(company));
  if (!entry) { res.status(404).json({ error: 'NOT_FOUND', message: '검색 결과가 없어요' }); return; }

  // ① 사전 수집값 즉답
  if (entry.avg_salary_man) {
    res.status(200).json({
      corp_name: entry.name,
      avg_salary_man: entry.avg_salary_man,
      employee_count: entry.employee_count || null,
      bsns_year: entry.bsns_year,
    });
    return;
  }

  // ② 폴백: DART 실시간 조회 (수집 전 시드 항목용)
  const key = process.env.DART_API_KEY;
  if (!key) { res.status(500).json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }); return; }

  try {
    const empUrl = `${DART_BASE}/empSttus.json?crtfc_key=${key}&corp_code=${entry.corp_code}&bsns_year=${FALLBACK_YEAR}&reprt_code=11011`;
    const empRes = await fetch(empUrl);
    if (!empRes.ok) {
      res.status(502).json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }); return;
    }
    const empData = await empRes.json();

    if (empData.status === '013' || !Array.isArray(empData.list) || empData.list.length === 0) {
      res.status(404).json({ error: 'NO_DATA', message: '연봉 정보가 없는 기업이에요' }); return;
    }
    if (empData.status && empData.status !== '000') {
      res.status(502).json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }); return;
    }

    const result = calcAvgSalary(empData.list);
    const { avg: avgSalaryMan, count: employeeCount } = result;
    if (!avgSalaryMan) { res.status(404).json({ error: 'NO_DATA', message: '연봉 정보가 없는 기업이에요' }); return; }

    res.status(200).json({
      corp_name: entry.name,
      avg_salary_man: avgSalaryMan,
      employee_count: employeeCount || null,
      bsns_year: FALLBACK_YEAR,
    });
  } catch (e) {
    console.error('[DART] ERROR:', e.message, e.stack);
    res.status(502).json({ error: 'DART_ERROR', message: e.message || String(e) });
  }
}

// ━━ helpers ━━

// 직원현황 list에서 남성 기준 평균연봉(만원) 산출
// ⚠️ scripts/collect-dart.js의 calcAvgSalary와 동일 로직 — 한쪽 수정 시 양쪽 동기화 필수
// 우선순위: ① 남성 합계행 총급여/인원 → ② jan_salary_am → ③ 남성 전체행 → ④ 기존 로직(안전망)
function calcAvgSalary(list) {
  const SUMMARY_KW = ['합계', '소계', '전체'];
  const isSummary = r => SUMMARY_KW.some(k => (r.fo_bbm || '').includes(k));
  const isMale    = r => (r.sexdstn || '').trim() === '남';

  // ① 남성 합계행: sexdstn="남" AND fo_bbm이 합계류
  const maleSumRows = list.filter(r => isMale(r) && isSummary(r));
  if (maleSumRows.length) {
    const withAmt = maleSumRows.filter(r => toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
    if (withAmt.length) {
      const totalAmt = withAmt.reduce((s, r) => s + toNum(r.fyer_salary_totamt), 0);
      const totalCnt = withAmt.reduce((s, r) => s + toNum(r.sm), 0);
      return { avg: Math.round(totalAmt / totalCnt / 10000), count: totalCnt };
    }
    // 폴백 1: fyer_salary_totamt="-" → jan_salary_am(원 단위) 사용
    const withJan = maleSumRows.filter(r => toNum(r.jan_salary_am) > 0);
    if (withJan.length) {
      const avg = Math.round(withJan.reduce((s, r) => s + toNum(r.jan_salary_am), 0) / withJan.length / 10000);
      return { avg, count: null };
    }
  }

  // 폴백 2: 남성 합계행 없음 → sexdstn="남" 전체 행 합산
  const maleAll = list.filter(r => isMale(r) && toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
  if (maleAll.length) {
    const totalAmt = maleAll.reduce((s, r) => s + toNum(r.fyer_salary_totamt), 0);
    const totalCnt = maleAll.reduce((s, r) => s + toNum(r.sm), 0);
    return { avg: Math.round(totalAmt / totalCnt / 10000), count: totalCnt };
  }

  // 폴백 3: 남성 행 자체 없음 → 기존 로직(안전망, 퇴행 방지)
  const valid = list.filter(r => toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
  if (!valid.length) return { avg: 0, count: 0 };
  const summaryRows = valid.filter(r => SUMMARY_KW.some(k => (r.fo_bbm || '').includes(k)));
  const rows = summaryRows.length ? summaryRows : valid;
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

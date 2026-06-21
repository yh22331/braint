export const config = { runtime: 'nodejs' };

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
  '현대자동차': '00164742', '현대차': '00164742',
  '기아': '00106641', '기아자동차': '00106641',
  'lg전자': '00401731',
  '카카오': '00258801', '(주)카카오': '00258801',
  '네이버': '00266961', 'naver': '00266961',
  'lg화학': '00356361',
  '삼성sdi': '00126362',
  '삼성바이오로직스': '00877059',
  '셀트리온': '00413046',
  '포스코홀딩스': '00155319', 'posco홀딩스': '00155319', '포스코': '00155319',
  '현대모비스': '00164788',
  'kt': '00190321', '케이티': '00190321',
  'sk텔레콤': '00159023',
  'lg유플러스': '00231363',
  '삼성생명': '00126256',
  '한국전력': '00159193', '한국전력공사': '00159193', '한전': '00159193',
  '크래프톤': '00760971',
  '엔씨소프트': '00261443',
  '하이브': '01204056',
  '한화에어로스페이스': '00126566',
  '한화비전': '01867758',
  '한화오션': '00111704',
  'cj제일제당': '00635134',
  '한미약품': '00828497',
  'kb금융': '00688996', 'kb금융지주': '00688996',
  '신한지주': '00382199', '신한금융지주': '00382199',
  '하나금융지주': '00547583',
  '우리금융지주': '01350869',
  '기업은행': '00149646', 'ibk기업은행': '00149646',
  '현대건설': '00164478',
  'gs건설': '00120030',
  '롯데쇼핑': '00120526',
  '신세계': '00136378',
  '현대백화점': '00428251',
  '카카오뱅크': '01133217',
  'sk이노베이션': '00631518',
  '두산에너빌리티': '00159616',
  'lg에너지솔루션': '01515323', 'lg엔솔': '01515323',
  '삼성물산': '00149655',
};

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD', message: 'GET only' }); return; }

  const key = process.env.DART_API_KEY;
  if (!key) { res.status(500).json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }); return; }

  const company = (req.query.company || '').trim();
  if (!company) { res.status(400).json({ error: 'BAD_REQUEST', message: '회사명을 입력해주세요' }); return; }

  const query = company.toLowerCase().trim();
  const corpCode = CORP_MAP[query] || CORP_MAP[company];
  if (!corpCode) { res.status(404).json({ error: 'NOT_FOUND', message: '검색 결과가 없어요' }); return; }

  const bsnsYear = '2023';

  try {
    const empUrl = `${DART_BASE}/empSttus.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=11011`;
    const empRes = await fetch(empUrl);
    if (!empRes.ok) { res.status(502).json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }); return; }
    const empData = await empRes.json();

    if (empData.status === '013' || !Array.isArray(empData.list) || empData.list.length === 0) {
      res.status(404).json({ error: 'NO_DATA', message: '연봉 정보가 없는 기업이에요' }); return;
    }
    if (empData.status && empData.status !== '000') {
      res.status(502).json({ error: 'DART_ERROR', message: '잠시 후 다시 시도해주세요' }); return;
    }

    const { avg: avgSalaryMan, count: employeeCount } = calcAvgSalary(empData.list);
    if (!avgSalaryMan) { res.status(404).json({ error: 'NO_DATA', message: '연봉 정보가 없는 기업이에요' }); return; }

    res.status(200).json({
      corp_name: company,
      avg_salary_man: avgSalaryMan,
      employee_count: employeeCount || null,
      bsns_year: bsnsYear,
    });
  } catch (e) {
    res.status(502).json({ error: 'DART_ERROR', message: e.message || String(e) });
  }
}

// ━━ helpers ━━

// 직원현황 list에서 성별합계 행들의 총급여액 합 / 인원 합 → 평균연봉(만원)
function calcAvgSalary(list) {
  const valid = list.filter(r => toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
  if (!valid.length) return { avg: 0, count: 0 };

  // fo_bbm(부문)별로 그룹화. 같은 부문에 '합계' 행이 있으면 그것만, 없으면 성별 행을 모두 합산
  // 단순화: fo_bbm 값들을 보고 '합계/소계/전체' 행이 있으면 그것만 사용
  const summaryRows = valid.filter(r => {
    const b = r.fo_bbm || '';
    return b.includes('합계') || b.includes('소계') || b.includes('전체');
  });

  // 합계 행이 있으면 사용, 없으면 전체 유효행 합산 (성별 분리 케이스)
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

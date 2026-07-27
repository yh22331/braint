#!/usr/bin/env node
// ━━ DART 상장사 평균연봉 일괄 수집 (1회성 로컬 스크립트 — 서버 배포 X) ━━
//
// 사용법:
//   DART_API_KEY=발급키 node scripts/collect-dart.js [--top 500] [--resume]
//
// 사전 준비:
//   1. DART 오픈API 키 (https://opendart.fss.or.kr — 무료, 일 20,000건 한도)
//   2. KRX 시가총액 CSV: data.krx.co.kr 정보데이터시스템 → [12002] 전종목 시세
//      → CSV 다운로드 → scripts/krx-marketcap.csv 로 저장 (EUC-KR/UTF-8 자동 인식)
//
// 동작:
//   ① corpCode.xml(전체 법인 목록) 다운로드·캐시(7일) → stock_code 있는 상장사만 필터
//   ② KRX CSV 시가총액 내림차순 + scripts/aliases.json의 force_include 병합 → 후보 선정
//   ③ 각 회사 empSttus.json(사업보고서 11011, 2025→2024 폴백)에서 남성 기준 평균연봉 산출
//      (api/dart-salary.js의 calcAvgSalary와 동일 로직 — 한쪽 수정 시 양쪽 동기화 필수)
//   ④ 출력:
//        scripts/output/dart-master.json  — 마스터 (원본 보관용)
//        api/_dart-data.js                — 서빙용 모듈 (dart-companies/dart-salary가 import)
//
//   호출 간 150ms 딜레이(분당 ~400건), 진행 상황을 scripts/output/.progress.json에
//   계속 저장하므로 중단돼도 --resume으로 이어서 실행 가능.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const OUT_DIR = path.join(__dirname, 'output');
const KRX_CSV = path.join(__dirname, 'krx-marketcap.csv');
const ALIASES_JSON = path.join(__dirname, 'aliases.json');
const PROGRESS_JSON = path.join(OUT_DIR, '.progress.json');
const MASTER_JSON = path.join(OUT_DIR, 'dart-master.json');
const DATA_MODULE = path.join(ROOT, 'api', '_dart-data.js');

const DART_BASE = 'https://opendart.fss.or.kr/api';
const DELAY_MS = 150;          // 호출 간 딜레이
const YEARS = ['2025', '2024']; // 사업보고서 연도 폴백 순서
const CORPCODE_TTL_MS = 7 * 24 * 3600 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ━━ main ━━

async function main() {
  const KEY = process.env.DART_API_KEY;
  if (!KEY) die('DART_API_KEY 환경변수가 필요합니다.\n  DART_API_KEY=발급키 node scripts/collect-dart.js');

  const args = process.argv.slice(2);
  const top = Number(argVal(args, '--top') || 500);
  const resume = args.includes('--resume');

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ① 상장사 목록
  const corps = await loadCorpCodes(KEY);
  console.log(`상장사 ${corps.length}개 로드 (corpCode.xml)`);

  // ② 시총 순위 + force_include 병합
  const krxRanks = loadKrxRanks(); // Map<stock_code, rank>
  const aliasesConf = JSON.parse(fs.readFileSync(ALIASES_JSON, 'utf8'));
  const byStock = new Map(corps.map(c => [c.stock_code, c]));
  const byCode = new Map(corps.map(c => [c.corp_code, c]));

  const ranked = [...krxRanks.entries()]
    .map(([stock, rank]) => ({ corp: byStock.get(stock), rank }))
    .filter(x => x.corp) // 우선주·ETF·ETN 등 corpCode에 없는 종목 제외
    .sort((a, b) => a.rank - b.rank);

  const forceCodes = Object.keys(aliasesConf.force_include || {});
  const forceMissing = forceCodes.filter(code => !byCode.get(code));
  if (forceMissing.length) console.warn(`⚠️ force_include 중 corpCode에 없는 코드: ${forceMissing.join(', ')}`);

  const seen = new Set();
  const queue = []; // force 먼저, 그 뒤 시총순
  for (const code of forceCodes) {
    const corp = byCode.get(code);
    if (!corp || seen.has(code)) continue;
    seen.add(code);
    const r = ranked.find(x => x.corp.corp_code === code);
    queue.push({ corp, rank: r ? r.rank : null, force: true });
  }
  for (const { corp, rank } of ranked) {
    if (seen.has(corp.corp_code)) continue;
    seen.add(corp.corp_code);
    queue.push({ corp, rank, force: false });
  }
  console.log(`후보 ${queue.length}개 (force ${forceCodes.length} + 시총순), 목표 ${top}개`);

  // ③ 수집
  const progress = resume && fs.existsSync(PROGRESS_JSON)
    ? JSON.parse(fs.readFileSync(PROGRESS_JSON, 'utf8')) : {};
  const results = [];
  const failures = [];
  let calls = 0;

  for (const { corp, rank, force } of queue) {
    if (!force && results.length >= top) break;

    let rec = progress[corp.corp_code];
    if (rec === undefined) {
      const got = await collectOne(KEY, corp.corp_code);
      calls += got.calls;
      rec = got.data; // 성공 시 {avg,count,year}, 실패 시 null
      progress[corp.corp_code] = rec;
      fs.writeFileSync(PROGRESS_JSON, JSON.stringify(progress));
      await sleep(DELAY_MS);
    }

    if (rec) {
      results.push({
        name: corp.corp_name,
        corp_code: corp.corp_code,
        stock_code: corp.stock_code,
        market_cap_rank: rank,
        avg_salary_man: rec.avg,
        employee_count: rec.count || null,
        bsns_year: rec.year,
        aliases: (aliasesConf.aliases || {})[corp.corp_code] || [],
      });
    } else {
      failures.push(`${corp.corp_name}(${corp.corp_code})${force ? ' [force]' : ''}`);
    }
    if ((results.length + failures.length) % 25 === 0) {
      console.log(`  진행: 성공 ${results.length} / 실패 ${failures.length} (API 호출 ${calls}회)`);
    }
  }

  // ④ 출력
  results.sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
  fs.writeFileSync(MASTER_JSON, JSON.stringify(results, null, 2));
  writeDataModule(results);

  console.log('\n━━ 완료 ━━');
  console.log(`성공 ${results.length}개 → ${path.relative(ROOT, MASTER_JSON)}, ${path.relative(ROOT, DATA_MODULE)}`);
  if (failures.length) {
    console.log(`실패(연봉 자료 없음 등) ${failures.length}개:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log('\n다음 단계: bf-home에서 회사 검색 동작 확인 후 api/_dart-data.js를 커밋하세요.');
}

// ━━ ① corpCode.xml ━━

async function loadCorpCodes(key) {
  const xmlPath = path.join(CACHE_DIR, 'CORPCODE.xml');
  const zipPath = path.join(CACHE_DIR, 'corpCode.zip');
  const fresh = fs.existsSync(xmlPath) && (Date.now() - fs.statSync(xmlPath).mtimeMs < CORPCODE_TTL_MS);
  if (!fresh) {
    console.log('corpCode.xml 다운로드 중...');
    const res = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${key}`);
    if (!res.ok) die(`corpCode.xml 다운로드 실패: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // 키 오류 시 ZIP 대신 XML 에러 응답이 옴
    if (buf.slice(0, 2).toString() !== 'PK') die(`corpCode.xml 응답이 ZIP이 아님 (API 키 확인): ${buf.slice(0, 200).toString()}`);
    fs.writeFileSync(zipPath, buf);
    execFileSync('unzip', ['-o', zipPath, '-d', CACHE_DIR], { stdio: 'ignore' });
  }
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const corps = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const stock = tag(block, 'stock_code').trim();
    if (!stock) continue; // 비상장 제외
    corps.push({
      corp_code: tag(block, 'corp_code').trim(),
      corp_name: tag(block, 'corp_name').trim(),
      stock_code: stock,
      modify_date: tag(block, 'modify_date').trim(),
    });
  }
  // 동일 stock_code 중복 시 modify_date 최신 것만
  const dedup = new Map();
  for (const c of corps) {
    const prev = dedup.get(c.stock_code);
    if (!prev || c.modify_date > prev.modify_date) dedup.set(c.stock_code, c);
  }
  return [...dedup.values()];
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

// ━━ ② KRX CSV → Map<종목코드, 시총순위> ━━

function loadKrxRanks() {
  if (!fs.existsSync(KRX_CSV)) {
    die(`KRX 시가총액 CSV가 없습니다: ${KRX_CSV}\n` +
        'data.krx.co.kr → 정보데이터시스템 → [12002] 전종목 시세 → CSV 다운로드 후 저장하세요.');
  }
  const buf = fs.readFileSync(KRX_CSV);
  let text = buf.toString('utf8');
  if (!text.includes('종목')) text = new TextDecoder('euc-kr').decode(buf); // KRX 기본 인코딩 대응
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = parseCsvLine(lines[0]);
  const codeIdx = header.findIndex(h => h.includes('종목코드') || h.includes('단축코드'));
  const capIdx = header.findIndex(h => h.includes('시가총액'));
  if (codeIdx < 0 || capIdx < 0) die(`CSV 헤더에서 종목코드/시가총액 컬럼을 못 찾음: ${header.join(' | ')}`);

  const rows = lines.slice(1).map(parseCsvLine)
    .map(cells => ({
      stock: (cells[codeIdx] || '').replace(/\D/g, '').padStart(6, '0'),
      cap: Number((cells[capIdx] || '').replace(/[^0-9]/g, '')) || 0,
    }))
    .filter(r => r.stock.length === 6 && r.cap > 0)
    .sort((a, b) => b.cap - a.cap);

  const ranks = new Map();
  rows.forEach((r, i) => { if (!ranks.has(r.stock)) ranks.set(r.stock, i + 1); });
  console.log(`KRX CSV: ${ranks.size}개 종목 시총 순위 로드`);
  return ranks;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

// ━━ ③ 회사별 수집 ━━

// 성공: { data: {avg, count, year}, calls }, 실패: { data: null, calls }
async function collectOne(key, corpCode) {
  let calls = 0;
  for (const year of YEARS) {
    const data = await dartFetch(`${DART_BASE}/empSttus.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011`);
    calls++;
    if (data.status === '000' && Array.isArray(data.list) && data.list.length) {
      const r = calcAvgSalary(data.list);
      if (r.avg > 0) return { data: { avg: r.avg, count: r.count, year }, calls };
    }
    // status 013(자료 없음)이면 이전 연도 폴백, 그 외 상태는 dartFetch에서 처리됨
    if (year !== YEARS[YEARS.length - 1]) await sleep(DELAY_MS);
  }
  return { data: null, calls };
}

let limitWaited = false;
async function dartFetch(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === '011' || data.status === '010') die(`DART API 키 오류 (status ${data.status}): ${data.message}`);
      if (data.status === '020') { // 사용 한도 초과
        if (limitWaited) die('DART 호출 한도 초과가 반복됩니다. 내일 --resume으로 이어서 실행하세요.');
        console.warn('⚠️ 호출 한도 감지 — 60초 대기 후 재시도');
        limitWaited = true;
        await sleep(60000);
        continue;
      }
      return data;
    } catch (e) {
      if (attempt === 0) { await sleep(1000); continue; } // 네트워크 오류 1회 재시도
      console.warn(`  요청 실패(${e.message}) — 건너뜀`);
      return { status: 'FETCH_ERROR' };
    }
  }
  return { status: 'FETCH_ERROR' };
}

// ━━ ④ 서빙용 모듈 생성 ━━

function writeDataModule(entries) {
  const header =
    '// ⚠️ scripts/collect-dart.js가 자동 생성하는 파일 — 직접 수정하지 말 것\n' +
    `// 생성: ${new Date().toISOString().slice(0, 10)} / 회사 ${entries.length}개\n` +
    '// 별칭 추가/수정: scripts/aliases.json 수정 후 스크립트 재실행 (--resume이면 API 재호출 없이 재생성)\n' +
    'export const DART_DATA = ';
  fs.writeFileSync(DATA_MODULE, header + JSON.stringify(entries, null, 1) + ';\n');
}

// ━━ 평균연봉 계산 (api/dart-salary.js와 동일 로직 — 동기화 필수) ━━

// 직원현황 list에서 남성 기준 평균연봉(만원) 산출
// 우선순위: ① 남성 합계행 총급여/인원 → ② jan_salary_am → ③ 남성 전체행 → ④ 안전망
function calcAvgSalary(list) {
  const SUMMARY_KW = ['합계', '소계', '전체'];
  const isSummary = r => SUMMARY_KW.some(k => (r.fo_bbm || '').includes(k));
  const isMale    = r => (r.sexdstn || '').trim() === '남';

  const maleSumRows = list.filter(r => isMale(r) && isSummary(r));
  if (maleSumRows.length) {
    const withAmt = maleSumRows.filter(r => toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
    if (withAmt.length) {
      const totalAmt = withAmt.reduce((s, r) => s + toNum(r.fyer_salary_totamt), 0);
      const totalCnt = withAmt.reduce((s, r) => s + toNum(r.sm), 0);
      return { avg: Math.round(totalAmt / totalCnt / 10000), count: totalCnt };
    }
    const withJan = maleSumRows.filter(r => toNum(r.jan_salary_am) > 0);
    if (withJan.length) {
      const avg = Math.round(withJan.reduce((s, r) => s + toNum(r.jan_salary_am), 0) / withJan.length / 10000);
      return { avg, count: null };
    }
  }

  const maleAll = list.filter(r => isMale(r) && toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
  if (maleAll.length) {
    const totalAmt = maleAll.reduce((s, r) => s + toNum(r.fyer_salary_totamt), 0);
    const totalCnt = maleAll.reduce((s, r) => s + toNum(r.sm), 0);
    return { avg: Math.round(totalAmt / totalCnt / 10000), count: totalCnt };
  }

  const valid = list.filter(r => toNum(r.fyer_salary_totamt) > 0 && toNum(r.sm) > 0);
  if (!valid.length) return { avg: 0, count: 0 };
  const summaryRows = valid.filter(r => SUMMARY_KW.some(k => (r.fo_bbm || '').includes(k)));
  const rows = summaryRows.length ? summaryRows : valid;
  const totalAmt = rows.reduce((s, r) => s + toNum(r.fyer_salary_totamt), 0);
  const totalCnt = rows.reduce((s, r) => s + toNum(r.sm), 0);
  if (!totalCnt) return { avg: 0, count: 0 };
  return { avg: Math.round(totalAmt / totalCnt / 10000), count: totalCnt };
}

function toNum(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ━━ util ━━

function argVal(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

main().catch(e => die(`오류: ${e.stack || e}`));

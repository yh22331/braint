export const config = { runtime: 'nodejs' };

import { DART_DATA } from './_dart-data.js';

// 자동완성 드롭다운용 회사명 + 별칭 평탄화 목록.
// 데이터 원본은 api/_dart-data.js (scripts/collect-dart.js가 생성) — 여기서 직접 관리하지 않음.
const COMPANIES = (() => {
  const set = new Set();
  for (const c of DART_DATA) {
    set.add(c.name);
    for (const a of (c.aliases || [])) set.add(a);
  }
  return [...set];
})();

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD', message: 'GET only' }); return; }

  res.status(200).json({ companies: COMPANIES });
}

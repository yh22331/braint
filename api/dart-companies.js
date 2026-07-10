export const config = { runtime: 'nodejs' };

// ⚠️ 이 목록은 dart-salary.js의 CORP_MAP과 동기화 필요.
//    회사 추가/삭제 시 두 파일 모두 수정할 것.
const COMPANIES = [
  '삼성전자', '삼성전자(주)',
  'sk하이닉스', 'sk하이닉스(주)',
  '현대자동차', '현대차',
  '기아', '기아자동차',
  'lg전자',
  '카카오', '(주)카카오',
  '네이버', 'naver',
  'lg화학',
  '삼성sdi',
  '삼성바이오로직스',
  '셀트리온',
  '포스코홀딩스', 'posco홀딩스', '포스코',
  '현대모비스',
  'kt', '케이티',
  'sk텔레콤',
  'lg유플러스',
  '삼성생명',
  '한국전력', '한국전력공사', '한전',
  '크래프톤',
  '엔씨소프트',
  '하이브',
  '한화에어로스페이스',
  '한화비전',
  '한화오션',
  'cj제일제당',
  '한미약품',
  'kb금융', 'kb금융지주',
  '신한지주', '신한금융지주',
  '하나금융지주',
  '우리금융지주',
  '기업은행', 'ibk기업은행',
  '현대건설',
  'gs건설',
  '롯데쇼핑',
  '신세계',
  '현대백화점',
  '카카오뱅크',
  'sk이노베이션',
  '두산에너빌리티',
  'lg에너지솔루션', 'lg엔솔',
  '삼성물산',
];

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'METHOD', message: 'GET only' }); return; }

  res.status(200).json({ companies: COMPANIES });
}

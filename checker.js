// checker.js — employees.json의 각 모니터링 대상(url)을 점검해 status를 갱신한다.
//
//   동작: url 이 있는 직원마다 요청 → 응답 실패(타임아웃 / 4xx / 5xx / 네트워크 오류)면
//         status="red", 정상(2xx·3xx)이면 status="green" 으로 바꿔 employees.json 에 다시 저장.
//   url 이 없는 직원(대표·관제 등)은 건드리지 않는다.
//
//   요구사항: Node 18+ (내장 fetch 사용). 외부 의존성 없음.
//   실행: node checker.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'employees.json');
const TIMEOUT_MS = 10000;            // 요청 타임아웃 (10초)
const UA = 'online-sangsa-checker/1.0 (+health-check)';

/** 단일 URL 점검. { ok, code } 반환. ok=true 면 정상(green). */
async function check(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // 가벼운 HEAD 먼저. HEAD 미지원(405/501) 서버는 GET 으로 재시도.
    let res = await fetch(url, {
      method: 'HEAD', redirect: 'follow', signal: ctrl.signal,
      headers: { 'user-agent': UA },
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET', redirect: 'follow', signal: ctrl.signal,
        headers: { 'user-agent': UA },
      });
    }
    // fetch 의 ok 는 2xx. 3xx 는 redirect:follow 로 최종 응답이 옴.
    return { ok: res.ok, code: res.status };
  } catch (err) {
    const code = err.name === 'AbortError' ? 'TIMEOUT' : (err.cause?.code || err.code || 'ERR');
    return { ok: false, code };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const now = new Date().toISOString();
  let checked = 0, changed = 0;

  for (const floor of data.floors) {
    for (const emp of floor.employees) {
      if (!emp.url) continue;          // 모니터링 대상이 아닌 직원은 건너뜀
      checked++;

      const r = await check(emp.url);
      const next = r.ok ? 'green' : 'red';
      const prev = emp.status;

      emp.status = next;
      emp.lastCheck = now;             // 마지막 점검 시각(UTC)
      emp.lastCode = r.code;           // 마지막 응답 코드 / 오류 사유

      if (prev !== next) changed++;
      const mark = next === 'green' ? '✅' : '❌';
      const note = prev !== next ? `  (${prev}→${next})` : '';
      console.log(`${mark} ${emp.name.padEnd(8)} ${String(r.code).padEnd(8)} ${emp.url}${note}`);
    }
  }

  // 들여쓰기 2칸으로 다시 저장 (index.html 이 그대로 fetch).
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`\n점검 완료: ${checked}개 확인, ${changed}개 상태 변경 → employees.json 저장됨 (${now})`);
}

main().catch((e) => { console.error('checker 실패:', e); process.exit(1); });

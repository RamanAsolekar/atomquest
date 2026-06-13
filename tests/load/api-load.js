import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// k6 load test for the Atom Support Vision API.
//   k6 run -e BASE_URL=http://localhost:4000 tests/load/api-load.js
const BASE = __ENV.BASE_URL || 'http://localhost:4000';

const errorRate = new Rate('errors');
const sessionCreateTrend = new Trend('session_create_ms');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    errors: ['rate<0.05'],
  },
};

function login() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({
    email: 'agent@atomvision.dev', password: 'Agent@123',
  }), { headers: { 'Content-Type': 'application/json' } });
  check(res, { 'login 200': (r) => r.status === 200 }) || errorRate.add(1);
  return res.json('accessToken');
}

export default function () {
  const token = login();
  const authHeaders = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };

  group('session lifecycle', () => {
    const t0 = Date.now();
    const create = http.post(`${BASE}/api/sessions`, JSON.stringify({ title: `Load ${__VU}-${__ITER}` }), authHeaders);
    sessionCreateTrend.add(Date.now() - t0);
    const ok = check(create, { 'create 201': (r) => r.status === 201 || r.status === 200 });
    if (!ok) { errorRate.add(1); return; }
    const sessionId = create.json('id');

    const invite = http.post(`${BASE}/api/sessions/${sessionId}/invites`, JSON.stringify({}), authHeaders);
    check(invite, { 'invite 201': (r) => r.status === 201 || r.status === 200 }) || errorRate.add(1);
    const token2 = invite.json('token');

    const validate = http.get(`${BASE}/api/sessions/invite/${encodeURIComponent(token2)}/validate`);
    check(validate, { 'validate 200': (r) => r.status === 200 }) || errorRate.add(1);

    const list = http.get(`${BASE}/api/sessions?take=10`, authHeaders);
    check(list, { 'list 200': (r) => r.status === 200 }) || errorRate.add(1);

    http.post(`${BASE}/api/sessions/${sessionId}/end`, null, authHeaders);
  });

  sleep(1);
}

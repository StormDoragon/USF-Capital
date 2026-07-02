process.env.SESSION_SECRET = 'integration-test-secret';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const speakeasy = require('speakeasy');

const { createTestDb } = require('../helpers/testDb');
const { TestClient } = require('../helpers/httpClient');

let server;
let baseUrl;
let cleanupDb;
let userCounter = 0;

function uniqueEmail() {
  userCounter += 1;
  return `investor${userCounter}.${Date.now()}@example.com`;
}

before(async () => {
  const testDb = createTestDb();
  cleanupDb = testDb.cleanup;
  const { createApp } = require('../../src/app');
  const app = createApp(testDb.db, testDb.pools);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  cleanupDb();
});

// A fresh client, registered and KYC-approved as an adult, ready to deposit.
async function registerApprovedUser(client, { dob = '1970-01-01', password = 'Password123' } = {}) {
  const email = uniqueEmail();
  await client.get('/register');
  await client.post('/register', {
    _csrf: client.csrfToken(),
    fullName: 'Test Investor',
    email,
    password,
    confirmPassword: password
  });
  await client.post('/kyc', {
    _csrf: client.csrfToken(),
    fullName: 'Test Investor',
    dob,
    country: 'USA',
    idNumber: '00011122'
  });
  return { email, password };
}

test('every major page shows the demo disclaimer', async () => {
  const client = new TestClient(baseUrl);
  const paths = ['/', '/how-it-works', '/pools', '/security', '/pricing', '/register', '/login'];
  for (const path of paths) {
    const res = await client.get(path);
    assert.equal(res.status, 200, `expected 200 for ${path}`);
    const body = await res.text();
    assert.match(body, /Demo only/, `expected disclaimer banner on ${path}`);
  }
});

test('state-changing requests without a CSRF token are rejected', async () => {
  const client = new TestClient(baseUrl);
  await client.get('/login');
  const res = await client.post('/login', { email: 'nobody@example.com', password: 'whatever123' });
  assert.equal(res.status, 403);
});

test('registration rejects weak passwords, mismatched confirmation, and duplicate emails', async () => {
  const client = new TestClient(baseUrl);
  await client.get('/register');
  const email = uniqueEmail();

  const weak = await client.post('/register', {
    _csrf: client.csrfToken(), fullName: 'A', email, password: 'short1', confirmPassword: 'short1'
  });
  assert.equal(weak.status, 400);
  assert.match(await weak.text(), /at least 10 characters/);

  const mismatched = await client.post('/register', {
    _csrf: client.csrfToken(), fullName: 'A', email, password: 'Password123', confirmPassword: 'Password124'
  });
  assert.equal(mismatched.status, 400);
  assert.match(await mismatched.text(), /do not match/);

  const success = await client.post('/register', {
    _csrf: client.csrfToken(), fullName: 'A', email, password: 'Password123', confirmPassword: 'Password123'
  });
  assert.equal(success.status, 302);
  assert.equal(success.headers.get('location'), '/kyc');

  // Registering the same email again (fresh client, no session) must fail.
  const dupeClient = new TestClient(baseUrl);
  await dupeClient.get('/register');
  const dupe = await dupeClient.post('/register', {
    _csrf: dupeClient.csrfToken(), fullName: 'B', email, password: 'Password123', confirmPassword: 'Password123'
  });
  assert.equal(dupe.status, 400);
  assert.match(await dupe.text(), /already exists/);
});

test('KYC rejects minors and keeps the dashboard gated', async () => {
  const client = new TestClient(baseUrl);
  const email = uniqueEmail();
  await client.get('/register');
  await client.post('/register', {
    _csrf: client.csrfToken(), fullName: 'Young Person', email, password: 'Password123', confirmPassword: 'Password123'
  });

  const seventeenYearsAgo = new Date();
  seventeenYearsAgo.setUTCFullYear(seventeenYearsAgo.getUTCFullYear() - 17);
  const minorDob = seventeenYearsAgo.toISOString().slice(0, 10);

  const kycRes = await client.post('/kyc', {
    _csrf: client.csrfToken(), fullName: 'Young Person', dob: minorDob, country: 'USA', idNumber: '99988877'
  });
  assert.equal(kycRes.status, 400);
  assert.match(await kycRes.text(), /18 or older/);

  const dashboard = await client.get('/dashboard');
  assert.equal(dashboard.status, 302);
  assert.equal(dashboard.headers.get('location'), '/kyc');
});

test('deposits enforce the lifetime cap and the per-pool maximum', async () => {
  const client = new TestClient(baseUrl);
  await registerApprovedUser(client);

  const overCap = await client.post('/deposit', {
    _csrf: client.csrfToken(),
    'amount_equity-growth': '2000',
    paymentMethod: 'card'
  });
  assert.equal(overCap.status, 400);
  assert.match(await overCap.text(), /lifetime limit/);

  const overPoolMax = await client.post('/deposit', {
    _csrf: client.csrfToken(),
    'amount_equity-growth': '900',
    paymentMethod: 'card'
  });
  assert.equal(overPoolMax.status, 400);
  assert.match(await overPoolMax.text(), /maximum of/);

  const ok = await client.post('/deposit', {
    _csrf: client.csrfToken(),
    'amount_equity-growth': '300',
    'amount_fixed-income': '200',
    paymentMethod: 'bank'
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/dashboard');
});

test('the live portfolio API reflects deposits for the authenticated user only', async () => {
  const client = new TestClient(baseUrl);
  await registerApprovedUser(client);
  await client.post('/deposit', {
    _csrf: client.csrfToken(), 'amount_equity-growth': '400', paymentMethod: 'card'
  });

  const res = await client.get('/api/portfolio');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.summary.totalPrincipalCents, 40000);
  assert.equal(data.positions.length, 1);

  const anonymous = new TestClient(baseUrl);
  const denied = await anonymous.get('/api/portfolio');
  assert.equal(denied.status, 302);
  assert.match(denied.headers.get('location'), /^\/login/);
});

test('early withdrawal requires confirmation, applies the year-1 penalty, and credits cash', async () => {
  const client = new TestClient(baseUrl);
  await registerApprovedUser(client);
  await client.post('/deposit', {
    _csrf: client.csrfToken(), 'amount_equity-growth': '500', paymentMethod: 'card'
  });

  const portfolio = await (await client.get('/api/portfolio')).json();
  const positionId = portfolio.positions[0].id;
  const grossCents = portfolio.positions[0].currentValueCents;

  const withoutConfirm = await client.post(`/withdraw/${positionId}`, { _csrf: client.csrfToken() });
  assert.equal(withoutConfirm.status, 302);
  assert.equal(withoutConfirm.headers.get('location'), '/withdraw');

  const stillActive = await (await client.get('/api/portfolio')).json();
  assert.equal(stillActive.positions.length, 1);

  const withdrawRes = await client.post(`/withdraw/${positionId}`, { _csrf: client.csrfToken(), confirm: 'yes' });
  assert.equal(withdrawRes.status, 302);
  assert.equal(withdrawRes.headers.get('location'), '/dashboard');

  const afterWithdraw = await (await client.get('/api/portfolio')).json();
  assert.equal(afterWithdraw.positions.length, 0);
  const expectedNet = grossCents - Math.round(grossCents * 0.20);
  // Allow a small tolerance: the position may have ticked slightly between
  // reading the gross value and withdrawing.
  assert.equal(Math.abs(afterWithdraw.cashBalanceCents - expectedNet) < 50, true);
});

test('changing the password invalidates the old one', async () => {
  const client = new TestClient(baseUrl);
  const { email, password } = await registerApprovedUser(client);

  const changeRes = await client.post('/settings/password', {
    _csrf: client.csrfToken(),
    currentPassword: password,
    newPassword: 'NewPassword456',
    confirmPassword: 'NewPassword456'
  });
  assert.equal(changeRes.status, 302);

  await client.post('/logout', { _csrf: client.csrfToken() });

  const oldLoginClient = new TestClient(baseUrl);
  await oldLoginClient.get('/login');
  const oldLogin = await oldLoginClient.post('/login', { _csrf: oldLoginClient.csrfToken(), email, password });
  assert.equal(oldLogin.status, 400);
  assert.match(await oldLogin.text(), /Incorrect email or password/);

  const newLoginClient = new TestClient(baseUrl);
  await newLoginClient.get('/login');
  const newLogin = await newLoginClient.post('/login', { _csrf: newLoginClient.csrfToken(), email, password: 'NewPassword456' });
  assert.equal(newLogin.status, 302);
  assert.equal(newLogin.headers.get('location'), '/dashboard');
});

test('full TOTP enrollment gates the next login until the correct code is entered', async () => {
  const client = new TestClient(baseUrl);
  const { email, password } = await registerApprovedUser(client);

  await client.get('/settings/2fa');
  const enrollRes = await client.post('/settings/2fa/enroll', { _csrf: client.csrfToken() });
  const enrollHtml = await enrollRes.text();
  const secretMatch = enrollHtml.match(/<code>([A-Z2-7]+)<\/code>/);
  assert.ok(secretMatch, 'expected the enrollment page to show the base32 secret');
  const secret = secretMatch[1];

  const validToken = speakeasy.totp({ secret, encoding: 'base32' });
  const verifyRes = await client.post('/settings/2fa/verify', { _csrf: client.csrfToken(), token: validToken });
  assert.equal(verifyRes.status, 302);
  assert.equal(verifyRes.headers.get('location'), '/settings');

  await client.post('/logout', { _csrf: client.csrfToken() });

  const loginClient = new TestClient(baseUrl);
  await loginClient.get('/login');
  const loginRes = await loginClient.post('/login', { _csrf: loginClient.csrfToken(), email, password });
  assert.equal(loginRes.status, 302);
  assert.equal(loginRes.headers.get('location'), '/login/verify');

  // Not yet fully authenticated: dashboard must still redirect to login.
  const stillGated = await loginClient.get('/dashboard');
  assert.equal(stillGated.status, 302);
  assert.match(stillGated.headers.get('location'), /^\/login/);

  const badCode = await loginClient.post('/login/verify', { _csrf: loginClient.csrfToken(), token: '000000' });
  assert.equal(badCode.status, 400);
  assert.match(await badCode.text(), /not correct/);

  const goodCode = speakeasy.totp({ secret, encoding: 'base32' });
  const challengeRes = await loginClient.post('/login/verify', { _csrf: loginClient.csrfToken(), token: goodCode });
  assert.equal(challengeRes.status, 302);
  assert.equal(challengeRes.headers.get('location'), '/dashboard');
});

test('active sessions and the audit log reflect account activity', async () => {
  const client = new TestClient(baseUrl);
  await registerApprovedUser(client);
  await client.post('/deposit', { _csrf: client.csrfToken(), 'amount_equity-growth': '100', paymentMethod: 'card' });

  const sessionsRes = await client.get('/settings/sessions');
  assert.equal(sessionsRes.status, 200);
  assert.match(await sessionsRes.text(), /This device/);

  const auditRes = await client.get('/settings/audit-log');
  assert.equal(auditRes.status, 200);
  const auditHtml = await auditRes.text();
  assert.match(auditHtml, /account created/);
  assert.match(auditHtml, /kyc approved/);
  assert.match(auditHtml, /deposit/);
});

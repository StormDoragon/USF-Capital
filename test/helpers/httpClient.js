// A minimal cookie-jar HTTP client for driving the app end-to-end in tests,
// using Node's built-in fetch. Redirects are not auto-followed so tests can
// assert on the intermediate response (status + Location header).
class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookie(name) {
    return this.cookies.get(name);
  }

  _cookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  _absorbSetCookie(res) {
    const values = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const cookieStr of values) {
      const pair = cookieStr.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, path, { body, headers = {}, form = true } = {}) {
    const finalHeaders = Object.assign({}, headers, { cookie: this._cookieHeader() });
    let payload;
    if (body && form) {
      const params = new URLSearchParams();
      Object.entries(body).forEach(([k, v]) => params.append(k, v));
      payload = params.toString();
      finalHeaders['content-type'] = 'application/x-www-form-urlencoded';
    } else if (body) {
      payload = JSON.stringify(body);
      finalHeaders['content-type'] = 'application/json';
    }

    const res = await fetch(this.baseUrl + path, { method, headers: finalHeaders, body: payload, redirect: 'manual' });
    this._absorbSetCookie(res);
    return res;
  }

  get(path, opts) { return this.request('GET', path, opts); }
  post(path, body, opts = {}) { return this.request('POST', path, Object.assign({}, opts, { body })); }

  csrfToken() {
    return this.cookies.get('csrf_token');
  }
}

module.exports = { TestClient };

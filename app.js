const express = require('express');
const BrowserService = require('./services/browser');
const BypassService = require('./services/bypass');
const BypassUtils = require('./bypassUtils');

const PORT = process.env.PORT || 3000;

const app = express();
const browserService = new BrowserService();
const bypassService = new BypassService(browserService);

app.use(express.json());
BypassUtils.setBypassService(bypassService);

function validateParams(url, sitekey) {
  if (!url) return { error: "URL parameter is required", code: 400 };
  if (!sitekey) return { error: "Sitekey parameter is required", code: 400 };
  if (typeof url !== "string" || url.trim().length === 0)
    return { error: "URL parameter must be a non-empty string", code: 400 };
  if (typeof sitekey !== "string" || sitekey.trim().length === 0)
    return { error: "Sitekey parameter must be a non-empty string", code: 400 };
  try { new URL(url.trim()); } catch {
    return { error: "Invalid URL format", code: 400 };
  }
  return null;
}

async function solveTurnstile(url, sitekey, withHeaders = false) {
  const bypass = await BypassUtils.solveBypass();
  if (withHeaders) {
    const [token, wafResult] = await Promise.all([
      bypass.solveTurnstileMin(url, sitekey),
      bypass.wafSession(url),
    ]);
    const cookieString = (wafResult.cookies || [])
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
    return {
      token,
      cookies:      wafResult.cookies || [],
      cookieString,
      headers: {
        ...(wafResult.headers || {}),
        ...(cookieString ? { cookie: cookieString } : {}),
      },
    };
  }
  const token = await bypass.solveTurnstileMin(url, sitekey);
  return { token };
}

app.get('/api/solver/turnstile', async (req, res) => {
  const { url, sitekey, headers: withHeaders } = req.query;
  const err = validateParams(url, sitekey);
  if (err) return res.status(err.code).json({ status: false, error: err.error, code: err.code });
  const includeHeaders = withHeaders === 'true' || withHeaders === '1';
  try {
    const result = await solveTurnstile(url.trim(), sitekey.trim(), includeHeaders);
    if (!result.token) {
      return res.status(500).json({ status: false, error: "Failed to solve Turnstile challenge", code: 500 });
    }
    const data = {
      url:      url.trim(),
      sitekey:  sitekey.trim(),
      token:    result.token,
      solvedAt: new Date().toISOString(),
    };
    if (includeHeaders) {
      data.cookies      = result.cookies;
      data.cookieString = result.cookieString;
      data.headers      = result.headers;
    }
    res.json({ status: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message || "Failed to solve Turnstile challenge", code: 500 });
  }
});

app.post('/api/solver/turnstile', async (req, res) => {
  const { url, sitekey, headers: withHeaders } = req.body;
  const err = validateParams(url, sitekey);
  if (err) return res.status(err.code).json({ status: false, error: err.error, code: err.code });
  const includeHeaders = withHeaders === true || withHeaders === 'true' || withHeaders === '1';
  try {
    const result = await solveTurnstile(url.trim(), sitekey.trim(), includeHeaders);
    if (!result.token) {
      return res.status(500).json({ status: false, error: "Failed to solve Turnstile challenge", code: 500 });
    }
    const data = {
      url:      url.trim(),
      sitekey:  sitekey.trim(),
      token:    result.token,
      solvedAt: new Date().toISOString(),
    };
    if (includeHeaders) {
      data.cookies      = result.cookies;
      data.cookieString = result.cookieString;
      data.headers      = result.headers;
    }
    res.json({ status: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message || "Failed to solve Turnstile challenge", code: 500 });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', browserReady: browserService.isReady(), timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  Token saja     : GET /api/solver/turnstile?url=...&sitekey=...`);
  console.log(`  Token+Headers  : GET /api/solver/turnstile?url=...&sitekey=...&headers=true`);
  console.log(`  POST           : POST /api/solver/turnstile  body: { url, sitekey, headers: true }`);
});

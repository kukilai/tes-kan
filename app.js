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

app.get('/api/solver/turnstile', async (req, res) => {
  const { url, sitekey } = req.query;

  if (!url) {
    return res.status(400).json({
      status: false,
      error: "URL parameter is required",
      code: 400,
    });
  }

  if (!sitekey) {
    return res.status(400).json({
      status: false,
      error: "Sitekey parameter is required",
      code: 400,
    });
  }

  if (typeof url !== "string" || url.trim().length === 0) {
    return res.status(400).json({
      status: false,
      error: "URL parameter must be a non-empty string",
      code: 400,
    });
  }

  if (typeof sitekey !== "string" || sitekey.trim().length === 0) {
    return res.status(400).json({
      status: false,
      error: "Sitekey parameter must be a non-empty string",
      code: 400,
    });
  }

  try {
    new URL(url.trim());
  } catch {
    return res.status(400).json({
      status: false,
      error: "Invalid URL format",
      code: 400,
    });
  }

  try {
    const bypass = await BypassUtils.solveBypass();
    const token = await bypass.solveTurnstileMin(url.trim(), sitekey.trim());

    if (!token) {
      return res.status(500).json({
        status: false,
        error: "Failed to solve Turnstile challenge",
        code: 500,
      });
    }

    res.json({
      status: true,
      data: {
        url: url.trim(),
        sitekey: sitekey.trim(),
        token: token,
        solvedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      error: error.message || "Failed to solve Turnstile challenge",
      code: 500,
    });
  }
});

app.post('/api/solver/turnstile', async (req, res) => {
  const { url, sitekey } = req.body;

  if (!url) {
    return res.status(400).json({
      status: false,
      error: "URL parameter is required",
      code: 400,
    });
  }

  if (!sitekey) {
    return res.status(400).json({
      status: false,
      error: "Sitekey parameter is required",
      code: 400,
    });
  }

  if (typeof url !== "string" || url.trim().length === 0) {
    return res.status(400).json({
      status: false,
      error: "URL parameter must be a non-empty string",
      code: 400,
    });
  }

  if (typeof sitekey !== "string" || sitekey.trim().length === 0) {
    return res.status(400).json({
      status: false,
      error: "Sitekey parameter must be a non-empty string",
      code: 400,
    });
  }

  try {
    new URL(url.trim());
  } catch {
    return res.status(400).json({
      status: false,
      error: "Invalid URL format",
      code: 400,
    });
  }

  try {
    const bypass = await BypassUtils.solveBypass();
    const token = await bypass.solveTurnstileMin(url.trim(), sitekey.trim());

    if (!token) {
      return res.status(500).json({
        status: false,
        error: "Failed to solve Turnstile challenge",
        code: 500,
      });
    }

    res.json({
      status: true,
      data: {
        url: url.trim(),
        sitekey: sitekey.trim(),
        token: token,
        solvedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      error: error.message || "Failed to solve Turnstile challenge",
      code: 500,
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    browserReady: browserService.isReady(),
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`GET: http://localhost:${PORT}/api/solver/turnstile?url=https://example.com&sitekey=0x4AAAAAAA_xxx`);
  console.log(`POST: http://localhost:${PORT}/api/solver/turnstile`);
});
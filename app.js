const express       = require('express');
const BrowserService = require('./services/browser');
const KeyFinder      = require('./services/keyFinder');

const PORT          = process.env.PORT || 3000;
const app           = express();
const browserService = new BrowserService();
const keyFinder      = new KeyFinder(browserService);

app.use(express.json());

app.get('/api/userKey', async (req, res) => {
  const silent  = req.query.silent  === 'true' || req.query.silent  === '1';
  const refresh = req.query.refresh === 'true' || req.query.refresh === '1';

  try {
    const data = await keyFinder.getData(silent, refresh);
    res.json({
      status:    true,
      data:      { userKey: data.userKey },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message || 'Failed to fetch userKey', code: 500 });
  }
});

app.get('/api/session', async (req, res) => {
  const silent  = req.query.silent  === 'true' || req.query.silent  === '1';
  const refresh = req.query.refresh === 'true' || req.query.refresh === '1';

  try {
    const data = await keyFinder.getData(silent, refresh);
    res.json({
      status: true,
      data: {
        userKey:      data.userKey,
        headers:      data.headers,
        cookies:      data.cookies,
        cookieString: data.cookieString,
        cachedAt:     data.cachedAt,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message || 'Failed to fetch session', code: 500 });
  }
});

app.get('/api/session/status', async (req, res) => {
  try {
    if (!keyFinder.cachedData) {
      return res.json({ status: true, data: { cached: false, valid: false } });
    }

    const valid = await keyFinder.isKeyValid(keyFinder.cachedData.userKey);
    res.json({
      status: true,
      data: {
        cached:       true,
        valid,
        userKey:      keyFinder.cachedData.userKey.slice(0, 8) + '...',
        cachedAt:     keyFinder.cachedData.cachedAt,
        cookieCount:  keyFinder.cachedData.cookies?.length ?? 0,
        cookieNames:  keyFinder.cachedData.cookies?.map(c => c.name) ?? [],
      },
    });
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.delete('/api/session', (req, res) => {
  keyFinder.cachedData = null;
  res.json({ status: true, message: 'Session cache cleared.' });
});

app.get('/health', (req, res) => {
  res.json({
    status:      'OK',
    browserReady: browserService.isReady(),
    hasCachedSession: !!keyFinder.cachedData,
    timestamp:   new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 UserKey Solver API — http://localhost:${PORT}\n`);
  console.log(`  GET    /api/userKey           → userKey saja`);
  console.log(`  GET    /api/userKey?refresh=true → force refresh`);
  console.log(`  GET    /api/session           → userKey + headers + cookies`);
  console.log(`  GET    /api/session?refresh=true → force refresh`);
  console.log(`  GET    /api/session/status    → cek validitas cache`);
  console.log(`  DELETE /api/session           → hapus cache`);
  console.log(`  GET    /health\n`);
});

const express = require('express');
const BrowserService = require('./services/browser');
const KeyFinder = require('./services/keyFinder');

const PORT = process.env.PORT || 3000;

const app = express();
const browserService = new BrowserService();
const keyFinder = new KeyFinder(browserService);

app.use(express.json());

app.get('/api/userKey', async (req, res) => {
  try {
    const silent = req.query.silent === 'true' || req.query.silent === '1';
    const userKey = await keyFinder.getKey(silent); 
    res.json({ 
      status: true, 
      data: { userKey }, 
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(500).json({ 
      status: false, 
      error: error.message || "Failed to fetch userKey", 
      code: 500 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', browserReady: browserService.isReady(), timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  Get userKey    : GET /api/userKey`);
  console.log(`  Health Check   : GET /health`);
});

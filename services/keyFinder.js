const axios = require('axios');

class KeyFinder {
  constructor(browserService) {
    this.browserService = browserService;
    this.cachedKey = null; 
  }

  async getUrlData(silent) {
    if (!silent) console.log('[perchance-image-generator]: Finding a new key...');
    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();
      let foundKey = null;
      page.on('request', request => {
        const url = request.url();
        const match = url.match(/userKey=([a-f\d]{64})/);
        if (match) {
          foundKey = match[0];
        }
      });
      await page.goto('https://perchance.org/ai-text-to-image-generator', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      const frameElement = await page.waitForSelector('iframe[src]', { timeout: 30000 });
      const frame = await frameElement.contentFrame();
      await frame.waitForSelector('button#generateButtonEl', { timeout: 30000 });
      await frame.click('button#generateButtonEl');

      let attempts = 0;
      while (!foundKey && attempts < 60) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }

      if (!foundKey) {
        throw new Error("Failed to find userKey in network requests");
      }

      if (!silent) console.log('[perchance-image-generator]: Found a new key');
      return foundKey;
    });
  }

  async getKey(silent = false) {
    let isValid = false;
    if (this.cachedKey) {
      const verificationUrl = 'https://image-generation.perchance.org/api/checkVerificationStatus';
      const userKey = this.cachedKey.split('=')[1] || this.cachedKey;
      const cacheBust = Math.random();
      try {
        const response = await axios.get(verificationUrl, {
          params: { userKey, __cacheBust: cacheBust }
        });
        if (response.data.status !== 'not_verified') {
          isValid = true;
        }
      } catch (error) {
        console.error('[perchance-image-generator error]: Verifying key failed:', error.message);
      }
    }

    if (isValid && this.cachedKey) {
      if (!silent) console.log('[perchance-image-generator]: Valid key found in memory cache');
      return this.cachedKey.split('=')[1];
    }

    if (!silent && this.cachedKey) {
      console.log('[perchance-image-generator]: Key no longer valid. Finding a new key...');
    }

    const newKey = await this.getUrlData(silent);
    this.cachedKey = newKey; 
    return newKey.split('=')[1];
  }
}

module.exports = KeyFinder;
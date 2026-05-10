const axios = require('axios');

class KeyFinder {
  constructor(browserService) {
    this.browserService = browserService;
    this.cachedData     = null;
  }

 async _method1(silent) {
    if (!silent) console.log('[keyFinder] method 1: perchance.org + klik generate...');

    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();
      let foundKey     = null;
      let foundHeaders = null;

      page.on('request', async (request) => {
        const url   = request.url();
        const match = url.match(/userKey=([a-f\d]{64})/);
        if (match && !foundKey) {
          foundKey     = match[1];
          foundHeaders = await request.headers();
          if (!silent) console.log('[keyFinder] method 1: key ditemukan di request');
        }
      });

      await page.goto('https://perchance.org/ai-text-to-image-generator', {
        waitUntil: 'domcontentloaded',
        timeout:   30000,
      });

      const frameElement = await page.waitForSelector('iframe[src]', { timeout: 30000 });
      const frame        = await frameElement.contentFrame();
      await frame.waitForSelector('button#generateButtonEl', { timeout: 30000 });
      await frame.click('button#generateButtonEl');
      if (!silent) console.log('[keyFinder] method 1: tombol generate diklik, menunggu...');

      let attempts = 0;
      while (!foundKey && attempts < 60) {
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      }

      if (!foundKey) throw new Error('method 1: timeout — userKey tidak muncul dalam 30 detik');

      const cookies      = await page.cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const cleanHeaders = { ...(foundHeaders || {}) };
      delete cleanHeaders['content-length'];
      delete cleanHeaders['content-type'];

      if (!silent) console.log('[keyFinder] method 1: ✅ berhasil');
      return { userKey: foundKey, headers: cleanHeaders, cookies, cookieString };
    });
  }

  async _method2(embedUrl = 'https://image-generation.perchance.org/embed', thread = 0, timeout = 90000, silent) {
    if (!silent) console.log('[keyFinder] method 2: embed page + intercept verifyUser...');

    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();
      await page.setDefaultTimeout(30000);
      await page.setDefaultNavigationTimeout(30000);

      let userKey      = null;
      let foundHeaders = null;

      page.on('response', async (res) => {
        try {
          if (res.url().includes('/api/verifyUser') && !userKey) {
            const json = await res.json().catch(() => null);
            if (json?.userKey) {
              userKey      = json.userKey;
              foundHeaders = await res.request().headers();
              if (!silent) console.log('[keyFinder] method 2: userKey dari verifyUser response');
            }
          }
        } catch (_) {}
      });

      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const deadline = Date.now() + timeout;
      while (!userKey && Date.now() < deadline) {
        if (!userKey) {
          userKey = await page.evaluate((t) => {
            try { return localStorage.getItem('userKey-' + t) || localStorage.getItem('userKey'); }
            catch (_) { return null; }
          }, thread).catch(() => null);
        }
        if (!userKey) await new Promise(r => setTimeout(r, 500));
      }

      if (!userKey) throw new Error(`method 2: timeout — userKey tidak muncul setelah ${timeout}ms`);

      const cookies      = await page.cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      const cleanHeaders = { ...(foundHeaders || {}) };
      delete cleanHeaders['content-length'];
      delete cleanHeaders['content-type'];

      if (!silent) console.log('[keyFinder] method 2: ✅ berhasil');
      return { userKey, headers: cleanHeaders, cookies, cookieString };
    });
  }

  // ─── Cek validitas key ────────────────────────────────────────────────────

  async isKeyValid(userKey) {
    try {
      const res = await axios.get(
        'https://image-generation.perchance.org/api/checkVerificationStatus',
        { params: { userKey, __cacheBust: Math.random() }, timeout: 10000 }
      );
      return res.data.status !== 'not_verified';
    } catch {
      return false;
    }
  }

  async getData(silent = false, forceRefresh = false) {
    if (!forceRefresh && this.cachedData) {
      const valid = await this.isKeyValid(this.cachedData.userKey);
      if (valid) {
        if (!silent) console.log('[keyFinder] pakai cache (key masih valid)');
        return this.cachedData;
      }
      if (!silent) console.log('[keyFinder] key cache tidak valid, refresh...');
    }

    let data  = null;
    let error1 = null;

    try {
      data = await this._method1(silent);
    } catch (err) {
      error1 = err.message;
      console.warn(`[keyFinder] method 1 gagal: ${error1}`);
      console.warn('[keyFinder] mencoba method 2 sebagai fallback...');
    }

    if (!data) {
      try {
        data = await this._method2(undefined, 0, 90000, silent);
      } catch (err) {
        throw new Error(`Kedua method gagal.\n  method 1: ${error1}\n  method 2: ${err.message}`);
      }
    }

    this.cachedData = { ...data, cachedAt: new Date().toISOString() };
    return this.cachedData;
  }

  async getKey(silent = false) {
    const data = await this.getData(silent);
    return data.userKey;
  }
}

module.exports = KeyFinder;

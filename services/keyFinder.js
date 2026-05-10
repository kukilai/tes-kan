const axios = require('axios');

class KeyFinder {
  constructor(browserService) {
    this.browserService = browserService;
    this.cachedData     = null;
  }

  // ─── Method 1 ─────────────────────────────────────────────────────────────
  // Buka embed → tunggu Turnstile selesai (auto oleh puppeteer-real-browser)
  // → userKey muncul di request generate setelah klik

  async _method1(silent) {
    if (!silent) console.log('[keyFinder] method 1: embed + tunggu verify + klik generate...');

    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();

      let foundKey     = null;
      let foundHeaders = null;

      page.on('request', async (request) => {
        const match = request.url().match(/userKey=([a-f\d]{64})/);
        if (match && !foundKey) {
          foundKey     = match[1];
          foundHeaders = await request.headers();
          if (!silent) console.log('[keyFinder] method 1: key ditemukan di request');
        }
      });

      // networkidle = tunggu semua request selesai (termasuk Turnstile + verifyUser)
      await page.goto('https://image-generation.perchance.org/embed', {
        waitUntil: 'networkidle2',
        timeout:   90000,
      });

      // Tunggu button muncul dan tidak disabled
      await page.waitForSelector('button#generateButtonEl:not([disabled])', {
        timeout: 60000,
      });

      await page.click('button#generateButtonEl');
      if (!silent) console.log('[keyFinder] method 1: tombol diklik, menunggu request...');

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

  // ─── Method 2 ─────────────────────────────────────────────────────────────
  // Buka embed → intercept response verifyUser (dipanggil otomatis oleh page JS
  // setelah Turnstile diselesaikan puppeteer-real-browser)

  async _method2(embedUrl = 'https://image-generation.perchance.org/embed', thread = 0, timeout = 120000, silent) {
    if (!silent) console.log('[keyFinder] method 2: intercept verifyUser response...');

    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();
      await page.setDefaultTimeout(60000);
      await page.setDefaultNavigationTimeout(90000);

      let userKey      = null;
      let foundHeaders = null;

      // Intercept SEBELUM goto — jangan sampai miss response
      page.on('response', async (res) => {
        try {
          if (res.url().includes('/api/verifyUser') && !userKey) {
            const json = await res.json().catch(() => null);
            if (json?.userKey) {
              userKey      = json.userKey;
              foundHeaders = await res.request().headers().catch(() => ({}));
              if (!silent) console.log('[keyFinder] method 2: userKey dari verifyUser response');
            }
          }
        } catch (_) {}
      });

      // networkidle = tunggu Turnstile + verifyUser selesai
      await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: 90000 });

      // Kalau networkidle selesai tapi userKey belum dapat, polling sampai timeout
      const deadline = Date.now() + timeout;
      while (!userKey && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
      }

      if (!userKey) throw new Error(`method 2: timeout — verifyUser tidak mengembalikan userKey setelah ${timeout}ms`);

      const cookies      = await page.cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const cleanHeaders = { ...(foundHeaders || {}) };
      delete cleanHeaders['content-length'];
      delete cleanHeaders['content-type'];

      if (!silent) console.log('[keyFinder] method 2: ✅ berhasil');
      return { userKey, headers: cleanHeaders, cookies, cookieString };
    });
  }

  // ─── Reinit browser ───────────────────────────────────────────────────────

  async _reinitBrowser(silent) {
    if (!silent) console.log('[keyFinder] reinitializing browser...');
    try {
      await this.browserService.initialize();
      if (!silent) console.log('[keyFinder] browser reinitialized ✅');
    } catch (err) {
      console.warn('[keyFinder] reinit warning:', err.message);
    }
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

  // ─── getData ──────────────────────────────────────────────────────────────

  async getData(silent = false, forceRefresh = false) {
    if (!forceRefresh && this.cachedData) {
      const valid = await this.isKeyValid(this.cachedData.userKey);
      if (valid) {
        if (!silent) console.log('[keyFinder] pakai cache (key masih valid)');
        return this.cachedData;
      }
      if (!silent) console.log('[keyFinder] cache tidak valid, refresh...');
    }

    let data   = null;
    let error1 = null;

    try {
      data = await this._method1(silent);
    } catch (err) {
      error1 = err.message;
      console.warn(`[keyFinder] method 1 gagal: ${error1}`);
      await this._reinitBrowser(silent);
      console.warn('[keyFinder] mencoba method 2...');
    }

    if (!data) {
      try {
        data = await this._method2(undefined, 0, 120000, silent);
      } catch (err) {
        throw new Error(
          `Kedua method gagal.\n  method 1: ${error1}\n  method 2: ${err.message}`
        );
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

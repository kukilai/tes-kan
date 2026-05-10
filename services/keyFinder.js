const axios = require('axios');

class KeyFinder {
  constructor(browserService) {
    this.browserService = browserService;
    this.cachedData     = null;
  }

  // ─── Method 1 ─────────────────────────────────────────────────────────────
  // Buka embed → klik generate → tangkap userKey dari POST /api/generate
  // (sesuai embed code: generate request pakai userKey di query param)

  async _method1(silent) {
    if (!silent) console.log('[keyFinder] method 1: embed + klik generate...');

    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();

      let foundKey     = null;
      let foundHeaders = null;

      // Generate request: POST /api/generate?userKey=HEX64&...
      page.on('request', async (request) => {
        try {
          const url   = request.url();
          const match = url.match(/[?&]userKey=([a-f\d]{64})/);
          if (match && url.includes('/api/generate') && !foundKey) {
            foundKey     = match[1];
            foundHeaders = await request.headers();
            if (!silent) console.log('[keyFinder] method 1: userKey dari generate request');
          }
        } catch (_) {}
      });

      // 'load' = tunggu load event (semua resource selesai)
      await page.goto('https://image-generation.perchance.org/embed', {
        waitUntil: 'load',
        timeout:   60000,
      });

      // Tunggu button aktif — page harus selesai verifyUser dulu
      // sebelum button menjadi tidak disabled
      if (!silent) console.log('[keyFinder] method 1: menunggu button aktif...');
      await page.waitForFunction(() => {
        const btn = document.querySelector('button#generateButtonEl');
        return btn && !btn.disabled;
      }, { timeout: 60000, polling: 500 });

      await page.click('button#generateButtonEl');
      if (!silent) console.log('[keyFinder] method 1: tombol diklik, menunggu request...');

      // Tunggu generate request (max 30 detik)
      let attempts = 0;
      while (!foundKey && attempts < 60) {
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      }

      if (!foundKey) throw new Error('method 1: timeout — userKey tidak muncul di generate request');

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
  // Buka embed → intercept response /api/verifyUser → ambil userKey
  // Fallback: polling localStorage['userKey-{thread}'] setelah page selesai
  // (sesuai embed code: setelah verify sukses, disimpan ke localStorage)

  async _method2(embedUrl = 'https://image-generation.perchance.org/embed', timeout = 120000, silent) {
    if (!silent) console.log('[keyFinder] method 2: embed + intercept verifyUser response...');

    return await this.browserService.withBrowserContext(async (context) => {
      const page = await context.newPage();
      await page.setDefaultTimeout(60000);
      await page.setDefaultNavigationTimeout(60000);

      let userKey      = null;
      let foundHeaders = null;

      // Intercept SEBELUM goto — tangkap verifyUser response
      // Sesuai embed: response berisi {status:"success", userKey:"HEX64"}
      page.on('response', async (res) => {
        try {
          if (res.url().includes('/api/verifyUser') && !userKey) {
            const json = await res.json().catch(() => null);
            if (
              json &&
              (json.status === 'success' || json.status === 'already_verified') &&
              json.userKey
            ) {
              userKey      = json.userKey;
              foundHeaders = await res.request().headers().catch(() => ({}));
              if (!silent) console.log('[keyFinder] method 2: userKey dari verifyUser response');
            }
          }
        } catch (_) {}
      });

      await page.goto(embedUrl, { waitUntil: 'load', timeout: 60000 });

      // Polling: tunggu userKey dari intercept atau localStorage
      // puppeteer-real-browser (turnstile:true) handle Turnstile otomatis
      const deadline = Date.now() + timeout;
      while (!userKey && Date.now() < deadline) {
        // Fallback: baca localStorage sesuai embed code
        // embed menyimpan di localStorage['userKey-{window.thread}']
        const stored = await page.evaluate(() => {
          try {
            // Cek semua thread (0-3) sesuai maxThreadsPerUser
            for (let i = 0; i < 4; i++) {
              const k = localStorage.getItem('userKey-' + i);
              if (k && k.length === 64) return k;
            }
          } catch (_) {}
          return null;
        }).catch(() => null);

        if (stored) {
          userKey = stored;
          if (!silent) console.log('[keyFinder] method 2: userKey dari localStorage');
          break;
        }

        await new Promise(r => setTimeout(r, 500));
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
  // Sesuai embed: /api/checkUserVerificationStatus (bukan checkVerificationStatus)

  async isKeyValid(userKey) {
    try {
      const res = await axios.get(
        'https://image-generation.perchance.org/api/checkUserVerificationStatus',
        {
          params: {
            userKey,
            cacheKey: Math.round(Date.now() / (1000 * 3)),
          },
          timeout: 10000,
        }
      );
      // Sesuai embed: status 'verified' = valid, selain itu tidak valid
      return res.data.status === 'verified';
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
        data = await this._method2(undefined, 120000, silent);
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

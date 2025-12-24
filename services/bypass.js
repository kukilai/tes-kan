const fs = require('fs');
const path = require('path');

class BypassService {
  constructor(browserService) {
    this.browserService = browserService;
    this.fakePageContent = '';
    this.loadFakePage();
  }

  loadFakePage() {
    try {
      let fakePagePath = path.join(process.cwd(), "assets", "fakePage.html");

      if (!fs.existsSync(fakePagePath)) {
        fakePagePath = path.join(process.cwd(), "fakePage.html");
      }

      const assetsDir = path.dirname(fakePagePath);
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      if (!fs.existsSync(fakePagePath)) {
        this.fakePageContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title></title>
</head>
<body>
    <div class="turnstile"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback" defer></script>
    <script>
        window.onloadTurnstileCallback = function () {
            turnstile.render('.turnstile', {
                sitekey: '<site-key>',
                callback: function (token) {
                    var c = document.createElement('input');
                    c.type = 'hidden';
                    c.name = 'cf-response';
                    c.value = token;
                    document.body.appendChild(c);
                },
            });
        };
    </script>
</body>
</html>`;
        fs.writeFileSync(fakePagePath, this.fakePageContent);
      } else {
        this.fakePageContent = fs.readFileSync(fakePagePath, "utf-8");
      }
    } catch (error) {
      this.fakePageContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title></title>
</head>
<body>
    <div class="turnstile"></div>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback" defer></script>
    <script>
        window.onloadTurnstileCallback = function () {
            turnstile.render('.turnstile', {
                sitekey: '<site-key>',
                callback: function (token) {
                    var c = document.createElement('input');
                    c.type = 'hidden';
                    c.name = 'cf-response';
                    c.value = token;
                    document.body.appendChild(c);
                },
            });
        };
    </script>
</body>
</html>`;
    }
  }

  async wafSession(url, proxy, timeout = 60000) {
    const startTime = Date.now();
    try {
      if (!url) {
        throw new Error("Missing url parameter");
      }

      const result = await this.browserService.withBrowserContext(async (context) => {
        const page = await context.newPage();
        await page.setDefaultTimeout(30000);
        await page.setDefaultNavigationTimeout(30000);

        if (proxy?.username && proxy?.password) {
          await page.authenticate({
            username: proxy.username,
            password: proxy.password,
          });
        }

        const acceptLanguage = await this.findAcceptLanguage(page);
        await page.setRequestInterception(true);

        let resolved = false;
        return new Promise((resolve, reject) => {
          const timeoutHandler = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              reject(new Error("Timeout Error"));
            }
          }, timeout);

          page.on("request", async (request) => {
            try {
              await request.continue();
            } catch (e) {}
          });

          page.on("response", async (res) => {
            try {
              if (!resolved && [200, 302].includes(res.status()) && [url, url + "/"].includes(res.url())) {
                await page.waitForNavigation({ waitUntil: "load", timeout: 5000 }).catch(() => {});
                const cookies = await page.cookies();
                const headers = await res.request().headers();
                delete headers["content-type"];
                delete headers["accept-encoding"];
                delete headers["accept"];
                delete headers["content-length"];
                headers["accept-language"] = acceptLanguage;
                resolved = true;
                clearTimeout(timeoutHandler);
                resolve({ cookies, headers });
              }
            } catch (error) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeoutHandler);
                reject(error);
              }
            }
          });

          page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((error) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutHandler);
              reject(error);
            }
          });
        });
      });

      return {
        success: true,
        data: result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || "Unknown error",
        duration: Date.now() - startTime,
      };
    }
  }

  async solveTurnstileMin(url, siteKey, proxy, timeout = 60000) {
    const startTime = Date.now();
    try {
      if (!url || !siteKey) {
        throw new Error("Missing url or siteKey parameter");
      }

      const token = await this.browserService.withBrowserContext(async (context) => {
        const page = await context.newPage();

        if (proxy?.username && proxy?.password) {
          await page.authenticate({
            username: proxy.username,
            password: proxy.password,
          });
        }

        await page.setRequestInterception(true);

        page.on("request", async (request) => {
          if ([url, url + "/"].includes(request.url()) && request.resourceType() === "document") {
            await request.respond({
              status: 200,
              contentType: "text/html",
              body: this.fakePageContent.replace(/<site-key>/g, siteKey),
            });
          } else {
            await request.continue();
          }
        });

        await page.goto(url, {
          waitUntil: "domcontentloaded",
        });

        await page.waitForSelector('[name="cf-response"]', {
          timeout: timeout,
        });

        return page.evaluate(() => {
          try {
            return document.querySelector('[name="cf-response"]')?.value;
          } catch (e) {
            return null;
          }
        });
      });

      if (!token || token.length < 10) {
        throw new Error("Failed to get token");
      }

      return {
        success: true,
        data: token,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || "Unknown error",
        duration: Date.now() - startTime,
      };
    }
  }

  async solveTurnstileMax(url, proxy, timeout = 60000) {
    const startTime = Date.now();
    try {
      if (!url) {
        throw new Error("Missing url parameter");
      }

      const token = await this.browserService.withBrowserContext(async (context) => {
        const page = await context.newPage();
        await page.setDefaultTimeout(30000);
        await page.setDefaultNavigationTimeout(30000);

        if (proxy?.username && proxy?.password) {
          await page.authenticate({
            username: proxy.username,
            password: proxy.password,
          });
        }

        await page.evaluateOnNewDocument(() => {
          let token = null;
          async function waitForToken() {
            while (!token) {
              try {
                token = window.turnstile.getResponse();
              } catch (e) {}
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            const c = document.createElement("input");
            c.type = "hidden";
            c.name = "cf-response";
            c.value = token;
            document.body.appendChild(c);
          }
          waitForToken();
        });

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        await page.waitForSelector('[name="cf-response"]', { timeout });

        return page.evaluate(() => {
          try {
            return document.querySelector('[name="cf-response"]')?.value;
          } catch (e) {
            return null;
          }
        });
      });

      if (!token || token.length < 10) {
        throw new Error("Failed to get token");
      }

      return {
        success: true,
        data: token,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || "Unknown error",
        duration: Date.now() - startTime,
      };
    }
  }

  async getSource(url, proxy, timeout = 60000) {
    const startTime = Date.now();
    try {
      if (!url) {
        throw new Error("Missing url parameter");
      }

      const result = await this.browserService.withBrowserContext(async (context) => {
        const page = await context.newPage();
        await page.setDefaultTimeout(30000);
        await page.setDefaultNavigationTimeout(30000);

        if (proxy?.username && proxy?.password) {
          await page.authenticate({
            username: proxy.username,
            password: proxy.password,
          });
        }

        await page.setRequestInterception(true);

        let resolved = false;
        return new Promise((resolve, reject) => {
          const timeoutHandler = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              reject(new Error("Timeout Error"));
            }
          }, timeout);

          page.on("request", async (request) => {
            try {
              await request.continue();
            } catch (e) {}
          });

          page.on("response", async (res) => {
            try {
              if (!resolved && [200, 302].includes(res.status()) && [url, url + "/"].includes(res.url())) {
                await page.waitForNavigation({ waitUntil: "load", timeout: 5000 }).catch(() => {});
                const html = await page.content();
                resolved = true;
                clearTimeout(timeoutHandler);
                resolve(html);
              }
            } catch (error) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeoutHandler);
                reject(error);
              }
            }
          });

          page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((error) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutHandler);
              reject(error);
            }
          });
        });
      });

      return {
        success: true,
        data: result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || "Unknown error",
        duration: Date.now() - startTime,
      };
    }
  }

  async findAcceptLanguage(page) {
    try {
      return await page.evaluate(async () => {
        const result = await fetch("https://httpbin.org/get")
          .then((res) => res.json())
          .then((res) => res.headers["Accept-Language"] || res.headers["accept-language"])
          .catch(() => null);
        return result;
      });
    } catch (error) {
      return "en-US,en;q=0.9";
    }
  }

  getStats() {
    return this.browserService.getBrowserStats();
  }
}

module.exports = BypassService;
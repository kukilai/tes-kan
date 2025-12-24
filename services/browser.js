const { connect } = require('puppeteer-real-browser');
const os = require('os');

class BrowserService {
  constructor() {
    this.browser = null;
    this.browserContexts = new Set();
    this.cleanupTimer = null;
    this.isShuttingDown = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    const cpuCores = os.cpus().length;
    this.contextLimit = Math.max(cpuCores * 4, 16);
    this.cleanupInterval = 30000;
    this.contextTimeout = 300000;
    this.contextCreationTimes = new Map();
    
    this.stats = {
      totalContexts: 0,
      activeContexts: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastCleanup: Date.now(),
    };

    this.setupGracefulShutdown();
    this.startPeriodicCleanup();
  }

  async initialize(options = {}) {
    if (this.isShuttingDown) return;

    try {
      await this.closeBrowser();

      const defaultWidth = 1024;
      const defaultHeight = 768;
      const width = options.width || defaultWidth;
      const height = options.height || defaultHeight;

      const { browser } = await connect({
        headless: false,
        turnstile: true,
        connectOption: {
          defaultViewport: { width, height },
          timeout: 120000,
          protocolTimeout: 300000,
          args: [
            `--window-size=${width},${height}`,
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--disable-extensions",
            "--disable-sync",
            "--disable-translate",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
          ],
        },
        disableXvfb: false,
      });

      if (!browser) {
        throw new Error("Failed to connect to browser");
      }

      this.browser = browser;
      this.reconnectAttempts = 0;
      this.setupBrowserEventHandlers();
      this.wrapBrowserMethods();
    } catch (error) {
      if (this.reconnectAttempts < this.maxReconnectAttempts && !this.isShuttingDown) {
        this.reconnectAttempts++;
        await new Promise(resolve => setTimeout(resolve, 5000 * this.reconnectAttempts));
        return this.initialize(options);
      }
      throw error;
    }
  }

  setupBrowserEventHandlers() {
    if (!this.browser) return;

    this.browser.on("disconnected", async () => {
      if (this.isShuttingDown) return;
      await this.handleBrowserDisconnection();
    });

    this.browser.on("targetcreated", () => {
      this.updateStats();
    });

    this.browser.on("targetdestroyed", () => {
      this.updateStats();
    });
  }

  wrapBrowserMethods() {
    if (!this.browser) return;

    const originalCreateContext = this.browser.createBrowserContext.bind(this.browser);

    this.browser.createBrowserContext = async (...args) => {
      if (this.browserContexts.size >= this.contextLimit) {
        await this.forceCleanupOldContexts();

        if (this.browserContexts.size >= this.contextLimit) {
          throw new Error(`Browser context limit reached (${this.contextLimit})`);
        }
      }

      const context = await originalCreateContext(...args);

      if (context) {
        this.browserContexts.add(context);
        this.contextCreationTimes.set(context, Date.now());
        this.stats.totalContexts++;

        const originalClose = context.close.bind(context);
        context.close = async () => {
          try {
            await originalClose();
          } catch (error) {} finally {
            this.browserContexts.delete(context);
            this.contextCreationTimes.delete(context);
            this.updateStats();
          }
        };

        setTimeout(async () => {
          if (this.browserContexts.has(context)) {
            try {
              await context.close();
            } catch (error) {}
          }
        }, this.contextTimeout);
      }

      this.updateStats();
      return context;
    };
  }

  async handleBrowserDisconnection() {
    try {
      const cleanupPromises = Array.from(this.browserContexts).map(context => context.close().catch(() => {}));
      await Promise.allSettled(cleanupPromises);

      this.browserContexts.clear();
      this.contextCreationTimes.clear();

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await this.initialize();
      }
    } catch (error) {}
  }

  startPeriodicCleanup() {
    this.cleanupTimer = setInterval(async () => {
      if (this.isShuttingDown) return;
      try {
        await this.performCleanup();
        this.updateStats();
      } catch (error) {}
    }, this.cleanupInterval);
  }

  async performCleanup() {
    const now = Date.now();
    const contextsToCleanup = [];

    for (const [context, creationTime] of this.contextCreationTimes.entries()) {
      if (now - creationTime > this.contextTimeout) {
        contextsToCleanup.push(context);
      }
    }

    if (contextsToCleanup.length > 0) {
      const cleanupPromises = contextsToCleanup.map(context => context.close().catch(() => {}));
      await Promise.allSettled(cleanupPromises);
    }

    if (this.browserContexts.size > this.contextLimit * 0.8) {
      await this.forceCleanupOldContexts();
    }

    this.stats.lastCleanup = now;
  }

  async forceCleanupOldContexts() {
    const contextsArray = Array.from(this.browserContexts);
    const sortedContexts = contextsArray.sort((a, b) => {
      const timeA = this.contextCreationTimes.get(a) || 0;
      const timeB = this.contextCreationTimes.get(b) || 0;
      return timeA - timeB;
    });

    const toCleanup = sortedContexts.slice(0, Math.floor(sortedContexts.length * 0.3));

    if (toCleanup.length > 0) {
      const cleanupPromises = toCleanup.map(context => context.close().catch(() => {}));
      await Promise.allSettled(cleanupPromises);
    }
  }

  updateStats() {
    this.stats.activeContexts = this.browserContexts.size;
    this.stats.memoryUsage = process.memoryUsage().heapUsed;
    const usage = process.cpuUsage();
    this.stats.cpuUsage = (usage.user + usage.system) / 1000000;
  }

  async createContext(options = {}) {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error("Browser not available");
    }

    return await this.browser.createBrowserContext({
      ...options,
      ignoreHTTPSErrors: true,
    });
  }

  async withBrowserContext(callback) {
    let context = null;
    try {
      context = await this.createContext();
      return await callback(context);
    } finally {
      if (context) {
        try {
          await context.close();
        } catch (error) {}
      }
    }
  }

  getBrowserStats() {
    return { ...this.stats };
  }

  isReady() {
    return this.browser !== null && !this.isShuttingDown;
  }

  async closeBrowser() {
    if (this.browser) {
      try {
        const cleanupPromises = Array.from(this.browserContexts).map(context => context.close().catch(() => {}));
        await Promise.allSettled(cleanupPromises);

        this.browserContexts.clear();
        this.contextCreationTimes.clear();

        await this.browser.close();
      } catch (error) {} finally {
        this.browser = null;
      }
    }
  }

  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      this.isShuttingDown = true;

      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
      }

      await this.closeBrowser();
      process.exit(0);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  }

  async shutdown() {
    this.isShuttingDown = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    await this.closeBrowser();
  }
}

module.exports = BrowserService;
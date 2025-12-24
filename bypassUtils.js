class BypassUtils {
  static bypassService = null;

  static setBypassService(service) {
    this.bypassService = service;
  }

  static async solveBypass() {
    if (!this.bypassService) {
      throw new Error("Bypass service not initialized");
    }

    return {
      wafSession: async (url, proxy) => {
        const result = await this.bypassService.wafSession(url, proxy);
        if (!result.success) {
          throw new Error(result.error || "WAF session failed");
        }
        return result.data;
      },

      solveTurnstileMin: async (url, siteKey, proxy) => {
        const result = await this.bypassService.solveTurnstileMin(url, siteKey, proxy);
        if (!result.success) {
          throw new Error(result.error || "Turnstile solve failed");
        }
        return result.data;
      },

      solveTurnstileMax: async (url, proxy) => {
        const result = await this.bypassService.solveTurnstileMax(url, proxy);
        if (!result.success) {
          throw new Error(result.error || "Turnstile solve failed");
        }
        return result.data;
      },

      getSource: async (url, proxy) => {
        const result = await this.bypassService.getSource(url, proxy);
        if (!result.success) {
          throw new Error(result.error || "Get source failed");
        }
        return result.data;
      },
    };
  }
}

module.exports = BypassUtils;
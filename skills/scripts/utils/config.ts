/**
 * Configuration management utility
 */

export interface AgentConfig {
  // X API
  x: {
    bearerToken: string;
    userAccessToken: string;
  };

  // AgentMail
  agentmail: {
    apiKey: string;
    webhookSecret: string;
  };

  // OpenClaw
  openclaw: {
    baseUrl: string;
    hookToken: string;
  };

  // Redis (optional, for production persistence)
  redis?: {
    url: string;
  };

  // Campaign settings
  campaign?: {
    name: string;
    dailyDmLimit?: number;
    maxUsdPerDeal?: number;
    aboveMaxPct?: number;
  };
}

export class ConfigManager {
  private config: Partial<AgentConfig> = {};

  constructor(envVars?: Record<string, string>) {
    this.loadFromEnv(envVars);
  }

  private loadFromEnv(envVars?: Record<string, string>) {
    const env = envVars || process.env;

    this.config = {
      x: {
        bearerToken: env.X_BEARER_TOKEN || "",
        userAccessToken: env.X_USER_ACCESS_TOKEN || "",
      },
      agentmail: {
        apiKey: env.AGENTMAIL_API_KEY || "",
        webhookSecret: env.AGENTMAIL_WEBHOOK_SECRET || "",
      },
      openclaw: {
        baseUrl: env.OPENCLAW_BASE_URL || "",
        hookToken: env.OPENCLAW_HOOK_TOKEN || "",
      },
      redis: env.REDIS_URL
        ? { url: env.REDIS_URL }
        : undefined,
    };
  }

  /**
   * Validate required configuration
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config.x?.bearerToken) {
      errors.push("X_BEARER_TOKEN is required");
    }
    if (!this.config.agentmail?.apiKey) {
      errors.push("AGENTMAIL_API_KEY is required");
    }
    if (!this.config.openclaw?.baseUrl) {
      errors.push("OPENCLAW_BASE_URL is required");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): Partial<AgentConfig> {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AgentConfig>) {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Check if configuration is ready
   */
  isReady(): boolean {
    const validation = this.validate();
    return validation.valid;
  }
}

export const createConfigManager = (envVars?: Record<string, string>) =>
  new ConfigManager(envVars);

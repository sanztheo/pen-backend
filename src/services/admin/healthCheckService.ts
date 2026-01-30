/**
 * Health Check Service
 * Monitors critical services and returns comprehensive health status
 * Results cached in Redis for 30 seconds to prevent abuse and support horizontal scaling
 */

import { createClerkClient } from "@clerk/backend";

import { DatabaseHealthCheck } from "../../lib/dbHealthCheck.js";
import { getUptimeStats } from "../../lib/monitoring.js";
import { prismaEmbeddings } from "../../lib/prismaEmbeddings.js";
import { redisHealthCheck } from "../../lib/redis.js";
import { AIService } from "../ai/base.js";
import { paddle } from "../billing/paddleBilling.js";
import { redisCache } from "../cache/redisCache.js";

interface ServiceHealth {
  status: "up" | "degraded" | "down";
  latency?: number;
  error?: string;
}

interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: { seconds: number; formatted: string };
  services: {
    database: ServiceHealth;
    embeddingsDatabase: ServiceHealth;
    redis: ServiceHealth;
    clerk: ServiceHealth;
    openai: ServiceHealth;
    paddle: ServiceHealth;
  };
}

const LATENCY_THRESHOLDS = {
  database: 1000,
  redis: 100,
  clerk: 2000,
  openai: 3000,
  paddle: 2000,
} as const;

type ClerkClient = ReturnType<typeof createClerkClient>;

// Cache key constants
const CACHE_KEY = "health";
const CACHE_NAMESPACE = "admin";
const CACHE_TTL = 30; // 30 seconds

export class HealthCheckService {
  private static clerkClient: ClerkClient | null = null;

  private static getClerkClient(): ClerkClient {
    if (!this.clerkClient) {
      this.clerkClient = createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
    }
    return this.clerkClient;
  }

  /**
   * Get health status with Redis cache (30s TTL)
   * Uses getOrSet pattern for horizontal scaling support
   */
  static async getHealthStatus(): Promise<HealthCheckResponse> {
    return redisCache.getOrSet(CACHE_KEY, () => this.runHealthChecks(), {
      ttl: CACHE_TTL,
      namespace: CACHE_NAMESPACE,
    });
  }

  /**
   * Run all health checks in parallel
   * Called by getOrSet when cache miss
   */
  private static async runHealthChecks(): Promise<HealthCheckResponse> {
    console.log("[HEALTH_CHECK] Running fresh checks...");
    const startTime = Date.now();

    const [database, embeddingsDatabase, redis, clerk, openai, paddleHealth] =
      await Promise.all([
        this.checkDatabase(),
        this.checkEmbeddingsDatabase(),
        this.checkRedis(),
        this.checkClerk(),
        this.checkOpenAI(),
        this.checkPaddle(),
      ]);

    const services = {
      database,
      embeddingsDatabase,
      redis,
      clerk,
      openai,
      paddle: paddleHealth,
    };

    const overallStatus = this.computeOverallStatus(services);

    const result: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: getUptimeStats(),
      services,
    };

    console.log(
      `[HEALTH_CHECK] Completed in ${Date.now() - startTime}ms (status: ${overallStatus})`,
    );

    return result;
  }

  private static computeOverallStatus(
    services: HealthCheckResponse["services"],
  ): "healthy" | "degraded" | "unhealthy" {
    const statuses = Object.values(services).map((s) => s.status);
    if (statuses.includes("down")) return "unhealthy";
    if (statuses.includes("degraded")) return "degraded";
    return "healthy";
  }

  private static async checkDatabase(): Promise<ServiceHealth> {
    return this.withTiming("Database", async () => {
      const diagnostic = await DatabaseHealthCheck.runDiagnostic();

      if (diagnostic.status === "error") {
        return { status: "down", error: "Connection failed" };
      }
      if (diagnostic.status === "warning") {
        return { status: "degraded", error: "High latency" };
      }
      return { status: "up" };
    });
  }

  private static async checkEmbeddingsDatabase(): Promise<ServiceHealth> {
    return this.withTiming(
      "Embeddings DB",
      async () => {
        await prismaEmbeddings.$queryRaw`SELECT 1 as test`;
        return { status: "up" };
      },
      LATENCY_THRESHOLDS.database,
    );
  }

  private static async checkRedis(): Promise<ServiceHealth> {
    return this.withTiming(
      "Redis",
      async () => {
        const isHealthy = await redisHealthCheck();
        if (!isHealthy) {
          return { status: "down", error: "PING failed" };
        }
        return { status: "up" };
      },
      LATENCY_THRESHOLDS.redis,
    );
  }

  private static async checkClerk(): Promise<ServiceHealth> {
    if (!process.env.CLERK_SECRET_KEY) {
      return { status: "down", error: "CLERK_SECRET_KEY not configured" };
    }

    return this.withTiming("Clerk", async () => {
      await this.getClerkClient().users.getCount();
      return { status: "up" };
    });
  }

  private static async checkOpenAI(): Promise<ServiceHealth> {
    if (!AIService.isConfigured()) {
      return { status: "down", error: "OpenAI not configured" };
    }

    return this.withTiming(
      "OpenAI",
      async () => {
        const isConnected = await AIService.testConnection();
        if (!isConnected) {
          return { status: "down", error: "Connection test failed" };
        }
        return { status: "up" };
      },
      LATENCY_THRESHOLDS.openai,
    );
  }

  private static async checkPaddle(): Promise<ServiceHealth> {
    if (!process.env.PADDLE_API_KEY) {
      return { status: "degraded", error: "PADDLE_API_KEY not configured" };
    }

    return this.withTiming(
      "Paddle",
      async () => {
        await paddle.subscriptions.list({ perPage: 1 });
        return { status: "up" };
      },
      LATENCY_THRESHOLDS.paddle,
      (message) => {
        if (message.includes("API key") || message.includes("authentication")) {
          return { status: "degraded", error: "API key issue (sandbox?)" };
        }
        return { status: "down", error: message };
      },
    );
  }

  private static async withTiming(
    serviceName: string,
    fn: () => Promise<Omit<ServiceHealth, "latency">>,
    latencyThreshold?: number,
    customErrorHandler?: (message: string) => ServiceHealth,
  ): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      const result = await fn();
      const latency = Date.now() - startTime;

      if (
        latencyThreshold &&
        latency > latencyThreshold &&
        result.status === "up"
      ) {
        return { status: "degraded", latency, error: "High latency" };
      }

      return { ...result, latency };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[HEALTH_CHECK] ${serviceName} check failed:`, message);
      if (customErrorHandler) {
        return customErrorHandler(message);
      }
      return { status: "down", error: message };
    }
  }
}

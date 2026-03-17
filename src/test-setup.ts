/**
 * Jest Test Setup
 * Configuration globale pour tous les tests
 */

// Set required environment variables for tests
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-key";
process.env.NODE_ENV = "test";

// Paddle env vars required for module loading (betaAdmin integration tests)
process.env.PADDLE_ENVIRONMENT = process.env.PADDLE_ENVIRONMENT || "sandbox";
process.env.PADDLE_API_KEY = process.env.PADDLE_API_KEY || "test_paddle_key";
process.env.PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || "test_webhook_secret";
process.env.PRODUCT = process.env.PRODUCT || "pro_test_product";
process.env.PREMIUMMONTHLY = process.env.PREMIUMMONTHLY || "pri_test_monthly";
process.env.PREMIUMYEARLY = process.env.PREMIUMYEARLY || "pri_test_yearly";

/**
 * Jest Test Setup
 * Configuration globale pour tous les tests
 */

// Set required environment variables for tests
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-key";
process.env.NODE_ENV = "test";

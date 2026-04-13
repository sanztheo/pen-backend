/**
 * Jest Configuration for Quiz Intelligence Pipeline Tests
 * PEN-24: Tests et Benchmarks
 */

export default {
  // Use ts-jest for TypeScript support
  preset: "ts-jest/presets/default-esm",

  // Test environment
  testEnvironment: "node",

  // Module resolution
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  // Transform configuration
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "Bundler",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },

  // Test file patterns
  testMatch: [
    "**/src/**/__tests__/**/*.test.ts",
    "**/src/**/*.spec.ts",
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    // Vitest-based tests (use vi.mock / vi.fn) — incompatible with Jest ESM.
    // These will be migrated to vitest runner separately.
    "quiz-streaming/__tests__/(parameterResolver|intelligentGenerator|standardGenerator|pipelineCorrection|quizCompletionController|singleCorrectionController|sourceAnalyzer|sseFactory|sessionManager)\\.test\\.ts$",
    "__tests__/services/credits/dailyModelLimit\\.test\\.ts$",
    // Trash integration tests — require a real Postgres (Infisical dev env).
    // Not runnable in CI where DATABASE_URL is absent.
    "routes/__tests__/trash\\.test\\.ts$",
    "services/__tests__/trashService\\.test\\.ts$",
  ],

  // Coverage configuration
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    "!node_modules/**",
    "!dist/**",
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },

  // Output directory for coverage reports
  coverageDirectory: "coverage",

  // Verbose output
  verbose: true,

  // Timeout for tests (10 seconds)
  testTimeout: 10000,

  // Force exit after tests complete
  forceExit: true,

  // Detect open handles
  detectOpenHandles: true,

  // Clear mocks between tests
  clearMocks: true,

  // Setup files
  setupFiles: ["<rootDir>/src/test-setup.ts"],
  setupFilesAfterEnv: [],

  // Module directories
  moduleDirectories: ["node_modules", "src"],

  // Roots for tests
  roots: ["<rootDir>/src"],

  // Display name for test suites
  displayName: {
    name: "Quiz Intelligence",
    color: "blue",
  },
};

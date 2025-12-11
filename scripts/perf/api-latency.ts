/**
 * ⚡ Script de test de latence des API
 * 
 * Mesure le temps de réponse des endpoints principaux.
 * 
 * Usage: npx tsx scripts/perf/api-latency.ts [--iterations=10]
 */

import * as dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.API_URL || 'http://localhost:3001/api';
const DEFAULT_ITERATIONS = 10;

interface LatencyResult {
  endpoint: string;
  method: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  successRate: number;
  iterations: number;
}

async function measureLatency(
  endpoint: string, 
  method: string = 'GET',
  iterations: number = DEFAULT_ITERATIONS,
  headers: Record<string, string> = {},
  body?: object
): Promise<LatencyResult> {
  const times: number[] = [];
  let successes = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };
      
      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${BASE_URL}${endpoint}`, options);
      const end = performance.now();
      
      if (response.ok || response.status === 401) { // 401 is expected without auth
        times.push(end - start);
        successes++;
      }
    } catch (error) {
      // Connection error - still record the time
      const end = performance.now();
      times.push(end - start);
    }
  }

  // Calculate stats
  const sorted = times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95Index = Math.floor(times.length * 0.95);

  return {
    endpoint,
    method,
    avgMs: Math.round(avg * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    p95Ms: Math.round(sorted[p95Index] * 100) / 100,
    successRate: (successes / iterations) * 100,
    iterations
  };
}

function formatMs(ms: number): string {
  if (ms < 100) return `\x1b[32m${ms}ms\x1b[0m`; // Green
  if (ms < 500) return `\x1b[33m${ms}ms\x1b[0m`; // Yellow
  return `\x1b[31m${ms}ms\x1b[0m`; // Red
}

async function runLatencyTests() {
  console.log('\n' + '═'.repeat(70));
  console.log('⚡ TEST DE LATENCE API');
  console.log('═'.repeat(70));
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`📊 Itérations par test: ${DEFAULT_ITERATIONS}`);
  console.log('═'.repeat(70) + '\n');

  const endpoints = [
    { path: '/health', method: 'GET', description: 'Health Check' },
    { path: '/limits', method: 'GET', description: 'Get User Limits' },
    { path: '/workspaces', method: 'GET', description: 'List Workspaces' },
    { path: '/updates', method: 'GET', description: 'Get Updates' },
  ];

  const results: LatencyResult[] = [];

  for (const endpoint of endpoints) {
    process.stdout.write(`Testing ${endpoint.description}... `);
    const result = await measureLatency(endpoint.path, endpoint.method);
    results.push(result);
    console.log(`${formatMs(result.avgMs)} avg`);
  }

  // Print summary table
  console.log('\n' + '═'.repeat(70));
  console.log('📊 RÉSULTATS');
  console.log('═'.repeat(70));
  console.log(`${'Endpoint'.padEnd(25)} ${'AVG'.padStart(10)} ${'MIN'.padStart(10)} ${'MAX'.padStart(10)} ${'P95'.padStart(10)} ${'OK%'.padStart(8)}`);
  console.log('─'.repeat(70));
  
  for (const r of results) {
    const statusIcon = r.successRate === 100 ? '✅' : r.successRate > 50 ? '⚠️' : '❌';
    console.log(
      `${statusIcon} ${r.endpoint.padEnd(23)} ${formatMs(r.avgMs).padStart(20)} ${formatMs(r.minMs).padStart(20)} ${formatMs(r.maxMs).padStart(20)} ${formatMs(r.p95Ms).padStart(20)} ${r.successRate.toFixed(0).padStart(6)}%`
    );
  }

  // Performance summary
  console.log('\n' + '═'.repeat(70));
  console.log('📈 ANALYSE');
  console.log('═'.repeat(70));
  
  const avgAll = results.reduce((a, b) => a + b.avgMs, 0) / results.length;
  const slowest = results.reduce((a, b) => a.avgMs > b.avgMs ? a : b);
  const fastest = results.reduce((a, b) => a.avgMs < b.avgMs ? a : b);
  
  console.log(`🏆 Plus rapide: ${fastest.endpoint} (${fastest.avgMs}ms)`);
  console.log(`🐢 Plus lent: ${slowest.endpoint} (${slowest.avgMs}ms)`);
  console.log(`📊 Moyenne globale: ${avgAll.toFixed(2)}ms`);
  
  if (avgAll < 100) {
    console.log('✅ Performance: EXCELLENTE');
  } else if (avgAll < 300) {
    console.log('👍 Performance: BONNE');
  } else if (avgAll < 500) {
    console.log('⚠️ Performance: ACCEPTABLE');
  } else {
    console.log('❌ Performance: À AMÉLIORER');
  }

  console.log('═'.repeat(70) + '\n');
}

runLatencyTests().catch(console.error);

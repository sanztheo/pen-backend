/**
 * 🗄️ Script de test de performance des requêtes DB
 * 
 * Mesure le temps d'exécution des requêtes Prisma critiques.
 * 
 * Usage: npx tsx scripts/perf/db-queries.ts
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

interface QueryResult {
  name: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  iterations: number;
}

async function measureQuery<T>(
  name: string, 
  queryFn: () => Promise<T>,
  iterations: number = 10
): Promise<QueryResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await queryFn();
    const end = performance.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = times.sort((a, b) => a - b);

  return {
    name,
    avgMs: Math.round(avg * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    iterations
  };
}

function formatMs(ms: number): string {
  if (ms < 10) return `\x1b[32m${ms}ms\x1b[0m`; // Green
  if (ms < 50) return `\x1b[33m${ms}ms\x1b[0m`; // Yellow
  return `\x1b[31m${ms}ms\x1b[0m`; // Red
}

async function runDbPerfTests() {
  console.log('\n' + '═'.repeat(70));
  console.log('🗄️ TEST DE PERFORMANCE DATABASE');
  console.log('═'.repeat(70));
  console.log(`📊 Itérations par test: 10`);
  console.log('═'.repeat(70) + '\n');

  const results: QueryResult[] = [];

  // Warm up the connection
  console.log('🔥 Warming up connection...');
  await prisma.$queryRaw`SELECT 1`;
  console.log('✅ Connection ready\n');

  // Test 1: Simple SELECT
  process.stdout.write('Testing: Simple SELECT 1... ');
  results.push(await measureQuery(
    'SELECT 1',
    () => prisma.$queryRaw`SELECT 1`
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 2: Count users
  process.stdout.write('Testing: Count users... ');
  results.push(await measureQuery(
    'Count Users',
    () => prisma.user.count()
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 3: Find user with limits
  process.stdout.write('Testing: Find user with limits (join)... ');
  results.push(await measureQuery(
    'User + Limits Join',
    () => prisma.user.findFirst({
      include: {
        userLimits: true,
        subscription: true
      }
    })
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 4: Count workspaces
  process.stdout.write('Testing: Count workspaces... ');
  results.push(await measureQuery(
    'Count Workspaces',
    () => prisma.workspace.count()
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 5: List recent pages
  process.stdout.write('Testing: List 10 recent pages... ');
  results.push(await measureQuery(
    'List 10 Pages',
    () => prisma.page.findMany({
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true }
    })
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 6: Aggregate usage records
  process.stdout.write('Testing: Aggregate usage records... ');
  results.push(await measureQuery(
    'Aggregate Usage',
    () => prisma.usageRecord.aggregate({
      _sum: { quantity: true }
    })
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 7: Full text preparation (count quizzes with conditions)
  process.stdout.write('Testing: Complex WHERE query... ');
  results.push(await measureQuery(
    'Complex WHERE',
    () => prisma.quiz.count({
      where: {
        isCompleted: true,
        updatedAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      }
    })
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Test 8: Transaction simulation
  process.stdout.write('Testing: Transaction (3 queries)... ');
  results.push(await measureQuery(
    'Transaction (3 queries)',
    () => prisma.$transaction([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.page.count()
    ])
  ));
  console.log(formatMs(results[results.length - 1].avgMs));

  // Print summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 RÉSULTATS');
  console.log('═'.repeat(70));
  console.log(`${'Query'.padEnd(30)} ${'AVG'.padStart(12)} ${'MIN'.padStart(12)} ${'MAX'.padStart(12)}`);
  console.log('─'.repeat(70));
  
  for (const r of results) {
    console.log(
      `${r.name.padEnd(30)} ${formatMs(r.avgMs).padStart(22)} ${formatMs(r.minMs).padStart(22)} ${formatMs(r.maxMs).padStart(22)}`
    );
  }

  // Analysis
  console.log('\n' + '═'.repeat(70));
  console.log('📈 ANALYSE');
  console.log('═'.repeat(70));
  
  const avgAll = results.reduce((a, b) => a + b.avgMs, 0) / results.length;
  const slowest = results.reduce((a, b) => a.avgMs > b.avgMs ? a : b);
  const fastest = results.reduce((a, b) => a.avgMs < b.avgMs ? a : b);
  
  console.log(`🏆 Plus rapide: ${fastest.name} (${fastest.avgMs}ms)`);
  console.log(`🐢 Plus lent: ${slowest.name} (${slowest.avgMs}ms)`);
  console.log(`📊 Moyenne globale: ${avgAll.toFixed(2)}ms`);
  
  if (avgAll < 10) {
    console.log('✅ Performance DB: EXCELLENTE');
  } else if (avgAll < 30) {
    console.log('👍 Performance DB: BONNE');
  } else if (avgAll < 100) {
    console.log('⚠️ Performance DB: ACCEPTABLE');
  } else {
    console.log('❌ Performance DB: À AMÉLIORER');
  }

  // Recommendations
  if (slowest.avgMs > 50) {
    console.log(`\n💡 Recommandation: La requête "${slowest.name}" pourrait bénéficier d'un index.`);
  }

  console.log('═'.repeat(70) + '\n');

  await prisma.$disconnect();
}

runDbPerfTests().catch(console.error);

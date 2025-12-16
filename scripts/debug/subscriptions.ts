/**
 * 🔍 Script de debug des subscriptions
 * 
 * Usage: npx tsx scripts/debug/subscriptions.ts [userId]
 * 
 * Affiche les détails des subscriptions Clerk et leur état.
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function debugSubscriptions(userId?: string) {
  console.log('\n' + '═'.repeat(70));
  console.log('🔍 DEBUG: SUBSCRIPTIONS');
  console.log('═'.repeat(70));
  console.log(`📅 Date actuelle: ${new Date().toISOString()}`);
  console.log('═'.repeat(70) + '\n');

  try {
    const whereClause = userId ? { userId } : {};
    
    const subscriptions = await prisma.userSubscription.findMany({
      where: whereClause,
      include: {
        user: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (subscriptions.length === 0) {
      console.log('❌ Aucune subscription trouvée.');
      return;
    }

    // Statistiques globales
    const stats = {
      total: subscriptions.length,
      free: 0,
      premium: 0,
      active: 0,
      canceled: 0,
      pastDue: 0,
      trialing: 0,
      invalidDates: 0
    };

    for (const sub of subscriptions) {
      // Mise à jour des stats
      if (sub.plan === 'free_user') stats.free++;
      if (sub.plan === 'premium') stats.premium++;
      if (sub.status === 'active') stats.active++;
      if (sub.status === 'canceled') stats.canceled++;
      if (sub.status === 'past_due') stats.pastDue++;
      if (sub.status === 'trialing') stats.trialing++;
      
      // Vérifier dates invalides
      const isInvalidDate = sub.currentPeriodEnd && sub.currentPeriodEnd.getFullYear() < 2000;
      if (isInvalidDate) stats.invalidDates++;

      console.log('┌' + '─'.repeat(68) + '┐');
      console.log(`│ 👤 ${sub.user?.firstName || 'N/A'} ${sub.user?.lastName || ''} (${sub.user?.email || 'N/A'})`);
      console.log(`│ 🆔 ID: ${sub.userId}`);
      console.log('├' + '─'.repeat(68) + '┤');
      console.log(`│ 📋 Plan: ${sub.plan === 'premium' ? '⭐ Premium' : '🆓 Free'}`);
      console.log(`│ 📊 Status: ${getStatusEmoji(sub.status)} ${sub.status}`);
      console.log(`│ 📅 Période: ${sub.currentPeriodStart?.toLocaleDateString('fr-FR') || 'N/A'} → ${sub.currentPeriodEnd?.toLocaleDateString('fr-FR') || 'N/A'}`);
      
      if (isInvalidDate) {
        console.log(`│ ⚠️ DATE INVALIDE: ${sub.currentPeriodEnd?.toISOString()}`);
      }
      
      if (sub.cancelAtPeriodEnd) {
        console.log(`│ 🚫 Cancel at period end: OUI`);
      }
      
      if (sub.canceledAt) {
        console.log(`│ ❌ Annulé le: ${sub.canceledAt.toLocaleDateString('fr-FR')}`);
      }
      
      if (sub.trialStart && sub.trialEnd) {
        console.log(`│ 🎁 Trial: ${sub.trialStart.toLocaleDateString('fr-FR')} → ${sub.trialEnd.toLocaleDateString('fr-FR')}`);
      }
      
      if (sub.clerkSubscriptionId) {
        console.log(`│ 🔗 Clerk ID: ${sub.clerkSubscriptionId}`);
      }
      
      console.log(`│ 🕐 Créé: ${sub.createdAt.toLocaleString('fr-FR')}`);
      console.log(`│ 🔄 MAJ: ${sub.updatedAt.toLocaleString('fr-FR')}`);
      console.log('└' + '─'.repeat(68) + '┘\n');
    }

    // Afficher les statistiques
    console.log('═'.repeat(70));
    console.log('📊 STATISTIQUES');
    console.log('═'.repeat(70));
    console.log(`📋 Total subscriptions: ${stats.total}`);
    console.log(`🆓 Free: ${stats.free}`);
    console.log(`⭐ Premium: ${stats.premium}`);
    console.log('─'.repeat(70));
    console.log(`✅ Active: ${stats.active}`);
    console.log(`❌ Canceled: ${stats.canceled}`);
    console.log(`⚠️ Past Due: ${stats.pastDue}`);
    console.log(`🎁 Trialing: ${stats.trialing}`);
    
    if (stats.invalidDates > 0) {
      console.log('─'.repeat(70));
      console.log(`🚨 DATES INVALIDES: ${stats.invalidDates}`);
      console.log(`   → Exécuter: npx tsx scripts/fix/subscription-dates.ts`);
    }
    
    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    'active': '✅',
    'canceled': '❌',
    'past_due': '⚠️',
    'trialing': '🎁',
    'incomplete': '🔄',
    'incomplete_expired': '💀',
    'unpaid': '💸',
    'ended': '🔚'
  };
  return emojis[status] || '❓';
}

const userId = process.argv[2];
debugSubscriptions(userId).catch(console.error);

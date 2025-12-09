/**
 * 🔧 Script de correction des dates de subscription corrompues
 * 
 * Ce script corrige les subscriptions avec des dates invalides (comme 0001-01-01)
 * en les recalculant à partir de lastResetAt + 1 mois.
 * 
 * Usage: npx tsx scripts/fix-subscription-dates.ts [--dry-run]
 * 
 * Options:
 *   --dry-run : Affiche ce qui serait corrigé sans modifier la DB
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run');

async function fixSubscriptionDates() {
  console.log('\n' + '═'.repeat(70));
  console.log('🔧 CORRECTION DES DATES DE SUBSCRIPTION');
  console.log('═'.repeat(70));
  console.log(`📅 Date actuelle: ${new Date().toISOString()}`);
  console.log(`🧪 Mode: ${isDryRun ? '🔍 DRY-RUN (aucune modification)' : '⚠️ PRODUCTION (modifications réelles)'}`);
  console.log('═'.repeat(70) + '\n');

  try {
    // Récupérer toutes les subscriptions avec dates potentiellement invalides
    const subscriptions = await prisma.userSubscription.findMany({
      include: {
        user: {
          include: {
            userLimits: true
          }
        }
      }
    });

    let fixedCount = 0;
    const issues: string[] = [];

    for (const sub of subscriptions) {
      const currentPeriodEnd = sub.currentPeriodEnd;
      const currentPeriodStart = sub.currentPeriodStart;
      const lastResetAt = sub.user?.userLimits?.lastResetAt;

      // Vérifier si la date est invalide
      let needsFix = false;
      let reason = '';

      if (!currentPeriodEnd) {
        needsFix = true;
        reason = 'currentPeriodEnd est null';
      } else {
        const year = currentPeriodEnd.getFullYear();
        if (year < 2000 || year > 2100) {
          needsFix = true;
          reason = `currentPeriodEnd invalide: ${currentPeriodEnd.toISOString()} (année ${year})`;
        }
      }

      if (!currentPeriodStart) {
        needsFix = true;
        reason += (reason ? ' + ' : '') + 'currentPeriodStart est null';
      } else {
        const year = currentPeriodStart.getFullYear();
        if (year < 2000 || year > 2100) {
          needsFix = true;
          reason += (reason ? ' + ' : '') + `currentPeriodStart invalide: ${currentPeriodStart.toISOString()}`;
        }
      }

      if (needsFix) {
        console.log(`\n⚠️ PROBLÈME DÉTECTÉ:`);
        console.log(`   👤 ${sub.user?.firstName} ${sub.user?.lastName} (${sub.user?.email})`);
        console.log(`   🆔 userId: ${sub.userId}`);
        console.log(`   ❌ Raison: ${reason}`);
        console.log(`   📊 currentPeriodStart: ${currentPeriodStart?.toISOString() || 'null'}`);
        console.log(`   📊 currentPeriodEnd: ${currentPeriodEnd?.toISOString() || 'null'}`);
        console.log(`   📅 lastResetAt: ${lastResetAt?.toISOString() || 'null'}`);

        // Calculer les nouvelles dates
        const now = new Date();
        let newPeriodStart: Date;
        let newPeriodEnd: Date;

        // Utiliser lastResetAt comme référence si disponible, sinon utiliser maintenant
        if (lastResetAt && lastResetAt.getFullYear() >= 2000) {
          newPeriodStart = new Date(lastResetAt);
        } else {
          newPeriodStart = now;
        }

        // Calculer la fin de période (1 mois après le début)
        newPeriodEnd = new Date(newPeriodStart);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

        // Si la période est déjà passée, recalculer à partir d'aujourd'hui
        if (newPeriodEnd < now) {
          newPeriodStart = now;
          newPeriodEnd = new Date(now);
          newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
        }

        console.log(`   ✅ Nouvelle currentPeriodStart: ${newPeriodStart.toISOString()}`);
        console.log(`   ✅ Nouvelle currentPeriodEnd: ${newPeriodEnd.toISOString()}`);

        issues.push(`${sub.user?.email}: ${reason}`);

        if (!isDryRun) {
          // Appliquer la correction
          await prisma.userSubscription.update({
            where: { id: sub.id },
            data: {
              currentPeriodStart: newPeriodStart,
              currentPeriodEnd: newPeriodEnd
            }
          });
          console.log(`   💾 Correction appliquée !`);
          fixedCount++;
        } else {
          console.log(`   🔍 [DRY-RUN] Correction simulée`);
          fixedCount++;
        }
      }
    }

    // Résumé
    console.log('\n' + '═'.repeat(70));
    console.log('📊 RÉSUMÉ');
    console.log('═'.repeat(70));
    console.log(`📋 Subscriptions analysées: ${subscriptions.length}`);
    console.log(`⚠️ Problèmes détectés: ${issues.length}`);
    
    if (isDryRun) {
      console.log(`🔍 Mode DRY-RUN: ${fixedCount} correction(s) simulée(s)`);
      console.log(`\n💡 Pour appliquer les corrections, relancez sans --dry-run:`);
      console.log(`   npx tsx scripts/fix-subscription-dates.ts`);
    } else {
      console.log(`✅ Corrections appliquées: ${fixedCount}`);
    }

    if (issues.length > 0) {
      console.log('\n📝 Liste des problèmes:');
      issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
    }

    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixSubscriptionDates().catch(console.error);

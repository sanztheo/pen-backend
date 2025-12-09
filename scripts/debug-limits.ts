/**
 * 🔍 Script de debug des limitations utilisateur
 * 
 * Usage: npx tsx scripts/debug-limits.ts [userId]
 * 
 * Sans userId, affiche toutes les données pour tous les utilisateurs.
 * Avec userId, affiche les détails pour un utilisateur spécifique.
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config();

const prisma = new PrismaClient();

async function debugLimits(userId?: string) {
  console.log('\n' + '═'.repeat(70));
  console.log('🔍 DEBUG: LIMITATIONS & RESET');
  console.log('═'.repeat(70));
  console.log(`📅 Date actuelle: ${new Date().toISOString()}`);
  console.log(`🕐 Heure locale: ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
  console.log('═'.repeat(70) + '\n');

  try {
    // Récupérer les données
    const whereClause = userId ? { id: userId } : {};
    
    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        subscription: true,
        userLimits: true,
      },
      take: userId ? 1 : 10, // Limiter à 10 utilisateurs si pas de filtre
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (users.length === 0) {
      console.log('❌ Aucun utilisateur trouvé.');
      return;
    }

    for (const user of users) {
      console.log('┌' + '─'.repeat(68) + '┐');
      console.log(`│ 👤 ${user.firstName} ${user.lastName} (${user.email})`);
      console.log(`│ 🆔 ID: ${user.id}`);
      console.log('├' + '─'.repeat(68) + '┤');

      // Subscription info
      if (user.subscription) {
        const sub = user.subscription;
        console.log('│ 📋 ABONNEMENT:');
        console.log(`│    Plan: ${sub.plan === 'premium' ? '⭐ Premium' : '🆓 Free'}`);
        console.log(`│    Status: ${sub.status}`);
        console.log(`│    Période début: ${sub.currentPeriodStart?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) || '❓ Non défini'}`);
        console.log(`│    Période fin: ${sub.currentPeriodEnd?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) || '❓ Non défini'}`);
        console.log(`│    Cancel at period end: ${sub.cancelAtPeriodEnd ? '⚠️ Oui' : '✅ Non'}`);
        
        // Calculer le temps restant jusqu'au reset
        if (sub.currentPeriodEnd) {
          const now = new Date();
          const endDate = new Date(sub.currentPeriodEnd);
          const diffMs = endDate.getTime() - now.getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          
          if (diffMs > 0) {
            console.log(`│    ⏳ Temps avant reset: ${diffDays}j ${diffHours}h`);
          } else {
            console.log(`│    🔄 Reset en retard de: ${Math.abs(diffDays)}j ${Math.abs(diffHours)}h`);
          }
        }
      } else {
        console.log('│ ⚠️ ABONNEMENT: Non défini!');
      }

      console.log('├' + '─'.repeat(68) + '┤');

      // UserLimits info
      if (user.userLimits) {
        const limits = user.userLimits;
        console.log('│ 📊 LIMITATIONS:');
        console.log(`│    AI Credits: ${limits.aiCreditsUsed}/${limits.aiCreditsLimit === -1 ? '∞' : limits.aiCreditsLimit}`);
        console.log(`│    Workspaces: ${limits.workspacesUsed}/${limits.workspacesLimit === -1 ? '∞' : limits.workspacesLimit}`);
        console.log(`│    Projects: ${limits.projectsUsed}/${limits.projectsLimit === -1 ? '∞' : limits.projectsLimit}`);
        console.log(`│    Custom Quizzes: ${limits.customQuizzesUsed}/${limits.customQuizzesLimit === -1 ? '∞' : limits.customQuizzesLimit}`);
        console.log(`│    Preset Sequences: ${limits.presetSequencesUsed}/${limits.presetSequencesLimit === -1 ? '∞' : limits.presetSequencesLimit}`);
        console.log(`│    Advanced Quizzes: ${limits.advancedQuizzesUsed}/${limits.advancedQuizzesLimit === -1 ? '∞' : limits.advancedQuizzesLimit}`);
        
        console.log('├' + '─'.repeat(68) + '┤');
        console.log('│ 🔄 INFO RESET:');
        console.log(`│    Type de reset: ${limits.resetType}`);
        console.log(`│    Dernier reset (lastResetAt): ${limits.lastResetAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
        console.log(`│    Advanced quiz reset: ${limits.advancedQuizzesResetAt?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) || '❓ Jamais utilisé'}`);
        
        // Calculer la prochaine date de reset basée sur lastResetAt + 1 mois
        const nextResetFromLimits = new Date(limits.lastResetAt);
        nextResetFromLimits.setMonth(nextResetFromLimits.getMonth() + 1);
        console.log(`│    Prochain reset estimé (lastResetAt + 1 mois): ${nextResetFromLimits.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
        
        // Si subscription a currentPeriodEnd, comparer
        if (user.subscription?.currentPeriodEnd) {
          const subReset = new Date(user.subscription.currentPeriodEnd);
          console.log(`│    Date reset subscription (currentPeriodEnd): ${subReset.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
          
          // Vérifier cohérence
          const diffMs = Math.abs(subReset.getTime() - nextResetFromLimits.getTime());
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          if (diffDays > 7) {
            console.log(`│    ⚠️ INCOHÉRENCE: ${diffDays.toFixed(1)} jours d'écart entre les dates de reset!`);
          } else {
            console.log(`│    ✅ Dates cohérentes (écart: ${diffDays.toFixed(1)} jours)`);
          }
        }
        
        console.log(`│    Created: ${limits.createdAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
        console.log(`│    Updated: ${limits.updatedAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
      } else {
        console.log('│ ⚠️ LIMITATIONS: Non définies!');
      }

      console.log('└' + '─'.repeat(68) + '┘\n');
    }

    // Afficher un résumé
    console.log('═'.repeat(70));
    console.log('📊 RÉSUMÉ GLOBAL');
    console.log('═'.repeat(70));
    
    const totalUsers = await prisma.user.count();
    const usersWithLimits = await prisma.userLimits.count();
    const usersWithSubscription = await prisma.userSubscription.count();
    
    console.log(`👥 Total utilisateurs: ${totalUsers}`);
    console.log(`📊 Avec limites: ${usersWithLimits}`);
    console.log(`💳 Avec subscription: ${usersWithSubscription}`);
    
    // Vérifier les incohérences globales
    const usersWithoutLimits = await prisma.user.count({
      where: {
        userLimits: null
      }
    });
    
    const usersWithoutSubscription = await prisma.user.count({
      where: {
        subscription: null
      }
    });
    
    if (usersWithoutLimits > 0) {
      console.log(`⚠️ Utilisateurs sans limites: ${usersWithoutLimits}`);
    }
    
    if (usersWithoutSubscription > 0) {
      console.log(`⚠️ Utilisateurs sans subscription: ${usersWithoutSubscription}`);
    }
    
    // Vérifier les resets en retard
    const now = new Date();
    const usersNeedingReset = await prisma.userSubscription.count({
      where: {
        currentPeriodEnd: {
          lt: now
        }
      }
    });
    
    if (usersNeedingReset > 0) {
      console.log(`🔄 Utilisateurs avec reset en retard: ${usersNeedingReset}`);
    }

    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Récupérer l'userId depuis les arguments
const userId = process.argv[2];

debugLimits(userId).catch(console.error);

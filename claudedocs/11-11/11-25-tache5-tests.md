# Tâche 5 : Tests et validation du nouveau flux

## 🎯 Objectif
Valider que le nouveau flux Coordinator → Planner → Executor → Scorer fonctionne correctement et qu'il n'y a pas de régression par rapport à l'ancien système Phase1.

## 📋 Étapes à suivre

### 1. Compilation TypeScript

**Commande** : `npx tsc --noEmit`

**Vérifications** :
- [ ] Aucune erreur TypeScript
- [ ] Tous les types sont correctement exportés
- [ ] Les imports sont valides

### 2. Tests manuels de base

#### Test 1 : Mode Ask (question simple)
**Requête** : "Quelles sont les dernières nouvelles sur l'IA ?"
**Attendu** :
- Plan généré avec 2-8 tools
- Validation du plan réussie
- Exécution des tools (probablement search_web_tavily)
- Score des résultats
- Réponse finale cohérente

**Commande de test** :
```bash
# Créer une conversation dans l'interface
# Envoyer la requête
# Observer les logs console
```

**Logs à vérifier** :
```
🎯 [COORDINATOR] Démarrage orchestration
🎯 [COORDINATOR] Plan généré: X tools
✅ [COORDINATOR] Plan validé
🎯 [COORDINATOR] Exécution step 1/X: [tool_name]
✅ [COORDINATOR] Orchestration terminée: X tools exécutés
```

#### Test 2 : Mode Search (recherche approfondie)
**Requête** : "Fais une recherche approfondie sur les LLM open source"
**Attendu** :
- Plan généré avec 5-15 tools minimum
- list_available_sources appelé
- Plusieurs sources lues
- Synthèse finale

**Logs à vérifier** :
```
🎯 [COORDINATOR] Plan généré: 8 tools (par exemple)
🎯 [COORDINATOR] Exécution step 1/8: list_available_sources
🎯 [COORDINATOR] Exécution step 2/8: read_rag_source
...
```

#### Test 3 : Mode Create (génération de contenu)
**Requête** : "Crée-moi un résumé des 3 derniers articles sur l'IA"
**Attendu** :
- Plan avec 2-8 tools (create_rapide)
- Sources extraites
- Génération de contenu structuré

### 3. Validation de la logique métier

#### Vérifier les callbacks
- [ ] `onThinking` est appelé pendant le planning
- [ ] `onToolCall` est appelé pour chaque tool
- [ ] `onToolResult` est appelé avec les résultats
- [ ] `onIntermediateThinking` est appelé pendant l'exécution

#### Vérifier les scores
- [ ] Chaque tool a un score dans le résultat final
- [ ] Les scores sont cohérents (0-1)
- [ ] Les scores bas génèrent un warning mais ne bloquent pas

#### Vérifier la validation
- [ ] Plans valides sont acceptés
- [ ] Plans invalides (ex: 2 tools en mode search) sont rejetés
- [ ] Warnings s'affichent mais n'empêchent pas l'exécution
- [ ] Seules les erreurs CRITIQUES bloquent

### 4. Tests de régression

**Comparer avec l'ancien système** :
- [ ] Le nombre de tools générés est similaire ou meilleur
- [ ] La qualité des réponses est maintenue
- [ ] Les temps d'exécution sont acceptables
- [ ] Pas de crash ou d'erreurs non gérées

**Scénarios de test** :
1. Question simple → réponse rapide
2. Recherche approfondie → plusieurs sources
3. Génération de contenu → structuration correcte
4. Sources pré-sélectionnées → pas de blocage

### 5. Vérification des erreurs

#### Scénario 1 : Source invalide
**Action** : Forcer un sourceId inexistant
**Attendu** : Warning mais pas de blocage (sauf si CRITIQUE)

#### Scénario 2 : Timeout d'un tool
**Action** : Simuler un timeout
**Attendu** : Erreur catchée, orchestration continue

#### Scénario 3 : Score très faible
**Action** : Observer un résultat de mauvaise qualité
**Attendu** : Warning "Score très faible (< 0.3), mais on continue"

### 6. Nettoyage optionnel

**Si tout fonctionne** :
- [ ] Déprécier `Phase1Service.executeMultiPhaseFunctionCalling()`
- [ ] Ajouter un commentaire `@deprecated` dans le code
- [ ] Garder le fichier pour référence historique

**Ne PAS supprimer** :
- Phase1Service (garder pour rollback si problème)
- Les anciens tests (ils peuvent être adaptés plus tard)

## ✅ Critères de validation

- [ ] `npx tsc --noEmit` passe sans erreur
- [ ] Test Ask : Réponse cohérente avec 2-8 tools
- [ ] Test Search : Plan avec minimum 5 tools, sources extraites
- [ ] Test Create : Contenu généré structuré
- [ ] Callbacks appelés correctement (onThinking, onToolCall, etc.)
- [ ] Scores calculés pour chaque tool
- [ ] Validation stricte mais pas bloquante (warnings vs errors)
- [ ] Pas de régression par rapport à Phase1
- [ ] Logs structurés avec emojis 🎯✅❌⚠️
- [ ] Gestion des erreurs propre (pas de crash)

## ⚠️ Rollback si problème

Si un test critique échoue :
1. Revenir aux handlers avec Phase1Service
2. Investiguer le problème dans les nouveaux services
3. Fixer et re-tester avant migration définitive

**Commande de rollback** :
```bash
git checkout src/controllers/assistant/handlers/*.ts
```

## 📝 Notes

- Cette tâche valide TOUT le travail des Tâches 1-4
- C'est le moment de vérité de la refactorisation
- Prenez le temps de bien tester chaque scénario
- Documentez tout problème découvert
- Si succès : Phase1Service peut être déprécié mais gardé

## 🎓 Apprentissages attendus

Après cette tâche, vous devriez comprendre :
- Comment le Coordinator orchestre Planner → Executor → Scorer
- Comment les plans sont validés et exécutés
- Comment les erreurs sont gérées dans le nouveau système
- Les différences de comportement entre Phase1 et la nouvelle archi

## 🚀 Prochaines étapes (hors scope)

Si tout fonctionne bien :
- Tests unitaires pour PlannerService
- Tests unitaires pour ExecutorService
- Tests unitaires pour CoordinatorService
- Tests d'intégration automatisés
- Documentation utilisateur mise à jour

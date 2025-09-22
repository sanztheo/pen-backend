# 🧪 TESTS DE SCALABILITÉ - PEN-SAAS BACKEND

**Version** : 2.0 (Sept 2025)  
**Objectif** : Vérifier la robustesse pour 1000+ utilisateurs simultanés  

---

## 🎯 TESTS OBLIGATOIRES

### 1. **Tests Base de Données PostgreSQL**

#### ✅ Test UPSERT Atomique Crédits IA
```bash
# Test de charge sur les crédits IA
curl -X POST "http://localhost:3001/api/ai/ask" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'

# Vérifier dans les logs : pas de deadlocks
tail -f logs/server-*.log | grep "DEADLOCK\|P2034\|timeout"
```

#### ✅ Test Timeouts Prisma
```bash
# Exécuter plusieurs transactions simultanées
for i in {1..50}; do
  curl -X POST "http://localhost:3001/api/quiz/generate" \
    -H "Authorization: Bearer YOUR_JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"topic": "test'$i'"}' &
done
wait

# Vérifier : pas de timeouts après 30s
grep -i "timeout\|P2034" logs/server-*.log
```

### 2. **Tests WebSocket Y.js**

#### ✅ Test Auto-cleanup Documents
```bash
# Script de test auto-cleanup
node -e "
const WebSocket = require('ws');
const pageId = 'test-page-id';

// Connexion 1
const ws1 = new WebSocket(\`ws://localhost:3001/ws/collaboration/\${pageId}?token=YOUR_JWT_TOKEN\`);

setTimeout(() => {
  // Fermer connexion 1
  ws1.close();
  console.log('✅ Connexion fermée - vérifier logs pour cleanup automatique');
}, 2000);
"

# Vérifier dans les logs
tail -f logs/server-*.log | grep "Document supprimé de la mémoire"
```

#### ✅ Test Limitation Payload (1MB)
```bash
# Test message trop volumineux
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3001/ws/collaboration/test?token=YOUR_JWT_TOKEN');

ws.on('open', () => {
  // Envoyer un message > 1MB
  const largePayload = Buffer.alloc(2 * 1024 * 1024, 'x'); // 2MB
  ws.send(largePayload);
});

ws.on('close', (code) => {
  console.log('✅ Connexion fermée avec code:', code); // Doit être 1009
});
"
```

### 3. **Tests Authentification & Sécurité**

#### ✅ Test JWT Validation WebSocket
```bash
# Test connexion sans token
curl -i --include \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:3001/ws/collaboration/test

# Doit retourner connexion fermée
```

#### ✅ Test Ownership Validation
```bash
# Tenter d'accéder à une page d'un autre utilisateur
curl -X GET "http://localhost:3001/api/pages/OTHER_USER_PAGE_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Doit retourner 403 Forbidden
```

### 4. **Tests Performance & Memory**

#### ✅ Test Memory Usage WebSocket
```bash
# Monitorer l'usage mémoire
while true; do
  ps aux | grep "node.*index.js" | grep -v grep
  sleep 10
done

# Observer : pas d'augmentation continue de la mémoire
```

#### ✅ Test Connexions Multiples
```bash
# Simuler 100 connexions simultanées
for i in {1..100}; do
  node -e "
    const WebSocket = require('ws');
    const ws = new WebSocket('ws://localhost:3001/ws/collaboration/test-$i?token=YOUR_JWT_TOKEN');
    setTimeout(() => ws.close(), 5000);
  " &
done
wait

# Vérifier : toutes les connexions sont nettoyées après 5s
```

---

## 🔥 TESTS DE CHARGE (OPTIONNELS)

### Load Testing avec Artillery
```bash
# Installer artillery
npm install -g artillery

# Test de charge API
artillery quick --count 100 --num 50 http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test de charge WebSocket
artillery run artillery-websocket.yml
```

### Artillery Config (`artillery-websocket.yml`)
```yaml
config:
  target: ws://localhost:3001
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "WebSocket Collaboration"
    engine: ws
    flow:
      - connect:
          url: "/ws/collaboration/test-{{$uuid}}?token=YOUR_JWT_TOKEN"
      - think: 5
      - send: "test message"
      - think: 10
```

---

## 📊 MÉTRIQUES À SURVEILLER

### ✅ Base de Données
- **Connexions Prisma** : `SELECT count(*) FROM pg_stat_activity;`
- **Deadlocks** : `SELECT deadlocks FROM pg_stat_database WHERE datname = 'votre_db';`
- **Temps de réponse** : < 200ms pour requêtes simples

### ✅ WebSocket
- **Connexions actives** : Logs WebSocket
- **Documents en mémoire** : Logs Y.js cleanup
- **Erreurs payload** : Messages "trop volumineux"

### ✅ Système
- **RAM Usage** : < 2GB par instance
- **CPU Usage** : < 80% en charge normale
- **Logs d'erreur** : Pas d'erreurs critiques récurrentes

---

## 🚨 INDICATEURS D'ALERTE

### ❌ Problèmes Critiques
- Logs d'erreur `DEADLOCK` ou `P2034` 
- Memory leaks (RAM qui augmente constamment)
- WebSocket connexions qui ne se ferment pas
- Timeouts fréquents > 30s

### ✅ Système Sain
- Auto-cleanup documents Y.js fonctionnel
- Limitation payload 1MB respectée
- JWT validation active sur tous les endpoints
- Pas de memory leaks détectés

---

## 🛡️ CHECKLIST POST-TESTS

- [ ] Aucun deadlock dans les logs BDD
- [ ] Auto-cleanup WebSocket fonctionnel  
- [ ] Limitation payload 1MB active
- [ ] JWT validation sur tous les endpoints
- [ ] Memory usage stable après tests
- [ ] Tous les tests de charge passés
- [ ] Aucune erreur critique dans les logs

**Status** : ✅ **PRÊT PRODUCTION** si tous les tests passent !

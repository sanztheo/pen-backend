# Explication des commandes Git utilisées pour créer une Pull Request

Voici une explication simple de chaque commande que je vous ai indiquée pour créer une Pull Request (PR) :

### 1. `git checkout main`
- Cette commande vous place sur la branche `main`, qui est généralement la branche principale de votre projet.
- Ça signifie que vous travaillez maintenant à partir de cette branche.

### 2. `git pull origin main`
- Met à jour votre branche `main` locale avec les dernières modifications qui sont sur le dépôt distant `origin`.
- Permet de synchroniser votre travail local avec ce qui est sur GitHub (ou autre serveur).

### 3. `git checkout -b feature/nom-de-votre-fonctionnalité`
- Crée une nouvelle branche locale nommée `feature/nom-de-votre-fonctionnalité` et bascule dessus.
- L'option `-b` est un raccourci pour "créer puis changer de branche".
- Cela vous permet de travailler sur une fonctionnalité sans modifier directement la branche `main`.

### 4. `git add .`
- Ajoute tous les fichiers modifiés et nouveaux dans l'index (zone de préparation) en vue d'un commit.
- Prépare les fichiers pour qu'ils soient inclus dans le prochain commit.

### 5. `git commit -m "message"`
- Enregistre vos changements dans l'historique Git avec un message résumant les modifications.
- Ce message doit être clair pour expliquer ce que vous avez modifié.

### 6. `git push -u origin feature/nom-de-votre-fonctionnalité`
- Envoie votre branche locale `feature/nom-de-votre-fonctionnalité` vers le dépôt distant (GitHub).
- L'option `-u` configure cette branche locale pour suivre la branche distante, facilitant les futurs `git push` et `git pull`.

### Ensuite, sur GitHub
- Vous créez la Pull Request via l'interface GitHub pour demander à intégrer votre branche dans la branche principale.

Chaque commande est une étape pour gérer vos modifications **sans toucher directement à la branche principale**, ce qui est une bonne pratique pour le travail collaboratif et la revue de code.[1][2][3]

[1](https://git-scm.com/docs/git-checkout/fr)
[2](https://www.atlassian.com/fr/git/tutorials/using-branches/git-checkout)
[3](https://www.ionos.fr/digitalguide/sites-internet/developpement-web/git-checkout/)
[4](https://www.sfeir.dev/product/draft-les-commande-git/)
[5](https://librecours.net/modules/git/git01/solweb/co/git01co09.html)
[6](https://www.atlassian.com/fr/git/glossary)
[7](https://www.varonis.com/fr/blog/git-branching)
[8](https://blog.stephane-robert.info/docs/developper/version/git/)
[9](https://www.hostinger.com/fr/tutoriels/commandes-git)
[10](https://grafikart.fr/tutoriels/checkout-revert-reset-586)
# Cookies et entreprises dans Protection

Mise à jour 0.8.0 (22 octobre 2026) : le journal est devenu le tableau de bord « Protection expliquée ». Il couvre aussi les décisions pertinentes d’autorisation, de redirection/réécriture et de blocage HTTPS, avec motif, identifiant opaque de filtre, type de ressource et dates. Les filtres d’affichage permettent de distinguer les décisions ; les détails présentent la source publique prédéfinie du catalogue d’attribution. Le compteur d’observations inclut les décisions autorisées ; le compteur du bouclier et son aperçu continuent de décrire uniquement les blocages. Le journal affiche 50 groupes initialement, puis jusqu’à 200 avec « Afficher plus ».

Le rapport JSON est copié à la demande depuis le processus principal après vérification de l’émetteur. Il contient tous les groupes retenus dans le périmètre normal ou de l’onglet privé source, indépendamment de la recherche et de la pagination. Le schéma est reconstruit à partir de champs autorisés ; les propriétés supplémentaires, les valeurs de cookies et les URL de pages ne sont pas sérialisées. Les liens de référence sont sélectionnés dans cinq URL HTTPS prédéfinies et revérifiés dans le rendu. Leur date de revue reste celle du catalogue du 21 octobre 2026 ; aucun contrôle externe en temps réel n’est annoncé. Les règles complètes et leur liste d’origine ne sont pas conservées ; l’interface présente l’identifiant du filtre et le type de décision quand ils sont observables.

Fonction ajoutée le 21 octobre 2026. Le bouton Protection présente les trois éléments observés les plus récents pour l’onglet actif. Le tableau de bord présente le journal de la session normale, avec recherche par entreprise, nom de cookie ou domaine et boutons de filtre par entreprise.

Chaque ligne distingue :

- le nom du cookie réellement observé, ou « Cookie non observable » quand une requête a été bloquée avant les en-têtes ;
- le domaine observé et le site concerné, si le contexte est disponible ;
- l’action de Nacre : requête bloquée, envoi de cookie empêché, stockage empêché ou cookie natif supprimé ;
- l’entreprise et le service reconnus, la base de l’attribution et l’usage lorsqu’il est connu.

Le compteur du bouton Protection inclut désormais les cookies filtrés ainsi que les requêtes bloquées. Il mesure des interventions, pas des personnes, des entreprises ou des traqueurs uniques. Le journal et les compteurs sont effaçables avec le bouton existant « Effacer les compteurs ».

## Attribution et limites

L’attribution utilise un petit catalogue embarqué, sans requête à un service d’identification externe. Le domaine enregistrable est calculé avec tldts, suffixes privés compris. Une correspondance exacte dans le catalogue associe le domaine observé à Google, Meta, Microsoft ou LinkedIn. Un sous-domaine trompeur comme `google.com.evil.test` ne correspond pas à Google.

Un nom comme `_ga` peut être utilisé sur le domaine d’un autre site. Il est donc présenté comme une **technologie possible**, et non comme la preuve que Google possède le site ou qu’un échange avec Google a eu lieu. Un domaine connu prime sur un nom de cookie contradictoire. Un cookie non reconnu reste attribué à une entreprise inconnue. Une association d’entreprise ne suffit pas à qualifier un cookie de traqueur : des cookies fonctionnels peuvent également être filtrés par une politique stricte.

La première version reconnaît notamment les signatures Google Analytics (`_ga`, `_gid`, `_gat`), Google Ads (`_gcl_*`), Meta Pixel (`_fbp`, `_fbc`), Microsoft Clarity (`_clck`, `_clsk`), Microsoft Advertising (`_uetvid`, `_uetsid`) et LinkedIn Insight Tag (`li_fat_id`). Les attributions sont des indices documentés et peuvent devenir obsolètes ; le catalogue doit être revu lors des mises à jour.

Les écritures JavaScript interceptées par les preloads ne sont pas toutes observables depuis le processus principal. Cette version n’expose aucune nouvelle API aux pages Web et ne transforme pas des déclarations arbitraires de pages en preuve de pistage. Une requête bloquée avant son envoi ne permet pas d’inventer un nom de cookie. Une purge native dont le contexte d’écriture est inconnu n’est pas rattachée artificiellement à un onglet.

## Données et sécurité

- Uniquement en mémoire : 200 entrées récentes, 50 affichées dans le tableau de bord. Les doublons sont regroupés ; les plus anciennes entrées sont évincées.
- Les valeurs des cookies, les en-têtes complets, les chemins de page et les paramètres d’URL ne sont pas conservés dans le journal.
- Depuis la version 0.6.1, chaque onglet privé possède un journal en mémoire distinct, effacé à sa fermeture. Sa page Protection ne reçoit ni le journal normal ni celui d’un autre onglet privé.
- Les noms et domaines observés sont bornés et affichés uniquement via `textContent`. Aucun HTML, logo distant ou lien construit à partir des cookies.
- Le journal est effacé lors d’une suppression confirmée des cookies, du cache ou des données de sites, et à la fin du processus. Il n’est pas écrit dans les réglages ni exporté automatiquement.

Sources du catalogue, consultées le 21 octobre 2026 : [Google — utilisation des cookies](https://policies.google.com/technologies/cookies?hl=en-us), [Microsoft — cookies Clarity](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies), [Microsoft Advertising — UET](https://help.ads.microsoft.com/apex/index/3/en-in/53056), [LinkedIn — tableau des cookies](https://www.linkedin.com/legal/l/cookie-table), [Meta — implémentation officielle du Pixel pour WooCommerce](https://github.com/facebook/facebook-for-woocommerce/blob/main/facebook-commerce-pixel-event.php), [Meta — notice de confidentialité](https://engineering.fb.com/privacy/).

## Validation

Les tests unitaires couvrent les attributions, les domaines trompeurs, les signatures incertaines, l’extraction des noms sans valeurs, les limites mémoire, l’éviction, la remise à zéro et l’exclusion privée. Le harnais du véritable processus principal vérifie les cookies retirés des en-têtes réseau, leur attribution et la remise à zéro des compteurs.

`node scripts/verify-protection-activity.cjs` exécute une page locale dans Electron 44.9.3. Il vérifie un véritable `Set-Cookie` filtré, l’attribution possible à Google Analytics par `_ga`, l’aperçu par onglet, les quatre langues, la recherche, les filtres d’entreprise, l’affichage en texte des données non fiables, l’isolation du panneau privé et l’effacement. Une capture Chromium hors écran est produite sous `.cache/protection-activity/preview.png` ; aucune fenêtre de test n’est affichée sur le bureau.


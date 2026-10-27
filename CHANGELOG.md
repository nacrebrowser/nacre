# Changelog

## 1.0.0

- Langue personnalisée : si ta langue manque, Réglages › Apparence › « Créer une langue personnalisée… » crée un modèle dans le dossier « languages » du profil, avec tous les textes de la langue actuelle. Une fois traduit, il apparaît dans la liste des langues. Les textes non valides (accolades modifiées, trop longs) restent en anglais.
- Au premier lancement, Nacre prend la première langue de la liste des langues de Windows qu’il connaît (par exemple « Swahili, Français » donne le français), sans aucune connexion.
- Langues : l’interface passe de 79 langues et variantes à 20 langues principales, traduites et vérifiées une à une (anglais, français, espagnol, portugais du Brésil, allemand, italien, néerlandais, polonais, russe, ukrainien, turc, arabe, persan, hindi, indonésien, vietnamien, chinois simplifié et traditionnel, japonais, coréen). Un profil réglé sur une langue retirée passe à la plus proche (français canadien → français, portugais du Portugal → portugais du Brésil, chinois de Hong Kong → chinois traditionnel), sinon à l’anglais.
- Les textes « Vérification… » du bilan de confidentialité et les noms des fonds sombres s’affichent maintenant dans la langue choisie.
- Menu principal simplifié : liste sobre sans en-tête ni icônes, raccourcis alignés à droite, séparateurs fins ; « Panique » ne passe au rouge qu’une fois armée. Nouvelles entrées Téléchargements et « Importer depuis un autre navigateur… ».
- Écran d’accueil au premier lancement : import des favoris en un clic depuis Chrome, Edge, Brave, Vivaldi, Opera et Firefox (favoris uniquement, lus localement), et choix des services où rester connecté.
- Sites de confiance (Netflix, YouTube, Disney+, Prime Video…, ou « Rester connecté sur ce site » dans le panneau de protection) : empreinte stable d’un lancement à l’autre, cookies de connexion entre domaines du même service, données conservées par « effacer à la fermeture ». Bloqueur, anti-phishing et HTTPS restent actifs ; jamais en onglet privé. La lecture DRM (Widevine) n’est pas encore disponible.
- Mémoire : liste anti-phishing compactée (environ 12 Mio de moins dans le processus principal), pages de démarrage en arrière-plan chargées à l’ouverture, mise en veille plus tôt des onglets les plus anciens au-delà de six onglets éveillés ou quand la RAM libre passe sous 12 %.
- Code de Nacre publié sous licence MPL-2.0 (`LICENSE.md`).

## 0.9.6.4

- Icônes de sites sans activer Tor : après un import, Nacre lit d’abord les icônes déjà stockées par l’autre navigateur, puis lance un Tor temporaire, séparé de la navigation, pour récupérer celles qui manquent. Il s’arrête dès que c’est fini, au plus tard après 4 minutes, et son dossier temporaire est effacé. Il ne démarre pas si Tor est déjà connecté (le Tor existant est utilisé), si un proxy manuel est configuré, ni plus d’une fois toutes les 3 heures quand on ajoute un raccourci. L’écran d’import l’annonce ; option « Récupérer les icônes de sites manquantes via Tor » dans Réglages › Confidentialité (activée par défaut).
- Les icônes sont récupérées quatre à la fois au lieu d’une par une.

## 0.9.6.3

- La barre de favoris s’affiche aussi sur la page « Nouvel onglet », comme dans Chrome.
- Icônes de sites : correction d’un défaut qui rejetait toutes les icônes récupérées via Tor (la réponse d’Electron n’indique pas son URL finale). Vérifié avec un vrai Tor (`npm run verify:site-icons`). Elles sont aussi demandées dès que Tor se connecte.
- « Importer depuis un autre navigateur » récupère maintenant aussi les icônes déjà stockées par Chrome, Edge, Brave, Vivaldi, Opera et Firefox sur ce PC (copie locale en lecture seule, aucune connexion), même si tous les favoris sont déjà dans Nacre.

## 0.9.6.2

- Les icônes contenues dans un fichier HTML de favoris exporté (Chrome, Edge, Firefox…) sont maintenant importées avec les favoris, sans aucune connexion, et affichées dans la barre de favoris et sur l’accueil.
- Une icône déjà chargée par un onglet est partagée avec les raccourcis du même site (google.com et www.google.com).
- Tuile d’ajout de l’accueil : un « + » avec un libellé court (« Ajouter ») ; correction du libellé brut `home.addShortcut` affiché avant le chargement des traductions.
- Nouvel essai de récupération des icônes via Tor après 30 minutes au lieu de 6 heures.

## 0.9.6

- Zoom comme dans Chrome : Ctrl+molette (ou Ctrl +/−/0) affiche une bulle de zoom sous la barre d’adresse, qui se referme seule ; une loupe reste dans la barre d’adresse tant que le site n’est pas à 100 % et disparaît au retour à la taille normale. Paliers de Chromium (90, 110, 125 %…).
- Raccourcis de l’accueil : tuile « Ajouter un raccourci », bouton ⋮ ou clic droit pour renommer ou retirer, glisser-déposer pour réorganiser (Alt+←/→ au clavier), « Ajouter cette page à l’accueil » dans le menu et la palette de commandes. Jusqu’à 20 raccourcis.
- L’accueil n’affiche plus automatiquement les derniers favoris : une page ajoutée avec l’étoile ou importée n’y apparaît plus sans qu’on l’y place. Les tuiles affichées en 0.9.5 sont conservées à la mise à jour.
- Icônes de site sur les raccourcis et la barre de favoris au lieu d’une lettre : reprises de l’onglet quand le site a déjà été ouvert (aucune connexion en plus), sinon récupérées uniquement via Tor, dans une session en mémoire sans cookies. Sans Tor, la lettre reste jusqu’à la première visite. Cache signé, limité aux raccourcis et favoris, chiffré avec le coffre-fort de profil s’il est activé.
- Réglages › Apparence : fond d’écran personnalisé pour l’accueil (JPEG ou PNG, réencodé localement).

## 0.9.5

- Nouveau design inspiré de Chrome et Firefox : onglets reliés à la barre, favicons, barre d’adresse arrondie, barre de favoris, nouvelle page d’accueil, menus affichés au-dessus de la page, nouvelles icônes.
- Favicons récupérés uniquement depuis l’origine de la page, sans cookies, vérifiés par le bloqueur, bornés en taille et en dimensions, puis réencodés.
- DNS sécurisé « automatique » par défaut (Quad9 avec repli sur le DNS du réseau) ou « strict », avec une page d’erreur explicative.
- Badges de pays Tor corrigés, version semver 0.9.5, toasts et états de téléchargement par clés i18n, schéma unique des réglages, découpage de `main.cjs`.

## 0.9.4.3

- Lecture des filtres sans repli non borné, suppression des cookies IPv6 et nettoyage des noms de téléchargement corrigés.
- Contrôle natif des processus dans le setup et son désinstallateur ; mise à niveau avec le désinstallateur corrigé et erreurs explicites.

## 0.9.4.2

- Diagnostics lisibles, JSON replié et bilan de validation du build avec comptages et empreinte des sources.
- Une page temporaire Tor Project après confirmation ; contrôles non conclusifs affichés comme non vérifiés.
- Liste publique phishunt.io incluse hors ligne, avec source et fraîcheur visibles.
- Barre d’onglets déplaçable sur son espace vide, accents corrigés et choix de fonds sombres.

## 0.9.4

- Contrôle local de confidentialité avec actions ciblées sur permissions, exceptions, HTTPS et cookies.
- Profils locaux indépendants, sélectionnés au prochain lancement, avec conservation du profil Personal existant.
- Nettoyage de liens intermédiaires connus de Google et Facebook lors de la navigation et de la copie.
- Coffre facultatif des réglages et favoris : mot de passe principal, déverrouillage au lancement, changement du mot de passe et transactions récupérables. Cookies, cache et anciennes sauvegardes restent hors de ce coffre.

## 0.9.3

- Page de diagnostics locaux : JavaScript, WebGL, Canvas, langues, fuseau horaire et worker, avec les limites affichées.
- Commande `verify:release` qui enchaîne les vérifications du code et du paquet.

## 0.9.1

- Installateur Windows natif : choix du dossier, choix Tor ou Standard, désinstallation native.

## 0.9.0

- Nouveau design : barre d'onglets et navigation simplifiées, réglages en dix catégories avec recherche, nouveau logo et nouvelles icônes.

## 0.8.2

- Effacer les données d'un site depuis le panneau de protection, ou automatiquement quand son dernier onglet se ferme.
- Lecture automatique du son bloquée sans interaction.
- Les liens copiés sont nettoyés des paramètres de suivi (`fbclid`, `gclid`…).
- Vérifications de permissions plus strictes.

## 0.8.1

- Suggestions de favoris dans la barre d'adresse, zoom par site, partage par QR code généré localement.
- Anti-phishing local, bouton Panique, mode lecture, mise en veille des onglets inactifs.

## 0.8.0

- Tableau de bord des protections : ce qui a été bloqué, autorisé ou modifié, et pourquoi.

## 0.7.0

- Interface traduite, menus et pages internes compris, avec prise en charge des langues de droite à gauche.

## 0.5.1

- Durcissement de la navigation, des téléchargements, des cookies tiers, des sessions privées, du proxy et des filtres.
- Interface en français, anglais, allemand et espagnol.

## 0.5.0

- Revue de sécurité complète : isolation d'Electron, réseau, Tor, empreinte, données locales, filtres, installateur.
- Tor échoue fermé : si Tor tombe, aucune connexion directe n'est rétablie en silence.

## 0.4.x

- Bloqueur de publicités Ghostery intégré, listes mises à jour uniquement via Tor et vérifiées par empreinte.
- Installateur Windows et version portable.
- WebGL désactivé par défaut pour ne pas exposer le modèle de carte graphique.
- Reprise de la page demandée après la reconnexion de Tor.

## 0.3.x

- Ponts Tor obfs4 et Snowflake.
- User-Agent Chrome standard, Global Privacy Control activé par défaut.
- Permissions par site, groupes d'onglets, import et export des favoris.

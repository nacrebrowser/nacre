# Tester Nacre 1.0.0 (bêta)

Merci de tester Nacre. C'est un navigateur Windows expérimental centré sur la vie privée, construit sur Chromium et Electron. Il n'est pas signé et pas encore publié : ne l'utilisez pas encore pour des choses sensibles.

## Installer

Deux façons, au choix :

- **Installateur** : `Nacre Setup 1.0.0.exe`. Il vous laisse choisir le dossier et un mode (avec ou sans Tor).
- **Portable** : décompressez **tout** le contenu de `Nacre 1.0.0 Portable.zip` dans un dossier où vous pouvez écrire, puis lancez **`Nacre Portable.cmd`** (pas `Nacre.exe` directement : il utiliserait le profil d'une version installée). Vos données restent dans le dossier `NacreData`, à côté de `Nacre.exe`.

### « Windows a protégé votre ordinateur »

C'est normal : le fichier n'est pas encore signé. Cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**. Pour vérifier que le fichier n'a pas été modifié, comparez son empreinte avec `SHA256SUMS-1.0.0.txt` :

```powershell
Get-FileHash "Nacre Setup 1.0.0.exe" -Algorithm SHA256
```

## Ce qu'il faut regarder en priorité

1. **Les menus** : le menu à trois points (en haut à droite), le menu Tor (à côté de la barre d'adresse) et le panneau du bouclier. Ils doivent s'ouvrir **au-dessus** de la page, se fermer quand on clique sur la page, et se parcourir au clavier (flèches, Échap).
2. **Les onglets** : icône du site, chargement, fermeture, glisser-déposer, onglets épinglés.
3. **La barre de favoris** : étoile dans la barre d'adresse pour ajouter, Ctrl+Maj+B pour afficher la barre. La page ne doit pas « sauter » quand la barre apparaît.
4. **Les boutons de la fenêtre** (réduire, agrandir, fermer) : alignés avec les onglets, jamais cachés.
5. **Tor** : activer, changer de pays de sortie, « Nouvelle identité Tor ». Le mode « Automatique » est le réglage par défaut.
6. **Un réseau d'école ou d'entreprise** : les sites s'ouvrent-ils ? Sinon, Réglages › Réseau et Tor › DNS sécurisé (Quad9) doit rester sur « Automatique ».
7. **Votre site de tous les jours** : se connecte-t-il, les vidéos marchent-elles ? Dites-moi lesquels ne marchent pas.

Ne marchent pas (connu) : Netflix, Disney+ et autres services qui demandent une protection DRM (Widevine).

## Les pages de contrôle

- **Réglages › Contrôle de confidentialité** : un bilan de vos réglages, sans test réseau. Les boutons disent ce qu'ils font (Activer, Révoquer, Bloquer de nouveau…).
- **Page « Vérifier Nacre »** (Réglages › À propos › « Lancer tous les diagnostics locaux », ou tapez `nacre://leak-tests/#run` dans la barre d'adresse) : lance des mesures sur la page elle-même. Un verdict en haut résume tout. « Limite connue » n'est ni un échec ni une réussite : la mesure n'est pas possible depuis l'intérieur du navigateur.

## Signaler un problème

Envoyez-moi :

- ce que vous faisiez et ce que vous attendiez ;
- une capture d'écran (ou une courte vidéo) ;
- votre version Windows ;
- pour un souci de navigation : l'adresse du site, et si Tor était activé ;
- si possible, le contenu du cadre « Données brutes des diagnostics (JSON) » de la page Vérifier Nacre (votre adresse IP publique y est partiellement masquée).

Ne m'envoyez jamais vos mots de passe ni le contenu du dossier du profil (`NacreData` ou `%APPDATA%\Nacre`) : il contient vos cookies et vos favoris.

## Désinstaller

Paramètres Windows › Applications › Nacre › Désinstaller. Vos données (favoris, réglages, cookies) restent dans `%APPDATA%\Nacre` : supprimez ce dossier si vous voulez tout effacer. Pour la version portable, supprimez simplement le dossier.

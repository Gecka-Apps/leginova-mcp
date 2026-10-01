# leginova-mcp

[![CI](https://github.com/Gecka-Apps/leginova-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Gecka-Apps/leginova-mcp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Gecka-Apps/leginova-mcp?sort=semver&label=release)](https://github.com/Gecka-Apps/leginova-mcp/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Gecka-Apps/leginova-mcp/total?label=downloads)](https://github.com/Gecka-Apps/leginova-mcp/releases)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-6E56CF)](https://modelcontextprotocol.io/specification/2026-07-28)

[![Télécharger pour Claude Desktop](https://img.shields.io/badge/T%C3%A9l%C3%A9charger-extension%20Claude%20Desktop%20(.mcpb)-D97757?style=for-the-badge&logo=claude&logoColor=white)](https://github.com/Gecka-Apps/leginova-mcp/releases/latest/download/leginova.mcpb)

Serveur [MCP](https://modelcontextprotocol.io) pour [Leginova](https://leginova.gouv.nc), le portail officiel du droit de la Nouvelle-Calédonie édité par le Gouvernement. Il donne à Claude (et à tout client MCP) un accès en lecture, en direct, au Journal officiel (JONC), aux codes, aux textes consolidés, à la jurisprudence et aux débats du Congrès, avec l'URL officielle de chaque source pour la citer.

Aucun compte ni clé d'API n'est nécessaire : le serveur interroge l'API publique qui alimente le site.

## Ce que Claude peut faire avec

- « Que prévoit le droit calédonien sur le télétravail dans le secteur privé ? »
- « Vérifie la référence "article L. 441-6 du code de commerce" dans le droit applicable en Nouvelle-Calédonie. »
- « Résume les arrêtés publiés au JONC en septembre 2026 sur la fiscalité. »
- « Trouve les arrêts de la cour d'appel de Nouméa sur la rupture d'un bail commercial depuis 2020 et lis le plus récent. »
- « Donne-moi l'historique des modifications de la loi du pays n° 2021-2. »

## Outils

| Outil | Rôle |
| --- | --- |
| `leginova_search` | Recherche plein texte dans tous les fonds, avec facettes, filtres, dates et tri |
| `leginova_advanced_search` | Recherche structurée (mots, expression exacte, conditions ET/OU/SAUF, autorité, juridiction, type d'acte, codes...) |
| `leginova_suggest` | Retrouve un document à partir d'un titre partiel |
| `leginova_list_codes` | Les 31 codes publiés, leur autorité déposante (État, Nouvelle-Calédonie, province) et la date de leur version |
| `leginova_get_code_outline` | Sommaire d'un code, avec le nombre d'articles par division |
| `leginova_get_code_article` | Un article de code, recherché par identifiant ou par numéro, quel que soit le préfixe |
| `leginova_read_code_section` | Le texte intégral d'une division de code |
| `leginova_get_texte_consolide` | Un texte consolidé (sommaire, texte paginé, article, historique, textes d'application) |
| `leginova_get_jurisprudence` | Une décision de justice, texte extrait du PDF officiel |
| `leginova_get_jonc` | Un numéro du JONC : sommaire analytique ou acte du JONC électronique |
| `leginova_get_jonc_item` | Un acte, une publication légale ou une association, avec sa date de publication au JONC et repli sur le PDF officiel quand Leginova n'a que les métadonnées |
| `leginova_get_debat` | Le compte rendu d'une séance du Congrès, page par page |
| `leginova_browse` | Les entrées d'un fonds par année (textes consolidés, jurisprudence, débats, JONC) |
| `leginova_get_catalogue` | Les identifiants acceptés par la recherche avancée |

Tous les outils sont en lecture seule et annotés comme tels. Chaque résultat de recherche indique l'outil à appeler pour ouvrir le document.

Le serveur fournit aussi des **ressources** (`leginova://guide`, `leginova://codes`, articles, textes et décisions par URI) et des **prompts** : `legal_research`, `analyze_consolidated_text`, `code_article_check`, `jonc_watch`. Dans Claude Code, ils apparaissent comme commandes, par exemple `/leginova:code_article_check`.

## Numéros d'article : L., Lp. et les autres

Dans les codes calédoniens, le préfixe fait partie du numéro. Un article adopté ou localisé par une loi du pays passe de la numérotation métropolitaine `L. 441-6` à `Lp. 441-6`. Sur Leginova, le code de commerce applicable en Nouvelle-Calédonie ne contient pas de `L. 441-6`, seulement un `Lp. 441-6`. La recherche avancée du site compare le numéro à la lettre : `L. 441-6`, `441-6` ou `Lp 441-6` n'y renvoient rien. Ce faux négatif se lit comme « la disposition n'existe pas » alors qu'elle existe sous un autre numéro.

`leginova_get_code_article` compare donc les numéros sans tenir compte du préfixe (`L.`, `Lp.`, `R.`, `D.`, `PS.`, `PN.`, `AN.`, numéros nus, `1er` = `1`) et dit toujours comment il a trouvé :

| `match_status` | Signification |
| --- | --- |
| `exact` | Le numéro demandé existe tel quel. Si le même numéro existe sous un autre préfixe (`L. 450-1` et `Lp. 450-1` sont deux articles distincts du code de commerce), un avertissement le signale. |
| `prefix_variant` | Le préfixe demandé n'existe pas, l'équivalent `L.`/`Lp.` existe : l'article est renvoyé avec un avertissement en tête. |
| `unique_unprefixed` | Aucun préfixe donné, un seul article porte ce numéro. |
| `ambiguous` | Plusieurs articles conviennent : ils sont listés, aucun n'est choisi. |
| `other_prefix_only` | Le numéro n'existe que sous un préfixe d'une autre nature (`R.`, `D.`...) : rien n'est substitué. |
| `not_found` | Aucun article de ce numéro, quel que soit le préfixe. La réponse précise ce qui a été vérifié, cherche dans les autres codes et rappelle qu'une absence sur Leginova ne prouve pas l'absence de fondement légal. |

Sans `code_slug`, la recherche porte sur les 31 codes. Le champ « numéro d'article » de la recherche avancée du site n'est volontairement pas exposé.

Plus généralement, toute recherche sans résultat est accompagnée du même rappel : le droit de l'État applicable en Nouvelle-Calédonie n'est parfois publié que sur Légifrance, et une recherche vide n'autorise pas à écrire « aucun fondement légal ».

## Ce que disent les réponses

Chaque outil de lecture renvoie le texte en Markdown et, dans `structuredContent`, la même réponse complète : texte compris, plus toutes les métadonnées. Certains clients ne transmettent au modèle que la partie structurée ; elle ne résume donc jamais, elle contient tout.

- **`text_status`** : `structured` (texte saisi sur Leginova), `pdf_text` (texte extrait du PDF officiel) ou `not_available` avec un motif. `pdf_without_text_layer` signale un scan image sans couche texte : aucune autre page n'en aura, inutile de réessayer. Les autres motifs sont `pdf_not_found`, `pdf_too_large`, `download_failed` et `extraction_failed`. `next_page` n'est proposé que si une page suivante porte du texte.
- **Actes du JONC** : `published_in_jonc_on` (date de publication au Journal officiel de la Nouvelle-Calédonie), `filing_authority`, `import_mode` et `pdf_scope`. `whole_issue` signifie que Leginova ne sert pas de PDF propre à l'acte mais le numéro entier ; la page imprimée où commence l'acte est alors indiquée (`printed_page_in_jonc`). Les résultats de recherche portent aussi la date de publication au JONC.
- **Codes** : `filing_authority`, l'autorité qui dépose et tient le code sur Leginova. Elle est plus fiable que le titre, car « applicable en Nouvelle-Calédonie » figure aussi bien sur des codes de l'État que de la Nouvelle-Calédonie. Elle ne tranche pas pour autant la compétence dans un code mixte : le code de commerce applicable en NC, déposé par la Nouvelle-Calédonie, garde des articles `L.` issus du droit de l'État à côté des articles `Lp.`.

## Installation

Chaque [release](https://github.com/Gecka-Apps/leginova-mcp/releases) publie deux fichiers, toujours disponibles à la même adresse pour la dernière version :

| Fichier | Usage | Lien « latest » |
| --- | --- | --- |
| `leginova.mcpb` | Extension Claude Desktop | [releases/latest/download/leginova.mcpb](https://github.com/Gecka-Apps/leginova-mcp/releases/latest/download/leginova.mcpb) |
| `leginova-mcp.mjs` | Serveur en un seul fichier, pour Claude Code et les autres clients (Node.js 22 ou plus récent) | [releases/latest/download/leginova-mcp.mjs](https://github.com/Gecka-Apps/leginova-mcp/releases/latest/download/leginova-mcp.mjs) |

Les mêmes fichiers existent sous un nom versionné (`leginova-0.1.0.mcpb`), avec leurs sommes `SHA256SUMS`.

### Claude Desktop : extension MCPB (recommandé)

Téléchargez [`leginova.mcpb`](https://github.com/Gecka-Apps/leginova-mcp/releases/latest/download/leginova.mcpb), double-cliquez dessus ou faites-le glisser dans la fenêtre de Claude Desktop, puis validez l'installation. Autre chemin : **Settings > Extensions > Advanced settings > Install Extension...** L'extension s'appuie sur le Node.js intégré à Claude Desktop ; la taille du cache et la taille maximale des PDF se règlent dans ses paramètres. Pour mettre à jour, installez la nouvelle version par-dessus.

### Serveur en un fichier

Les autres modes d'installation lancent `leginova-mcp.mjs` avec Node.js 22 ou plus récent :

```sh
mkdir -p ~/.local/share/leginova-mcp
curl -L -o ~/.local/share/leginova-mcp/leginova-mcp.mjs \
  https://github.com/Gecka-Apps/leginova-mcp/releases/latest/download/leginova-mcp.mjs
```

Relancez la même commande pour passer à la dernière version. Dans les exemples ci-dessous, remplacez `/chemin/vers/leginova-mcp.mjs` par le chemin absolu du fichier. On peut aussi le construire depuis les sources (voir [Développement](#développement)).

### Claude Desktop : configuration manuelle

Dans `claude_desktop_config.json` (**Settings > Developer > Edit Config**) :

```json
{
  "mcpServers": {
    "leginova": {
      "command": "node",
      "args": ["/chemin/vers/leginova-mcp.mjs"]
    }
  }
}
```

Redémarrez Claude Desktop.

### Claude Code

```sh
claude mcp add --scope user leginova -- node /chemin/vers/leginova-mcp.mjs
```

`--scope user` rend le serveur disponible dans tous vos projets ; `--scope project` l'écrit dans le `.mcp.json` du projet pour le partager avec l'équipe. Vérifiez avec `claude mcp list` ou `/mcp` dans une session.

### Claude Code : plugin

Le dépôt est aussi une marketplace de plugins Claude Code. Le plugin embarque sa propre copie du serveur, placée dans `claude-plugin/server/` par `npm run build`. Depuis un clone où le build a été fait :

```
/plugin marketplace add /chemin/vers/le/clone
/plugin install leginova@leginova
```

`/plugin marketplace add Gecka-Apps/leginova-mcp` fonctionnera directement depuis GitHub quand `claude-plugin/server/leginova-mcp.mjs` sera versionné dans le dépôt.

### claude.ai, Claude Desktop et mobile : connecteur distant

Les connecteurs personnalisés sont appelés depuis l'infrastructure d'Anthropic : le serveur doit être joignable en HTTPS depuis Internet. Lancez-le en mode HTTP derrière un reverse proxy TLS :

```sh
docker build -t leginova-mcp .
docker run -d --name leginova-mcp -p 127.0.0.1:3000:3000 \
  -e MCP_ALLOWED_HOSTS=leginova-mcp.example.nc \
  leginova-mcp
```

Le point d'entrée MCP est `https://leginova-mcp.example.nc/mcp` et `/healthz` répond pour la supervision. Ajoutez ensuite le connecteur :

- offres Pro et Max : **Customize > Connectors**, « + », **Add custom connector**, puis l'URL ;
- offres Team et Enterprise : un administrateur passe par **Organization settings > Connectors**, **Add**, **Custom**, **Web**.

Activez-le ensuite dans une conversation avec le bouton « + », puis **Connectors**. Voir [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Les données servies sont publiques, le serveur ne demande donc pas d'authentification. Une instance exposée relaie toutefois les requêtes de ses utilisateurs vers leginova.gouv.nc : prévoyez une limitation de débit au niveau du proxy.

Sans Docker : `node dist/leginova-mcp.mjs --http --host 0.0.0.0 --port 3000 --allowed-hosts leginova-mcp.example.nc`.

### Autres clients MCP

Tout client qui lance un serveur stdio accepte la même configuration que Claude Desktop (`command: node`, `args: [".../dist/leginova-mcp.mjs"]`). Les clients qui parlent Streamable HTTP se connectent à l'URL `/mcp` d'une instance HTTP.

## Configuration

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `LEGINOVA_BASE_URL` | `https://leginova.gouv.nc` | Site interrogé |
| `LEGINOVA_TIMEOUT_MS` | `30000` | Délai maximal par requête |
| `LEGINOVA_MAX_CONCURRENCY` | `4` | Requêtes simultanées vers Leginova |
| `LEGINOVA_RETRIES` | `2` | Nouvelles tentatives sur erreur transitoire (429, 5xx, réseau) |
| `LEGINOVA_CACHE_MB` | `256` | Taille du cache mémoire |
| `LEGINOVA_CACHE_TTL_S` | `3600` | Durée de vie du cache |
| `LEGINOVA_MAX_PDF_MB` | `80` | Taille maximale d'un PDF téléchargé pour extraction |
| `LEGINOVA_USER_AGENT` | `leginova-mcp/<version> (...)` | User-Agent envoyé |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Écoute en mode HTTP |
| `MCP_ALLOWED_HOSTS` | | Noms d'hôte acceptés quand l'écoute n'est pas en boucle locale (obligatoire dans ce cas) |
| `MCP_ALLOWED_ORIGINS` | `MCP_ALLOWED_HOSTS` | Origines navigateur acceptées |

En mode HTTP, les en-têtes `Host` et `Origin` sont vérifiés pour bloquer le DNS rebinding.

## Fonctionnement et limites

- Leginova ne publie pas la documentation de son API. Les points d'accès utilisés sont ceux qu'appelle le site lui-même, relevés dans son client ; une évolution du site peut casser un outil. `npm run test:live` le détecte.
- La jurisprudence, les débats du Congrès et beaucoup d'actes anciens du JONC (pour lesquels Leginova ne détient que les métadonnées) n'existent qu'en PDF. Leur texte est extrait page par page à la demande. Les plus anciens sont des scans sans couche texte : la réponse le dit (`pdf_without_text_layer`) et renvoie vers le PDF, aucun OCR n'est fait. Le premier accès à un débat télécharge jusqu'à 60 Mo, soit quelques secondes.
- Les images incluses dans les textes (tableaux scannés, plans) sont remplacées par un repère : le document complet reste accessible par son URL ou son PDF.
- Les textes consolidés sont la version en vigueur à leur date de consolidation, les codes à leur date d'application : les outils l'indiquent à chaque fois.
- Le serveur reste poli avec le site : quatre requêtes simultanées au plus, cache, nouvelles tentatives espacées.
- Ces informations juridiques ne constituent pas un conseil juridique.

## Développement

Depuis les sources (Node.js 22 ou plus récent) :

```sh
git clone https://github.com/Gecka-Apps/leginova-mcp.git
cd leginova-mcp
npm ci
npm run build        # dist/leginova-mcp.mjs, un fichier unique sans dépendance
npm run pack:mcpb    # leginova-<version>.mcpb, l'extension Claude Desktop
```

```sh
npm run typecheck    # TypeScript strict
npm test             # tests unitaires et protocole, sans réseau
npm run test:live    # tests contre leginova.gouv.nc
npm run inspect      # MCP Inspector sur le bundle
npm run check        # typecheck + tests + build
```

La CI GitHub teste sur Node.js 22, 24 et 26, puis construit l'extension à chaque push : le `.mcpb` est téléchargeable dans les artefacts du run pendant 30 jours.

### Publier une version

1. `npm run version:set 0.2.0` aligne le numéro de version dans `package.json`, `package-lock.json`, `manifest.json`, `src/version.ts` et les manifestes du plugin ; `npm run version:check` le vérifie.
2. Ajouter la section `## 0.2.0 (date)` à `CHANGELOG.md` : elle devient le texte de la release.
3. Committer, puis pousser un tag annoté `v0.2.0`. Son message sert de titre à la release.

Le workflow `release.yml` vérifie que le tag correspond partout au numéro de version, relance les tests (y compris contre leginova.gouv.nc), construit l'extension et publie la release avec `leginova-0.2.0.mcpb`, `leginova.mcpb`, `leginova-mcp-0.2.0.mjs`, `leginova-mcp.mjs` et `SHA256SUMS`. Un tag avec suffixe (`v0.2.0-rc.1`) donne une pré-version, qui ne remplace pas la cible des liens « latest ».

Le serveur repose sur le SDK MCP TypeScript v2 (`@modelcontextprotocol/server`, spécification 2026-07-28, compatible avec les clients 2025) et sur Zod 4. Les schémas d'entrée et de sortie des outils sont déclarés, et les réponses portent à la fois un texte Markdown et un `structuredContent`.

```
src/
  index.ts            CLI : stdio ou HTTP
  server.ts           assemblage du serveur
  instructions.ts     instructions transmises au client et guide
  articles.ts         index des numéros d'article, tolérant aux préfixes
  client/             API Leginova : HTTP, cache, types
  format/             HTML vers Markdown, PDF, URL canoniques, résultats
  tools/              un fichier par famille d'outils
  resources.ts, prompts.ts
```

## Licence

[AGPL-3.0-or-later](LICENSE). Les contenus juridiques restent ceux de leginova.gouv.nc, soumis à ses [conditions d'utilisation](https://leginova.gouv.nc/conditions-utilisation).

---
Built with 🥥 and ☕ by [Gecka](https://gecka.nc) — Kanaky-New Caledonia 🇳🇨

# Bébé suivi

Le besoin métier pour ce TP est : disposer d'une application web permet à mon épouse et moi de suivre mon nourrisson d'une semaine. Je souhaite assurer un suivi sur les trois points suivants :

- **tétées** (temps/recurrence: sein gauche / droit) ;
- **durée du sommeil** ;
- **couches** (pipi, caca, change).
  Plus spécifiquement, elle tourne entièrement dans Docker : une API Node.js / Express, une base PostgreSQL et une interface Adminer pour consulter la base.

## Architecture

```
            navigateur
     :8080 │          │ :8081
           ▼          ▼
     ┌──────────┐ ┌──────────┐
     │   web    │ │ adminer  │
     │ Node 24  │ │ adminer:4│
     │ Express  │ └────┬─────┘
     └────┬─────┘      │
          │  app-network (bridge)
          ▼            ▼
        ┌──────────────────┐
        │        db        │
        │   postgres:17    │──── volume db_data
        └──────────────────┘
```

Le schéma détaillé est dans [20261003_EBDE_Architecture_bebe_suivi.pdf](20261003_EBDE_Architecture_bebe_suivi.pdf).

Points notables :

- `web` et `adminer` attendent que `db` soit **healthy** (`pg_isready`) avant de démarrer (`depends_on: condition: service_healthy`).
- La base n'est pas exposée sur l'hôte : seuls les conteneurs du réseau `app-network` peuvent la joindre, via le nom de service `db`.
- Les données sont persistées dans le volume nommé `db_data`.
- La base stocke les dates en UTC ; l'API découpe les statistiques par jour dans le fuseau `FUSEAU_HORAIRE` (`Europe/Paris`).

## Arborescence

```
bebe_suivi/
├── docker-compose.yml        # les 3 services, le réseau et le volume
├── .env.example              # modèle des variables d'environnement
├── db/
│   └── init.sql              # types ENUM, table events et contraintes CHECK
└── app/
    ├── Dockerfile            # image node:24-slim, utilisateur non root
    ├── .dockerignore
    ├── package.json          # dépendances : express, pg
    ├── server.js             # API REST
    └── public/
        └── index.html        # interface (HTML/CSS/JS sans framework)
```

## Démarrage

### Prérequis

| Outil          | Version testée | Minimum requis               |
| -------------- | -------------- | ---------------------------- |
| Docker Engine  | 29.8.1         | —                            |
| Docker Compose | v5.5.1         | v2 (plugin `docker compose`) |

Docker Compose est fourni comme plugin de Docker : la commande s'écrit `docker compose` (avec un espace).
Il est inclus dans Docker Desktop ; sous Linux, il s'installe avec le paquet `docker-compose-plugin`.
L'ancienne commande `docker-compose` (Compose v1, avec un tiret) n'est plus maintenue depuis 2023 et n'est pas prise en charge dans ce TP:
le fichier `docker-compose.yml` suit la _Compose Specification_ (pas de clé `version:` en tête).

### Lancement

0. Vérifier les versions installées :

````bash
docker --version          # Docker version 29.8.1
docker compose version    # Docker Compose version v5.5.1

1. Créer le fichier `.env` à partir du modèle et renseigner les valeurs :

   ```bash
   cp .env.example .env
````

| Variable            | Description             |
| ------------------- | ----------------------- |
| `POSTGRES_DB`       | nom de la base          |
| `POSTGRES_USER`     | utilisateur PostgreSQL  |
| `POSTGRES_PASSWORD` | mot de passe PostgreSQL |

Le fichier `.env` est ignoré par git (voir `.gitignore`).

2. Construire et lancer :

   ```bash
   docker compose up -d --build
   ```

3. Ouvrir :
   - l'application : <http://localhost:8080>
   - Adminer : <http://localhost:8081> (système _PostgreSQL_, serveur `db`, identifiants du `.env`)

4. Vérifier que l'API joint la base :

   ```bash
   curl http://localhost:8080/api/health
   # {"status":"ok"}
   ```

Arrêt :

```bash
docker compose down        # arrête et supprime les conteneurs, garde les données
docker compose down -v     # supprime aussi le volume db_data (données perdues)
```

> `db/init.sql` n'est exécuté par PostgreSQL **qu'au premier démarrage**, quand le volume est vide.
> Après une modification du schéma, il faut repartir d'un volume vierge (`docker compose down -v`).

# Les commandes utiles

**Vérifier le nom de mon volume :**

```bash
docker volume ls
```

**Trouver où est enregistré le volume :**

```bash
docker volume inspect db_data
```

**Enregistrer les mesures d'un build :**

```bash
time docker compose --progress plain build --no-cache web 2>&1 | tee mesures/build1.txt
```

**Identifier les images :**

```bash
docker compose images
```

**Analyser les logs :**

```bash
docker compose logs
```

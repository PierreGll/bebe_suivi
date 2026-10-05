const express = require('express');
const { Pool } = require('pg');

// Connexion à la base : extraction des informations depuis les variables d'entrainement 
const pool = new Pool({
  host: process.env.DB_HOST,               // "db" = le nom du service dans compose.yaml
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

// Fuseau utilisé pour découper les statistiques par jour (la base stocke en UTC)
const FUSEAU = process.env.FUSEAU_HORAIRE || 'Europe/Paris';

const app = express();
app.use(express.json());                   // lit le corps JSON des requêtes POST
app.use(express.static('public'));         // sert public/index.html sur "/"

// Renvoie l'événement en cours d'un type donné ('nourrir' ou 'dormir'), ou undefined
async function enCours(type) {
  const { rows } = await pool.query(
    'SELECT * FROM events WHERE type = $1 AND date_fin IS NULL ORDER BY date_debut DESC LIMIT 1',
    [type]
  );
  return rows[0];
}

// ===================== Lecture =====================

// Vérifie que l'application joint bien la base
app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

// Liste des derniers événements
app.get('/api/events', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM events ORDER BY date_debut DESC LIMIT 50'
  );
  res.json(rows);
});

// Résumé pour le haut de la page : en cours, dernière tétée, dernier change
app.get('/api/resume', async (req, res) => {
  const derniereTetee = await pool.query(
    `SELECT cote, date_debut FROM events
     WHERE type = 'nourrir' ORDER BY date_debut DESC LIMIT 1`
  );
  const dernierChange = await pool.query(
    `SELECT MAX(change_couche) AS date FROM events WHERE type = 'hygiene'`
  );
  res.json({
    teteeEnCours: (await enCours('nourrir')) || null,
    sommeilEnCours: (await enCours('dormir')) || null,
    derniereTetee: derniereTetee.rows[0] || null,
    dernierChange: dernierChange.rows[0].date,
  });
});

// Statistiques des 7 derniers jours
app.get('/api/stats', async (req, res) => {
  // Une ligne par jour, même les jours sans événement (generate_series + LEFT JOIN)
  const parJour = await pool.query(
    `WITH jours AS (
       SELECT generate_series(
         (now() AT TIME ZONE $1)::date - 6,
         (now() AT TIME ZONE $1)::date,
         interval '1 day'
       )::date AS jour
     )
     SELECT j.jour::text AS jour,
       COUNT(*) FILTER (WHERE e.type = 'nourrir' AND e.cote = 'gauche')::int AS tetees_gauche,
       COUNT(*) FILTER (WHERE e.type = 'nourrir' AND e.cote = 'droit')::int  AS tetees_droit,
       COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM e.date_fin - e.date_debut) / 60)
         FILTER (WHERE e.type = 'dormir' AND e.date_fin IS NOT NULL)), 0)::int AS sommeil_min,
       COALESCE(ROUND(MAX(EXTRACT(EPOCH FROM e.date_fin - e.date_debut) / 60)
         FILTER (WHERE e.type = 'dormir' AND e.date_fin IS NOT NULL)), 0)::int AS plus_long_sommeil_min,
       COUNT(*) FILTER (WHERE e.type = 'hygiene' AND e.pipi)::int                     AS pipis,
       COUNT(*) FILTER (WHERE e.type = 'hygiene' AND e.caca IS NOT NULL)::int         AS cacas,
       COUNT(*) FILTER (WHERE e.type = 'hygiene' AND e.change_couche IS NOT NULL)::int AS changes
     FROM jours j
     LEFT JOIN events e ON (e.date_debut AT TIME ZONE $1)::date = j.jour
     GROUP BY j.jour
     ORDER BY j.jour DESC`,
    [FUSEAU]
  );

  // Nombre et durée moyenne des tétées terminées, par sein, sur 7 jours
  const parSein = await pool.query(
    `SELECT cote,
       COUNT(*)::int AS nombre,
       ROUND(AVG(EXTRACT(EPOCH FROM date_fin - date_debut) / 60))::int AS duree_moyenne_min
     FROM events
     WHERE type = 'nourrir' AND date_fin IS NOT NULL
       AND date_debut > now() - interval '7 days'
     GROUP BY cote`
  );

  // Temps moyen entre le début de deux tétées consécutives, sur 7 jours
  // LAG() lit la ligne précédente : pour chaque tétée, on récupère le début de la tétée d'avant
  const intervalle = await pool.query(
    `WITH tetees AS (
       SELECT date_debut,
         LAG(date_debut) OVER (ORDER BY date_debut) AS precedente
       FROM events
       WHERE type = 'nourrir' AND date_debut > now() - interval '7 days'
     )
     SELECT ROUND(AVG(EXTRACT(EPOCH FROM date_debut - precedente) / 60))::int AS minutes
     FROM tetees
     WHERE precedente IS NOT NULL`
  );

  res.json({
    parJour: parJour.rows,
    parSein: parSein.rows,
    intervalleMoyenMin: intervalle.rows[0].minutes,  // null s'il y a moins de 2 tétées
  });
});

// ===================== Écriture =====================

// Démarre une tétée (body : { "cote": "gauche" | "droit" })
app.post('/api/tetees', async (req, res) => {
  if (await enCours('nourrir')) {
    return res.status(409).json({ error: 'Une tétée est déjà en cours. Terminez-la d\'abord.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO events (type, cote, date_debut)
     VALUES ('nourrir', $1, now()) RETURNING *`,
    [req.body.cote]
  );
  res.status(201).json(rows[0]);
});

// Démarre un sommeil
app.post('/api/sommeils', async (req, res) => {
  if (await enCours('dormir')) {
    return res.status(409).json({ error: 'Un sommeil est déjà en cours. Terminez-le d\'abord.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO events (type, date_debut)
     VALUES ('dormir', now()) RETURNING *`
  );
  res.status(201).json(rows[0]);
});

// Enregistre une couche (body : { "pipi": true, "caca": "petit" | "moyen" | "grand" | null, "changeCouche": true })
app.post('/api/hygiene', async (req, res) => {
  const { pipi = false, caca = null, changeCouche = true } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO events (type, pipi, caca, date_debut, change_couche)
     VALUES ('hygiene', $1, $2, now(), CASE WHEN $3::boolean THEN now() END)
     RETURNING *`,
    [pipi, caca, changeCouche]
  );
  res.status(201).json(rows[0]);
});

// Termine une tétée ou un sommeil en cours
app.post('/api/events/:id/fin', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE events SET date_fin = now()
     WHERE id = $1 AND type IN ('nourrir', 'dormir') AND date_fin IS NULL
     RETURNING *`,
    [req.params.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Aucun événement en cours avec cet id' });
  }
  res.json(rows[0]);
});

// Supprime un événement (erreur de saisie)
app.delete('/api/events/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
  if (rowCount === 0) {
    return res.status(404).json({ error: 'Événement introuvable' });
  }
  res.status(204).end();
});

// Gestion des erreurs : une donnée refusée par la base devient une erreur 400
app.use((err, req, res, next) => {
  // 23514 = contrainte CHECK violée, 23502 = NOT NULL violé, 22P02 = valeur invalide (enum, nombre)
  if (['23514', '23502', '22P02'].includes(err.code)) {
    return res.status(400).json({ error: 'Données invalides', detail: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur interne' });
});

// --- Démarrage ---
const port = Number(process.env.PORT) || 8080;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Bébé suivi en écoute sur le port ${port}`);
});

// Arrêt propre quand Docker envoie SIGTERM (docker compose stop / down)
process.on('SIGTERM', () => {
  console.log('SIGTERM reçu, arrêt en cours...');
  server.close(() => pool.end().then(() => process.exit(0)));
});

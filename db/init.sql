CREATE TYPE action_base AS ENUM ('nourrir', 'dormir', 'hygiene');
CREATE TYPE sein AS ENUM ('gauche', 'droit');
CREATE TYPE taille_popo AS ENUM ('petit', 'moyen', 'grand');
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    type action_base NOT NULL,
    cote sein NULL,
    -- sens de la tétée (gaucghe ou droit)
    pipi BOOLEAN NULL,
    -- deux cas seulement vrai ou faux. on pourrait ajouter la couleur mais on reste basique pour l'instant. 
    caca taille_popo NULL,
    change_couche TIMESTAMPTZ NULL,
    date_debut TIMESTAMPTZ NOT NULL,
    date_fin TIMESTAMPTZ NULL,
    -- on ajoute une règle de validation à la table pour vérifier que chaque évènement 
    --inséré soit un évènement possible. 
    CONSTRAINT check_nourrir CHECK (
        type <> 'nourrir'
        OR cote IS NOT NULL
    ),
    CONSTRAINT check_hygiene CHECK (
        type <> 'hygiene'
        OR (
            pipi IS NOT NULL
            AND (
                pipi = TRUE
                OR caca IS NOT NULL
            )
        )
    ),
    CONSTRAINT check_couche CHECK (
        type = 'hygiene'
        OR (
            pipi IS NULL
            AND caca IS NULL
            AND change_couche IS NULL
        )
    )
);
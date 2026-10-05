# Image officielle Node, version LTS 24, variante slim, tag figé
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# 1. Dépendances d'abord (change rarement -> couche mise en cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 2. Code ensuite (change souvent -> seule cette couche est reconstruite)
COPY . .

# Ne pas tourner en root dans le conteneur
USER node

EXPOSE 8080

# Forme exec (tableau JSON) : node est le processus principal et reçoit SIGTERM
CMD ["node", "server.js"]   

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache smartmontools
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 4000
CMD ["npm", "start"]

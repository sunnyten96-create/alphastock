FROM node:22-alpine

WORKDIR /app
COPY package.json server.js kis.js ./
COPY public ./public
RUN mkdir -p data

ENV NODE_ENV=production
ENV PORT=5173
EXPOSE 5173

CMD ["node", "server.js"]

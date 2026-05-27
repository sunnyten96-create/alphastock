FROM node:22-alpine

WORKDIR /app
COPY package.json server.js kis.js ./
COPY public ./public
RUN if [ ! -f public/index.html ] && [ -d public/public ]; then cp -r public/public/* public/; fi
RUN mkdir -p data
COPY data/research-report.json data/research-report.md data/model-registry.json ./data/

ENV NODE_ENV=production
ENV PORT=5173
EXPOSE 5173

CMD ["node", "server.js"]

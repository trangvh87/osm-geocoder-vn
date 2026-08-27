FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY smart-proxy.js ./
EXPOSE 3000
CMD ["node", "smart-proxy.js"]
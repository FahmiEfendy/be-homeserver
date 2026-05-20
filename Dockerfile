FROM node:22-alpine
WORKDIR /app
COPY server.js .
EXPOSE 3002
CMD ["node", "server.js"]

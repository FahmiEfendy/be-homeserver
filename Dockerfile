FROM node:22-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY server.js .
EXPOSE 3002
CMD ["node", "server.js"]

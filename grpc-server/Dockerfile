FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 50051
EXPOSE 9091
CMD [ "node", "server.js" ]
FROM node:24-alpine

RUN apk add --no-cache python3 make g++ git

WORKDIR /usr/src

COPY package.json package-lock.json ./

RUN npm install --no-audit --no-fund

COPY . .

RUN npm run build

ENTRYPOINT ["/bin/sh", "-c" , "npm start"]

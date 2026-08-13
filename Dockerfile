FROM node:24-alpine

RUN apk add --no-cache python3 make g++ git

COPY . /usr/src

WORKDIR /usr/src

RUN npm install --no-audit --no-fund

RUN npm run build

ENTRYPOINT ["/bin/sh", "-c" , "npm start"]

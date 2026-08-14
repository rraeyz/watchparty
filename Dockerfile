FROM node:24-alpine

# bash/iproute2/docker-cli are needed by the virtual browser manager, which
# picks a free port and launches neko containers on the host's Docker socket.
RUN apk add --no-cache python3 make g++ git bash iproute2 docker-cli

WORKDIR /usr/src

COPY package.json package-lock.json ./

RUN npm install --no-audit --no-fund

COPY . .

RUN npm run build

ENTRYPOINT ["/bin/sh", "-c" , "npm start"]

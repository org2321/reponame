# EnvKey API Community Edition

## Run in Node.js Container

```bash
npm run build

docker run -d --name envkey_community_mysql56 \
  -p 127.0.0.1:3309:3306 \
  -e 'MYSQL_ALLOW_EMPTY_PASSWORD=true' \
  -e 'MYSQL_DATABASE=envkey_development_community' \
  --mount source=envkey_development_community_vol,target=/app \
  mysql:5.6

docker run --rm -ti --net host --mount=type=bind,src=$(pwd),dst=/usr/local/envkey-community/ -e 'NODE_ENV=production' --env-file=.env --env-file=.community.env --workdir="/usr/local/envkey-community" node:14-alpine node "/usr/local/envkey-community/build/api.community.js"

curl http://localhost:3014

```
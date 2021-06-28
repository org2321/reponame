#!/bin/bash

version=${1?missing param 1 version}
branch=${2?missing param 2 branch}

echo $version $branch

THIS_DIR=$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd -P
)
PUBLIC_GO_MOD_REPO=$(
  cd "$THIS_DIR/../../../../go-envkeyfetch"
  pwd -P
)

echo "SDK publish for envkey-fetch will only push source code to mirror (no artifacts)"
# assume the repo exists
cd $PUBLIC_GO_MOD_REPO || "did you git clone go-envkeyfetch mirror?"
pwd

git checkout -b "$branch"
git branch

rm -rf ./*

# files to move over
cp -r $THIS_DIR/* ./
# the remote repo will not have a .gitignore unless we do this
cp -r $THIS_DIR/.gitignore ./
# go modules
# go.mod.public created during release_sdks.ts
rm ./go.mod
mv ./go.mod.public ./go.mod
go mod download

git add -A
git commit -m "Release v${version}"
git tag -m "v${version}" "v$version"
git push origin --tags "$branch"

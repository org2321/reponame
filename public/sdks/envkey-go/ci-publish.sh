#!/bin/bash

version=${1?missing param 1 version}
branch=${2?missing param 2 branch}

echo $version $branch

THIS_DIR=$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd -P
)
PUBLIC_GO_MOD_REPO=$(
  cd "$THIS_DIR/../../../../go-sdk"
  pwd -P
)
ENVKEYFETCH_VERSION=$(cat $THIS_DIR/../../../releases/envkeyfetch/envkeyfetch-version.txt)

echo "Using envkey-fetch $ENVKEYFETCH_VERSION"

echo "$version" > version.txt

# assume the repo exists
cd $PUBLIC_GO_MOD_REPO || "did you git clone go-sdk mirror?"
pwd

git checkout -b "$branch" || git checkout "$branch"
git branch

rm -rf ./*

# files to move over
cp -r $THIS_DIR/* ./
# go modules
# go.mod.public created during release_sdks.ts
rm ./go.mod
rm ./go.sum
mv ./go.mod.public ./go.mod
bash ci-test.sh

git add -A
git commit -m "Release v${version}"
git tag -m "v${version}" "v$version"
git push origin --tags "$branch"

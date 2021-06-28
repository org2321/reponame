#!/bin/bash
version=${1?missing param 1 version}
branch=${2?missing param 2 branch}

echo $version $branch

THIS_DIR=$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd -P
)

echo "$version" > version.txt

# TODO: change python publish to be real
export ENVKEY_DEV_OVERRIDE_PACKAGE_NAME=darcy_bingley_wickham
make release

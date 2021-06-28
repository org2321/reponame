#!/bin/bash
version=${1?missing param 1 version}
branch=${2?missing param 2 branch}

echo $version $branch

THIS_DIR=$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd -P
)

echo "$version" > version.txt

# TODO: remove to use real ruby gem package
override_gem=fitzwilliam_charles_george
export ENVKEY_DEV_OVERRIDE_PACKAGE_NAME=$override_gem
gem build envkey.gemspec
gem push "$override_gem-$version.gem"

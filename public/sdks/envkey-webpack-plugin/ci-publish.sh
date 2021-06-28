#!/bin/bash

version=${1?missing param 1 version}
branch=${2?missing param 2 branch}

# TODO: real npm publish for envkey-webpack-plugin
echo "webpack plugin is only doing a dry-run publish!"
npm version "$version" --allow-same-version
npm publish --dry-run --silly

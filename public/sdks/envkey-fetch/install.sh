#!/usr/bin/env bash

# Overrides: ENVKEY_FETCH_BUCKET, ENVKEY_FETCH_VERSION

set -e

PLATFORM=
ARCH=
BUCKET=
VERSION=

case "$(uname -s)" in
 Darwin)
   PLATFORM='darwin'
   ;;

 Linux)
   PLATFORM='linux'
   ;;

 FreeBSD)
   PLATFORM='freebsd'
   ;;

 CYGWIN*|MINGW*|MSYS*)
   PLATFORM='windows'
   ;;

 *)
   echo "Platform may or may not be supported. Will attempt to install."
   PLATFORM='linux'
   ;;
esac

if [[ "$(uname -m)" == 'x86_64' ]]; then
  ARCH="amd64"
else
  ARCH="386"
fi

# Set Bucket
if [[ -z "${ENVKEY_FETCH_BUCKET}" ]]; then
  BUCKET=envkey-releases
else
  BUCKET=$ENVKEY_FETCH_BUCKET
  echo "Using custom bucket $BUCKET"
fi

# Set Version
if [[ -z "${ENVKEY_FETCH_VERSION}" ]]; then
  curl -s -o .ek_tmp_version "https://$BUCKET.s3.amazonaws.com/latest/envkeyfetch-version.txt"
  VERSION=$(cat .ek_tmp_version)
  rm .ek_tmp_version
else
  VERSION=$ENVKEY_FETCH_VERSION
  echo "Using custom version $VERSION"
fi

cleanup () {
  rm envkey-fetch.tar.gz
  rm -f envkey-fetch
  rm -f envkey-fetch.exe
}

welcome_envkey () {
  echo "envkey-fetch $VERSION Quick Install"
  echo "Copyright (c) 2021 Envkey Inc. - MIT License"
  echo ""
}

download_envkey () {
  echo "Downloading envkey-fetch binary for ${PLATFORM}-${ARCH}"
  url="https://$BUCKET.s3.amazonaws.com/envkeyfetch/release_artifacts/${VERSION}/envkey-fetch_${VERSION}_${PLATFORM}_${ARCH}.tar.gz"
  echo "Downloading tarball from ${url}"
  curl -s -L -o envkey-fetch.tar.gz "${url}"

  tar zxf envkey-fetch.tar.gz 1> /dev/null

  if [ "$PLATFORM" == "darwin" ]; then
    mv envkey-fetch /usr/local/bin/
    echo "envkey-fetch is installed in /usr/local/bin"
  elif [ "$PLATFORM" == "windows" ]; then
    # ensure $HOME/bin exists (it's in PATH but not present in default git-bash install)
    mkdir $HOME/bin 2> /dev/null
    mv envkey-fetch.exe $HOME/bin/
    echo "envkey-fetch is installed in $HOME/bin"
  else
    CAN_I_RUN_SUDO=$(sudo -n uptime 2>&1|grep "load"|wc -l)
    if [ "${CAN_I_RUN_SUDO}" -gt 0 ]; then
      sudo mv envkey-fetch /usr/local/bin/
    else
      mv envkey-fetch /usr/local/bin/
    fi
    echo "envkey-fetch is installed in /usr/local/bin"
  fi
}

welcome_envkey
download_envkey
cleanup

echo "Installation complete. Info:"
echo ""
envkey-fetch -h

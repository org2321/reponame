#!/usr/bin/env bash

set -e

ACCOUNT_ID=$(aws --profile=envkey-host sts get-caller-identity --query Account)
ACCOUNT_ID="${ACCOUNT_ID%\"}"
ACCOUNT_ID="${ACCOUNT_ID#\"}"

echo $ACCOUNT_ID
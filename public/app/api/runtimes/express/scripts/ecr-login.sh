#!/usr/bin/env bash

# aws-cli v2 dropped support for get-login so this script uses get-login-password

set -e

ACCOUNT_ID=$(./scripts/account-id.sh)
REGION=$(aws --profile=envkey-host configure get region)

aws --profile=envkey-host ecr get-login-password --region "$REGION" | docker login \
    --username AWS \
    --password-stdin \
    "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

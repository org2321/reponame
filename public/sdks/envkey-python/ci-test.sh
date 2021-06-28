#! /bin/bash

set -e
cleanup() {
  deactivate
}
trap cleanup EXIT

source venv/bin/activate

make dev-deps
make test

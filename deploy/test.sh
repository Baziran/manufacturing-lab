#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose run --rm --no-deps -v "$(pwd):/workspace:ro" dashboard sh -c 'pip install --quiet --target /tmp/test-deps httpx==0.28.1 && cd /workspace && PYTHONPATH=/tmp/test-deps:/workspace python -m unittest discover -s tests -v'

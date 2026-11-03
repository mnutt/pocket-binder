#!/bin/bash
set -euo pipefail
cd /opt/app
export DATA_DIR=/var/pocket-binder
exec python3 app.py

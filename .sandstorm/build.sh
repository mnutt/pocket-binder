#!/bin/bash
set -euo pipefail
cd /opt/app
python3 -m unittest discover -s tests -v

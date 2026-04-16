#!/bin/bash
# Load env and run Go backend
cd "$(dirname "$0")"
set -a
source .env
set +a
go run ./cmd/server

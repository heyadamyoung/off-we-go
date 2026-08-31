#!/bin/sh
set -eu

APP_ROOT="$CI_PRIMARY_REPOSITORY_PATH/app"
: "${WAYFARE_DOMAIN:=offwego.to}"
export WAYFARE_DOMAIN

cd "$APP_ROOT"
corepack enable
corepack prepare pnpm@10.6.5 --activate
pnpm install --frozen-lockfile
VITE_API_URL="https://${WAYFARE_DOMAIN}/api" pnpm ios:sync
/usr/libexec/PlistBuddy -c "Set :com.apple.developer.associated-domains:0 applinks:${WAYFARE_DOMAIN}" \
  ios/App/App/App.entitlements

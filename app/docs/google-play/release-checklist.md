# Android release checklist

1. Use package name `ai.threadway.wayfare` in Google Play Console and enable Play App Signing.
2. Increment `versionCode` (and update `versionName` when appropriate) in `android/app/build.gradle`, then build with JDK 21 or newer and Android SDK 35: `VITE_API_URL=https://offwego.to/api pnpm android:sync`.
3. Create a private upload keystore. Never commit the keystore or its passwords.
4. Build a signed Android App Bundle with `pnpm exec cap build android --androidreleasetype AAB` and the `--keystorepath`, `--keystorepass`, `--keystorealias`, and `--keystorealiaspass` options.
5. Copy the SHA-256 fingerprint of the **app signing certificate** from Play Console into `ANDROID_SHA256_CERT_FINGERPRINTS` in the VPS `.env`, then redeploy.
6. Confirm `https://offwego.to/.well-known/assetlinks.json` lists `ai.threadway.wayfare` and that fingerprint before testing the OIDC browser return to the app.
7. On a physical Android 13+ phone, verify sign-in, system photo selection, upload, precise-location permission, notification permission, locked-screen tracking, pause/resume, offline queue replay, and device revocation.
8. Complete Google Play’s Data safety and foreground-service declarations using Off We Go’s published privacy policy, then upload the AAB to internal testing before production.

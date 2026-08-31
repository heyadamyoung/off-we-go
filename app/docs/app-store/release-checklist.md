# iOS release checklist

1. Confirm `offwego.to` resolves to the VPS and `https://offwego.to/api/health` returns `{"ok":true}`.
2. Confirm the VPS `.env` retains `APPLE_TEAM_ID=R65UN25Q64`; verify `/.well-known/apple-app-site-association` returns `R65UN25Q64.ai.threadway.wayfare` without redirects.
3. Create the `ai.threadway.wayfare` identifier in Apple Developer and enable Associated Domains.
4. In Xcode Cloud, connect this repository, choose the `App` scheme, set the branch, and use `app/ios/App/ci_scripts/ci_post_clone.sh`.
5. Select automatic signing for the correct team and create an archive build for iOS. The repository's GitHub workflow also compiles the unsigned iPhone/iPad simulator target on every main-branch change.
6. Distribute the archive to internal TestFlight testers. On a real iPhone and iPad verify account sign-in/sign-up, invitation acceptance, selected Photos, upload, background GPS with the screen locked, offline/online retry, pause/resume, account deletion, and all permission-denial paths.
7. Capture final App Store screenshots from that build, fill the manual values in `metadata.md`, complete App Privacy answers, and submit for review.

The codebase can automate compilation and tests. Apple credentials, legal contact information, the review account, and the physical-device observations must be supplied by the account owner.

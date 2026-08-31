# Off We Go App Store metadata

## Identity

- Name: `Off We Go`
- Subtitle: `Your trip, mapped together`
- Bundle ID: `ai.threadway.wayfare`
- Primary category: `Travel`
- Secondary category: `Photo & Video`
- Content rights: Off We Go displays user-selected content and map/Wikipedia material with source attribution.
- Age rating: `4+` unless trip owners add content requiring a higher rating.

## URLs

- Marketing URL: `https://offwego.to/`
- Support URL: `https://offwego.to/support.html`
- Privacy Policy URL: `https://offwego.to/privacy.html`

## Promotional text

Plan the route, see where everyone is, and pin the trip's photos to the places they happened.

## Description

Off We Go gives a private travel group one shared view of the trip.

Build an itinerary, map stops and routes, and follow opted-in travellers on the live map. Select photos directly from Apple Photos; Off We Go uses their capture details or your private GPS trail to place them on the journey. Add captions and comments so the map becomes a record everyone on the trip can revisit.

Features:

- Private, invitation-only trips
- Live background location sharing with visible pause and removal controls
- Offline GPS queue with automatic retry
- Up to 20 Apple Photos per selection
- Photo placement from EXIF GPS or capture-time trail matching
- Fast resized images and thumbnails while originals stay in Apple Photos/iCloud
- Shared itinerary, routes, comments and likes
- Account deletion inside the app

Location sharing is optional and can reduce battery life. Continued use of GPS running in the background can decrease battery life.

## Keywords

`travel,trip,route,itinerary,map,photos,family,location,journal,vacation`

## Review notes

Off We Go is invitation-only. Provide App Review with a dedicated reviewer account whose verified email has a pending invitation to a sample trip. The reviewer signs in with the supplied Off We Go ID credentials, accepts the invitation in the app, and then opens the sample trip.

To test background location: sign in, open the people/phones panel, register the test device, start sharing, and accept the iOS location prompts. The status card exposes pause/resume and removal controls. Location is visible only to members of that private trip and is retained for 30 days.

To test Photos: choose Add photo, select one or more items, and upload. The app uploads a resized copy and thumbnail; it does not alter or delete the Apple Photos original.

To delete the account: open the people/phones panel, scroll to Account, tap Delete my account, and type `DELETE`.

Trips are private and invitation-only. Trip owners can delete comments/photos, revoke invitations, and remove a member and that member's reporting phones. Every member can use “Report a safety concern” in the people panel; published standards are at `https://offwego.to/terms.html` and safety contact is `safety@threadway.ai`.

## App Privacy answers

Declare these data types as collected and linked to the user:

- Contact Info: Email Address — app functionality and authentication.
- User Content: Photos or Videos, Other User Content — app functionality.
- Location: Precise Location — app functionality; background collection only after opt-in.
- Identifiers: User ID — app functionality and security.
- Usage Data: Product Interaction — only if production server logging is configured to retain it; otherwise do not declare it.
- Diagnostics: Crash Data/Performance Data — only if a crash or telemetry service is later added.

Do not declare tracking. Off We Go does not combine data across other companies' apps or websites for advertising or broker purposes.

## Required manual App Store Connect values

- Apple Developer Team ID and signing/provisioning selection
- SKU (suggested: `WAYFARE-IOS-001`)
- App Review contact name, phone and email
- Dedicated review-account email invited to a sample trip
- Final screenshots produced from the signed build
- Price/availability territories and copyright holder

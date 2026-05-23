# Junior Ranger Firebase Cutover

Date: 2026-05-23

## Firebase Project

- Project ID: `junior-ranger-map-auth`
- Project number: `937801458577`
- Display name: `Junior Ranger Map Auth`
- Web app ID: `1:937801458577:web:56bc917b26d3ea4c2a3030`
- Hosting site: `junior-ranger-map-auth`
- Console: `https://console.firebase.google.com/project/junior-ranger-map-auth/overview`

## Completed

- Created the new Google Cloud/Firebase project.
- Registered the Junior Ranger web app.
- Created the default Cloud Firestore database in `nam5`.
- Deployed the repo Firestore rules to the new project.
- Initialized Firebase Authentication.
- Enabled Email/Password sign-in.
- Verified Google sign-in is enabled.
- Smoke tested Email/Password account creation and deleted the temporary test user.
- Pointed the repo default Firebase alias to `junior-ranger-map-auth`.
- Moved the public app and admin page SDK config off `barkrangermap-auth`.
- Kept the old BARK project as an explicit `.firebaserc` alias named `bark` so it is not the default deploy target.

## Auth Verification

- Authorized domains include `junior-ranger-map-auth.firebaseapp.com` and `junior-ranger-map-auth.web.app`.
- Email/Password sign-up returned an ID token during the smoke test.
- The temporary smoke-test user was deleted immediately after the successful sign-up check.

## Billing-Gated Follow-Up

Cloud Functions and function secrets cannot be deployed until a billing account is attached to the new project. After billing is attached:

1. Enable the remaining services if needed: Cloud Build, Artifact Registry, Secret Manager, Cloud Functions.
2. Add function secrets for `ORS_API_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `GEMINI_PAID_API_KEY`, and `GOOGLE_MAPS_API_KEY` as needed.
3. Deploy functions with `npx firebase-tools deploy --only functions --project junior-ranger-map-auth`.

Do not export or import BARK Auth users into this project unless a deliberate migration is approved. The Junior Ranger account base should start clean.

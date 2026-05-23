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
- Pointed the repo default Firebase alias to `junior-ranger-map-auth`.
- Moved the public app and admin page SDK config off `barkrangermap-auth`.
- Kept the old BARK project as an explicit `.firebaserc` alias named `bark` so it is not the default deploy target.

## Console Steps Still Needed

Firebase Authentication still needs to be initialized in the Firebase console because the public Identity Platform admin API requires billing before it can initialize Auth programmatically.

1. Open `https://console.firebase.google.com/project/junior-ranger-map-auth/authentication/providers`.
2. Click **Get started** if Authentication is not initialized yet.
3. Enable **Email/Password**.
4. Enable **Google** and set the project support email.
5. Confirm authorized domains include the Firebase Hosting domains:
   - `junior-ranger-map-auth.firebaseapp.com`
   - `junior-ranger-map-auth.web.app`

## Billing-Gated Follow-Up

Cloud Functions and function secrets cannot be deployed until a billing account is attached to the new project. After billing is attached:

1. Enable the remaining services if needed: Cloud Build, Artifact Registry, Secret Manager, Cloud Functions.
2. Add function secrets for `ORS_API_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `GEMINI_PAID_API_KEY`, and `GOOGLE_MAPS_API_KEY` as needed.
3. Deploy functions with `npx firebase-tools deploy --only functions --project junior-ranger-map-auth`.

Do not export or import BARK Auth users into this project unless a deliberate migration is approved. The Junior Ranger account base should start clean.

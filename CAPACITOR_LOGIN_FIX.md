# Capacitor Android login transition fix

This patch preserves the existing project structure and business functionality.

## Files included

- `frontend/src/lib/api.js`
- `frontend/src/App.jsx`
- `frontend/src/pages/Login.jsx`

## What changed

1. Native Capacitor builds automatically use the deployed Render API:
   `https://daily-expenses-g4ze.onrender.com/api`
   unless `VITE_API_BASE_URL` is explicitly set.

2. Login now guarantees a usable user object. If a compatible backend ever omits
   `user` from the login response, the frontend fetches `/api/me` with the new JWT.

3. The post-login route is selected explicitly in React state/history. The
   authenticated screen no longer depends on a normal browser navigation to
   leave the login page, which is important for a bundled Capacitor WebView.

4. When a requested route is not permitted, the app chooses `/dashboard` when
   available and otherwise the first permitted module.

## Apply

Copy the three files into the same paths in your existing repository.

Then rebuild the frontend and resync the existing Android project:

```bash
cd frontend
npm run build
npx cap sync android
```

Then rebuild/run the Android app from Android Studio.

## Important Capacitor setting

For a production Android build, do not use `server.url` in `capacitor.config.*`
to point at the Vercel site. Capacitor documents `server.url` as a live-reload
setting, not a production deployment mechanism. The normal production setup is
to bundle the Vite `dist` directory and let the native WebView load those assets.

The backend already allows cross-origin requests (`CORS_ORIGIN=*` in the current
Render configuration), so no backend CORS change is required for this fix.

## Verification

After installing the rebuilt APK:

1. Open the app and log in.
2. The login success response stores the JWT.
3. The app immediately switches React state to the authenticated layout.
4. `/dashboard` is selected when the logged-in user has dashboard permission.
5. On the next cold start, `/api/me` restores the session from the stored JWT.

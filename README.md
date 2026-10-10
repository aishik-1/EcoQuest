<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/04d64a0a-2825-482c-92f3-e2426ced73b1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to Vercel

1. Push this repository to GitHub / GitLab / Bitbucket.
2. In Vercel, import the repository.
3. Vercel automatically detects the framework preset as **Vite** (via `vercel.json`):
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. (Optional) Add your Environment Variables in Vercel Project Settings:
   - `GEMINI_API_KEY`
   - `VITE_GOOGLE_MAPS_API_KEY`
5. Click **Deploy**. The project will build and deploy cleanly with zero errors.

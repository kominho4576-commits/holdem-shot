# Hold'em & Shot – Web App Skeleton

This repository contains a **client** (Vercel) and a **server** (Render) skeleton.
Files are intentionally empty placeholders so you can push to GitHub first. 
I will provide full code to paste into each file next.

## Structure
```
holdem-shot/
  client/                 # React + TypeScript (Vite). Deploy to **Vercel**
  server/                 # Node + Express + Socket.IO. Deploy to **Render**
  vercel.json             # (client) headers & SPA fallback (optional)
  render.yaml             # (server) Render service template
```

## Quick Start (Local Dev)
1) **Server**
```bash
cd server
npm i
# put your vars in .env (see .env.example)
npm run dev
```
2) **Client**
```bash
cd client
npm i
npm run dev
```
Open http://localhost:5173

## Deploy
- **Render (server)**
  - New Web Service → Connect this repo → `server` directory
  - Build: `npm i`
  - Start: `npm start`
  - Add env: `CORS_ORIGIN=https://<your-vercel-domain>`

- **Vercel (client)**
  - Import GitHub repo → `client` directory
  - Framework: Vite
  - Env: `VITE_SERVER_URL=https://<your-render-domain>`
  - Build Command: `npm run build`
  - Output: `dist`

## Icons
- App icon is a "Joker card with a bullet hole" at `client/public/icon.svg`.

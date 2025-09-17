# Hold'em & Shot – Web App (Mobile portrait–first)

Monorepo for the web version of **Hold’em & Shot**.

- **client/**: Vite + React (TypeScript). Deploy to **Vercel**.
- **server/**: Node.js + Express + Socket.IO. Deploy to **Render** (Free Web Service).

This commit contains **empty placeholders** only. Ask ChatGPT “다음” and it will deliver **full code** file‑by‑file in follow‑up messages.

---

## Mobile portrait–first
Design mirrors the provided sketches exactly for **mobile portrait**. Desktop and tablet will scale from that baseline.

## Deploy (quick outline)
1) **GitHub**
   - Create a repo and push this folder.

2) **Render (server)**
   - New → Web Service → Connect this repo → Root: `server`
   - Build Command: `npm ci && npm run build` (if TS) or `npm ci`
   - Start Command: `npm start`
   - Environment: add `CORS_ORIGIN=https://<your-vercel-domain>` (later we’ll support multiple origins).
   - Note the deployed URL, e.g. `https://holdem-shot-api.onrender.com`.

3) **Vercel (client)**
   - New Project → Import GitHub → Root: `client`
   - Build Command: `npm run build`
   - Output: `dist`
   - Add env: `VITE_SERVER_URL=https://<render-url>`

4) **Local dev**
   ```bash
   # terminal A
   cd server && npm i && npm start
   # terminal B
   cd client && npm i && npm run dev
   ```

---

## File map
```
client/
  src/
    pages/
      Home.tsx        # 화면 1: 홈
      Match.tsx       # 화면 2: 매칭
      Game.tsx        # 화면 3: 플레이(홀덤/룰렛 탭 분리)
      Result.tsx      # 화면 4/5: 승리/패배
    components/
      ServerPill.tsx
      Card.tsx
      Roulette.tsx
      Modal.tsx
      TopBar.tsx
    styles/
      globals.css
    lib/
      socket.ts
      types.ts
    assets/
      spadeA.svg
    main.tsx
    App.tsx
  index.html
  vite.config.ts
  tsconfig.json
  package.json

server/
  src/
    index.ts          # Express + Socket.IO 진입점
    game/
      engine.ts       # 라운드/플로우 상태 머신
      matchmaker.ts   # 퀵매치/룸 매칭
      rules.ts        # 족보/조커/룰렛 로직
      types.ts
  package.json
  tsconfig.json
  .env.example
```

> Next: say **“다음”** and I’ll start filling each file with full code (beginning with the **server/src/index.ts** and core game flow).

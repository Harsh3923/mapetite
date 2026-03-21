# Mapetite — Map your appetite, before you forget it.

A full-stack web app with a 3D Toronto/GTA map. Search for restaurants, save them, and they appear as glowing amber markers on the map. Light style during the day, dark style at night.

---

## Prerequisites

- **Node.js** 18+ — [nodejs.org](https://nodejs.org)
- **PostgreSQL** 15+ — [postgresql.org](https://www.postgresql.org/download/)
- **Maptiler account** (free, no credit card) — [maptiler.com](https://www.maptiler.com/)
- **VS Code Live Server** extension (or any static file server)

---

## Setup (5 steps)

### 1. Create the database

```bash
# Open psql or pgAdmin and run:
CREATE DATABASE mapetite;
```

Or via command line:
```bash
createdb mapetite
```

### 2. Configure backend environment

```bash
cd mapetite/backend
cp .env.example .env
```

Edit `.env` with your values:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/mapetite"
ACCESS_TOKEN_SECRET="paste-a-long-random-string-here"
REFRESH_TOKEN_SECRET="paste-a-different-long-random-string-here"
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5500
```

**Generate secrets** (run in your terminal):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Run it twice — use one for ACCESS_TOKEN_SECRET and one for REFRESH_TOKEN_SECRET.

### 3. Install dependencies & run migrations

```bash
cd mapetite/backend
npm install
npx prisma migrate dev --name init
npm run dev
```

You should see:
```
✓ Mapetite API running on http://localhost:3001
```

### 4. Add your Maptiler key

Open `mapetite/frontend/js/app.js` and set your free Maptiler API key:

```js
MAPTILER_KEY: "your-maptiler-key-here",
```

Get your free key at: https://cloud.maptiler.com/account/keys/

### 5. Open the frontend

- Open VS Code in the `mapetite/frontend/` folder
- Right-click `index.html` → **Open with Live Server**
- It opens at `http://localhost:5500`

---

## Usage

1. The 3D Toronto/GTA map loads immediately (light in daytime, dark at night)
2. Click **Sign In** → Register with email + password
3. Type a restaurant name in the search bar
4. Click a result → info card slides in
5. Click **Save Place** → an amber marker rises on the map
6. Click **My Saves** → see your saved list, click any to fly there
7. Refresh the page → auto-logged in, your saves reload

---

## Project Structure

```
mapetite/
├── backend/
│   ├── .env                  ← your secrets (never commit this)
│   ├── server.js             ← Express app entry
│   ├── db.js                 ← Prisma client
│   ├── prisma/
│   │   └── schema.prisma     ← database models
│   ├── middleware/
│   │   └── auth.js           ← JWT verification
│   └── routes/
│       ├── auth.js           ← register/login/logout/refresh
│       └── places.js         ← save/fetch/delete places
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── app.js            ← bootstrap + authFetch
        ├── map.js            ← MapLibre GL JS v4 layers
        ├── auth.js           ← modal UI + tokens
        └── places.js         ← search, save, sidebar
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/auth/register | — | Create account |
| POST | /api/auth/login | — | Sign in (+ rememberMe) |
| POST | /api/auth/logout | — | Clear cookie |
| POST | /api/auth/refresh | cookie | New access token |
| GET | /api/places | ✓ | Get all saved places |
| POST | /api/places | ✓ | Save a place |
| PATCH | /api/places/:id | ✓ | Update notes |
| DELETE | /api/places/:id | ✓ | Remove a place |

---

## Troubleshooting

**Map doesn't load:**
Check your Maptiler key in `app.js` — make sure it's valid at cloud.maptiler.com

**"Network error" on login:**
Make sure the backend is running (`npm run dev` in `/backend`)

**Database connection error:**
Check your `DATABASE_URL` in `.env` — ensure PostgreSQL is running and the password is correct

**CORS error in browser:**
Make sure `FRONTEND_URL` in `.env` matches exactly where Live Server is serving (`http://localhost:5500`)

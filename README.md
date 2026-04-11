# BillEasy License Server

A Node.js/Express license validation server with an admin dashboard for managing BillEasy activation keys. Uses **MongoDB** for persistent storage.

## Features

- **MongoDB persistence** — licenses survive server restarts and redeployments
- **Admin Dashboard** — premium dark-themed UI at `/admin`
- **Key generation** — `BILL-XXXX-XXXX-XXXX` format
- **Machine binding** — one key = one PC (admin can unbind)
- **Vendor tracking** — see who activated, when, on which machine
- **Real-time stats** — total, active, pending, expired, deactivated
- **Toggle/delete/unbind** — full lifecycle management
- **Auto-refresh** — dashboard updates every 10 seconds
- **Backward compatible** — works with existing BillEasy desktop app

## Quick Start (Local)

```bash
npm install
MONGO_URI=mongodb://localhost:27017/billeasy-licenses ADMIN_SECRET=your_secret_here node server.js
```

Open **http://localhost:3001/admin** and sign in with your secret.

## Deploy to Render.com (Free)

1. Push this folder as a GitHub repo
2. Create a free **MongoDB Atlas** cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
   - Create a database user and whitelist `0.0.0.0/0` for access
   - Copy the connection string (e.g. `mongodb+srv://user:pass@cluster.mongodb.net/billeasy-licenses`)
3. Create a **Web Service** on [render.com](https://render.com)
4. Settings:

| Setting | Value |
|---------|-------|
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | Free |

5. Environment variables:

| Key | Value |
|-----|-------|
| `ADMIN_SECRET` | A strong password |
| `MONGO_URI` | Your MongoDB Atlas connection string |
| `PORT` | `10000` |

6. Deploy → your dashboard is at `https://YOUR-APP.onrender.com/admin`

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/admin` | — | Admin dashboard (HTML) |
| `POST` | `/admin/login` | body: `secret` | Verify admin secret |
| `GET` | `/admin/stats` | header: `X-Admin-Token` | Dashboard metrics |
| `GET` | `/admin/licenses` | header: `X-Admin-Token` | List all licenses |
| `POST` | `/admin/create` | header: `X-Admin-Token` | Generate a new key |
| `POST` | `/admin/toggle` | header: `X-Admin-Token` | Enable/disable a key |
| `POST` | `/admin/unbind` | header: `X-Admin-Token` | Detach machine binding |
| `POST` | `/admin/delete` | header: `X-Admin-Token` | Permanently delete key |
| `POST` | `/validate` | — | BillEasy app validates here |
| `GET` | `/health` | — | Health check |

## How It Works

1. Admin generates a key in the dashboard
2. Admin shares the key + download link with the vendor
3. Vendor installs BillEasy and enters the key
4. First activation binds the key to that PC's Windows GUID
5. After activation, BillEasy works **100% offline** — server is never contacted again
6. If vendor switches PCs, admin clicks "Unbind" and vendor re-activates

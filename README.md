# WhatsApp Bot Backend

## Local
```
npm install
npm start
```
Server: http://localhost:3000

## Render Deploy
1. Push this folder to GitHub
2. Render → New Web Service → connect repo
3. Build: `npm install`  Start: `npm start`
4. Add **Disk** mounted at `/opt/render/project/src/auth_info` (1 GB) — warna session restart pe gum ho jayega
5. Frontend me **Backend URL** = `https://your-app.onrender.com`

## Endpoints
- `GET  /status` → connection state + QR data URL
- `POST /pair`  `{ phone: "919812345678" }` → pairing code
- `POST /logout`
- `POST /create-group` `{ user_id, name? }`

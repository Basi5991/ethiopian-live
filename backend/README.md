# Terjuman.live Django REST API

Production-ready Django backend for the Terjuman.live remote interpretation platform.

## Stack

- Django 4.2+ with Django REST Framework
- SQLite (development) — switch to PostgreSQL via environment variables
- Google Gemini (`GEMINI_API_KEY`) with offline mock fallbacks
- CORS enabled for the React/Vite frontend

## Quick start

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py seed_demo_data
python manage.py runserver 8000
```

## Connect the frontend

In `frontend/vite.config.ts`, proxy API calls to Django during development:

```ts
server: {
  proxy: {
    '/api': 'http://localhost:8000',
  },
},
```

Then run the frontend (`npm run dev`) and the poller will sync from `GET /api/init`.

## Demo users

| ID | Name | Role |
|---|---|---|
| usr_admin1 | Almaz Kebede | admin |
| usr_client13 | Dawit Yohannes | client |
| usr_int1 | Bekele Megersa | interpreter |
| usr_int2 | Haleema Bashir | interpreter |
| usr_int3 | Yared Girmay | interpreter |
| usr_int4 | Selamawit Tadesse | interpreter |

Password for all seeded users: `demo1234` (Django auth; frontend uses client-side demo login).

## API endpoints

All routes are under `/api/`:

- `GET /api/init` — full application state
- Session lifecycle: `request`, `accept`, `reject`, `chat`, `complete`, `intervene`
- `POST /api/calls/dial` — direct interpreter dial
- Wallet: `deposit`, `payout`
- Contracts: `create`, `select`, `extend`
- `POST /api/users/<id>/update`
- `POST /api/scheduler/update`
- Gemini: `translate`, `speech-caption`, `session-summary`, `smart-match`
- Orzo AI: `orzo/translate`, `orzo/chat`

## PostgreSQL (production)

Set in `.env`:

```
DB_ENGINE=django.db.backends.postgresql
DB_NAME=terjuman
DB_USER=postgres
DB_PASSWORD=your-password
DB_HOST=localhost
DB_PORT=5432
```

## Reseed data

```bash
python manage.py seed_demo_data --flush
```

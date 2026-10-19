# RTA Schedule API — foundation

This is a first server-side foundation for the Telegram Mini App. It is deliberately separate from the existing GitHub Pages frontend, so the current app keeps working while the API is prepared.

## Included

- FastAPI app with `/health`, `/api/me`, `/api/groups`, and `/api/schedule/{group_code}`.
- Telegram Mini App `initData` HMAC verification on user-facing API routes.
- PostgreSQL schema for groups, weekly lessons, date-specific additions/removals, Telegram users, group representatives, subscriptions, and an audit log.
- Four current law-faculty groups pre-seeded in SQL.
- Environment-variable template; secrets must not be committed.

## 1. Create the database

1. Create a project in Supabase.
2. Open its SQL Editor and run `server/schema.sql`.
3. Copy a PostgreSQL connection string from the database settings. Use the provider's recommended connection/pooler string for the deployment environment.

The tables have Row Level Security enabled and no public policies. The API uses a private server-side database connection; never put database credentials or a service-role key in `index.html`.

## 2. Configure locally

From the repository root:

```powershell
cd server
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Fill in `.env` with:
- `TELEGRAM_BOT_TOKEN`: the existing bot token from BotFather.
- `DATABASE_URL`: PostgreSQL connection string.
- `ALLOWED_ORIGINS`: keep the GitHub Pages origin and any local development origin needed.

Do not paste bot tokens or database passwords into chat or commit them to GitHub.

Run the API:

```powershell
uvicorn app.main:app --reload --port 8000
```

Check `http://127.0.0.1:8000/health` and API documentation at `http://127.0.0.1:8000/docs`.

## 3. Deploy the API

Deploy the `server` directory to a Python host that supports FastAPI, configure the same environment variables in that host's dashboard, and use this start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set a stable HTTPS API URL before wiring the Mini App frontend to it.

## Important current limitations

- The API is read-only: it does not yet accept schedule edits or payment notifications.
- The existing frontend is not connected to this API yet.
- The current schedule data has not been imported automatically. After the database is created, the existing in-app schedule must be converted to a verified import and checked against the official timetable PDF.
- Representative permissions and subscriptions have schema placeholders only. No one is granted representative rights and no payment is processed by this foundation.
- Keep a backup/export of the database before importing or changing schedule data.

## Planned next steps

1. Add API tests (Telegram signature, expired initData, group lookup, date overrides).
2. Export the four current groups' timetable from the frontend into a validated import file.
3. Compare the import against the official PDF before inserting the lessons.
4. Deploy the API and test the endpoints.
5. Connect the Mini App frontend, then implement authenticated representative editing with history/undo.

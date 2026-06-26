#!/usr/bin/env bash
set -o errexit

echo "==> Installing Python dependencies"
pip install -r backend/requirements.txt

echo "==> Building React frontend"
cd frontend
npm ci
npm run build:render
cd ..

echo "==> Django migrate & collectstatic"
cd backend
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py seed_demo_data

echo "==> Build complete"

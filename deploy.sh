#!/bin/bash
set -euo pipefail

echo "🚀 Starting deployment process..."

if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

if ! vercel whoami &> /dev/null; then
    echo "🔐 Please login to Vercel..."
    vercel login
fi

# Fail fast locally rather than discovering type errors in the build logs.
echo "🔍 Type-checking..."
npm run typecheck

echo "🔨 Building project..."
npm run build

echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "📱 Don't forget to:"
echo "   1. Set environment variables in the Vercel dashboard (see env-template.txt)"
echo "   2. Deploy the Socket.IO server separately (Railway/Render) and set"
echo "      NEXT_PUBLIC_SOCKET_URL, SOCKET_SERVER_URL, SOCKET_EMIT_SECRET and"
echo "      SOCKET_ALLOWED_ORIGINS — the socket server will not start without the last two"
echo "   3. Back up the production database, then run: npm run db:deploy"
echo "      (the schema-hardening migration de-duplicates rows before adding unique constraints)"

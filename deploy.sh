#!/bin/bash

echo "🚀 Starting deployment process..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Check if user is logged in
if ! vercel whoami &> /dev/null; then
    echo "🔐 Please login to Vercel..."
    vercel login
fi

# Build the project
echo "🔨 Building project..."
npm run build

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "📱 Don't forget to:"
echo "   1. Set environment variables in Vercel Dashboard"
echo "   2. Deploy Socket.IO server separately (Railway/Render)"
echo "   3. Update NEXT_PUBLIC_SOCKET_URL in Vercel"
echo "   4. Run database migrations on production database" 
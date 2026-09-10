# 🚀 Vercel Deployment Guide

## Overview
This guide will help you deploy your job portal application to Vercel. Since your app includes Socket.IO and a database, we'll need to handle some special considerations.

## ⚠️ Important Limitations

### Socket.IO on Vercel
**Vercel doesn't support long-running WebSocket connections** in serverless functions. You have two options:

1. **Deploy Socket.IO server separately** (Recommended)
2. **Use alternative real-time solutions** (Pusher, Ably, etc.)

## 🎯 Option 1: Separate Socket.IO Server (Recommended)

### Step 1: Deploy Socket.IO Server
Deploy your `socket-server.js` to a platform that supports WebSockets:

#### Option A: Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

#### Option B: Render
```bash
# Create a new Web Service on Render
# Upload your socket-server.js and package.json
# Set environment variables
```

#### Option C: DigitalOcean App Platform
```bash
# Create a new app from GitHub
# Select Node.js runtime
# Point to your socket-server.js
```

### Step 2: Update Environment Variables
Add your Socket.IO server URL to Vercel:

```bash
NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.railway.app
```

## 🎯 Option 2: Alternative Real-Time Solutions

### Replace Socket.IO with Pusher
```bash
npm install pusher pusher-js
```

Update your environment variables:
```bash
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster
```

## 🗄️ Database Setup

### Option A: Use Vercel Postgres
1. Go to Vercel Dashboard
2. Create a new Postgres database
3. Copy the connection string
4. Add to environment variables:
```bash
DATABASE_URL=postgresql://...
```

### Option B: Use External Database
- **Supabase** (Free tier available)
- **Neon** (Serverless Postgres)
- **PlanetScale** (MySQL)

## 🔧 Deployment Steps

### 1. Prepare Your Project
```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login
```

### 2. Set Environment Variables
```bash
# Database
DATABASE_URL=your_production_database_url

# JWT (generate with: openssl rand -base64 48)
JWT_SECRET=your_production_jwt_secret

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# App URL
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# Google sign-in (optional - omit to disable the Google buttons)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=your_nextauth_secret

# Socket.IO - all four are required for real-time chat in production.
# Real-time is disabled (the app falls back to plain REST) when
# NEXT_PUBLIC_SOCKET_URL is unset, rather than hanging on a dead host.
NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.com   # browser -> socket server
SOCKET_SERVER_URL=https://your-socket-server.com        # Next.js API -> socket server
SOCKET_EMIT_SECRET=your_long_random_shared_secret       # required in production
SOCKET_ALLOWED_ORIGINS=https://your-app.vercel.app      # required in production
```

> **Note:** `SOCKET_EMIT_SECRET` and `SOCKET_ALLOWED_ORIGINS` are mandatory on the
> Socket.IO host in production - the server refuses to start without them, because
> `/emit-message` would otherwise let anyone forge a chat message into any
> conversation.

### 3. Deploy to Vercel
```bash
# Deploy
vercel --prod

# Or use GitHub integration for automatic deployments
```

### 4. Run Database Migrations
```bash
# Generate Prisma client
npm run db:generate

# Apply migrations (NOT `db push` - the hardening migration de-duplicates
# existing rows before adding unique constraints, and `db push` skips it)
npm run db:deploy
```

> **Back up your database first.** The `20260910120000_harden_schema` migration adds
> `UNIQUE(userId, jobId)` on applications and `UNIQUE(userId, companyId)` on
> conversations. It deletes duplicate rows, keeping the earliest of each pair, and
> re-points messages from duplicate conversations onto the surviving thread.

## 🌐 Environment Variables in Vercel

1. Go to your project in Vercel Dashboard
2. Navigate to Settings → Environment Variables
3. Add each variable from your `.env` file
4. Make sure to set them for **Production** environment

## 📱 Post-Deployment Checklist

- [ ] Database migrations applied (`npm run db:deploy`)
- [ ] Authentication working, for both password and Google sign-in
- [ ] Resume upload working (Cloudinary)
- [ ] Real-time chat working, or gracefully disabled if you skipped the socket server
- [ ] All API routes responding
- [ ] Images loading correctly
- [ ] Rotate any credential that was ever committed to the repository

## 🚨 Common Issues & Solutions

### Issue: Database Connection Failed
**Solution**: Check your `DATABASE_URL` and ensure the database is accessible from Vercel's servers.

### Issue: Socket.IO Not Working
**Solution**: Deploy Socket.IO server separately or switch to Pusher/Ably.

### Issue: Build Failures
**Solution**: Check that all dependencies are in `dependencies` not `devDependencies`.

### Issue: Environment Variables Not Loading
**Solution**: Ensure variables are set for the correct environment (Production).

## 🔄 Continuous Deployment

1. Connect your GitHub repository to Vercel
2. Every push to `main` branch will trigger automatic deployment
3. Preview deployments for pull requests

## 📊 Monitoring

- Use Vercel Analytics for performance monitoring
- Check Function Logs for API errors
- Monitor database performance
- Set up error tracking (Sentry, LogRocket)

## 💰 Cost Considerations

- **Vercel**: Free tier available, pay per usage
- **Database**: Free tiers available on Supabase, Neon
- **Socket.IO Server**: Free on Railway, Render
- **File Storage**: Cloudinary free tier available

## 🎉 Success!

Once deployed, your job portal will be accessible at:
`https://your-app-name.vercel.app` 
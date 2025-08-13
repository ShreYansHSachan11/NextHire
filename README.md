# Job Portal - Full Stack Application

A comprehensive job portal built with Next.js, Prisma, PostgreSQL, and Socket.IO for real-time messaging.

## Features

- 🔐 User authentication (Job Seekers & Companies)
- 💼 Job posting and application management
- 📄 Resume upload with Cloudinary integration
- 💬 Real-time messaging between companies and applicants
- 🔔 Notification system
- 📱 Responsive design with Tailwind CSS

## Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Cloudinary account (for file uploads)

## Environment Setup

1. Copy the environment template:
```bash
cp env-template.txt .env.local
```

2. Update `.env.local` with your actual credentials:
```env
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/jobportal"

# JWT Configuration  
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME="your-cloudinary-cloud-name"
CLOUDINARY_API_KEY="your-cloudinary-api-key"
CLOUDINARY_API_SECRET="your-cloudinary-api-secret"

# Application Configuration
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
SOCKET_SERVER_PORT="3002"
```

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up the database:
```bash
npx prisma generate
npx prisma db push
```

3. Run the development server:
```bash
# For development with Socket.IO
npm run dev:both

# Or run separately:
npm run dev          # Next.js app
npm run dev:socket   # Socket.IO server
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
job-portal/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── company/           # Company dashboard
│   ├── seeker/            # Job seeker dashboard
│   └── jobs/              # Job-related pages
├── lib/                   # Utilities and configurations
├── prisma/                # Database schema and migrations
├── store/                 # Redux store and slices
└── public/                # Static assets
```

## API Endpoints

- `POST /api/auth` - User registration and login
- `GET/POST /api/jobs` - Job management
- `GET/POST /api/applications` - Job applications
- `GET/POST /api/resumes` - Resume upload
- `GET/POST /api/conversations` - Messaging
- `GET/POST /api/notifications` - Notifications

## Security Features

- Environment variable validation
- JWT-based authentication
- Password hashing with bcrypt
- Input validation and sanitization
- Secure file upload handling

## Deployment

The application is ready for deployment on platforms like Vercel, Netlify, or any Node.js hosting service.

Remember to:
- Set up environment variables in your hosting platform
- Configure your PostgreSQL database
- Set up Cloudinary credentials
- Update the Socket.IO server configuration for production

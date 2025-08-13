import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    // Test environment variables
    const envCheck = {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasCloudinaryName: !!process.env.CLOUDINARY_CLOUD_NAME,
      nodeEnv: process.env.NODE_ENV,
    };

    // Test database connection
    const dbTest = await prisma.$queryRaw`SELECT 1 as test`;
    
    return NextResponse.json({
      success: true,
      message: 'Database connection successful',
      envCheck,
      dbTest,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Database test error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: String(error),
      envCheck: {
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasJwtSecret: !!process.env.JWT_SECRET,
        hasCloudinaryName: !!process.env.CLOUDINARY_CLOUD_NAME,
        nodeEnv: process.env.NODE_ENV,
      },
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 
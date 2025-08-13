import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ 
        error: 'No authorization header found',
        authHeader: authHeader 
      }, { status: 401 });
    }
    
    const token = authHeader.substring(7);
    
    if (!token) {
      return NextResponse.json({ 
        error: 'No token found in authorization header' 
      }, { status: 401 });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      return NextResponse.json({
        success: true,
        token: token.substring(0, 20) + '...',
        decoded: decoded,
        env: {
          hasJwtSecret: !!process.env.JWT_SECRET,
          jwtSecretLength: process.env.JWT_SECRET?.length || 0
        }
      });
    } catch (jwtError) {
      return NextResponse.json({
        error: 'Token verification failed',
        jwtError: jwtError instanceof Error ? jwtError.message : 'Unknown error',
        token: token.substring(0, 20) + '...'
      }, { status: 401 });
    }
    
  } catch (error) {
    console.error('Debug token error:', error);
    return NextResponse.json({ 
      error: 'Failed to process token debug request' 
    }, { status: 500 });
  }
} 
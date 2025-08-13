import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { env } from '@/lib/env';
import 'dotenv/config';

export async function GET(req: NextRequest) {
  try {
    // Get token from cookie
    const token = req.cookies.get('token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: 'No token found' }, { status: 401 });
    }
    
    // Decode token
    const decoded = jwt.verify(token, env.JWT_SECRET);
    
    return NextResponse.json({ 
      message: 'Token decoded successfully',
      tokenData: decoded
    });
  } catch (error) {
    console.error('Token decode error:', error);
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, password, name, role } = body;

    if (!action || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (action === 'register') {
      try {
        // Check if user exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          return NextResponse.json({ error: 'User already exists' }, { status: 409 });
        }
        
        // Hash password
        const hashed = await bcrypt.hash(password, 10);
        
        let companyId = null;
        
        // If registering as a company, create a company record
        if (role === 'COMPANY') {
          console.log('Creating company for user:', name);
          
          const company = await prisma.company.create({
            data: {
              name: name,
              profile: `Company profile for ${name}`
            }
          });
          
          companyId = company.id;
          console.log('Company created with ID:', companyId);
        }
        
        // Create user with companyId if applicable
        const user = await prisma.user.create({
          data: {
            email,
            password: hashed,
            name: name || '',
            role: role || 'SEEKER',
            companyId: companyId
          },
          include: {
            company: true
          }
        });
        
        // Create JWT token for registration
        const token = jwt.sign({ 
          id: user.id, 
          email: user.email, 
          role: user.role,
          companyId: user.companyId,
          name: user.name,
          companyName: user.company?.name || null
        }, env.JWT_SECRET, { expiresIn: '7d' });
        
        return NextResponse.json({ 
          message: 'User registered', 
          token,
          user: { 
            id: user.id, 
            email: user.email, 
            name: user.name, 
            role: user.role,
            companyId: user.companyId,
            company: user.company
          } 
        }, { status: 201 });
      } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
      }
    }

    if (action === 'login') {
      try {
        // Find user with company information
        const user = await prisma.user.findUnique({ 
          where: { email },
          include: {
            company: true
          }
        });
        
        if (!user) {
          return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }
        
        // Check password
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }
        
        // Debug: Log user data
        console.log('Login - User data:', {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          companyId: user.companyId,
          company: user.company
        });
        
        // Create JWT
        const jwtPayload = { 
          id: user.id, 
          email: user.email, 
          role: user.role,
          companyId: user.companyId,
          name: user.name,
          companyName: user.company?.name || null
        };
        
        console.log('Login - JWT payload:', jwtPayload);
        
        const token = jwt.sign(jwtPayload, env.JWT_SECRET, { expiresIn: '7d' });
        
        return NextResponse.json({ 
          message: 'Login successful', 
          token, 
          user: { 
            id: user.id, 
            email: user.email, 
            name: user.name, 
            role: user.role,
            companyId: user.companyId,
            company: user.company
          } 
        });
      } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ error: 'Login failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('API error:', error);
    
    // For debugging - remove in production
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error instanceof Error ? error.message : 'Unknown error'
      : 'Internal server error';
    
    return NextResponse.json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    }, { status: 500 });
  }
} 
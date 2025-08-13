import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';

// Helper function to verify JWT token
function verifyToken(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    console.log("Auth header:", authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log("No valid authorization header found");
      return null;
    }
    
    const token = authHeader.substring(7);
    console.log("Token extracted:", token ? "Token exists" : "No token");
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    console.log("Token verified successfully");
    return decoded as any;
  } catch (error) {
    console.log("Token verification failed:", error);
    return null;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      include: {
        company: true
      }
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Return user data without password
    const { password, ...userData } = user;
    return NextResponse.json(userData);
    
  } catch (error) {
    console.error('GET /api/users/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    console.log("PUT /api/users/[id] called with params:", params);
    
    // Verify authentication
    const decoded = verifyToken(req);
    console.log("Decoded token:", decoded);
    
    if (!decoded) {
      console.log("Authentication failed - no valid token");
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is updating their own profile or is admin
    console.log("Checking permissions - decoded.id:", decoded.id, "params.id:", params.id, "decoded.role:", decoded.role);
    
    if (decoded.id !== params.id && decoded.role !== 'ADMIN') {
      console.log("Permission denied - user can only update their own profile");
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const data = await req.json();
    console.log("Update data received:", data);
    
    // Remove sensitive fields that shouldn't be updated directly
    const { id, password, role, companyId, createdAt, ...updateData } = data;
    
    // Validate required fields
    if (!updateData.name?.trim()) {
      return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
    }
    
    if (!updateData.email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Check if email is already taken by another user
    const existingUser = await prisma.user.findFirst({
      where: {
        email: updateData.email,
        id: { not: params.id }
      }
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email is already taken' }, { status: 400 });
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: updateData,
      include: {
        company: true
      }
    });
    
    console.log("User updated successfully:", updatedUser);
    
    // Return user data without password
    const { password: _, ...userData } = updatedUser;
    return NextResponse.json(userData);
    
  } catch (error) {
    console.error('PUT /api/users/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    // Verify authentication
    const decoded = verifyToken(req);
    if (!decoded) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is deleting their own account or is admin
    if (decoded.id !== params.id && decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ message: 'User deleted successfully' });
    
  } catch (error) {
    console.error('DELETE /api/users/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
} 
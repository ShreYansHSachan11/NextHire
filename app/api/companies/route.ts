import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');
    
    let whereClause = {};
    if (name) {
      whereClause = {
        name: {
          contains: name,
          mode: 'insensitive' // Case-insensitive search
        }
      };
    }
    
    const companies = await prisma.company.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        profile: true,
        createdAt: true
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    return NextResponse.json(companies);
  } catch (error) {
    console.error('GET /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    
    const company = await prisma.company.create({
      data: {
        name: data.name,
        profile: data.profile || null,
      },
    });
    
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    console.error('POST /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const data = await req.json();
    const { id, ...updateData } = data;
    
    const company = await prisma.company.update({
      where: { id },
      data: updateData,
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });
    return NextResponse.json(company);
  } catch (error: any) {
    console.error('PUT /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to update company' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ message: 'Company deleted' });
  } catch (error: any) {
    console.error('DELETE /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to delete company' }, { status: 500 });
  }
} 
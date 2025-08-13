import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');
    
    if (companyId) {
      // Fetch jobs for a specific company with full application details
      console.log('GET /api/jobs - Fetching jobs for company:', companyId);
      
      const jobs = await prisma.job.findMany({
        where: {
          companyId: companyId
        },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              profile: true
            }
          },
          applications: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
      
      console.log('GET /api/jobs - Found', jobs.length, 'jobs for company');
      return NextResponse.json(jobs);
    } else {
      // Fetch all active jobs for job seekers
      const jobs = await prisma.job.findMany({
        include: {
          company: {
            select: {
              id: true,
              name: true,
              profile: true
            }
          },
          applications: {
            select: {
              id: true,
              status: true,
              createdAt: true
            }
          }
        },
        where: {
          isActive: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
      return NextResponse.json(jobs);
    }
  } catch (error) {
    console.error('GET /api/jobs error:', error);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    console.log('POST /api/jobs - Starting job creation...');
    
    const data = await req.json();
    console.log('POST /api/jobs - Received data:', JSON.stringify(data, null, 2));
    
    // Validate required fields
    const requiredFields = ['title', 'description', 'companyId'];
    const missingFields = requiredFields.filter(field => !data[field]);
    
    if (missingFields.length > 0) {
      console.error('POST /api/jobs - Missing required fields:', missingFields);
      return NextResponse.json({ 
        error: `Missing required fields: ${missingFields.join(', ')}` 
      }, { status: 400 });
    }
    
    // Validate companyId format (should be a UUID)
    if (data.companyId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.companyId)) {
      console.error('POST /api/jobs - Invalid companyId format:', data.companyId);
      return NextResponse.json({ 
        error: 'Invalid companyId format' 
      }, { status: 400 });
    }
    

    
    // Check if company exists
    const company = await prisma.company.findUnique({
      where: { id: data.companyId }
    });
    
    if (!company) {
      console.error('POST /api/jobs - Company not found:', data.companyId);
      return NextResponse.json({ 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    console.log('POST /api/jobs - Company found:', company.name);
    
    // Create job with validated data
    const jobData = {
      title: data.title,
      description: data.description,
      salary: data.salary || null,
      experience: data.experience || null,
      location: data.location || null,
      type: data.type || null,
      companyId: data.companyId,
      isActive: true
    };
    
    console.log('POST /api/jobs - Creating job with data:', JSON.stringify(jobData, null, 2));
    
    const job = await prisma.job.create({ 
      data: jobData,
      include: {
        company: true
      }
    });
    
    console.log('POST /api/jobs - Job created successfully:', job.id);
    return NextResponse.json(job, { status: 201 });
    
  } catch (error: any) {
    console.error('POST /api/jobs - Error creating job:', error);
    
    // Handle specific Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json({ 
        error: 'A job with this title already exists for this company' 
      }, { status: 409 });
    }
    
    if (error.code === 'P2003') {
      return NextResponse.json({ 
        error: 'Invalid company reference' 
      }, { status: 400 });
    }
    
    return NextResponse.json({ 
      error: 'Failed to create job',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const data = await req.json();
    const job = await prisma.job.update({
      where: { id: data.id },
      data,
    });
    return NextResponse.json(job);
  } catch (error) {
    console.error('PUT /api/jobs error:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await prisma.job.delete({ where: { id } });
    return NextResponse.json({ message: 'Job deleted' });
  } catch (error) {
    console.error('DELETE /api/jobs error:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
} 
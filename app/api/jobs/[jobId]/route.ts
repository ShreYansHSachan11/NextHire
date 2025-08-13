import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    
    console.log('GET /api/jobs/[jobId] - Fetching job:', jobId);
    
    const job = await prisma.job.findUnique({
      where: { id: jobId },
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
      }
    });
    
    if (!job) {
      console.log('GET /api/jobs/[jobId] - Job not found:', jobId);
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    console.log('GET /api/jobs/[jobId] - Job found:', job.title);
    return NextResponse.json(job);
    
  } catch (error) {
    console.error('GET /api/jobs/[jobId] error:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const data = await req.json();
    
    console.log('PUT /api/jobs/[jobId] - Updating job:', jobId);
    
    const job = await prisma.job.update({
      where: { id: jobId },
      data,
      include: {
        company: {
          select: {
            id: true,
            name: true,
            profile: true
          }
        }
      }
    });
    
    console.log('PUT /api/jobs/[jobId] - Job updated successfully');
    return NextResponse.json(job);
    
  } catch (error) {
    console.error('PUT /api/jobs/[jobId] error:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    
    console.log('DELETE /api/jobs/[jobId] - Deleting job:', jobId);
    
    await prisma.job.delete({
      where: { id: jobId }
    });
    
    console.log('DELETE /api/jobs/[jobId] - Job deleted successfully');
    return NextResponse.json({ message: 'Job deleted successfully' });
    
  } catch (error) {
    console.error('DELETE /api/jobs/[jobId] error:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
} 
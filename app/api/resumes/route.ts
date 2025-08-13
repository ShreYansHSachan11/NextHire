import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '@/lib/env';
import 'dotenv/config';

cloudinary.config({
  cloud_name: env.CLOUDINARY.CLOUD_NAME,
  api_key: env.CLOUDINARY.API_KEY,
  api_secret: env.CLOUDINARY.API_SECRET
});


export const config = {
  api: {
    bodyParser: false,
  },
};

async function uploadToCloudinary(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder: 'resumes' }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    }).end(buffer);
  });
}

export async function GET() {
  try {
    const resumes = await prisma.resume.findMany();
    return NextResponse.json(resumes);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch resumes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('resume') as File;
    const userId = formData.get('userId') as string;
    console.log('POST /api/resumes - userId:', userId, 'file:', file);
    if (!file || !userId) {
      console.error('Missing file or userId');
      return NextResponse.json({ error: 'File and userId are required' }, { status: 400 });
    }
    let uploadResult: any;
    try {
      uploadResult = await uploadToCloudinary(file);
    } catch (cloudErr) {
      console.error('Cloudinary upload error:', cloudErr);
      return NextResponse.json({ error: 'Cloudinary upload failed', details: String(cloudErr) }, { status: 500 });
    }
    let resume;
    try {
      resume = await prisma.resume.create({
        data: {
          url: uploadResult.secure_url,
          userId,
        },
      });
    } catch (prismaErr) {
      console.error('Prisma create error:', prismaErr);
      return NextResponse.json({ error: 'Database error', details: String(prismaErr) }, { status: 500 });
    }
    return NextResponse.json(resume, { status: 201 });
  } catch (error) {
    console.error('POST /api/resumes error:', error);
    return NextResponse.json({ error: 'Failed to upload resume', details: String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('resume') as File;
    const userId = formData.get('userId') as string;
    const id = formData.get('id') as string;
    console.log('PUT /api/resumes - id:', id, 'userId:', userId, 'file:', file);
    if (!file || !userId || !id) {
      console.error('Missing file, userId, or id');
      return NextResponse.json({ error: 'File, userId, and id are required' }, { status: 400 });
    }
    // Get previous resume to delete from Cloudinary if needed
    let prevResume;
    try {
      prevResume = await prisma.resume.findUnique({ where: { id } });
    } catch (prismaErr) {
      console.error('Prisma findUnique error:', prismaErr);
    }
    // Upload new file to Cloudinary
    let uploadResult: any;
    try {
      uploadResult = await uploadToCloudinary(file);
    } catch (cloudErr) {
      console.error('Cloudinary upload error:', cloudErr);
      return NextResponse.json({ error: 'Cloudinary upload failed', details: String(cloudErr) }, { status: 500 });
    }
    // Optionally delete old file from Cloudinary
    if (prevResume && prevResume.url) {
      const urlParts = prevResume.url.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const publicId = fileName.split('.')[0];
      try {
        await cloudinary.uploader.destroy(`resumes/${publicId}`);
      } catch (e) {
        console.error('Cloudinary delete error:', e);
      }
    }
    // Update resume record
    let resume;
    try {
      resume = await prisma.resume.update({
        where: { id },
        data: {
          url: uploadResult.secure_url,
          userId,
        },
      });
    } catch (prismaErr) {
      console.error('Prisma update error:', prismaErr);
      return NextResponse.json({ error: 'Database error', details: String(prismaErr) }, { status: 500 });
    }
    return NextResponse.json(resume);
  } catch (error) {
    console.error('PUT /api/resumes error:', error);
    return NextResponse.json({ error: 'Failed to update resume', details: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await prisma.resume.delete({ where: { id } });
    return NextResponse.json({ message: 'Resume deleted' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete resume' }, { status: 500 });
  }
} 
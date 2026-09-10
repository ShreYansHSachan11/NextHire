import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  requireAuth,
  requireRole,
  badRequest,
  forbidden,
  notFound,
  serverError,
  isUuid,
} from '@/lib/auth';
import { cleanString, cleanText } from '@/lib/validation';

/** Only these two fields are ever writable from the API. */
function readCompanyFields(body: Record<string, unknown>) {
  return {
    name: cleanString(body.name, 100),
    profile: cleanText(body.profile, 2000),
  };
}

/**
 * Public directory lookup. Supports `?id=` and a case-insensitive `?name=`
 * search, and returns only the fields the public pages actually render.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name');
  const id = searchParams.get('id');

  // Typed rather than an untyped object literal, so `mode: 'insensitive'` is
  // actually checked by TypeScript.
  const where: Prisma.CompanyWhereInput = {};
  if (id) {
    if (!isUuid(id)) return badRequest('That company id is not valid');
    where.id = id;
  }
  if (name) where.name = { contains: name, mode: 'insensitive' };

  try {
    const companies = await prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        profile: true,
        createdAt: true,
        _count: { select: { jobs: { where: { isActive: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(companies);
  } catch (error) {
    console.error('GET /api/companies failed:', error);
    return serverError('We could not load companies. Please try again.');
  }
}

/**
 * Admin only. Normal companies are created as part of company registration in
 * `/api/auth`, which links the company to its owner; this route used to be open
 * to anyone and produced orphan companies nobody could post under.
 */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const { name, profile } = readCompanyFields(body);
  if (!name) return badRequest('Company name is required');

  try {
    const company = await prisma.company.create({ data: { name, profile } });
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    console.error('POST /api/companies failed:', error);
    return serverError('We could not create the company. Please try again.');
  }
}

/** A company user may only edit its own company; admins may edit any. */
export async function PUT(req: NextRequest) {
  const guard = requireAuth(req);
  if (guard.response) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const id = body.id;
  if (!isUuid(id)) return badRequest('A valid company id is required');
  if (session.role !== 'ADMIN' && session.companyId !== id) {
    return forbidden('You can only update your own company');
  }

  const { name, profile } = readCompanyFields(body);
  if (!name) return badRequest('Company name is required');

  try {
    const company = await prisma.company.update({
      where: { id },
      data: { name, profile },
      select: { id: true, name: true, profile: true, createdAt: true },
    });
    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return notFound('That company no longer exists');
    }
    console.error('PUT /api/companies failed:', error);
    return serverError('We could not update the company. Please try again.');
  }
}

/** Admin only: deleting a company cascades to its jobs and conversations. */
export async function DELETE(req: NextRequest) {
  const guard = requireRole(req, 'ADMIN');
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const id = body.id;
  if (!isUuid(id)) return badRequest('A valid company id is required');

  try {
    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ message: 'Company deleted' });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return notFound('That company no longer exists');
    }
    console.error('DELETE /api/companies failed:', error);
    return serverError('We could not delete the company. Please try again.');
  }
}

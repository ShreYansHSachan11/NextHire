import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const companyId = searchParams.get('companyId');
    
    if (companyId) {
      // For companies: get all applications and existing conversations
      console.log('GET /api/conversations - Fetching conversations for company:', companyId);
      
      // Get all applications for this company
      const applications = await prisma.application.findMany({
        where: {
          job: {
            companyId: companyId
          }
        },
        include: {
          job: {
            select: {
              id: true,
              title: true
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Get existing conversations
      const conversations = await prisma.conversation.findMany({
        where: {
          companyId: companyId
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          messages: {
            orderBy: {
              createdAt: 'desc'
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Create a map of existing conversations by userId
      const conversationMap = new Map();
      conversations.forEach(conv => {
        conversationMap.set(conv.userId, conv);
      });

      // Combine applications and conversations
      const result = applications.map(app => {
        const existingConversation = conversationMap.get(app.userId);
        return {
          application: app,
          conversation: existingConversation || null,
          hasConversation: !!existingConversation
        };
      });

      console.log('GET /api/conversations - Found', result.length, 'applications/conversations for company');
      return NextResponse.json(result);
      
    } else if (userId) {
      // For seekers: get their conversations
      const conversations = await prisma.conversation.findMany({
        where: { userId },
        include: {
          company: {
            select: {
              id: true,
              name: true
            }
          },
          messages: {
            orderBy: {
              createdAt: 'desc'
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
      
      return NextResponse.json(conversations);
    } else {
      return NextResponse.json({ error: 'userId or companyId is required' }, { status: 400 });
    }
  } catch (error) {
    console.error('GET /api/conversations error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    
    // Check if conversation already exists
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        userId: data.userId,
        companyId: data.companyId
      }
    });

    if (existingConversation) {
      return NextResponse.json(existingConversation, { status: 200 });
    }

    // Create new conversation
    const conversation = await prisma.conversation.create({
      data: {
        userId: data.userId,
        companyId: data.companyId
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    console.error('POST /api/conversations error:', error);
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const data = await req.json();
    const conversation = await prisma.conversation.update({
      where: { id: data.id },
      data: {
        userId: data.userId,
        companyId: data.companyId,
      },
    });
    return NextResponse.json(conversation);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await prisma.conversation.delete({ where: { id } });
    return NextResponse.json({ message: 'Conversation deleted' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
} 
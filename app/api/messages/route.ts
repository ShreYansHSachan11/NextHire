import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversationId');
    
    const whereClause = conversationId ? { conversationId } : {};
    
    const messages = await prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    return NextResponse.json(messages);
  } catch (error) {
    console.error('GET /api/messages error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    
    // Create the message
    const message = await prisma.message.create({ 
      data,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        conversation: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            },
            company: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    // If the sender is a company (role === 'COMPANY'), create a notification for the seeker
    if (message.sender.role === 'COMPANY') {
      await prisma.notification.create({
        data: {
          userId: message.conversation.userId,
          content: `New message from ${message.conversation.company.name}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`,
          read: false
        }
      });
    }

    // Emit Socket.IO event for real-time updates
    try {
      console.log('Attempting to emit Socket.IO event for conversation:', message.conversationId);
      // Use fetch to send a message to the Socket.IO server
      const socketResponse = await fetch('http://localhost:3002/emit-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: message.conversationId,
          message: message
        }),
      });
      
      if (socketResponse.ok) {
        console.log('Socket.IO event emitted successfully');
      } else {
        console.log('Socket.IO event emission failed:', socketResponse.status);
      }
    } catch (socketError) {
      console.log('Socket.IO not available, continuing without real-time update:', socketError);
    }

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error('POST /api/messages error:', error);
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const data = await req.json();
    const message = await prisma.message.update({
      where: { id: data.id },
      data,
    });
    return NextResponse.json(message);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await prisma.message.delete({ where: { id } });
    return NextResponse.json({ message: 'Message deleted' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
} 
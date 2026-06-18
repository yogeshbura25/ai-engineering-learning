import prisma from '../config/prisma.js';

export const saveMessage = async (sessionId, role, content) => {
  try {
    const message = await prisma.chatMessage.create({
      data: {
        sessionId,
        role,
        content
      }
    });
    return message;
  } catch (error) {
    console.error("Failed to save chat message via Prisma:", error);
    throw error;
  }
};

export const getChatHistory = async (sessionId, limit = 10) => {
  try {
    const history = await prisma.chatMessage.findMany({
      where: {
        sessionId
      },
      select: {
        role: true,
        content: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    });
    // Reverse to return them in chronological order
    return history.reverse();
  } catch (error) {
    console.error("Failed to retrieve chat history via Prisma:", error);
    throw error;
  }
};

import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { readCommunicationPage } from '../services/communicationPage.js';

export const communicationRouter = Router();

communicationRouter.get('/tasks', asyncHandler(async (req, res) => {
  res.json(await readCommunicationPage(prisma, req.query));
}));

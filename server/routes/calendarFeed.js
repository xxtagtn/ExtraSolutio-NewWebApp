import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../utils/http.js';
import { buildCalendarFeed, buildCalendarFeedUrls } from '../utils/calendarFeed.js';

export const calendarFeedPublicRouter = Router();
export const calendarFeedRouter = Router();

const DEFAULT_PREFERENCES = {
  services: true,
  payments: true,
  followUps: true,
  birthdays: true,
};

function parsePreferences(value) {
  if (!value) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(value);
    return {
      ...DEFAULT_PREFERENCES,
      ...Object.fromEntries(
        Object.entries(parsed || {}).filter(([, entryValue]) => typeof entryValue === 'boolean'),
      ),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function feedUrls(req, token) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return buildCalendarFeedUrls({
    token,
    requestProtocol: protocol,
    requestHost: req.get('host'),
    publicBaseUrl:
      process.env.CALENDAR_FEED_PUBLIC_URL
      || process.env.APP_PUBLIC_URL
      || process.env.VITE_APP_PUBLIC_URL
      || process.env.APP_URL,
  });
}

function publicState(req, user) {
  const urls = feedUrls(req, user?.calendarFeedToken);
  return {
    enabled: Boolean(user?.calendarFeedEnabled && user?.calendarFeedToken),
    preferences: parsePreferences(user?.calendarFeedPreferences),
    ...urls,
  };
}

async function uniqueToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(32).toString('hex');
    const existing = await prisma.user.findFirst({
      where: { calendarFeedToken: token },
      select: { id: true },
    });
    if (!existing) return token;
  }
  const error = new Error('Não foi possível gerar um token único.');
  error.statusCode = 500;
  throw error;
}

function calendarRange() {
  const now = new Date();
  const from = new Date(now.getFullYear() - 1, 0, 1);
  const to = new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59, 999);
  return { from, to };
}

async function loadFeedData(preferences) {
  const { from, to } = calendarRange();
  const services = preferences.services || preferences.payments
    ? await prisma.event.findMany({
      where: {
        status: { not: 'cancelled' },
        AND: [
          { date: { lte: to } },
          {
            OR: [
              { endDate: { gte: from } },
              { endDate: null, date: { gte: from } },
              { remainingPaymentDate: { gte: from, lte: to } },
            ],
          },
        ],
      },
      include: {
        client: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { name: 'asc' }],
    })
    : [];

  const budgets = preferences.followUps
    ? await prisma.budget.findMany({
      where: { followUpHistory: { not: null } },
      include: { client: { select: { name: true } } },
      orderBy: [{ eventDate: 'asc' }, { createdAt: 'desc' }],
    })
    : [];

  const collaborators = preferences.birthdays
    ? await prisma.collaborator.findMany({
      where: {
        birthDate: { not: null },
        status: { not: 'inactive' },
      },
      select: {
        id: true,
        name: true,
        shortName: true,
        birthDate: true,
      },
      orderBy: [{ shortName: 'asc' }, { name: 'asc' }],
    })
    : [];

  return {
    services: preferences.services || preferences.payments ? services : [],
    budgets,
    collaborators,
  };
}

calendarFeedPublicRouter.get('/:token.ics', asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(404).type('text/plain').send('Calendário não encontrado.');
  }

  const user = await prisma.user.findFirst({
    where: {
      calendarFeedToken: token,
      calendarFeedEnabled: true,
    },
    select: {
      id: true,
      calendarFeedPreferences: true,
    },
  });
  if (!user) return res.status(404).type('text/plain').send('Calendário não encontrado.');

  const preferences = parsePreferences(user.calendarFeedPreferences);
  const data = await loadFeedData(preferences);
  const ics = buildCalendarFeed({
    services: preferences.services || preferences.payments ? data.services : [],
    budgets: preferences.followUps ? data.budgets : [],
    collaborators: preferences.birthdays ? data.collaborators : [],
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(ics);
}));

calendarFeedRouter.get('/me', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      calendarFeedToken: true,
      calendarFeedEnabled: true,
      calendarFeedPreferences: true,
    },
  });
  res.json(publicState(req, user));
}));

calendarFeedRouter.post('/regenerate', asyncHandler(async (req, res) => {
  const token = await uniqueToken();
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      calendarFeedToken: token,
      calendarFeedEnabled: true,
      calendarFeedPreferences: JSON.stringify(DEFAULT_PREFERENCES),
    },
    select: {
      calendarFeedToken: true,
      calendarFeedEnabled: true,
      calendarFeedPreferences: true,
    },
  });
  res.json(publicState(req, user));
}));

calendarFeedRouter.post('/disable', asyncHandler(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { calendarFeedEnabled: false },
    select: {
      calendarFeedToken: true,
      calendarFeedEnabled: true,
      calendarFeedPreferences: true,
    },
  });
  res.json(publicState(req, user));
}));

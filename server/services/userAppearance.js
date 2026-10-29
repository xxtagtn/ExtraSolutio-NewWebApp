import { normalizeThemePreference, resolveSeasonalTheme, SEASONAL_THEMES } from '../../src/utils/seasonalTheme.js';
import { normalizeRole } from '../security/roles.js';

const PUBLIC_SCOPE = 'attendance';
const canPublish = (user) => normalizeRole(user?.role) === 'admin';

export async function readUserAppearance(db, user) {
  const own = await db.userAppearance.findUnique({ where: { userId: user.id } });
  const controller = await db.userAppearance.findUnique({ where: { publicScope: PUBLIC_SCOPE }, select: { userId: true, user: { select: { role: true } } } });
  const activeController = controller && canPublish(controller.user);
  return { preference: normalizeThemePreference(own?.preference), configured: Boolean(own),
    controlsPublicQr: Boolean(activeController && controller.userId === user.id), publicQrConfigured: Boolean(activeController), canPublishQr: canPublish(user) };
}

export async function updateUserAppearance(db, user, input) {
  if (!SEASONAL_THEMES.some(({ value }) => value === input?.preference)
    || (input.publishToQr !== undefined && typeof input.publishToQr !== 'boolean')) {
    throw Object.assign(new Error('Preferência de tema inválida.'), { statusCode: 400 });
  }
  if (input.publishToQr && !canPublish(user)) {
    throw Object.assign(new Error('Só um administrador pode definir a conta responsável pelo tema das picagens.'), { statusCode: 403 });
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        if (input.publishToQr) await tx.userAppearance.updateMany({
          where: { publicScope: PUBLIC_SCOPE, userId: { not: user.id } }, data: { publicScope: null },
        });
        await tx.userAppearance.upsert({ where: { userId: user.id },
          create: { userId: user.id, preference: input.preference, ...(input.publishToQr ? { publicScope: PUBLIC_SCOPE } : {}) },
          update: { preference: input.preference, ...(input.publishToQr ? { publicScope: PUBLIC_SCOPE } : {}) },
        });
        return readUserAppearance(tx, user);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt >= 2 || !['P2002', 'P2034'].includes(error.code)) throw error;
    }
  }
}

export async function publicQrAppearance(db, now = new Date()) {
  const controller = await db.userAppearance.findUnique({ where: { publicScope: PUBLIC_SCOPE }, select: { preference: true, user: { select: { role: true } } } });
  return { theme: resolveSeasonalTheme(controller && canPublish(controller.user) ? controller.preference : 'original', now) };
}

export async function withPublicQrAppearance(db, payload) {
  try {
    return { ...payload, appearance: await publicQrAppearance(db) };
  } catch (error) {
    // A cosmetic preference must never turn a successful punch into a reported failure.
    console.error('Não foi possível consultar o tema das picagens:', error.code || error.name);
    return { ...payload, appearance: { theme: 'original' } };
  }
}

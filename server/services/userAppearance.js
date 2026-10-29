import { normalizeThemePreference, resolveSeasonalTheme, SEASONAL_THEMES } from '../../src/utils/seasonalTheme.js';
import { normalizeRole } from '../security/roles.js';

const PUBLIC_SCOPE = 'attendance';
const canPublish = (user) => normalizeRole(user?.role) === 'admin';

async function publicThemeController(db) {
  const select = { userId: true, preference: true, publicScope: true, user: { select: { role: true } } };
  const explicit = await db.userAppearance.findUnique({ where: { publicScope: PUBLIC_SCOPE }, select });
  if (explicit) return { controller: canPublish(explicit.user) ? explicit : null, ambiguous: !canPublish(explicit.user) };
  // Existing installations may have saved the theme before linking its account.
  // Only an unambiguous saved administrator preference can provide that default.
  const candidates = await db.userAppearance.findMany({ where: { user: { role: 'admin' } }, select, orderBy: { userId: 'asc' }, take: 2 });
  return { controller: candidates.length === 1 ? candidates[0] : null, ambiguous: candidates.length > 1 };
}

export async function readUserAppearance(db, user) {
  const own = await db.userAppearance.findUnique({ where: { userId: user.id } });
  const { controller, ambiguous } = await publicThemeController(db);
  return { preference: normalizeThemePreference(own?.preference), configured: Boolean(own),
    controlsPublicQr: controller?.userId === user.id, publicQrConfigured: Boolean(controller), canPublishQr: canPublish(user), publicQrNeedsAccount: ambiguous };
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
        const { controller, ambiguous } = await publicThemeController(tx);
        const initialize = canPublish(user) && !controller && !ambiguous;
        if (!input.publishToQr && canPublish(user) && controller && controller.publicScope !== PUBLIC_SCOPE) {
          await tx.userAppearance.update({ where: { userId: controller.userId }, data: { publicScope: PUBLIC_SCOPE } });
        }
        if (input.publishToQr) await tx.userAppearance.updateMany({
          where: { publicScope: PUBLIC_SCOPE, userId: { not: user.id } }, data: { publicScope: null },
        });
        await tx.userAppearance.upsert({ where: { userId: user.id },
          create: { userId: user.id, preference: input.preference, ...(input.publishToQr || initialize ? { publicScope: PUBLIC_SCOPE } : {}) },
          update: { preference: input.preference, ...(input.publishToQr || initialize ? { publicScope: PUBLIC_SCOPE } : {}) },
        });
        return readUserAppearance(tx, user);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt >= 2 || !['P2002', 'P2034'].includes(error.code)) throw error;
    }
  }
}

export async function publicQrAppearance(db, now = new Date()) {
  const { controller } = await publicThemeController(db);
  return { theme: resolveSeasonalTheme(controller?.preference, now) };
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

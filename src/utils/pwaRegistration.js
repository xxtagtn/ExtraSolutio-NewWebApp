export function shouldRegisterPwaServiceWorker({ prod = false, navigatorRef = globalThis.navigator } = {}) {
  return Boolean(prod && navigatorRef?.serviceWorker?.register);
}

export async function registerPwaServiceWorker({
  prod = false,
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  serviceWorkerUrl = '/service-worker.js?v=5',
} = {}) {
  if (!shouldRegisterPwaServiceWorker({ prod, navigatorRef })) {
    return { status: 'skipped' };
  }

  const register = async () => {
    try {
      const registration = await navigatorRef.serviceWorker.register(serviceWorkerUrl, {
        scope: '/',
        updateViaCache: 'none',
      });
      await registration.update?.();
      return { status: 'registered', registration };
    } catch (error) {
      return { status: 'error', error };
    }
  };

  if (windowRef?.addEventListener) {
    windowRef.addEventListener('load', () => {
      register();
    });
    return { status: 'pending' };
  }

  return register();
}

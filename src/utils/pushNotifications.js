import { api, API_URL, getStoredAuth } from './api.js';

const CACHE = 'extrasolutio-push-settings';
const OWNER = '/__push-owner';
let cleanup = Promise.resolve();
let ownerWrites = Promise.resolve();

export function pushAvailability() {
  if (!globalThis.isSecureContext) return 'As notificações precisam de HTTPS. Abre a aplicação pelo endereço seguro.';
  const navigator = globalThis.navigator;
  const isIos = /iPhone|iPad|iPod/.test(navigator?.userAgent || '') || (navigator?.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos && !navigator.standalone && !globalThis.matchMedia?.('(display-mode: standalone)').matches) return 'No iPhone/iPad, abre a aplicação adicionada ao ecrã principal para ativar notificações.';
  if (!globalThis.Notification || !globalThis.PushManager || !globalThis.navigator?.serviceWorker || !globalThis.caches) {
    return 'Notificações não suportadas neste modo. No iPhone/iPad, usa iOS 16.4 ou posterior e abre a aplicação adicionada ao ecrã principal.';
  }
  if (globalThis.Notification.permission === 'denied') return 'Notificações bloqueadas nas definições deste browser/dispositivo.';
  return '';
}

export async function pushRegistration(create = false) {
  await cleanup;
  if (!globalThis.navigator?.serviceWorker) return null;
  let registration = await globalThis.navigator.serviceWorker.getRegistration('/');
  if (!create) return registration || null;
  registration = await globalThis.navigator.serviceWorker.register('/service-worker.js?v=6', { scope: '/', updateViaCache: 'none' });
  if (registration.active && !registration.installing && !registration.waiting) return registration;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const ready = registration.active && !registration.installing && !registration.waiting;
      if (ready || Date.now() - started > 10000) {
        window.clearInterval(timer);
        if (ready) resolve(registration);
        else reject(new Error('Não foi possível ativar as notificações. Volta a tentar.'));
      }
    }, 100);
  });
}

function bindPushOwner(userId) {
  ownerWrites = ownerWrites.catch(() => {}).then(async () => {
    const cache = await globalThis.caches.open(CACHE);
    if (!userId) return cache.delete(OWNER);
    if (getStoredAuth()?.user?.id !== userId) throw new Error('A sessão foi alterada. Volta a ativar as notificações.');
    await cache.put(OWNER, new globalThis.Response(String(userId)));
    if (getStoredAuth()?.user?.id !== userId) await cache.delete(OWNER);
  });
  return ownerWrites;
}

export async function currentPushDevice() {
  const registration = await pushRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return { subscription: null, device: null };
  const device = await api('/push/device', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  const owner = await (await globalThis.caches.open(CACHE)).match(OWNER);
  const bound = owner && await owner.text() === String(getStoredAuth()?.user?.id);
  return { subscription, device: bound ? device : null };
}

export function requestPushPermission() {
  const unavailable = pushAvailability();
  if (unavailable) return Promise.reject(new Error(unavailable));
  // Invoke directly from the button gesture (required by mobile browsers).
  return globalThis.Notification.requestPermission();
}

export async function enablePush(publicKey, preferences, userId, permission) {
  if (await permission !== 'granted') throw new Error('É necessário autorizar as notificações neste dispositivo.');
  const registration = await pushRegistration(true);
  const key = globalThis.Uint8Array.from(globalThis.atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  const oldKey = subscription?.options?.applicationServerKey;
  if (oldKey && String(new globalThis.Uint8Array(oldKey)) !== String(key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const device = await api('/push/device', { method: 'PUT', body: JSON.stringify({ subscription: subscription.toJSON(), ...preferences }) });
  await bindPushOwner(userId);
  return { subscription, device };
}

export async function disablePush() {
  const registration = await pushRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (globalThis.caches) await bindPushOwner(null);
  for (const notification of await registration?.getNotifications?.() || []) notification.close();
  if (subscription) {
    // Revoke locally even if the network is unavailable.
    await subscription.unsubscribe();
    await api('/push/device', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  }
}

export function detachPushOnLogout(token) {
  cleanup = cleanup.catch(() => {}).then(async () => {
    if (globalThis.caches) await bindPushOwner(null);
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration('/');
    for (const notification of await registration?.getNotifications?.() || []) notification.close();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await subscription.unsubscribe();
    if (token) await fetch(`${API_URL}/push/device`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: subscription.endpoint }), signal: globalThis.AbortSignal.timeout(5000),
    });
  }).catch(() => {});
  return cleanup;
}

export async function synchronizePushAccount(userId) {
  await cleanup;
  if (!globalThis.caches) return;
  const response = await (await globalThis.caches.open(CACHE)).match(OWNER);
  if (response && await response.text() !== String(userId)) await detachPushOnLogout();
}

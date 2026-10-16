import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { API_URL, apiBlob } from '../../utils/api.js';
import { privatePhotoPath } from '../../utils/privatePhotos.js';

export default function CollaboratorImage({ src, alt, ...props }) {
  const { token } = useAuth();
  const path = privatePhotoPath(src, API_URL);
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (!path || !token) return undefined;
    const controller = new globalThis.AbortController();
    let objectUrl;
    let active = true;
    apiBlob(path, { signal: controller.signal, cache: 'no-store' }).then((blob) => {
      if (!active) return;
      objectUrl = globalThis.URL.createObjectURL(blob);
      setLoaded({ path, token, url: objectUrl });
    }).catch(() => { /* Missing or forbidden photos must not expose a public fallback. */ });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) globalThis.URL.revokeObjectURL(objectUrl);
    };
  }, [path, token]);

  const resolved = path ? (loaded?.path === path && loaded?.token === token ? loaded.url : undefined) : src;
  return <img {...props} alt={alt} src={resolved || undefined} />;
}

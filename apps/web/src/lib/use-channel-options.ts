import { useEffect, useState } from 'react';
import { apiRequest } from './api';

/**
 * Channel names the backend accepts for outbound / beat delivery, loaded from
 * `GET /api/admin/capabilities`. Empty until the request resolves; no hardcoded
 * channel list.
 */
export function useChannelOptions(): string[] {
  const [channels, setChannels] = useState<string[]>([]);

  useEffect(() => {
    apiRequest<{ channels?: string[] }>('/capabilities')
      .then((res) => {
        if (res.channels?.length) setChannels(res.channels);
      })
      .catch(() => {
        // leave empty — the field is optional and the server validates on submit
      });
  }, []);

  return channels;
}

import { useEffect, useState } from 'react';
import { apiRequest } from './api';
import type { ChannelHints, ChannelHintsResponse } from './types';

export function useChannelHints(): { hints: Record<string, ChannelHints>; loading: boolean } {
  const [hints, setHints] = useState<Record<string, ChannelHints>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<ChannelHintsResponse>('/channels/hints')
      .then((res) => {
        if (res.hints) {
          setHints(res.hints);
        }
      })
      .catch(() => {
        // Ignored
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { hints, loading };
}

import type { NegotiatorAction } from '../utils/negotiator-response';

export const ERRAND_ACTION_FOLLOWUPS: Readonly<Record<NegotiatorAction, string | null>> = {
  continue: null,
  escalate: null,
  resolved: 'Thank you for your help!',
  failed: null,
};

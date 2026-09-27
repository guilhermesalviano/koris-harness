export const BEAT_TYPES = ['reminder', 'scheduled_beat'] as const;
export type BeatType = typeof BEAT_TYPES[number];

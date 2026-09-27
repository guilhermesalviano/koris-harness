import { config } from '../config';

export function getTimezone(): string {
  return config.TIMEZONE || 'America/Sao_Paulo';
}

export function formatISO(date: Date = new Date(), timeZone: string = getTimezone()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(date);

  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const rawOffset = value('timeZoneName').replace('GMT', '');
  const offset = rawOffset === '' || rawOffset === '+00:00' || rawOffset === '-00:00' ? 'Z' : rawOffset;
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}.${milliseconds}${offset}`;
}

export function nowISO(timeZone: string = getTimezone()): string {
  return formatISO(new Date(), timeZone);
}

export function formatDateTime(date: Date = new Date(), timeZone: string = getTimezone()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date);
}

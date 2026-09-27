import type { CSSProperties } from 'react';

interface IconProps {
  className?: string;
}

function svgStyle(width: number, linecap: 'butt' | 'round' | 'square' = 'round', linejoin: 'miter' | 'round' | 'bevel' = 'round'): CSSProperties {
  return { strokeWidth: width, strokeLinecap: linecap, strokeLinejoin: linejoin };
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.5)} viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function OverviewIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M3 3v18h18M7 15l4-6 4 4 4-8" />
    </svg>
  );
}

export function SessionsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function MemoriesIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.1 2.5 5.3.8.7 1.5 1.7 1.5 2.7v1h6v-1c0-1 .7-2 1.5-2.7C17.8 13.1 19 11.4 19 9a7 7 0 0 0-7-7zM9 21h6" />
    </svg>
  );
}

export function HeartbeatsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function ErrandsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M17 3l4 4-4 4" />
      <path d="M21 7H9a4 4 0 0 0-4 4v0" />
      <path d="M7 21l-4-4 4-4" />
      <path d="M3 17h12a4 4 0 0 0 4-4v0" />
    </svg>
  );
}

export function ChannelsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

export function SkillsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M12 2l3 6 6.5 1-4.7 4.6 1.1 6.4-5.9-3-5.9 3 1.1-6.4L2.5 9l6.5-1z" />
    </svg>
  );
}

export function PluginsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M9 2v4M15 2v4M7 6h10l-1 6H8L7 6zM6 12h12v3a6 6 0 0 1-12 0v-3zM12 21v-3" />
    </svg>
  );
}

export function ProvidersIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9zM12 3v18M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}

export function AuditIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
    </svg>
  );
}

export function QueueIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M12 3v18M3 7l9-4 9 4M3 17l9 4 9-4M3 7v10M21 7v10M3 12h18" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M10.3 2h3.4l.4 2.5a8 8 0 0 1 2 .8l2.1-1.4 2.4 2.4-1.4 2.1a8 8 0 0 1 .8 2l2.5.4v3.4l-2.5.4a8 8 0 0 1-.8 2l1.4 2.1-2.4 2.4-2.1-1.4a8 8 0 0 1-2 .8l-.4 2.5h-3.4l-.4-2.5a8 8 0 0 1-2-.8l-2.1 1.4-2.4-2.4 1.4-2.1a8 8 0 0 1-.8-2L2 13.7v-3.4l2.5-.4a8 8 0 0 1 .8-2L3.9 5.8l2.4-2.4 2.1 1.4a8 8 0 0 1 2-.8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2)} viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2, 'round')} viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function BrokenImageIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.5)} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </svg>
  );
}

export function AttachIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2.2)} viewBox="0 0 24 24">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

export function SquareIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24">
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2)} viewBox="0 0 24 24">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2)} viewBox="0 0 24 24">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2)} viewBox="0 0 24 24">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function RetryIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.9)} viewBox="0 0 24 24">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.7)} viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

export function WaveformIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24">
      <path d="M3 10v4M7 6v12M11 3v18M15 8v8M19 5v14M23 11v2" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(2)} viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function MicOffIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

export function AlertCircleIcon({ className }: IconProps) {
  return (
    <svg className={className} style={svgStyle(1.8)} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
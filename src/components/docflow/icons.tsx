import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  strokeWidth?: number;
}

const Icon: React.FC<IconProps & { children: React.ReactNode }> = ({
  size = 16,
  strokeWidth = 1.6,
  children,
  ...rest
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const I = {
  Dashboard: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  ),
  Users: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16 15.5c2.4.2 3.9 1.6 4.5 4" />
    </Icon>
  ),
  Inbox: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 13l2.5-7A2 2 0 0 1 7.4 5h9.2a2 2 0 0 1 1.9 1.4L21 13" />
      <path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      <path d="M3 13h5l1.5 2h5L16 13h5" />
    </Icon>
  ),
  Folder: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  ),
  Calendar: (p: IconProps) => (
    <Icon {...p}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  ),
  Chart: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </Icon>
  ),
  Settings: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  ),
  Search: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  ),
  Bell: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 8a6 6 0 1 1 12 0v4l1.5 3H4.5L6 12z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  ),
  Plus: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  ChevronL: (p: IconProps) => (
    <Icon {...p}>
      <path d="m14 6-6 6 6 6" />
    </Icon>
  ),
  ChevronR: (p: IconProps) => (
    <Icon {...p}>
      <path d="m10 6 6 6-6 6" />
    </Icon>
  ),
  Upload: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </Icon>
  ),
  Download: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </Icon>
  ),
  Send: (p: IconProps) => (
    <Icon {...p}>
      <path d="m4 12 17-8-7 17-2.5-7z" />
      <path d="M11.5 13.5 21 4" />
    </Icon>
  ),
  Msg: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5z" />
    </Icon>
  ),
  Check: (p: IconProps) => (
    <Icon {...p}>
      <path d="m5 12 4.5 4.5L20 6" />
    </Icon>
  ),
  X: (p: IconProps) => (
    <Icon {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  ),
  More: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </Icon>
  ),
  Doc: (p: IconProps) => (
    <Icon {...p}>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </Icon>
  ),
  Filter: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
    </Icon>
  ),
  ArrowUp: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Icon>
  ),
  Refresh: (p: IconProps) => (
    <Icon {...p}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </Icon>
  ),
  Shield: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z" />
    </Icon>
  ),
  Trash: (p: IconProps) => (
    <Icon {...p}>
      <path d="M5 7h14M10 11v6M14 11v6" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </Icon>
  ),
  Menu: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  ),
};

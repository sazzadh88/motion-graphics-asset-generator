import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Svg>
    <path d="M4.5 3v10l8-5z" fill="currentColor" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <path d="M5 3.5v9M11 3.5v9" strokeWidth="2" />
  </Svg>
);
export const StepBackIcon = () => (
  <Svg>
    <path d="M4 3v10M12 3.5v9l-6-4.5z" />
  </Svg>
);
export const StepForwardIcon = () => (
  <Svg>
    <path d="M12 3v10M4 3.5v9l6-4.5z" />
  </Svg>
);
export const ToStartIcon = () => (
  <Svg>
    <path d="M3.5 3v10M13 3.5L7 8l6 4.5zM3.5 8H7" />
  </Svg>
);
export const ToEndIcon = () => (
  <Svg>
    <path d="M12.5 3v10M3 3.5L9 8l-6 4.5z" />
  </Svg>
);
export const LoopIcon = () => (
  <Svg>
    <path d="M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2" />
  </Svg>
);
export const DownloadIcon = () => (
  <Svg>
    <path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
  </Svg>
);
export const CopyIcon = () => (
  <Svg>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Svg>
);
export const TrashIcon = () => (
  <Svg>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
  </Svg>
);

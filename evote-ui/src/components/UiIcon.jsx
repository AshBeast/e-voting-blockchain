export default function UiIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (name) {
    case "refresh":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 0 0-15.4-6.4" />
          <path d="M3 4v5h5" />
          <path d="M3 12a9 9 0 0 0 15.4 6.4" />
          <path d="M21 20v-5h-5" />
        </svg>
      );
    case "switch":
      return (
        <svg {...common}>
          <path d="M4 7h14" />
          <path d="m14 3 4 4-4 4" />
          <path d="M20 17H6" />
          <path d="m10 13-4 4 4 4" />
        </svg>
      );
    case "tally":
      return (
        <svg {...common}>
          <path d="M4 20h16" />
          <path d="M7 20V10" />
          <path d="M12 20V6" />
          <path d="M17 20V13" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 1 0-7l2-2a5 5 0 1 1 7 7l-1.5 1.5" />
          <path d="M14 11a5 5 0 0 1 0 7l-2 2a5 5 0 1 1-7-7L6.5 11.5" />
        </svg>
      );
    case "vote":
      return (
        <svg {...common}>
          <path d="M7 4h10l2 4H5z" />
          <path d="M6 8v12h12V8" />
          <path d="m9.5 14 2 2 4-4" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M8 3h8l4 4v14l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
          <path d="M8 8h8" />
          <path d="M8 12h8" />
        </svg>
      );
    case "back":
      return (
        <svg {...common}>
          <path d="M15 18l-6-6 6-6" />
          <path d="M9 12h12" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "load":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 21h16" />
        </svg>
      );
    case "clear":
      return (
        <svg {...common}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "prev":
      return (
        <svg {...common}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case "next":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M4 20h16" />
        </svg>
      );
    case "deploy":
      return (
        <svg {...common}>
          <path d="m5 12 14-7-4 14-3-4-4-3z" />
        </svg>
      );
    case "attach":
      return (
        <svg {...common}>
          <path d="M21 11.5 11.5 21a5 5 0 0 1-7-7l9.5-9.5a3.5 3.5 0 1 1 5 5L9.4 19.1a2 2 0 0 1-2.8-2.8l8.5-8.5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "danger":
      return (
        <svg {...common}>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <path d="M16 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    default:
      return null;
  }
}

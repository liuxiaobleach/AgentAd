export interface TelegramCheckResult {
  url: string;
  handle: string | null;
  isValid: boolean;
  matchesProject: boolean;
  flags: string[];
}

export function checkTelegramLink(
  url: string,
  projectName: string
): TelegramCheckResult {
  const flags: string[] = [];

  // Parse t.me link
  const match = url.match(/t\.me\/([a-zA-Z0-9_]+)/);
  const handle = match ? match[1] : null;

  if (!handle) {
    return {
      url,
      handle: null,
      isValid: false,
      matchesProject: false,
      flags: ["invalid_telegram_url"],
    };
  }

  // Check if handle roughly matches project name
  const normalizedHandle = handle.toLowerCase().replace(/[_-]/g, "");
  const normalizedProject = projectName.toLowerCase().replace(/[_\s-]/g, "");
  const matchesProject =
    normalizedHandle.includes(normalizedProject) ||
    normalizedProject.includes(normalizedHandle);

  if (!matchesProject) {
    flags.push("telegram_project_mismatch");
  }

  return {
    url,
    handle,
    isValid: true,
    matchesProject,
    flags,
  };
}

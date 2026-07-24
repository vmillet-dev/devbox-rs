export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.round(hours / 24);
  return `il y a ${days}j`;
}

export function formatExpiry(at: Date, now: Date = new Date()): string {
  const days = Math.ceil((at.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'expirée';
  return `expire dans ${days}j`;
}

export function isExpiringSoon(at: Date, now: Date = new Date(), thresholdDays = 3): boolean {
  const days = (at.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  return days <= thresholdDays;
}

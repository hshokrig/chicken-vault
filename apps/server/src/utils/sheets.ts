import { Player } from '@chicken-vault/shared';

function sanitizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 20);
}

export function makePlayerSheetName(player: Player, usedNames: Set<string>): string {
  const seatPrefix = `P${String(player.seatIndex + 1).padStart(2, '0')}`;
  const cleaned = sanitizeName(player.name) || 'Player';
  let base = `${seatPrefix}_${cleaned}`;

  if (base.length > 31) {
    base = base.slice(0, 31);
  }

  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  let counter = 2;
  while (counter < 100) {
    const suffix = `_${counter}`;
    const candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }

  throw new Error(`Unable to generate unique sheet name for ${player.name}`);
}

export function findPlayerBySeatIndex(players: Player[], seatIndex: number): Player | undefined {
  return players.find((player) => player.seatIndex === seatIndex);
}

export function sortPlayersBySeat(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.seatIndex - b.seatIndex);
}

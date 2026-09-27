export type RankedItem = {
  id: string;
  name: string;
  rating: number;
  deviation: number;
  wins: number;
  losses: number;
};

export type Matchup = [string, string] | null;

export type RankingBoard = {
  title: string;
  items: RankedItem[];
  pairCounts: Record<string, number>;
  comparisons: number;
  matchup: Matchup;
};

const STARTING_RATING = 1500;
const INITIAL_DEVIATION = 350;
const MIN_DEVIATION = 30;
const ELO_SCALE = 400;
const Q = Math.LN10 / ELO_SCALE;
const STORAGE_KEY = 'pairwise-ranking-board-v2';

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function pairKey(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join('::');
}

export function makeItem(name: string, rating = STARTING_RATING, deviation = INITIAL_DEVIATION): RankedItem {
  return { id: createId(), name, rating, deviation, wins: 0, losses: 0 };
}

export function initialBoard(): RankingBoard {
  return { title: '', items: [], pairCounts: {}, comparisons: 0, matchup: null };
}

function glickoG(deviation: number) {
  return 1 / Math.sqrt(1 + (3 * Q ** 2 * deviation ** 2) / Math.PI ** 2);
}

function expectedScore(first: RankedItem, second: RankedItem) {
  const g = glickoG(Math.hypot(first.deviation, second.deviation));
  return 1 / (1 + 10 ** (-(g * (first.rating - second.rating)) / ELO_SCALE));
}

export function ratingOnTenPointScale(rating: number, referenceRating: number) {
  const score = 1 + 9 / (1 + 10 ** (-(rating - referenceRating) / ELO_SCALE));
  return Math.min(10, Math.max(1, score));
}

function updateRating(item: RankedItem, opponent: RankedItem, result: number) {
  const g = glickoG(opponent.deviation);
  const expected = 1 / (1 + 10 ** (-(g * (item.rating - opponent.rating)) / ELO_SCALE));
  const variance = 1 / (Q ** 2 * g ** 2 * expected * (1 - expected));
  const precision = 1 / item.deviation ** 2 + 1 / variance;

  return {
    rating: item.rating + (Q / precision) * g * (result - expected),
    deviation: Math.max(MIN_DEVIATION, Math.sqrt(1 / precision)),
  };
}

function normalCdf(value: number) {
  const t = 1 / (1 + 0.2316419 * value);
  const density = Math.exp(-0.5 * value ** 2) / Math.sqrt(2 * Math.PI);
  const tail =
    density *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - tail;
}

export function rankingConfidence(items: RankedItem[]) {
  const pairCount = (items.length * (items.length - 1)) / 2;
  if (pairCount === 0) return 1;

  let confidence = 0;
  for (let firstIndex = 0; firstIndex < items.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < items.length; secondIndex += 1) {
      const first = items[firstIndex];
      const second = items[secondIndex];
      const combinedDeviation = Math.hypot(first.deviation, second.deviation);
      confidence += normalCdf(Math.abs(first.rating - second.rating) / combinedDeviation);
    }
  }
  return confidence / pairCount;
}

function pairwiseRankingRisk(first: RankedItem, second: RankedItem) {
  const deviation = Math.hypot(first.deviation, second.deviation);
  return 1 - normalCdf(Math.abs(first.rating - second.rating) / deviation);
}

function affectedRankingRisk(
  items: RankedItem[],
  firstIndex: number,
  secondIndex: number,
  first: RankedItem,
  second: RankedItem,
) {
  let risk = pairwiseRankingRisk(first, second);
  for (let index = 0; index < items.length; index += 1) {
    if (index === firstIndex || index === secondIndex) continue;
    risk += pairwiseRankingRisk(first, items[index]) + pairwiseRankingRisk(second, items[index]);
  }
  return risk;
}

function rateHypotheticalPair(first: RankedItem, second: RankedItem, firstResult: number) {
  return [
    { ...first, ...updateRating(first, second, firstResult) },
    { ...second, ...updateRating(second, first, 1 - firstResult) },
  ] as const;
}

export function chooseMatchup(items: RankedItem[], pairCounts: Record<string, number>): Matchup {
  if (items.length < 2) return null;

  const comparisonCounts = new Map<string, number>();
  for (const item of items) comparisonCounts.set(item.id, 0);
  for (const [key, count] of Object.entries(pairCounts)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const [firstId, secondId] = key.split('::');
    if (comparisonCounts.has(firstId)) {
      comparisonCounts.set(firstId, comparisonCounts.get(firstId)! + count);
    }
    if (comparisonCounts.has(secondId)) {
      comparisonCounts.set(secondId, comparisonCounts.get(secondId)! + count);
    }
  }

  const unplayed = items.flatMap((item, index) => (comparisonCounts.get(item.id) === 0 ? [index] : []));
  const tieTolerance = 1e-12;
  const selection: {
    bestScore: number;
    fewestComparisons: number;
    tiedCount: number;
    chosen: [RankedItem, RankedItem] | null;
  } = { bestScore: -Infinity, fewestComparisons: Infinity, tiedCount: 0, chosen: null };

  const considerPair = (i: number, j: number) => {
    if (i > j) [i, j] = [j, i];
    const first = items[i];
    const second = items[j];
    const key = pairKey(first.id, second.id);
    const expected = expectedScore(first, second);
    const before = affectedRankingRisk(items, i, j, first, second);
    const [firstWinsFirst, firstWinsSecond] = rateHypotheticalPair(first, second, 1);
    const [secondWinsFirst, secondWinsSecond] = rateHypotheticalPair(first, second, 0);
    const expectedAfter =
      expected * affectedRankingRisk(items, i, j, firstWinsFirst, firstWinsSecond) +
      (1 - expected) * affectedRankingRisk(items, i, j, secondWinsFirst, secondWinsSecond);
    const score = before - expectedAfter;
    const comparisons = pairCounts[key] ?? 0;

    if (score > selection.bestScore + tieTolerance) {
      selection.bestScore = score;
      selection.fewestComparisons = comparisons;
      selection.tiedCount = 1;
      selection.chosen = [first, second];
    } else if (Math.abs(score - selection.bestScore) <= tieTolerance) {
      if (comparisons < selection.fewestComparisons) {
        selection.fewestComparisons = comparisons;
        selection.tiedCount = 1;
        selection.chosen = [first, second];
      } else if (comparisons === selection.fewestComparisons) {
        selection.tiedCount += 1;
        if (Math.random() < 1 / selection.tiedCount) selection.chosen = [first, second];
      }
    }
  };

  // Give each unseen item a comparison before returning to items already seen.
  if (unplayed.length >= 2) {
    for (let i = 0; i < unplayed.length; i += 1) {
      for (let j = i + 1; j < unplayed.length; j += 1) considerPair(unplayed[i], unplayed[j]);
    }
  } else if (unplayed.length === 1) {
    const unplayedIndex = unplayed[0];
    const fewestPriorComparisons = items.reduce((fewest, item, index) =>
      index === unplayedIndex ? fewest : Math.min(fewest, comparisonCounts.get(item.id) ?? 0),
    Infinity);
    for (let index = 0; index < items.length; index += 1) {
      if (index !== unplayedIndex && comparisonCounts.get(items[index].id) === fewestPriorComparisons) {
        considerPair(unplayedIndex, index);
      }
    }
  } else {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) considerPair(i, j);
    }
  }

  return selection.chosen ? [selection.chosen[0].id, selection.chosen[1].id] : null;
}

export function recordChoice(board: RankingBoard, winnerId: string): RankingBoard {
  const matchup = board.matchup;
  if (!matchup) return board;

  const [firstId, secondId] = matchup;
  const winner = winnerId === firstId ? firstId : secondId;
  const first = board.items.find((item) => item.id === firstId);
  const second = board.items.find((item) => item.id === secondId);
  if (!first || !second) return board;

  const firstResult = winner === firstId ? 1 : 0;
  const firstUpdate = updateRating(first, second, firstResult);
  const secondUpdate = updateRating(second, first, 1 - firstResult);
  const items = board.items.map((item) => {
    if (item.id === firstId) {
      return {
        ...item,
        ...firstUpdate,
        wins: item.wins + (winner === firstId ? 1 : 0),
        losses: item.losses + (winner === secondId ? 1 : 0),
      };
    }
    if (item.id === secondId) {
      return {
        ...item,
        ...secondUpdate,
        wins: item.wins + (winner === secondId ? 1 : 0),
        losses: item.losses + (winner === firstId ? 1 : 0),
      };
    }
    return item;
  });
  const pairCounts = { ...board.pairCounts };
  const key = pairKey(firstId, secondId);
  pairCounts[key] = (pairCounts[key] ?? 0) + 1;

  return {
    ...board,
    items,
    pairCounts,
    comparisons: board.comparisons + 1,
    matchup: chooseMatchup(items, pairCounts),
  };
}

export function addItems(board: RankingBoard, names: string[]): RankingBoard {
  const normalized = new Set(board.items.map((item) => item.name.toLocaleLowerCase()));
  const added = names
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase();
      if (!key || normalized.has(key)) return false;
      normalized.add(key);
      return true;
    });
  if (added.length === 0) return board;

  const averageRating = board.items.length
    ? board.items.reduce((sum, item) => sum + item.rating, 0) / board.items.length
    : STARTING_RATING;
  const items = [...board.items, ...added.map((name) => makeItem(name, averageRating))];
  return {
    ...board,
    items,
    matchup: chooseMatchup(items, board.pairCounts),
  };
}

function isRankedItem(value: unknown): value is RankedItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RankedItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.rating === 'number' &&
    typeof item.deviation === 'number' &&
    typeof item.wins === 'number' &&
    typeof item.losses === 'number'
  );
}

export function loadBoard(): RankingBoard {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialBoard();
    const saved = JSON.parse(raw) as Partial<RankingBoard>;
    const items = Array.isArray(saved.items) ? saved.items.filter(isRankedItem) : [];
    const pairCounts = saved.pairCounts && typeof saved.pairCounts === 'object' ? saved.pairCounts : {};
    const ids = new Set(items.map((item) => item.id));
    const savedMatchup = Array.isArray(saved.matchup) ? saved.matchup : null;
    const matchup =
      savedMatchup?.length === 2 && ids.has(savedMatchup[0]) && ids.has(savedMatchup[1])
        ? [savedMatchup[0], savedMatchup[1]] as [string, string]
        : chooseMatchup(items, pairCounts);

    return {
      title: typeof saved.title === 'string' ? saved.title : '',
      items,
      pairCounts,
      comparisons: typeof saved.comparisons === 'number' ? saved.comparisons : 0,
      matchup,
    };
  } catch {
    return initialBoard();
  }
}

export function saveBoard(board: RankingBoard) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // Keep the current session usable if browser storage is unavailable.
  }
}

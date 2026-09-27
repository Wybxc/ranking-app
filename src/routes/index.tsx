import { Title } from '@solidjs/meta';
import autoAnimate from '@formkit/auto-animate';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  addItems,
  initialBoard,
  loadBoard,
  rankingConfidence,
  ratingOnTenPointScale,
  recordChoice,
  saveBoard,
  type RankingBoard,
} from '../lib/ranking';

export default function Home() {
  const savedBoard = loadBoard();
  const [board, setBoard] = createSignal(savedBoard);
  const [titleDraft, setTitleDraft] = createSignal(savedBoard.title || '我的榜单');
  const [listDraft, setListDraft] = createSignal('');
  const [itemDraft, setItemDraft] = createSignal('');
  const [addOpen, setAddOpen] = createSignal(false);
  const [addError, setAddError] = createSignal('');
  const [rankingListElement, setRankingListElement] = createSignal<HTMLOListElement | null>(null, {
    name: 'ranking-list-element',
  });

  createEffect(() => board(), (current) => saveBoard(current));

  const parsedNames = createMemo(() => {
    const seen = new Set<string>();
    return listDraft()
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => {
        const key = name.toLocaleLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
  const rankedItems = createMemo(() =>
    [...board().items].sort((first, second) => second.rating - first.rating || second.wins - first.wins),
  );
  const rankedItemIds = createMemo(() => rankedItems().map((item) => item.id), {
    name: 'ranked-item-ids',
  });
  const rankedItemsById = createMemo(() => new Map(rankedItems().map((item) => [item.id, item] as const)), {
    name: 'ranked-items-by-id',
  });
  const averageRating = createMemo(() => {
    const items = rankedItems();
    return items.length ? items.reduce((sum, item) => sum + item.rating, 0) / items.length : 1500;
  });
  const ratingScore = (rating: number) => ratingOnTenPointScale(rating, averageRating()).toFixed(1);
  const confidence = createMemo(() => Math.round(rankingConfidence(rankedItems()) * 1000) / 10);
  const isNewBoard = createMemo(() => board().items.length < 2, { name: 'is-new-board' });

  createEffect(
    () => {
      return [isNewBoard(), rankingListElement()] as const;
    },
    ([newBoard, element]) => {
      if (newBoard || !element) return;
      const controller = autoAnimate(element, { duration: 220 });
      onCleanup(() => controller.destroy?.());
    },
    { name: 'ranking-list-animation' },
  );

  const currentMatchup = createMemo(() => {
    const current = board();
    const matchup = current.matchup;
    if (!matchup) return null;
    const first = current.items.find((item) => item.id === matchup[0]);
    const second = current.items.find((item) => item.id === matchup[1]);
    return first && second ? { first, second } : null;
  });

  function startRanking(event: SubmitEvent) {
    event.preventDefault();
    const names = parsedNames();
    if (names.length < 2) return;
    const next: RankingBoard = addItems(
      { ...initialBoard(), title: titleDraft().trim() || '我的榜单' },
      names,
    );
    setBoard(next);
    setListDraft('');
  }

  function addItem(event: SubmitEvent) {
    event.preventDefault();
    const name = itemDraft().trim();
    if (!name) return;
    const current = board();
    const next = addItems(current, [name]);
    if (next.items.length === current.items.length) {
      setAddError('这个选项已经在榜单里');
      return;
    }
    setBoard(next);
    setItemDraft('');
    setAddError('');
    setAddOpen(false);
  }

  function choose(winnerId: string) {
    setBoard(recordChoice(board(), winnerId));
  }

  function beginNewBoard() {
    if (!window.confirm('新建榜单会替换当前榜单，继续吗？')) return;
    setBoard(initialBoard());
    setTitleDraft('我的榜单');
    setListDraft('');
    setItemDraft('');
    setAddOpen(false);
    setAddError('');
  }

  return (
    <main class="min-h-screen bg-base-200/55 text-base-content">
      <Title>{isNewBoard() ? '排个序' : `${board().title} · 排个序`}</Title>
      <div class="mx-auto min-h-screen max-w-7xl px-4 sm:px-6 lg:px-8">
        <header class="flex h-[4.5rem] items-center justify-between border-b border-base-300/75">
          <a href="/" class="flex items-center gap-3 text-base-content no-underline" aria-label="排个序首页">
            <span class="grid size-9 place-items-center rounded-box bg-primary text-sm font-bold text-primary-content">序</span>
            <span class="text-[15px] font-semibold">排个序</span>
          </a>
          <Show when={!isNewBoard()}>
            <div class="flex items-center gap-2 text-xs text-base-content/60 sm:gap-3">
              <span>{board().comparisons} 次比较</span>
              <span class="hidden h-4 w-px bg-base-300 sm:block" aria-hidden="true" />
              <span class="hidden items-center gap-1.5 sm:flex">
                <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
                自动保存
              </span>
              <button class="btn btn-ghost btn-xs shrink-0 sm:btn-sm" type="button" onClick={beginNewBoard}>
                新建榜单
              </button>
            </div>
          </Show>
        </header>

        <Show
          when={!isNewBoard()}
          fallback={
            <section class="mx-auto grid max-w-5xl gap-10 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)] lg:gap-16 lg:py-20">
              <div>
                <p class="mb-3 text-xs font-semibold uppercase text-primary">新建榜单</p>
                <h1 class="mb-8 text-3xl font-semibold leading-tight">整理你想比较的选项</h1>
                <form class="space-y-6" onSubmit={startRanking}>
                  <fieldset class="fieldset p-0">
                    <legend class="fieldset-legend text-sm font-medium text-base-content">榜单名称</legend>
                    <input
                      class="input w-full border-base-300 bg-base-100"
                      id="board-title"
                      value={titleDraft()}
                      onInput={(event) => setTitleDraft(event.currentTarget.value)}
                      maxlength="60"
                      placeholder="例如：周末想看的电影"
                    />
                  </fieldset>
                  <fieldset class="fieldset p-0">
                    <legend class="fieldset-legend text-sm font-medium text-base-content">选项</legend>
                    <textarea
                      class="textarea min-h-56 w-full resize-y border-base-300 bg-base-100 leading-7 placeholder:text-base-content/35"
                      id="board-items"
                      value={listDraft()}
                      onInput={(event) => setListDraft(event.currentTarget.value)}
                      placeholder={'每行一个选项\n\n《花样年华》\n《千与千寻》\n《海街日记》'}
                    />
                    <p class="label px-0 text-xs text-base-content/55">每行一项，至少两项</p>
                  </fieldset>
                  <button class="btn btn-primary min-w-36" type="submit" disabled={parsedNames().length < 2}>
                    开始比较
                  </button>
                </form>
              </div>

              <aside class="border-t border-base-300 pt-6 lg:mt-11 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <div class="mb-5 flex items-baseline justify-between gap-4">
                  <h2 class="text-sm font-semibold">选项预览</h2>
                  <span class="text-xs text-base-content/55">{parsedNames().length} 项</span>
                </div>
                <Show
                  when={parsedNames().length > 0}
                  fallback={<p class="text-sm leading-6 text-base-content/45">输入内容后会显示在这里</p>}
                >
                  <ol class="max-h-[28rem] divide-y divide-base-300/75 overflow-auto">
                    <For each={parsedNames()}>
                      {(name, index) => (
                        <li class="flex min-h-12 items-center gap-3 py-2.5 text-sm">
                          <span class="w-6 shrink-0 font-mono text-xs text-base-content/40">
                            {String(index() + 1).padStart(2, '0')}
                          </span>
                          <span class="min-w-0 break-words">{name}</span>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              </aside>
            </section>
          }
        >
          <section class="pb-12 pt-9 sm:pb-16 sm:pt-12">
            <div class="mb-8 flex flex-col gap-2">
              <p class="text-xs font-semibold uppercase text-primary">当前榜单</p>
              <h1 class="break-words text-2xl font-semibold leading-tight">{board().title}</h1>
            </div>

            <div class="grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.75fr)] lg:gap-14">
              <section aria-labelledby="compare-heading">
                <div class="mb-5 flex items-end justify-between gap-4">
                  <h2 id="compare-heading" class="text-lg font-semibold">你更喜欢哪一个？</h2>
                  <span class="shrink-0 text-xs text-base-content/55">选择一项</span>
                </div>
                <Show when={currentMatchup()}>
                  {(pair) => (
                    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] sm:items-stretch">
                      <button
                        class="btn btn-outline group flex h-auto min-h-52 w-full flex-col justify-center gap-5 whitespace-normal border-base-300 bg-base-100 px-6 py-8 text-base-content shadow-sm transition hover:border-primary/60 hover:bg-base-100 hover:text-base-content"
                        type="button"
                        aria-label={`选择 ${pair().first.name}`}
                        onClick={() => choose(pair().first.id)}
                      >
                        <span class="text-[11px] font-semibold uppercase text-base-content/40">A</span>
                        <span class="max-w-full break-words text-center text-xl font-semibold leading-snug">{pair().first.name}</span>
                        <span class="text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">选这个</span>
                      </button>
                      <span class="flex items-center justify-center text-[11px] font-medium text-base-content/40">或</span>
                      <button
                        class="btn btn-outline group flex h-auto min-h-52 w-full flex-col justify-center gap-5 whitespace-normal border-base-300 bg-base-100 px-6 py-8 text-base-content shadow-sm transition hover:border-primary/60 hover:bg-base-100 hover:text-base-content"
                        type="button"
                        aria-label={`选择 ${pair().second.name}`}
                        onClick={() => choose(pair().second.id)}
                      >
                        <span class="text-[11px] font-semibold uppercase text-base-content/40">B</span>
                        <span class="max-w-full break-words text-center text-xl font-semibold leading-snug">{pair().second.name}</span>
                        <span class="text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">选这个</span>
                      </button>
                    </div>
                  )}
                </Show>
              </section>

              <section class="border-t border-base-300 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" aria-labelledby="ranking-heading">
                <div class="mb-4 flex items-baseline justify-between gap-4">
                  <h2 id="ranking-heading" class="text-lg font-semibold">当前排名</h2>
                  <span class="text-xs text-base-content/55">{board().items.length} 项</span>
                </div>
                <div class="mb-2 flex items-center justify-between gap-3">
                  <span class="text-xs text-base-content/55">排名置信度</span>
                  <span class="text-sm font-semibold tabular-nums">{confidence()}%</span>
                </div>
                <progress
                  class="progress progress-primary mb-4 h-2 w-full"
                  value={confidence()}
                  max="100"
                  aria-label={`排名置信度 ${confidence()}%`}
                />
                <ol ref={setRankingListElement} class="max-h-[33rem] overflow-auto">
                  <For each={rankedItemIds()}>
                    {(itemId, index) => {
                      const item = createMemo(() => rankedItemsById().get(itemId)!, {
                        name: 'ranked-list-item',
                      });
                      return (
                        <li class="flex min-h-[4.25rem] items-center gap-3 border-b border-base-300/75 py-3">
                          <span class="grid size-8 shrink-0 place-items-center rounded-selector bg-base-300/65 font-mono text-xs text-base-content/65">
                            {String(index() + 1).padStart(2, '0')}
                          </span>
                          <div class="min-w-0 flex-1">
                            <div class="break-words text-sm font-medium leading-snug">{item().name}</div>
                            <div class="mt-1 text-xs text-base-content/50">胜 {item().wins} · 负 {item().losses}</div>
                          </div>
                          <span class="badge badge-soft badge-sm shrink-0 font-mono tabular-nums mx-2">
                            {ratingScore(item().rating)}
                          </span>
                        </li>
                      );
                    }}
                  </For>
                </ol>

                <div class="mt-5">
                  <Show
                    when={addOpen()}
                    fallback={
                      <button class="btn btn-ghost btn-sm px-2 text-primary" type="button" onClick={() => setAddOpen(true)}>
                        <span aria-hidden="true">+</span>
                        添加选项
                      </button>
                    }
                  >
                    <form class="flex flex-col gap-2 sm:flex-row" onSubmit={addItem}>
                      <input
                        class="input input-sm min-w-0 flex-1 border-base-300 bg-base-100"
                        value={itemDraft()}
                        onInput={(event) => {
                          setItemDraft(event.currentTarget.value);
                          setAddError('');
                        }}
                        maxlength="120"
                        aria-label="新选项名称"
                        placeholder="新选项名称"
                      />
                      <button class="btn btn-primary btn-sm" type="submit" disabled={!itemDraft().trim()}>
                        添加
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        type="button"
                        aria-label="取消添加"
                        onClick={() => {
                          setAddOpen(false);
                          setAddError('');
                        }}
                      >
                        取消
                      </button>
                    </form>
                    <Show when={addError()}>
                      <p class="mt-2 text-xs text-error" role="status">{addError()}</p>
                    </Show>
                  </Show>
                </div>
              </section>
            </div>
          </section>
        </Show>
      </div>
    </main>
  );
}

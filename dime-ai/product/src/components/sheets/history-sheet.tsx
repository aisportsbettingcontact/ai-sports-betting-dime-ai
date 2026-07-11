"use client";

import { useMemo } from "react";
import { useDimeApp } from "@/lib/store";
import { Drawer } from "@/components/ui/sheet";
import { SearchIcon, PencilIcon, TrashIcon, CloseIcon } from "@/components/icons";
import type { Conversation } from "@/lib/types";

export function HistorySheet() {
  const { state, dispatch, newChat, loadConvo } = useDimeApp();

  const filtered = useMemo(
    () =>
      state.convos.filter((c) => c.title.toLowerCase().includes(state.historyQuery.trim().toLowerCase())),
    [state.convos, state.historyQuery]
  );

  const groups = useMemo(() => {
    const order: Conversation["group"][] = ["Today", "Yesterday"];
    return order
      .map((group) => ({ group, items: filtered.filter((c) => c.group === group) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <Drawer open={state.historyOpen} onClose={() => dispatch({ type: "CLOSE_SHEETS" })} ariaLabel="Chat history">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-[19px] font-bold text-text-1 m-0">Chat history</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={newChat}
            className="h-9 px-3.5 rounded-full bg-mint text-on-mint text-[13px] font-semibold flex items-center gap-1 active:opacity-85"
          >
            <span aria-hidden>+</span> New chat
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dispatch({ type: "CLOSE_SHEETS" })}
            className="w-9 h-9 rounded-full flex items-center justify-center text-text-3 active:bg-surface-2"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 h-10 mb-4 flex-none">
        <SearchIcon size={15} className="text-text-3 flex-none" />
        <input
          value={state.historyQuery}
          onChange={(e) => dispatch({ type: "SET_HISTORY_QUERY", query: e.target.value })}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="flex-1 bg-transparent text-[13.5px] text-text-1 placeholder:text-text-3"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
        {groups.length === 0 && (
          <p className="text-center text-[13.5px] text-text-3 py-8">No conversations found</p>
        )}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3 px-1 pb-1.5">{group}</div>
            <div className="flex flex-col gap-0.5">
              {items.map((c) => (
                <ConvoRow key={c.id} convo={c} onLoad={() => loadConvo(c.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function ConvoRow({ convo, onLoad }: { convo: Conversation; onLoad: () => void }) {
  const { state, dispatch } = useDimeApp();
  const isRenaming = state.renamingId === convo.id;
  const isConfirmingDelete = state.confirmDeleteId === convo.id;

  if (isRenaming) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          autoFocus
          value={state.renameDraft}
          onChange={(e) => dispatch({ type: "SET_RENAME_DRAFT", draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") dispatch({ type: "COMMIT_RENAME" });
          }}
          className="flex-1 min-w-0 bg-surface-2 rounded-lg px-2.5 py-1.5 text-[14.5px] text-text-1"
        />
        <button
          type="button"
          onClick={() => dispatch({ type: "COMMIT_RENAME" })}
          className="flex-none text-[13px] font-semibold text-mint px-1"
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-lg group">
      <button type="button" onClick={onLoad} className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 text-left active:bg-surface-2 rounded-lg">
        {convo.current && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-mint flex-none" />}
        <span className="flex flex-col min-w-0">
          <span className="text-[14.5px] font-medium text-text-1 truncate">{convo.title}</span>
          <span className="text-[12px] text-text-3 truncate">{convo.sub}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Rename ${convo.title}`}
        onClick={() => dispatch({ type: "START_RENAME", id: convo.id, draft: convo.title })}
        className="flex-none w-8 h-8 rounded-lg flex items-center justify-center text-text-3 active:bg-surface-2"
      >
        <PencilIcon size={14} />
      </button>
      {isConfirmingDelete ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "COMMIT_DELETE", id: convo.id })}
          className="flex-none text-[12.5px] font-semibold text-text-1 px-2"
        >
          Delete?
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Delete ${convo.title}`}
          onClick={() => dispatch({ type: "ARM_DELETE", id: convo.id })}
          className="flex-none w-8 h-8 rounded-lg flex items-center justify-center text-text-3 active:bg-surface-2"
        >
          <TrashIcon size={14} />
        </button>
      )}
    </div>
  );
}
